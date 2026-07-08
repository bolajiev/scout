import type { Fixture } from './fixtures';
import type { TeamForm } from './teamStats';

// Bzzoiro Sports Data API (sports.bzzoiro.com) — free football data API.
// Used only for data lookups here: fixtures, live scores/minute, and last-N
// real match results for grounding Coach/Predictor's prompts. Bzzoiro also
// offers a cloud ML match-prediction endpoint, deliberately NOT used —
// Scout's whole pitch is 100% on-device AI, and calling a remote ML model
// for the win-probability number would quietly contradict that. The
// on-device LLM computes its own win/draw/win estimate instead, reasoning
// over the real recent-form data this file supplies.
const BASE = 'https://sports.bzzoiro.com';
const authHeaders = (key: string) => ({ Authorization: `Token ${key}` });

// Not imported from fixtures.ts — that file imports Bzzoiro helpers for the
// merge waterfall, and a two-way import would create a cycle.
const fetchWithTimeout = async (url: string, ms = 8000, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const norm = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// /api/v2/events/ is paginated ({count, next, previous, results}) despite
// the published OpenAPI spec documenting it as a bare array — verified
// against the live API, not just the docs, since trusting the docs here
// would have made every .map() below throw on an object instead of an
// array.
async function fetchBzEventsPage(url: string, key: string, ms = 8000): Promise<any[]> {
  const res = await fetchWithTimeout(url, ms, { headers: authHeaders(key) });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : (data.results ?? []);
}

export interface BzLiveMatch {
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  minute: number | null;
  status: string;
}

// One bulk call carries minute + score for every live match — unlike
// football-data.org, no separate per-match detail call is needed.
export async function fetchBzLiveEvents(key: string): Promise<BzLiveMatch[]> {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/v2/events/live/`, 8000, { headers: authHeaders(key) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events ?? []).map((e: any): BzLiveMatch => ({
      homeTeam: e.home_team ?? '',
      awayTeam: e.away_team ?? '',
      homeScore: e.home_score ?? null,
      awayScore: e.away_score ?? null,
      minute: e.current_minute ?? null,
      status: e.status ?? '',
    }));
  } catch {
    return [];
  }
}

const bzTeamName = (t: any, fallback: string) => typeof t === 'string' ? t : (t?.name ?? fallback ?? '');

// Future knockout-round fixtures are scheduled before the teams are known —
// verified live, Bzzoiro fills those in as literal placeholder codes like
// "W101" (winner of match 101) or "L101" (loser of match 101) until the
// earlier round finishes. Showing that literally as a team name in a match
// card would just look broken, so these are filtered out entirely rather
// than displayed — they'll appear normally once real teams are confirmed.
const isPlaceholderTeam = (name: string) => /^[WL]\d+$/i.test(name.trim());
const hasRealTeams = (f: Fixture) =>
  !!f.strHomeTeam && !!f.strAwayTeam && !isPlaceholderTeam(f.strHomeTeam) && !isPlaceholderTeam(f.strAwayTeam);

// The general events list only ever carries league_id (a bare number),
// never a name — verified live, despite EventBriefV2Schema/live-list
// schemas in the docs having a name field. Resolved once per session via
// /api/v2/leagues/ (66 total, one page) and cached in memory since leagues
// essentially never change within a running app.
let leagueNameCache: Map<number, string> | null = null;
let leagueNameCachePromise: Promise<Map<number, string>> | null = null;
async function getLeagueNameMap(key: string): Promise<Map<number, string>> {
  if (leagueNameCache) return leagueNameCache;
  if (leagueNameCachePromise) return leagueNameCachePromise;
  leagueNameCachePromise = (async () => {
    const map = new Map<number, string>();
    try {
      const res = await fetchWithTimeout(`${BASE}/api/v2/leagues/?limit=200`, 8000, { headers: authHeaders(key) });
      if (res.ok) {
        const data = await res.json();
        const list: any[] = Array.isArray(data) ? data : (data.results ?? []);
        for (const l of list) if (l.id != null && l.name) map.set(l.id, l.name);
      }
    } catch {}
    leagueNameCache = map;
    return map;
  })();
  return leagueNameCachePromise;
}

// Duplicated from fixtures.ts's normalizeLeague/WC_NAME rather than
// imported, for the same reason as fetchWithTimeout above — fixtures.ts
// imports this file's fetch functions as values, so importing a value back
// would create a cycle. Must stay in sync with fixtures.ts's WC_NAME.
const BZ_WC_NAME = 'FIFA World Cup 2026';
const bzNormalizeLeague = (name: string): string =>
  (/world cup/i.test(name) || /fifa wc/i.test(name)) ? BZ_WC_NAME : name;

function mapBzEvent(e: any, leagueNames?: Map<number, string>, leagueNameOverride?: string): Fixture {
  const utc = new Date(e.event_date);
  const hh = String(utc.getUTCHours()).padStart(2, '0');
  const mm = String(utc.getUTCMinutes()).padStart(2, '0');
  const started = e.status === 'inprogress' || e.status === 'penalties' || e.status === 'finished';
  return {
    idEvent: `bz-${e.id}`,
    strHomeTeam: bzTeamName(e.home_team, e.home_team_name),
    strAwayTeam: bzTeamName(e.away_team, e.away_team_name),
    strLeague: bzNormalizeLeague(leagueNameOverride ?? e.league?.name ?? e.league_name ?? leagueNames?.get(e.league_id) ?? ''),
    strTime: `${hh}:${mm}:00`,
    dateEvent: e.event_date?.split('T')[0] ?? null,
    intHomeScore: started && e.home_score != null ? String(e.home_score) : null,
    intAwayScore: started && e.away_score != null ? String(e.away_score) : null,
    strHomeTeamBadge: null, // Bzzoiro doesn't expose crest URLs — TeamBadge resolves by name instead
    strAwayTeamBadge: null,
    minute: e.status === 'inprogress' ? (e.current_minute ?? null) : null,
  };
}

// Full fixture window (today + a couple days) for the Matches list — same
// shape of call as football-data.org's /v4/matches, one request per window.
export async function fetchBzMatches(key: string, from: string, to: string): Promise<Fixture[]> {
  try {
    const params = new URLSearchParams({ date_from: from, date_to: to, limit: '200' });
    const [events, leagueNames] = await Promise.all([
      fetchBzEventsPage(`${BASE}/api/v2/events/?${params}`, key),
      getLeagueNameMap(key),
    ]);
    return events.map(e => mapBzEvent(e, leagueNames)).filter(hasRealTeams);
  } catch {
    return [];
  }
}

// Pinned top-5 European league IDs, confirmed live against the API
// (GET /api/v2/leagues/?country=England etc. — Bzzoiro has no name-search
// on that endpoint, so these were resolved once by country and hardcoded;
// they're each a division's permanent ID, not season-specific).
export const TOP_LEAGUES: { id: number; name: string }[] = [
  { id: 1, name: 'Premier League' },
  { id: 3, name: 'La Liga' },
  { id: 4, name: 'Serie A' },
  { id: 5, name: 'Bundesliga' },
  { id: 6, name: 'Ligue 1' },
];

// World Cup 2026's league_id, confirmed via /api/v2/leagues/ (distinct from
// the various regional "World Cup Qualification" entries). Fetched in the
// same wide-window batch as the top-5 leagues below — verified live that
// the tournament has real gaps of 3-4+ days between rounds (knockout
// placeholder fixtures are scheduled well ahead), which the app's normal
// 2-day fixture window was silently missing almost entirely — that's the
// actual reason the World Cup tab and hero card were coming up empty or
// showing an unrelated closer match instead.
const WC_LEAGUE_ID = 27;

// Fetched with a wider window than the main fixture list so the World Cup
// tab and each top league chip always has at least its next upcoming
// match, even during a gap (rest days between rounds, international
// break) that the normal 2-day fixture window would miss entirely.
export async function fetchBzTopLeagueMatches(key: string, from: string, to: string): Promise<Fixture[]> {
  try {
    const leagues = [{ id: WC_LEAGUE_ID, name: BZ_WC_NAME }, ...TOP_LEAGUES];
    const lists = await Promise.all(leagues.map(async l => {
      const params = new URLSearchParams({ date_from: from, date_to: to, league_id: String(l.id), limit: '50' });
      const events = await fetchBzEventsPage(`${BASE}/api/v2/events/?${params}`, key);
      // Name is known from the list itself (we filtered by this exact
      // league_id) — no need to wait on the id→name lookup for this path.
      return events.map(e => mapBzEvent(e, undefined, l.name));
    }));
    return lists.flat().filter(hasRealTeams);
  } catch {
    return [];
  }
}

// Real last-N results for Predictor's grounding — shaped to drop straight
// into teamStats.ts's existing TeamForm/formatFormContext plumbing rather
// than inventing a parallel prompt block. Bzzoiro's status=finished filter
// already returns most-recent-first, verified live.
export async function fetchBzTeamForm(key: string, teamName: string, limit = 5): Promise<TeamForm | null> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const params = new URLSearchParams({ team_name: teamName, status: 'finished', date_to: today, limit: String(limit) });
    // Short timeout — this runs on Predictor's critical path before the
    // model call even starts, and it's a best-effort enrichment with two
    // more fallback sources behind it (football-data.org, TheSportsDB).
    // The default 8s here would mean a team Bzzoiro doesn't cover pays a
    // full 8s tax, THEN tries the next source, stacking up to 20-30s of
    // dead air before the model starts — which read as "predictor is
    // completely broken" even though it was just queued behind slow misses.
    const events = await fetchBzEventsPage(`${BASE}/api/v2/events/?${params}`, key, 3500);
    if (events.length === 0) return null;
    const qNorm = norm(teamName);
    const parsed = events.map(e => {
      const home = bzTeamName(e.home_team, e.home_team_name);
      const away = bzTeamName(e.away_team, e.away_team_name);
      const isHome = norm(home).includes(qNorm) || qNorm.includes(norm(home));
      const homeScore: number | null = e.home_score;
      const awayScore: number | null = e.away_score;
      const gf = isHome ? homeScore : awayScore;
      const ga = isHome ? awayScore : homeScore;
      return { home, away, isHome, homeScore, awayScore, gf, ga, date: e.event_date?.split('T')[0] ?? '' };
    }).filter(m => m.gf != null && m.ga != null);
    if (parsed.length === 0) return null;
    return {
      teamId: 'bz',
      teamName,
      form: parsed.map(m => (m.gf! > m.ga! ? 'W' : m.gf! < m.ga! ? 'L' : 'D')),
      events: parsed.map(m => ({
        opponent: m.isHome ? m.away : m.home,
        result: (m.gf! > m.ga! ? 'W' : m.gf! < m.ga! ? 'L' : 'D') as 'W' | 'D' | 'L',
        // Literal home-away score, matching the existing fd/TheSportsDB
        // convention in teamStats.ts (not reordered to the searched
        // team's perspective).
        score: `${m.homeScore}-${m.awayScore}`,
        date: m.date,
        league: '',
      })),
    };
  } catch {
    return null;
  }
}

export async function fetchBothBzTeamForms(key: string, nameA: string, nameB: string, limit = 5): Promise<[TeamForm | null, TeamForm | null]> {
  return Promise.all([fetchBzTeamForm(key, nameA, limit), fetchBzTeamForm(key, nameB, limit)]);
}

export interface RatedPlayer {
  name: string;
  rating: number;
  position: string;
  nationality: string;
}

// Resolves a team name to Bzzoiro's own team_id — verified live that
// /api/v2/teams/?search= silently ignores the search term (always returns
// the same unrelated page), while ?name= does a real filtered match. Picks
// the case-insensitive exact match among results since a bare name search
// can return youth/reserve sides sharing the same name (e.g. "Real Madrid
// Castilla U21" alongside the actual first team).
async function resolveBzTeamId(key: string, teamName: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/v2/teams/?name=${encodeURIComponent(teamName)}&limit=10`, 5000, { headers: authHeaders(key) });
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data.results ?? [];
    const exact = results.find(t => (t.name ?? '').toLowerCase() === teamName.trim().toLowerCase());
    return (exact ?? results[0])?.id ?? null;
  } catch {
    return null;
  }
}

