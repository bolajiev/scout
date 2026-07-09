import { getDb } from './historyDb';
import { getActiveFdKey, getActiveBzKey } from './storage';
import { fetchBzMatches, fetchBzTopLeagueMatches, TOP_LEAGUES } from './bzzoiro';

const TOP_LEAGUE_NAMES = new Set(TOP_LEAGUES.map(l => l.name));

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
  // Only populated for football-data.org (fd-*) fixtures via the per-match
  // detail endpoint — the bulk /v4/matches list this app polls for the
  // fixture list does NOT include minute or goalscorers, only the score.
  minute?: number | null;
  lastScorer?: { team: 'home' | 'away'; name: string; minute: number } | null;
}

// TheSportsDB badge URLs serve resized variants via a path suffix —
// "/small" (~128px) is plenty for our circles. Other sources (football-data
// crests) are used as-is.
export const badgeUrl = (url: string | null | undefined): string | null =>
  url ? (url.includes('thesportsdb') ? `${url}/small` : url) : null;

export const todayISO = () => new Date().toISOString().split('T')[0];

export const isWorldCup = (f: Fixture) =>
  /world cup/i.test(f.strLeague) || /fifa wc/i.test(f.strLeague);

// One canonical name for World Cup fixtures regardless of source — verified
// live that TheSportsDB, football-data.org, and Bzzoiro each spell this
// differently ("FIFA World Cup 2026" vs "World Cup 2026" vs similar).
// Without normalizing, a single pinned chip can't exact-match all three,
// and the same tournament could show up as two different filter chips.
export const WC_NAME = 'FIFA World Cup 2026';
export const normalizeLeague = (name: string): string =>
  (/world cup/i.test(name) || /fifa wc/i.test(name)) ? WC_NAME : name;

const timeToMins = (t: string): number | null => {
  if (!t || t === '00:00:00') return null;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
};

