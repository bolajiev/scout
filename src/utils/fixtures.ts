import { getDb } from './historyDb';
import { getActiveFdKey } from './storage';

export interface Fixture {
  idEvent: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strLeague: string;
  strTime: string;
  dateEvent: string | null;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strHomeTeamBadge: string | null;
  strAwayTeamBadge: string | null;
}

// TheSportsDB badge URLs serve resized variants via a path suffix —
// "/small" (~128px) is plenty for our circles. Other sources (football-data
// crests) are used as-is.
export const badgeUrl = (url: string | null | undefined): string | null =>
  url ? (url.includes('thesportsdb') ? `${url}/small` : url) : null;

export const todayISO = () => new Date().toISOString().split('T')[0];

export const isWorldCup = (f: Fixture) =>
  /world cup/i.test(f.strLeague) || /fifa wc/i.test(f.strLeague);

const timeToMins = (t: string): number | null => {
  if (!t || t === '00:00:00') return null;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
};

export const isLive = (f: Fixture): boolean => {
  if (f.dateEvent && f.dateEvent !== todayISO()) return false;
  const mins = timeToMins(f.strTime);
  if (mins === null) return false;
  const now = new Date();
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const elapsed = nowMins - mins;
  return elapsed >= 0 && elapsed <= 105;
};

// Scores present and the match is no longer running → final result
export const isFinished = (f: Fixture): boolean =>
  f.intHomeScore != null && f.intAwayScore != null && !isLive(f);

// Days from today to the event date (0 = today, negative = past, null = unknown)
const dayDiff = (f: Fixture): number | null => {
  if (!f.dateEvent) return null;
  const d = Date.parse(f.dateEvent);
  const t = Date.parse(todayISO());
  if (isNaN(d) || isNaN(t)) return null;
  return Math.round((d - t) / 86_400_000);
};

// Rail ordering: live matches first (all of them), then upcoming by
// kick-off (today before future days), finished matches last
export const fixtureOrder = (f: Fixture): number => {
  const mins = timeToMins(f.strTime) ?? 0;
  const key = (dayDiff(f) ?? 0) * 1440 + mins;
  if (isLive(f)) return -1_000_000 + key;
  if (isFinished(f)) return 1_000_000 + key;
  return key;
};

// Pick the single most relevant match to surface on the home card.
// Live match wins immediately. Then soonest upcoming. World Cup pool first.
export const findClosestMatch = (fixtures: Fixture[]): Fixture | null => {
  if (fixtures.length === 0) return null;

  const wc = fixtures.filter(isWorldCup);
  const pool = wc.length > 0 ? wc : fixtures;

  const now = new Date();
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();

  let best: Fixture | null = null;
  let bestScore = Infinity;

  for (const f of pool) {
    const mins = timeToMins(f.strTime);
    if (mins === null) {
      if (!best) best = f;
      continue;
    }
    const days = dayDiff(f) ?? 0;
    const diff = days * 1440 + (mins - nowMins);
    if (diff >= -105 && diff <= 0 && days === 0) return f; // live → immediate winner
    const score = diff > 0 ? diff : 10_000 + Math.abs(diff);
    if (score < bestScore) { bestScore = score; best = f; }
  }

  return best;
};

export const fmtMatchTime = (t: string): string => {
  if (!t || t === '00:00:00') return '';
  const [h, m] = t.split(':');
  return `${h}:${m}`;
};

// "Saudi Arabia" → "SAU", "Brazil" → "BRA"
export const teamAbbr = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join('').slice(0, 3).toUpperCase();
};

// ── SQLite cache ──────────────────────────────────────────────────────────────