// The real, non-guessed answer to "who's the key player" — Bzzoiro's
// player records carry a genuine 0-99 rating (same idea as FIFA/FM-style
// ratings) for most senior pros. Verified live: /api/v2/players/?ordering=
// -rating doesn't actually sort (the param is silently ignored), so the
// full squad is pulled in one call and sorted client-side instead. Many
// backup/youth entries have a null rating (never played enough to be
// scored) — those are filtered out rather than treated as a 0.
export async function fetchTopRatedPlayer(key: string, teamName: string): Promise<RatedPlayer | null> {
  try {
    const teamId = await resolveBzTeamId(key, teamName);
    if (!teamId) return null;
    const res = await fetchWithTimeout(`${BASE}/api/v2/players/?team_id=${teamId}&limit=50`, 6000, { headers: authHeaders(key) });
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data.results ?? [];
    const rated = results.filter(p => typeof p.rating === 'number');
    if (rated.length === 0) return null;
    rated.sort((a, b) => b.rating - a.rating);
    const top = rated[0];
    return { name: top.name, rating: top.rating, position: top.position ?? '', nationality: top.nationality ?? '' };
  } catch {
    return null;
  }
}

export async function fetchBothTopRatedPlayers(key: string, nameA: string, nameB: string): Promise<[RatedPlayer | null, RatedPlayer | null]> {
  return Promise.all([fetchTopRatedPlayer(key, nameA), fetchTopRatedPlayer(key, nameB)]);
}
