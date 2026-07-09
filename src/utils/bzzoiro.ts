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
// Same team name, different squad entirely — verified live: searching
// "Spain" for recent form pulled in "Spain U19 3-0 Croatia U19" because
// "spain" is a clean substring of "spainu19", contaminating a senior
// team's form with youth-international results.
const AGE_GRADE_RE = /\b(u1[0-9]|u2[0-9]|u23|ii|res(?:erves?)?|youth|women)\b/i;
// Length-guarded containment match — bare `.includes()` with no minimum
// let a short substring match unrelated names (verified live elsewhere in
// this app: "brazil" contains "az"). Same fix applied here as
// teamStats.ts's matchesTeamName.
const fuzzyNameMatch = (a: string, b: string): boolean => {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (AGE_GRADE_RE.test(a) !== AGE_GRADE_RE.test(b)) return false;
  return (na.length >= 4 && nb.includes(na)) || (nb.length >= 4 && na.includes(nb));
};

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
    // BUG FIX: this used to take the date substring straight from the raw
    // event_date STRING, while strTime above is derived from the
    // UTC-normalized `utc` object — if Bzzoiro ever returns a timestamp
    // with a non-UTC offset, those two disagree (e.g.
    // "2026-07-09T23:30:00-05:00" is really "2026-07-10T04:30:00Z": the
    // raw string gives dateEvent="2026-07-09" paired with strTime="04:30",
    // tagging a match with the wrong day). Deriving both from the same
    // normalized `utc` object keeps them consistent regardless of what
    // offset the API happens to send.
    dateEvent: !isNaN(utc.getTime()) ? utc.toISOString().split('T')[0] : (e.event_date?.split('T')[0] ?? null),
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
export async function fetchBzTeamForm(key: string, teamName: string, limit = 5, timeoutMs = 3500): Promise<TeamForm | null> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const params = new URLSearchParams({ team_name: teamName, status: 'finished', date_to: today, limit: String(limit) });
    // Default is short (3.5s) for Predictor's critical path, which runs
    // this before the model call even starts with two more fallback
    // sources behind it (football-data.org, TheSportsDB) — the default 8s
    // there would mean a team Bzzoiro doesn't cover pays a full 8s tax,
    // THEN tries the next source, stacking up to 20-30s of dead air before
    // the model starts. MatchDetailScreen has no such urgency (it's already
    // showing a skeleton) and was silently inheriting this same aggressive
    // timeout — verified live: real recent-form data existed for Norway/
    // England/Spain/Belgium and came back well inside 6-7s, but the 3.5s
    // cutoff killed the request first and fell through to "no recent form
    // found" even though the data was real and on its way. Callers with
    // more headroom pass a longer timeoutMs explicitly.
    const events = await fetchBzEventsPage(`${BASE}/api/v2/events/?${params}`, key, timeoutMs);
    if (events.length === 0) return null;
    const parsed = events.map(e => {
      const home = bzTeamName(e.home_team, e.home_team_name);
      const away = bzTeamName(e.away_team, e.away_team_name);
      // BUG FIX: this used to check ONLY the home side and unconditionally
      // assume away otherwise — no length guard on the substring check
      // either (teamStats.ts's matchesTeamName already learned that
      // lesson: "brazil" contains "az"). If the home check ever failed
      // for a real home match (spelling/alias mismatch) this silently
      // flipped every W to an L and vice versa in the form fed to
      // Coach/Predictor, invisible in the UI but backwards. Now checks
      // both sides explicitly and skips the match entirely if neither
      // side can be confidently matched, rather than guessing.
      const isHomeMatch = fuzzyNameMatch(home, teamName);
      const isAwayMatch = fuzzyNameMatch(away, teamName);
      const isHome = isHomeMatch ? true : isAwayMatch ? false : null;
      const homeScore: number | null = e.home_score;
      const awayScore: number | null = e.away_score;
      const gf = isHome === true ? homeScore : isHome === false ? awayScore : null;
      const ga = isHome === true ? awayScore : isHome === false ? homeScore : null;
      return { home, away, isHome: isHome === true, homeScore, awayScore, gf, ga, date: e.event_date?.split('T')[0] ?? '' };
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

export async function fetchBothBzTeamForms(key: string, nameA: string, nameB: string, limit = 5, timeoutMs = 3500): Promise<[TeamForm | null, TeamForm | null]> {
  return Promise.all([fetchBzTeamForm(key, nameA, limit, timeoutMs), fetchBzTeamForm(key, nameB, limit, timeoutMs)]);
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
// Checks whether a player actually featured in their most recent logged
// match — verified live: the plain highest-card-rating pick occasionally
// named someone injured, benched, or transferred out who hadn't actually
// played the team's last match at all. A single-row stats fetch (most
// recent appearance only) is cheap enough to run for a handful of
// candidates without turning this into an N-calls-per-squad problem.
async function playedRecently(key: string, playerId: number): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/v2/players/${playerId}/stats/?limit=1`, 4000, { headers: authHeaders(key) });
    if (!res.ok) return false;
    const data = await res.json();
    const latest = (data.results ?? [])[0];
    return !!latest && (latest.minutes_played ?? 0) > 0;
  } catch {
    return false;
  }
}

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
    // Check the top 5 candidates' actual last-match involvement in
    // parallel, then take the highest-rated one who really played —
    // falling back to the plain #1 rating if none of them checks out
    // (a real pick beats no pick, even if unverified).
    const candidates = rated.slice(0, 5);
    const playedFlags = await Promise.all(candidates.map(p => playedRecently(key, p.id)));
    const top = candidates.find((_, i) => playedFlags[i]) ?? rated[0];
    return { name: top.name, rating: top.rating, position: top.position ?? '', nationality: top.nationality ?? '' };
  } catch {
    return null;
  }
}

export async function fetchBothTopRatedPlayers(key: string, nameA: string, nameB: string): Promise<[RatedPlayer | null, RatedPlayer | null]> {
  return Promise.all([fetchTopRatedPlayer(key, nameA), fetchTopRatedPlayer(key, nameB)]);
}

export interface PlayerAppearance {
  goals: number;
  assists: number;
  minutesPlayed: number;
  rating: number | null;
}

export interface PlayerStatsSummary {
  name: string;
  team: string;
  appearances: PlayerAppearance[]; // most recent first
}

// A name search can match several players sharing a name (verified live:
// "Mbappe" returns Ethan AND Kylian Mbappé, among others) — no query param
// disambiguates by fame, so the highest-rated match is used as the best
// guess for "the player everyone means" rather than whichever the API
// happens to list first.
async function resolveBzPlayerId(key: string, playerName: string): Promise<{ id: number; name: string; team: string } | null> {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/v2/players/?name=${encodeURIComponent(playerName)}&limit=10`, 6000, { headers: authHeaders(key) });
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data.results ?? [];
    if (results.length === 0) return null;
    const withRating = results.filter(p => typeof p.rating === 'number');
    const best = (withRating.length > 0 ? withRating : results).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    return { id: best.id, name: best.name, team: String(best.current_team_id ?? '') };
  } catch {
    return null;
  }
}