export const isLive = (f: Fixture): boolean => {
  if (!f.dateEvent) return false;
  const mins = timeToMins(f.strTime);
  if (mins === null) return false;
  // Compare full timestamps, not just minute-of-day — a same-day-only
  // check broke any match still playing after midnight UTC (kickoff
  // 23:xx, still live at 00:3x the next calendar day) by comparing
  // against the wrong day's minute count. Also widened 90+15 -> 130 to
  // cover real matches with heavy stoppage time before they're finished.
  const kickoff = Date.parse(`${f.dateEvent}T00:00:00Z`) + mins * 60_000;
  const elapsed = (Date.now() - kickoff) / 60_000;
  return elapsed >= 0 && elapsed <= 130;
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

// Rough competition prestige tiers, used to keep a small regional league
// from outranking the World Cup or a top-5 European league just because it
// kicks off a few minutes earlier — verified this was a real, visible
// problem: TheSportsDB/Bzzoiro list order is arbitrary, so "Australia
// Northern NSW NPL" was landing above real World Cup fixtures on the same
// day purely by chance. Not exhaustive — anything unrecognized lands in
// the neutral middle tier rather than being wrongly promoted or demoted.
const TIER1_COMPETITIONS = /champions league|europa league|conference league|european championship|euro 20\d\d|copa am[eé]rica|africa cup of nations|asian cup|gold cup|nations league/i;
const TIER3_LEAGUES = /eredivisie|primeira liga|liga portugal|brasileir[aã]o s[eé]rie a\b|major league soccer|\bmls\b|scottish premiership|s[uü]per lig|saudi pro league|liga mx|championship\b/i;
const LOWER_TIER_MARKERS = /serie b\b|segunda divisi[oó]n|2\. ?bundesliga|ligue 2\b|league one|league two|u1[0-9]\b|u2[0-3]\b|under-?1[0-9]\b|under-?2[0-3]\b|youth|reserve|academy|regional|amateur|\bnpl\b|division [2-9]/i;

export const leagueRank = (league: string): number => {
  if (!league) return 4;
  if ((/world cup/i.test(league) || /fifa wc/i.test(league)) && !/qualif/i.test(league)) return 0;
  if (TIER1_COMPETITIONS.test(league)) return 1;
  if (TOP_LEAGUE_NAMES.has(league)) return 2;
  if (TIER3_LEAGUES.test(league)) return 3;
  if (LOWER_TIER_MARKERS.test(league)) return 5;
  return 4;
};

// Rail ordering: live matches first (all of them, higher-tier competitions
// ahead of lower ones within that group), then upcoming sorted by league
// tier first and kick-off time second (a small regional match can't outrank
// the World Cup just because it kicks off a few minutes earlier), finished
// matches last.
export const fixtureOrder = (f: Fixture): number => {
  const mins = timeToMins(f.strTime) ?? 0;
  const dayKey = (dayDiff(f) ?? 0) * 1440 + mins;
  const rank = leagueRank(f.strLeague);
  if (isLive(f)) return -10_000_000 + rank * 10_000 + mins;
  if (isFinished(f)) return 10_000_000 + rank * 10_000 + mins;
  return rank * 100_000 + dayKey;
};

// Pick the single most relevant match to surface on the home card.
// Live match wins immediately. Then soonest upcoming. World Cup pool first.
export const findClosestMatch = (fixtures: Fixture[]): Fixture | null => {
  if (fixtures.length === 0) return null;

  // BUG FIX: when no World Cup match is in the current fetch window, this
  // used to fall straight back to ALL fixtures with zero regard for
  // league prominence — verified live, an Estonian Esiliiga match became
  // the featured hero card purely because it kicked off soonest, ahead of
  // any top-5-league match also in the list. Falls back one tier at a
  // time instead: WC, then any notable competition (leagueRank <= 3),
  // only reaching truly any-league as the last resort.
  const wc = fixtures.filter(isWorldCup);
  const notable = fixtures.filter(f => leagueRank(f.strLeague) <= 3);
  const pool = wc.length > 0 ? wc : notable.length > 0 ? notable : fixtures;

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

type FixtureRow = {
  id_event: string; home_team: string; away_team: string;
  league: string; match_time: string; date_event: string | null;
  home_score: string | null; away_score: string | null;
  home_badge: string | null; away_badge: string | null;
};
const rowToFixture = (r: FixtureRow): Fixture => ({
  idEvent: r.id_event,
  strHomeTeam: r.home_team,
  strAwayTeam: r.away_team,
  strLeague: normalizeLeague(r.league),
  strTime: r.match_time,
  dateEvent: r.date_event,
  intHomeScore: r.home_score,
  intAwayScore: r.away_score,
  strHomeTeamBadge: r.home_badge,
  strAwayTeamBadge: r.away_badge,
});

// Coach's get_today_fixtures tool reads this directly instead of doing its
// own live fetch — verified live, that used to mean a SECOND full
// fetchAndCacheFixtures() call (Bzzoiro + 4 separate TheSportsDB HTTP
// calls) on every single fixtures question, on top of whatever the
// Matches tab had already fetched moments earlier. This is instant (a
// synchronous SQLite read of whatever's already cached), so it only
// falls back to a live call at all when nothing's cached yet.
export const getCachedFixturesNow = (): Fixture[] => loadFixturesFromDb(todayISO());

const loadFixturesFromDb = (date: string): Fixture[] => {
  const db = getDb();
  const rows = db.getAllSync<FixtureRow>('SELECT * FROM fixtures WHERE cache_date = ?', [date]);
  if (rows.length > 0) return rows.map(rowToFixture);
  // BUG FIX: saveFixturesToDb wipes any OTHER date's rows on every
  // successful fetch, so the table only ever holds one date's worth of
  // fixtures at a time anyway — requiring an EXACT match on `date` meant
  // opening the app offline on a day nothing had successfully fetched yet
  // returned nothing at all, even though yesterday's real fixtures (still
  // informative, just possibly stale) were sitting right there until the
  // next successful fetch. Fall back to whatever's cached, any date.
  const fallback = db.getAllSync<FixtureRow>('SELECT * FROM fixtures ORDER BY cache_date DESC LIMIT 50');
  return fallback.map(rowToFixture);
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
        strLeague: normalizeLeague(m.competition?.name ?? ''),
        strTime: `${hh}:${mm}:00`,
        dateEvent: m.utcDate?.split('T')[0] ?? null,
        intHomeScore: started && m.score?.fullTime?.home != null ? String(m.score.fullTime.home) : null,
        intAwayScore: started && m.score?.fullTime?.away != null ? String(m.score.fullTime.away) : null,
        strHomeTeamBadge: crest(m.homeTeam?.crest),
        strAwayTeamBadge: crest(m.awayTeam?.crest),
        // The list endpoint sometimes carries this for free; the detail
        // endpoint (fetchFdMatchDetail) is the reliable source, polled
        // separately per-live-match since minute/scorers aren't guaranteed
        // here.
        minute: m.status === 'IN_PLAY' || m.status === 'PAUSED' ? (m.minute ?? null) : null,
      };
    }).filter((f: Fixture) => f.strHomeTeam && f.strAwayTeam);
  } catch {
    return [];
  }
};

