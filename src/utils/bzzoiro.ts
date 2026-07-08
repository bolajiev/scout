import type { Fixture } from './fixtures';
import type { TeamForm } from './teamStats';

// Bzzoiro Sports Data API (sports.bzzoiro.com) — free football data API with
// genuine CatBoost ML match predictions (real 1X2 probabilities, xG,
// over/under, BTTS, most-likely score), separate from Scout's on-device LLM
// verdict. Predictor still uses the LLM for the narrative (key players,
// analysis) — this only supplies real numbers for the odds display when a
// match resolves to a known Bzzoiro event, replacing the fabricated
// confidence-derived split.
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

export interface BzPrediction {
  probHome: number | null;
  probDraw: number | null;
  probAway: number | null;
  predicted: 'H' | 'D' | 'A' | null;
  xgHome: number | null;
  xgAway: number | null;
  mostLikelyScore: string | null;
  confidence: number | null;
}

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

// Bzzoiro's internal event IDs aren't shared with TheSportsDB or
// football-data.org, so a match has to be resolved by team name (+ optional
// date window) before its prediction can be fetched.
export async function findBzEventId(
  key: string,
  homeTeam: string,
  awayTeam: string,
  dateISO?: string | null,
): Promise<number | null> {
  try {
    const params = new URLSearchParams({ team_name: homeTeam, limit: '20' });
    if (dateISO) { params.set('date_from', dateISO); params.set('date_to', dateISO); }
    const events = await fetchBzEventsPage(`${BASE}/api/v2/events/?${params}`, key);
    const awayNorm = norm(awayTeam);
    const match = events.find(e => {
      const away = typeof e.away_team === 'string' ? e.away_team : (e.away_team?.name ?? e.away_team_name ?? '');
      const an = norm(away);
      return an && (an.includes(awayNorm) || awayNorm.includes(an));
    });
    return match?.id ?? null;
  } catch {
    return null;
  }
}

export async function fetchBzPrediction(key: string, eventId: number): Promise<BzPrediction | null> {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/v2/events/${eventId}/prediction/`, 8000, { headers: authHeaders(key) });
    if (!res.ok) return null;
    const data = await res.json();
    const mr = data.markets?.match_result ?? {};
    const xg = data.markets?.expected_goals ?? {};
    const score = data.markets?.score ?? {};
    if (mr.prob_home == null && mr.prob_draw == null && mr.prob_away == null) return null;
    return {
      probHome: mr.prob_home ?? null,
      probDraw: mr.prob_draw ?? null,
      probAway: mr.prob_away ?? null,
      predicted: mr.predicted ?? null,
      xgHome: xg.home ?? null,
      xgAway: xg.away ?? null,
      mostLikelyScore: score.most_likely ?? null,
      confidence: data.model?.confidence ?? null,
    };
  } catch {
    return null;
  }
}

// Best-effort one-shot: resolve the event, then fetch its prediction. Used
// right before Predictor asks the on-device model to commit, in parallel
// with that (slower) call so it never adds visible wait time.
export async function findBzPrediction(
  key: string,
  homeTeam: string,
  awayTeam: string,
  dateISO?: string | null,
): Promise<BzPrediction | null> {
  const id = await findBzEventId(key, homeTeam, awayTeam, dateISO);
  if (!id) return null;
  return fetchBzPrediction(key, id);
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
