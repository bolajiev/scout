// TheSportsDB — free, no API key required.
// Used to pull real recent match form for predictions and grounded AI answers.

import { fetchWithTimeout } from './fixtures';

export type FormResult = 'W' | 'D' | 'L';

export interface TeamEvent {
  opponent: string;
  result: FormResult;
  score: string;
  date: string;
  league: string;
}

export interface TeamForm {
  teamId: string;
  teamName: string;
  form: FormResult[];        // last ≤5, most recent last
  events: TeamEvent[];
}

const BASE = 'https://www.thesportsdb.com/api/v1/json/3';

// Search for a team by name → return the matching FOOTBALL team's ID.
// BUG FIX: this used to fall back to teams[0] (the first result of ANY
// sport) when nothing matched the soccer/football check. Verified live:
// searching "Jordan" (a real 2026 World Cup debutant) returns exactly one
// TheSportsDB result — a defunct 1991-2005 Formula One team also named
// "Jordan" — and the old fallback would silently hand that team's ID back,
// pulling Formula One data into a football prediction. Returning null
// (honest "not found," model falls back to its own knowledge) is a far
// better failure mode than confidently wrong-sport data.
export const searchTeamId = async (name: string): Promise<string | null> => {
  try {
    const res = await fetchWithTimeout(`${BASE}/searchteams.php?t=${encodeURIComponent(name)}`, 6000);
    const data = await res.json();
    const teams: any[] = data.teams ?? [];
    const soccer = teams.find(t => /soccer|football/i.test(t.strSport ?? ''));
    return soccer?.idTeam ?? null;
  } catch {
    return null;
  }
};

// Real current squad list — grounds the model's "key player" callouts in
// actual current names instead of stale training-data memory (verified:
// a model asked to name Brazil's key player defaulted to Neymar, who
// hasn't been part of the current national-team picture for years).
// Free tier caps this at ~10 entries including staff, so it's a partial
// squad, not the full roster — still far better than pure recall.
export const fetchSquad = async (teamName: string): Promise<string[]> => {
  const teamId = await searchTeamId(teamName);
  if (!teamId) return [];
  try {
    const res = await fetchWithTimeout(`${BASE}/lookup_all_players.php?id=${teamId}`, 6000);
    const data = await res.json();
    const players: any[] = data.player ?? [];
    return players
      .filter(p => p.strPosition && !/manager|coach/i.test(p.strPosition))
      .map(p => p.strPlayer)
      .filter(Boolean);
  } catch {
    return [];
  }
};

export const fetchBothSquads = async (
  nameA: string,
  nameB: string,
): Promise<[string[], string[]]> =>
  Promise.all([fetchSquad(nameA), fetchSquad(nameB)]);

// Fetch last 5 events for a team and derive W/D/L
export const fetchTeamForm = async (teamName: string): Promise<TeamForm | null> => {
  const teamId = await searchTeamId(teamName);
  if (!teamId) return null;

  try {
    // eventslast.php returns the team's most recent finished matches
    // (eventslast5.php does not exist — it 404s)
    const res = await fetchWithTimeout(`${BASE}/eventslast.php?id=${teamId}`, 6000);
    const data = await res.json();
    const raw: any[] = data.results ?? [];

    const events: TeamEvent[] = raw.map(ev => {
      const home = ev.strHomeTeam ?? '';
      const away = ev.strAwayTeam ?? '';
      const hs = parseInt(ev.intHomeScore ?? '-1', 10);
      const as_ = parseInt(ev.intAwayScore ?? '-1', 10);
      const homeLower = home.toLowerCase();
      const nameLower = teamName.toLowerCase();
      const isHome = matchesTeamName(homeLower, nameLower);

      let result: FormResult = 'D';
      if (hs >= 0 && as_ >= 0) {
        if (isHome) result = hs > as_ ? 'W' : hs < as_ ? 'L' : 'D';
        else result = as_ > hs ? 'W' : as_ < hs ? 'L' : 'D';
      }

      return {
        opponent: isHome ? away : home,
        result,
        score: hs >= 0 && as_ >= 0 ? `${hs}-${as_}` : '?-?',
        date: ev.dateEvent ?? '',
        league: ev.strLeague ?? '',
      };
    });

    return {
      teamId,
      teamName,
      form: events.map(e => e.result),
      events,
    };
  } catch {
    return null;
  }
};

// football-data.org (optional user key, set in Settings) — TheSportsDB's
// free eventslast.php hard-caps at 1 past match per team; football-data's
// /v4/matches isn't capped that way, but it IS capped at a 10-day window
// per call, so recent form means walking backward in 10-day windows. One
// call covers BOTH teams at once (unlike TheSportsDB's per-team calls),
// so this is also more rate-limit-friendly for a 2-team prediction.
const normTeam = (s: string) => s.trim().toLowerCase();
// `target.includes(name)` is the dangerous direction: a short API team
// name/code (e.g. "AZ", from Dutch club AZ Alkmaar) can be an accidental
// substring of a longer search name — "brazil" contains "az". Verified
// live: this pulled an unrelated Eredivisie match into Brazil's form.
// Only trust that direction when the API name is long enough not to be
// noise; the other direction (target inside a full team name) is safe
// since the user-typed search name is always a real team name, not a code.
const matchesTeamName = (name: string, target: string): boolean =>
  name === target || name.includes(target) || (name.length >= 4 && target.includes(name));
