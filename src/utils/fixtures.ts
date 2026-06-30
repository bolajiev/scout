import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Fixture {
  idEvent: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strLeague: string;
  strTime: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
}

const CACHE_KEY = '@scout_fixtures_cache';
const CACHE_DATE_KEY = '@scout_fixtures_cache_date';

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
  const mins = timeToMins(f.strTime);
  if (mins === null) return false;
  const now = new Date();
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const elapsed = nowMins - mins;
  return elapsed >= 0 && elapsed <= 105;
};

// Pick the single most relevant match to surface on the home card:
// Live match wins immediately. Then: soonest upcoming. Then: most recent finished.
// World Cup pool is checked first; falls back to all soccer.
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

    const diff = mins - nowMins; // positive = starts in future, negative = already started

    // Currently live (started 0–105 min ago) → surface immediately
    if (diff >= -105 && diff <= 0) return f;

    // Future matches ranked by closeness; past matches ranked much lower
    const score = diff > 0 ? diff : 10_000 + Math.abs(diff);
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }

  return best;
};

export const fmtMatchTime = (t: string): string => {
  if (!t || t === '00:00:00') return '';
  const [h, m] = t.split(':');
  return `${h}:${m}`;
};

// 3-letter abbreviation: "Argentina" → "ARG", "Saudi Arabia" → "SAU"
export const teamAbbr = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join('').slice(0, 3).toUpperCase();
};

export const fetchAndCacheFixtures = async (): Promise<{
  fixtures: Fixture[];
  fromCache: boolean;
  online: boolean;
}> => {
  try {
    const res = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${todayISO()}&s=Soccer`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    const fixtures: Fixture[] = data.events ?? [];

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fixtures));
    await AsyncStorage.setItem(CACHE_DATE_KEY, todayISO());

    return { fixtures, fromCache: false, online: true };
  } catch {
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      const cachedDate = await AsyncStorage.getItem(CACHE_DATE_KEY);
      if (cached) {
        const fixtures = JSON.parse(cached) as Fixture[];
        const isToday = cachedDate === todayISO();
        return { fixtures: isToday ? fixtures : [], fromCache: true, online: false };
      }
    } catch {}
    return { fixtures: [], fromCache: true, online: false };
  }
};