const saveFixturesToDb = (fixtures: Fixture[], date: string) => {
  const db = getDb();
  db.runSync('DELETE FROM fixtures WHERE cache_date != ?', [date]);
  for (const f of fixtures) {
    db.runSync(
      `INSERT OR REPLACE INTO fixtures
         (id_event, home_team, away_team, league, match_time, date_event,
          home_score, away_score, home_badge, away_badge, cache_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.idEvent, f.strHomeTeam, f.strAwayTeam, f.strLeague, f.strTime, f.dateEvent ?? null,
       f.intHomeScore ?? null, f.intAwayScore ?? null,
       f.strHomeTeamBadge ?? null, f.strAwayTeamBadge ?? null, date],
    );
  }
};

const loadFixturesFromDb = (date: string): Fixture[] => {
  const db = getDb();
  const rows = db.getAllSync<{
    id_event: string; home_team: string; away_team: string;
    league: string; match_time: string; date_event: string | null;
    home_score: string | null; away_score: string | null;
    home_badge: string | null; away_badge: string | null;
  }>('SELECT * FROM fixtures WHERE cache_date = ?', [date]);

  return rows.map(r => ({
    idEvent: r.id_event,
    strHomeTeam: r.home_team,
    strAwayTeam: r.away_team,
    strLeague: r.league,
    strTime: r.match_time,
    dateEvent: r.date_event,
    intHomeScore: r.home_score,
    intAwayScore: r.away_score,
    strHomeTeamBadge: r.home_badge,
    strAwayTeamBadge: r.away_badge,
  }));
};

// ─────────────────────────────────────────────────────────────────────────────

// TheSportsDB is the best fully-free no-key soccer API.
// We fetch today's general soccer matches, then separately try the
// FIFA World Cup 2026 league (id=4429) so WC fixtures always appear even
// if the day endpoint doesn't surface them.
const WC_LEAGUE_ID = '4429';

// AbortSignal.timeout() does not exist in React Native's Hermes runtime —
// calling it throws synchronously, which made every fetch "fail" and the app
// permanently show the offline fallback. Manual AbortController instead.
export const fetchWithTimeout = async (url: string, ms = 8000, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

// football-data.org v4 (optional, user-supplied free key): accurate scores
// and fixtures for the 12 major competitions incl. World Cup, PL, UCL.
// One /matches call covers a whole date window — friendly to the 10/min cap.
const fetchFdMatches = async (key: string, from: string, to: string): Promise<Fixture[]> => {
  try {
    const res = await fetchWithTimeout(
      `https://api.football-data.org/v4/matches?dateFrom=${from}&dateTo=${to}`,
      8000,
      { headers: { 'X-Auth-Token': key } },
    );
    if (!res.ok) return []; // 429 rate limit or bad key — silently fall back
    const data = await res.json();
    return (data.matches ?? []).map((m: any): Fixture => {
      const utc = new Date(m.utcDate);
      const hh = String(utc.getUTCHours()).padStart(2, '0');
      const mm = String(utc.getUTCMinutes()).padStart(2, '0');
      const started = m.status === 'IN_PLAY' || m.status === 'PAUSED' || m.status === 'FINISHED';
      const crest = (u: string | null | undefined) =>
        u && /\.(png|jpg|jpeg)$/i.test(u) ? u : null; // RN Image can't render SVG crests
      return {
        idEvent: `fd-${m.id}`,
        strHomeTeam: m.homeTeam?.shortName || m.homeTeam?.name || '',
        strAwayTeam: m.awayTeam?.shortName || m.awayTeam?.name || '',
        strLeague: m.competition?.name ?? '',
        strTime: `${hh}:${mm}:00`,
        dateEvent: m.utcDate?.split('T')[0] ?? null,
        intHomeScore: started && m.score?.fullTime?.home != null ? String(m.score.fullTime.home) : null,
        intAwayScore: started && m.score?.fullTime?.away != null ? String(m.score.fullTime.away) : null,
        strHomeTeamBadge: crest(m.homeTeam?.crest),
        strAwayTeamBadge: crest(m.awayTeam?.crest),
      };
    }).filter((f: Fixture) => f.strHomeTeam && f.strAwayTeam);
  } catch {
    return [];
  }
};

export const fetchAndCacheFixtures = async (): Promise<{
  fixtures: Fixture[];
  fromCache: boolean;
  online: boolean;
}> => {
  const today = todayISO();
  const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().split('T')[0];

  try {
    const fdKey = await getActiveFdKey().catch(() => '');

    // Keyed mode: football-data.org is the exclusive source while the key
    // works — the free API is only consulted if the keyed call fails or
    // returns nothing (rate limit, outage, bad key).
    const fdMatches = fdKey ? await fetchFdMatches(fdKey, today, plusDays(2)) : [];

    let results: (Response | null)[] = [];
    if (fdMatches.length === 0) {
      // Free keyless source: WC next events + today's soccer + next two days
      results = await Promise.all([
        fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${WC_LEAGUE_ID}`),
        fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${today}&s=Soccer`),
        fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${plusDays(1)}&s=Soccer`),
        fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${plusDays(2)}&s=Soccer`),
      ].map(p => p.then(r => r as Response | null).catch(() => null)));
    }

    const oks = results.map(r => !!r && r.ok);
    // Every source unreachable → we are offline; don't report success with 0 fixtures
    if (!oks.some(Boolean) && fdMatches.length === 0) throw new Error('offline');

    const eventLists: any[][] = await Promise.all(results.map(async (r, i) =>
      oks[i] ? (((await (r as Response).json()).events) ?? []) : []
    ));

    // Merge: football-data first (accurate scores when keyed), then TheSportsDB.
    // Dedup by team-pair + date so the same real match never appears twice
    // across sources, plus by idEvent within a source.
    const seenId = new Set<string>();
    const seenMatch = new Set<string>();
    const matchKey = (f: Fixture) =>
      `${f.strHomeTeam.toLowerCase().slice(0, 6)}|${f.strAwayTeam.toLowerCase().slice(0, 6)}|${f.dateEvent ?? ''}`;
    const merged: Fixture[] = [];

    for (const f of fdMatches) {
      if (!seenId.has(f.idEvent) && !seenMatch.has(matchKey(f))) {
        seenId.add(f.idEvent);
        seenMatch.add(matchKey(f));
        merged.push(f);
      }
    }
    for (const e of eventLists.flat()) {
      if (!e.idEvent || seenId.has(e.idEvent)) continue;
      const f: Fixture = {
        idEvent: e.idEvent,
        strHomeTeam: e.strHomeTeam ?? '',
        strAwayTeam: e.strAwayTeam ?? '',
        strLeague: e.strLeague ?? '',
        strTime: e.strTime ?? '',
        dateEvent: e.dateEvent ?? null,
        intHomeScore: e.intHomeScore ?? null,
        intAwayScore: e.intAwayScore ?? null,
        strHomeTeamBadge: e.strHomeTeamBadge ?? null,
        strAwayTeamBadge: e.strAwayTeamBadge ?? null,
      };
      if (seenMatch.has(matchKey(f))) continue;
      seenId.add(f.idEvent);
      seenMatch.add(matchKey(f));
      merged.push(f);
    }

    // Caching is best-effort — never lose fresh network data to a DB error
    try { saveFixturesToDb(merged, today); } catch {}
    return { fixtures: merged, fromCache: false, online: true };
  } catch {
    let cached: Fixture[] = [];
    try { cached = loadFixturesFromDb(today); } catch {}
    return { fixtures: cached, fromCache: true, online: false };
  }
};