const teamInMatch = (home: string, away: string, target: string): 'home' | 'away' | null => {
  if (matchesTeamName(normTeam(home), target)) return 'home';
  if (matchesTeamName(normTeam(away), target)) return 'away';
  return null;
};

const fetchFdRecentMatches = async (
  key: string,
  teamAName: string,
  teamBName: string,
): Promise<{ a: TeamEvent[]; b: TeamEvent[] }> => {
  const a: TeamEvent[] = [];
  const b: TeamEvent[] = [];
  const nameA = normTeam(teamAName);
  const nameB = normTeam(teamBName);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const today = new Date();

  for (let w = 0; w < 5 && (a.length < 5 || b.length < 5); w++) {
    const to = new Date(today.getTime() - w * 10 * 86_400_000);
    const from = new Date(to.getTime() - 9 * 86_400_000);
    try {
      const res = await fetchWithTimeout(
        `https://api.football-data.org/v4/matches?dateFrom=${fmt(from)}&dateTo=${fmt(to)}&status=FINISHED`,
        8000,
        { headers: { 'X-Auth-Token': key } },
      );
      if (!res.ok) break; // bad key or rate-limited — stop, fall back below
      const data = await res.json();
      const matches: any[] = (data.matches ?? [])
        .sort((x: any, y: any) => Date.parse(y.utcDate) - Date.parse(x.utcDate));

      for (const m of matches) {
        const home = m.homeTeam?.name || m.homeTeam?.shortName || '';
        const away = m.awayTeam?.name || m.awayTeam?.shortName || '';
        const hs = m.score?.fullTime?.home;
        const as_ = m.score?.fullTime?.away;
        if (hs == null || as_ == null) continue;
        const event = (isHome: boolean): TeamEvent => ({
          opponent: isHome ? away : home,
          result: isHome
            ? (hs > as_ ? 'W' : hs < as_ ? 'L' : 'D')
            : (as_ > hs ? 'W' : as_ < hs ? 'L' : 'D'),
          score: `${hs}-${as_}`,
          date: m.utcDate?.split('T')[0] ?? '',
          league: m.competition?.name ?? '',
        });
        const sideA = teamInMatch(home, away, nameA);
        if (sideA && a.length < 5) a.push(event(sideA === 'home'));
        const sideB = teamInMatch(home, away, nameB);
        if (sideB && b.length < 5) b.push(event(sideB === 'home'));
      }
    } catch { break; }
  }
  return { a, b };
};

// Fetch form for two teams in parallel. With a football-data.org key
// configured, tries that first (richer history for teams in its ~12
// supported competitions), falling back to TheSportsDB per team when a
// team isn't covered (free-tier competitions only) or no key is set.
export const fetchBothTeamForms = async (
  nameA: string,
  nameB: string,
  fdKey?: string,
): Promise<[TeamForm | null, TeamForm | null]> => {
  if (fdKey) {
    try {
      const { a, b } = await fetchFdRecentMatches(fdKey, nameA, nameB);
      const [fallbackA, fallbackB] = await Promise.all([
        a.length === 0 ? fetchTeamForm(nameA) : Promise.resolve(null),
        b.length === 0 ? fetchTeamForm(nameB) : Promise.resolve(null),
      ]);
      const formA: TeamForm | null = a.length > 0
        ? { teamId: 'fd', teamName: nameA, form: a.map(e => e.result), events: a }
        : fallbackA;
      const formB: TeamForm | null = b.length > 0
        ? { teamId: 'fd', teamName: nameB, form: b.map(e => e.result), events: b }
        : fallbackB;
      return [formA, formB];
    } catch {
      // fall through to TheSportsDB-only path below
    }
  }
  return Promise.all([fetchTeamForm(nameA), fetchTeamForm(nameB)]);
};

// Format as a compact context block for injection into prompt
export const formatFormContext = (
  teamA: string,
  formA: TeamForm | null,
  teamB: string,
  formB: TeamForm | null,
): string => {
  const fmt = (name: string, form: TeamForm | null) => {
    if (!form || form.events.length === 0) return `${name}: no recent data`;
    const dots = form.form.join(' ');
    const detail = form.events
      .slice(0, 3)
      .map(e => `vs ${e.opponent} ${e.score} (${e.result})`)
      .join(', ');
    return `${name} last ${form.form.length}: ${dots} — ${detail}`;
  };
  return [
    '[LIVE FORM DATA]',
    fmt(teamA, formA),
    fmt(teamB, formB),
    '[END FORM DATA]\nUse this real recent form as a strong signal in your prediction.',
  ].join('\n');
};


// Format today's fixtures as a lightweight context block for MatchAI
export const formatFixtureContext = (fixtures: Array<{
  strHomeTeam: string; strAwayTeam: string; strLeague: string; strTime: string;
}>): string => {
  if (fixtures.length === 0) return '';
  const lines = fixtures.slice(0, 6).map(f =>
    `${f.strHomeTeam} vs ${f.strAwayTeam} (${f.strLeague}${f.strTime ? ', ' + f.strTime.slice(0, 5) : ''})`
  );
  return [
    `[LIVE FIXTURES — Today via TheSportsDB]`,
    ...lines,
    `[END FIXTURES]`,
  ].join('\n');
};