// Real per-match stats — goals/assists/minutes/rating — the data source
// that was missing entirely before this: Coach previously had no way to
// answer "how many goals has X scored" except fabricating an answer, and
// Predictor's "Player to Watch" had no way to check whether its pick
// actually played recently. No date field comes back on these rows
// (verified live), but they're returned most-recent-match-first.
export async function fetchPlayerStats(key: string, playerName: string, limit = 5): Promise<PlayerStatsSummary | null> {
  try {
    const player = await resolveBzPlayerId(key, playerName);
    if (!player) return null;
    const res = await fetchWithTimeout(`${BASE}/api/v2/players/${player.id}/stats/?limit=${limit}`, 6000, { headers: authHeaders(key) });
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data.results ?? [];
    if (results.length === 0) return null;
    return {
      name: player.name,
      team: player.team,
      appearances: results.map(r => ({
        goals: r.goals ?? 0,
        assists: r.goal_assist ?? 0,
        minutesPlayed: r.minutes_played ?? 0,
        rating: typeof r.rating === 'number' ? r.rating : null,
      })),
    };
  } catch {
    return null;
  }
}

export interface H2HMatch {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  league: string;
}

// No dedicated head-to-head endpoint exists (verified live — a `head2head`
// path and an `opponent_id` filter both don't do anything real), so this
// pulls one team's own match history with a wide enough limit to have a
// real shot at catching past meetings, then filters client-side for the
// specific opponent. International fixtures between any two given teams
// can be years apart, so this can legitimately come back empty — that's
// reported honestly as "no recent meetings found", not papered over.
export async function fetchHeadToHead(key: string, teamAName: string, teamBName: string): Promise<H2HMatch[]> {
  try {
    const teamAId = await resolveBzTeamId(key, teamAName);
    if (!teamAId) return [];
    const res = await fetchWithTimeout(`${BASE}/api/v2/events/?team_id=${teamAId}&status=finished&limit=100`, 6000, { headers: authHeaders(key) });
    if (!res.ok) return [];
    const data = await res.json();
    const results: any[] = data.results ?? [];
    return results
      .filter(e => fuzzyNameMatch(e.home_team ?? '', teamBName) || fuzzyNameMatch(e.away_team ?? '', teamBName))
      .slice(0, 5)
      .map(e => ({
        date: e.event_date?.split('T')[0] ?? '',
        homeTeam: e.home_team ?? '',
        awayTeam: e.away_team ?? '',
        homeScore: e.home_score ?? 0,
        awayScore: e.away_score ?? 0,
        league: e.league_name ?? '',
      }));
  } catch {
    return [];
  }
}