// Per-match detail — the ONLY football-data.org endpoint that reliably
// includes the current minute and goalscorers; the bulk list above omits
// both. Called sparingly (see LIVE_POLL_MIN_GAP_MS in HomeScreen) to stay
// inside the free tier's 10 requests/minute cap.
export const fetchFdMatchDetail = async (
  key: string,
  fdIdEvent: string, // "fd-12345"
): Promise<{ minute: number | null; homeScore: number | null; awayScore: number | null; lastScorer: Fixture['lastScorer'] }> => {
  const id = fdIdEvent.replace(/^fd-/, '');
  try {
    const res = await fetchWithTimeout(
      `https://api.football-data.org/v4/matches/${id}`,
      8000,
      { headers: { 'X-Auth-Token': key } },
    );
    if (!res.ok) return { minute: null, homeScore: null, awayScore: null, lastScorer: null };
    const m = await res.json();
    const goals: any[] = m.goals ?? [];
    const last = goals[goals.length - 1];
    const lastScorer: Fixture['lastScorer'] = last
      ? {
          team: last.team?.id === m.homeTeam?.id ? 'home' : 'away',
          name: last.scorer?.name ?? '',
          minute: last.minute ?? 0,
        }
      : null;
    return {
      minute: m.minute ?? null,
      homeScore: m.score?.fullTime?.home ?? null,
      awayScore: m.score?.fullTime?.away ?? null,
      lastScorer: lastScorer && lastScorer.name ? lastScorer : null,
    };
  } catch {
    return { minute: null, homeScore: null, awayScore: null, lastScorer: null };
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
    const [fdKey, bzKey] = await Promise.all([
      getActiveFdKey().catch(() => ''),
      getActiveBzKey().catch(() => ''),
    ]);

    // Bzzoiro first when keyed — its bulk list already carries live minute
    // directly (no per-match detail call needed, unlike football-data.org),
    // and its predictions feed Predictor's real odds. football-data.org is
    // the fallback keyed source, then the free keyless source last. The
    // top-5-league fetch uses a wider window so those chips always have at
    // least one upcoming fixture even during a gap the normal 2-day window
    // would miss (international break, etc).
    const [bzMatches, bzTopLeagueMatches] = bzKey
      ? await Promise.all([fetchBzMatches(bzKey, today, plusDays(2)), fetchBzTopLeagueMatches(bzKey, today, plusDays(21))])
      : [[], []];
    const fdMatches = bzMatches.length === 0 && fdKey ? await fetchFdMatches(fdKey, today, plusDays(2)) : [];
    const keyedMatches = [...bzMatches, ...bzTopLeagueMatches, ...fdMatches];

    // BUG FIX: this used to only query TheSportsDB when NO keyed source
    // found anything at all — meaning the instant Bzzoiro found even one
    // match (near-guaranteed once WC 2026 kicked off, since the shared
    // default key is basically always active), TheSportsDB's entire unique
    // league coverage silently disappeared for the rest of the day. The two
    // sources cover different leagues, not a strict superset/subset, so
    // always querying both and merging (keyed sources win on overlap, see
    // dedup below) is the only way to not lose coverage either had alone.
    const results = await Promise.all([
      fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${WC_LEAGUE_ID}`),
      fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${today}&s=Soccer`),
      fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${plusDays(1)}&s=Soccer`),
      fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${plusDays(2)}&s=Soccer`),
    ].map(p => p.then(r => r as Response | null).catch(() => null)));

    const oks = results.map(r => !!r && r.ok);
    // Every source unreachable → we are offline; don't report success with 0 fixtures
    if (!oks.some(Boolean) && keyedMatches.length === 0) throw new Error('offline');

    const eventLists: any[][] = await Promise.all(results.map(async (r, i) =>
      oks[i] ? (((await (r as Response).json()).events) ?? []) : []
    ));

    // Merge: keyed sources first (Bzzoiro, then football-data.org — accurate
    // scores/minute when keyed), then TheSportsDB. Dedup by team-pair + date
    // so the same real match never appears twice across sources, plus by
    // idEvent within a source.
    //
    // BUG FIX: this used to key on `name.slice(0, 6)` for both teams —
    // football-data.org supplies short names ("Man United") while
    // TheSportsDB/Bzzoiro supply full names ("Manchester United"); those
    // truncate to different 6-char prefixes ("man un" vs "manche") so the
    // SAME real match slipped past the dedup and showed twice. In the
    // other direction, unrelated teams sharing a 6-char prefix ("Barcelona"
    // vs "Barcelona SC", an Ecuadorian club) truncate to the identical key
    // and would have been wrongly merged into one. A containment check on
    // the FULL normalized name (with a minimum length so short/common
    // words can't false-positive) handles the short-vs-full-name case
    // correctly without introducing the truncation's own false positives.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const teamsMatch = (a: string, b: string): boolean => {
      const na = norm(a), nb = norm(b);
      if (!na || !nb) return false;
      if (na === nb) return true;
      return (na.length >= 4 && nb.includes(na)) || (nb.length >= 4 && na.includes(nb));
    };
    const isSameFixture = (a: Fixture, b: Fixture): boolean =>
      (a.dateEvent ?? '') === (b.dateEvent ?? '') && teamsMatch(a.strHomeTeam, b.strHomeTeam) && teamsMatch(a.strAwayTeam, b.strAwayTeam);

    const seenId = new Set<string>();
    const merged: Fixture[] = [];

    for (const f of keyedMatches) {
      if (!seenId.has(f.idEvent) && !merged.some(m => isSameFixture(m, f))) {
        seenId.add(f.idEvent);
        merged.push(f);
      }
    }
    for (const e of eventLists.flat()) {
      if (!e.idEvent || seenId.has(e.idEvent)) continue;
      const f: Fixture = {
        idEvent: e.idEvent,
        strHomeTeam: e.strHomeTeam ?? '',
        strAwayTeam: e.strAwayTeam ?? '',
        strLeague: normalizeLeague(e.strLeague ?? ''),
        strTime: e.strTime ?? '',
        dateEvent: e.dateEvent ?? null,
        intHomeScore: e.intHomeScore ?? null,
        intAwayScore: e.intAwayScore ?? null,
        strHomeTeamBadge: e.strHomeTeamBadge ?? null,
        strAwayTeamBadge: e.strAwayTeamBadge ?? null,
      };
      if (merged.some(m => isSameFixture(m, f))) continue;
      seenId.add(f.idEvent);
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
