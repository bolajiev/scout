import { getDb } from './historyDb';

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

// TheSportsDB badge URLs serve resized variants via a path suffix.
// "/small" (~128px) is plenty for our 36-56px circles and loads fast.
export const badgeUrl = (url: string | null | undefined): string | null =>
  url ? `${url}/small` : null;

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

// Days from today to the event date (0 = today, negative = past, null = unknown)
const dayDiff = (f: Fixture): number | null => {
  if (!f.dateEvent) return null;
  const d = Date.parse(f.dateEvent);
  const t = Date.parse(todayISO());
  if (isNaN(d) || isNaN(t)) return null;
  return Math.round((d - t) / 86_400_000);
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
const fetchWithTimeout = async (url: string, ms = 8000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const fetchAndCacheFixtures = async (): Promise<{
  fixtures: Fixture[];
  fromCache: boolean;
  online: boolean;
}> => {
  const today = todayISO();

  try {
    // Parallel: today's soccer + WC next events
    const [dayRes, wcRes] = await Promise.allSettled([
      fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${today}&s=Soccer`),
      fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${WC_LEAGUE_ID}`),
    ]);

    const dayOk = dayRes.status === 'fulfilled' && dayRes.value.ok;
    const wcOk = wcRes.status === 'fulfilled' && wcRes.value.ok;

    // Both endpoints unreachable → we are offline; don't report success with 0 fixtures
    if (!dayOk && !wcOk) throw new Error('offline');

    const dayEvents: any[] = dayOk ? ((await (dayRes as PromiseFulfilledResult<Response>).value.json()).events ?? []) : [];
    const wcEvents: any[] = wcOk ? ((await (wcRes as PromiseFulfilledResult<Response>).value.json()).events ?? []) : [];

    // Merge: WC events first, deduplicated by idEvent (skip entries missing idEvent)
    const seen = new Set<string>();
    const merged: Fixture[] = [];
    for (const e of [...wcEvents, ...dayEvents]) {
      if (e.idEvent && !seen.has(e.idEvent)) {
        seen.add(e.idEvent);
        merged.push({
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
        });
      }
    }

    saveFixturesToDb(merged, today);
    return { fixtures: merged, fromCache: false, online: true };
  } catch {
    const cached = loadFixturesFromDb(today);
    return { fixtures: cached, fromCache: true, online: false };
  }
};