export interface LineupPlayer {
  name: string;
  position: string;
  jerseyNumber: number | null;
}

export interface TeamLineup {
  teamName: string;
  formation: string;
  players: LineupPlayer[];
}

export interface MatchLineups {
  status: 'confirmed' | 'predicted' | 'unavailable';
  confidence: number | null; // only meaningful when status === 'predicted'
  home: TeamLineup | null;
  away: TeamLineup | null;
}

// Bzzoiro serves AI-PREDICTED probable lineups days ahead of kickoff
// (verified live: a match 2 days out came back lineup_status: "predicted",
// confidence: 0.836) and CONFIRMED ones once the real team sheet is in —
// the UI must be honest about which one it's showing, never presenting a
// predicted XI as if it were confirmed.
export async function fetchLineups(key: string, bzEventId: number): Promise<MatchLineups> {
  const empty: MatchLineups = { status: 'unavailable', confidence: null, home: null, away: null };
  try {
    const res = await fetchWithTimeout(`${BASE}/api/v2/events/${bzEventId}/lineups/`, 6000, { headers: authHeaders(key) });
    if (!res.ok) return empty;
    const data = await res.json();
    if (!data.lineups || data.lineup_status === 'unavailable') return empty;
    const mapSide = (side: any): TeamLineup | null => side ? {
      teamName: side.team_name ?? '',
      formation: side.formation ?? '',
      players: (side.players ?? []).map((p: any) => ({
        name: p.short_name ?? p.name ?? '',
        position: p.position ?? '',
        jerseyNumber: p.jersey_number ?? null,
      })),
    } : null;
    return {
      status: data.lineup_status === 'confirmed' ? 'confirmed' : 'predicted',
      confidence: typeof data.lineups.home?.confidence === 'number' ? data.lineups.home.confidence : null,
      home: mapSide(data.lineups.home),
      away: mapSide(data.lineups.away),
    };
  } catch {
    return empty;
  }
}

export const formatPlayerStatsContext = (stats: PlayerStatsSummary): string => {
  const { appearances } = stats;
  const totalGoals = appearances.reduce((s, a) => s + a.goals, 0);
  const totalAssists = appearances.reduce((s, a) => s + a.assists, 0);
  const lines = appearances.map((a, i) =>
    `Match ${i + 1} ago: ${a.goals} goal${a.goals === 1 ? '' : 's'}, ${a.assists} assist${a.assists === 1 ? '' : 's'}, ${a.minutesPlayed} min${a.rating != null ? `, rating ${a.rating}` : ''}`
  );
  return [
    `[PLAYER STATS — ${stats.name}, last ${appearances.length} appearances, via Bzzoiro Sports]`,
    `Totals: ${totalGoals} goal${totalGoals === 1 ? '' : 's'}, ${totalAssists} assist${totalAssists === 1 ? '' : 's'}`,
    ...lines,
    '[END PLAYER STATS]',
  ].join('\n');
};
