// TheSportsDB — free, no API key required.
// Used to pull real recent match form for predictions and grounded AI answers.

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

// Search for a team by name → return first matching team ID
export const searchTeamId = async (name: string): Promise<string | null> => {
  try {
    const res = await fetch(`${BASE}/searchteams.php?t=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    const teams: any[] = data.teams ?? [];
    // Prefer soccer/football teams
    const soccer = teams.find(t =>
      /soccer|football/i.test(t.strSport ?? '') ||
      /national|international/i.test(t.strTeamShort ?? '')
    ) ?? teams[0];
    return soccer?.idTeam ?? null;
  } catch {
    return null;
  }
};

// Fetch last 5 events for a team and derive W/D/L
export const fetchTeamForm = async (teamName: string): Promise<TeamForm | null> => {
  const teamId = await searchTeamId(teamName);
  if (!teamId) return null;

  try {
    const res = await fetch(`${BASE}/eventslast5.php?id=${teamId}`, {
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    const raw: any[] = data.results ?? [];

    const events: TeamEvent[] = raw.map(ev => {
      const home = ev.strHomeTeam ?? '';
      const away = ev.strAwayTeam ?? '';
      const hs = parseInt(ev.intHomeScore ?? '-1', 10);
      const as_ = parseInt(ev.intAwayScore ?? '-1', 10);
      // Use exact substring match only — the slice(0,5) heuristic caused false positives
      const homeLower = home.toLowerCase();
      const nameLower = teamName.toLowerCase();
      const isHome = homeLower.includes(nameLower) || nameLower.includes(homeLower);

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

// Fetch form for two teams in parallel
export const fetchBothTeamForms = async (
  nameA: string,
  nameB: string,
): Promise<[TeamForm | null, TeamForm | null]> =>
  Promise.all([fetchTeamForm(nameA), fetchTeamForm(nameB)]);

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
    '[LIVE FORM DATA — TheSportsDB]',
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
