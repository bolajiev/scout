import * as SQLite from 'expo-sqlite';

export interface Fixture {
  idEvent: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strLeague: string;
  strTime: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
}

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
    const diff = mins - nowMins;
    if (diff >= -105 && diff <= 0) return f; // live → immediate winner
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

let _db: SQLite.SQLiteDatabase | null = null;

const getDb = (): SQLite.SQLiteDatabase => {
  if (!_db) {
    _db = SQLite.openDatabaseSync('scout.db');
    _db.execSync(`
      CREATE TABLE IF NOT EXISTS fixtures (
        id_event   TEXT PRIMARY KEY,
        home_team  TEXT NOT NULL,
        away_team  TEXT NOT NULL,
        league     TEXT NOT NULL,
        match_time TEXT NOT NULL,
        home_score TEXT,
        away_score TEXT,
        cache_date TEXT NOT NULL
      );
    `);
  }
  return _db;
};

const saveFixturesToDb = (fixtures: Fixture[], date: string) => {
  const db = getDb();
  db.runSync('DELETE FROM fixtures WHERE cache_date != ?', [date]);
  for (const f of fixtures) {
    db.runSync(
      `INSERT OR REPLACE INTO fixtures
         (id_event, home_team, away_team, league, match_time, home_score, away_score, cache_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.idEvent, f.strHomeTeam, f.strAwayTeam, f.strLeague, f.strTime,
       f.intHomeScore ?? null, f.intAwayScore ?? null, date],
    );
  }
};

const loadFixturesFromDb = (date: string): Fixture[] => {
  const db = getDb();
  const rows = db.getAllSync<{
    id_event: string; home_team: string; away_team: string;
    league: string; match_time: string; home_score: string | null; away_score: string | null;
  }>('SELECT * FROM fixtures WHERE cache_date = ?', [date]);

  return rows.map(r => ({
    idEvent: r.id_event,
    strHomeTeam: r.home_team,
    strAwayTeam: r.away_team,
    strLeague: r.league,
    strTime: r.match_time,
    intHomeScore: r.home_score,
    intAwayScore: r.away_score,
  }));
};

// ─────────────────────────────────────────────────────────────────────────────

// TheSportsDB is the best fully-free no-key soccer API.
// We fetch today's general soccer matches, then separately try the
// FIFA World Cup 2026 league (id=4429) so WC fixtures always appear even
// if the day endpoint doesn't surface them.
const WC_LEAGUE_ID = '4429';

export const fetchAndCacheFixtures = async (): Promise<{
  fixtures: Fixture[];
  fromCache: boolean;
  online: boolean;
}> => {
  const today = todayISO();

  try {
    // Parallel: today's soccer + WC next events
    const [dayRes, wcRes] = await Promise.allSettled([
      fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${today}&s=Soccer`, { signal: AbortSignal.timeout(8000) }),
      fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${WC_LEAGUE_ID}`, { signal: AbortSignal.timeout(8000) }),
    ]);

    const dayEvents: Fixture[] = dayRes.status === 'fulfilled'
      ? ((await dayRes.value.json()).events ?? [])
      : [];

    const wcEvents: Fixture[] = wcRes.status === 'fulfilled'
      ? ((await wcRes.value.json()).events ?? [])
      : [];

    // Merge: WC events first, deduplicated by idEvent
    const seen = new Set<string>();
    const merged: Fixture[] = [];
    for (const f of [...wcEvents, ...dayEvents]) {
      if (!seen.has(f.idEvent)) { seen.add(f.idEvent); merged.push(f); }
    }

    saveFixturesToDb(merged, today);
    return { fixtures: merged, fromCache: false, online: true };
  } catch {
    const cached = loadFixturesFromDb(today);
    return { fixtures: cached, fromCache: true, online: false };
  }
};
