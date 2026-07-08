import * as SQLite from 'expo-sqlite';

export type ScreenType = 'matchai' | 'predictor' | 'scoutlens';

export interface Session {
  id: string;
  screen: ScreenType;
  title: string;
  createdAt: number;
}

export interface MessageMeta {
  elapsed?: number;    // seconds
  toks?: number;       // generated tokens
  thinking?: string;   // the model's reasoning trace, if Think mode was on
  thinkingMs?: number; // how long thinking took
  image?: string;      // local photo URI attached to a user message, if any
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  meta?: MessageMeta;
}

let _db: SQLite.SQLiteDatabase | null = null;
let _dbFailed = false;

export const getDb = (): SQLite.SQLiteDatabase => {
  if (_dbFailed) throw new Error('DB unavailable');
  if (!_db) {
    try {
      _db = SQLite.openDatabaseSync('scout.db');
      _db.execSync(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS fixtures (
          id_event   TEXT PRIMARY KEY,
          home_team  TEXT NOT NULL,
          away_team  TEXT NOT NULL,
          league     TEXT NOT NULL,
          match_time TEXT NOT NULL,
          date_event TEXT,
          home_score TEXT,
          away_score TEXT,
          home_badge TEXT,
          away_badge TEXT,
          cache_date TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id         TEXT PRIMARY KEY,
          screen     TEXT NOT NULL,
          title      TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id         TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          meta       TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_screen  ON sessions(screen, created_at DESC);
        CREATE TABLE IF NOT EXISTS predictions (
          id               TEXT PRIMARY KEY,
          team_a           TEXT NOT NULL,
          team_b           TEXT NOT NULL,
          predicted_winner TEXT NOT NULL,
          predicted_score  TEXT,
          confidence       TEXT,
          created_at       INTEGER NOT NULL,
          actual_score     TEXT,
          outcome          TEXT
        );
      `);
      // Migrate fixtures tables created before badge/date columns existed.
      // ALTER TABLE ADD COLUMN throws if the column is already there — ignore.
      for (const col of ['date_event TEXT', 'home_badge TEXT', 'away_badge TEXT']) {
        try { _db.execSync(`ALTER TABLE fixtures ADD COLUMN ${col};`); } catch {}
      }
      // Stats metadata on messages (tok/s, elapsed) — added later
      try { _db.execSync('ALTER TABLE messages ADD COLUMN meta TEXT;'); } catch {}
    } catch (e) {
      _dbFailed = true;
      throw e;
    }
  }
  return _db;
};

const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

// ── Sessions ──────────────────────────────────────────────────────────────────

export const createSession = (screen: ScreenType, title: string): string => {
  const id = uid();
  getDb().runSync(
    'INSERT INTO sessions (id, screen, title, created_at) VALUES (?, ?, ?, ?)',
    [id, screen, title.slice(0, 120), Date.now()],
  );
  return id;
};

export const getSessions = (screen: ScreenType, limit = 50): Session[] =>
  getDb()
    .getAllSync<{ id: string; screen: string; title: string; created_at: number }>(
      'SELECT * FROM sessions WHERE screen = ? ORDER BY created_at DESC LIMIT ?',
      [screen, limit],
    )
    .map(r => ({ id: r.id, screen: r.screen as ScreenType, title: r.title, createdAt: r.created_at }));

export const deleteSession = (sessionId: string): void => {
  const db = getDb();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM messages WHERE session_id = ?', [sessionId]);
    db.runSync('DELETE FROM sessions WHERE id = ?', [sessionId]);
  });
};

// One-time cleanup for sessions with no title and/or no messages — these
// render as blank rows in History with nothing to expand. Never observed
// a code path that creates one going forward (every createSession() call
// is guarded by a non-empty question/title before it runs), so this is
// almost certainly leftover from an earlier build's bug, still sitting in
// SQLite since app data survives an APK update. Safe to run on every
// startup: a no-op once the backlog is gone.
export const cleanupOrphanedSessions = (): void => {
  const db = getDb();
  db.withTransactionSync(() => {
    db.runSync(`
      DELETE FROM sessions
      WHERE TRIM(COALESCE(title, '')) = ''
         OR id NOT IN (SELECT DISTINCT session_id FROM messages)
    `);
  });
};

// ── Messages ──────────────────────────────────────────────────────────────────

export const addMessage = (
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  meta?: MessageMeta,
): void => {
  getDb().runSync(
    'INSERT INTO messages (id, session_id, role, content, created_at, meta) VALUES (?, ?, ?, ?, ?, ?)',
    [uid(), sessionId, role, content, Date.now(), meta ? JSON.stringify(meta) : null],
  );
};

export const getMessages = (sessionId: string): Message[] =>
  getDb()
    .getAllSync<{ id: string; session_id: string; role: string; content: string; created_at: number; meta: string | null }>(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId],
    )
    .map(r => {
      let meta: MessageMeta | undefined;
      if (r.meta) { try { meta = JSON.parse(r.meta); } catch {} }
      return {
        id: r.id,
        sessionId: r.session_id,
        role: r.role as 'user' | 'assistant',
        content: r.content,
        createdAt: r.created_at,
        meta,
      };
    });

// Update the final assistant message content (streaming completes after initial insert)
export const updateLastAssistantMessage = (sessionId: string, content: string): void => {
  getDb().runSync(
    `UPDATE messages SET content = ?
     WHERE session_id = ? AND role = 'assistant'
     ORDER BY created_at DESC LIMIT 1`,
    [content, sessionId],
  );
};

// ── Prediction record (accountability) ───────────────────────────────────────

export interface PredictionRow {
  id: string;
  teamA: string;
  teamB: string;
  predictedWinner: string;
  predictedScore: string | null;
  confidence: string | null;
  createdAt: number;
  actualScore: string | null;
  outcome: 'hit' | 'miss' | null;
}

export const addPrediction = (
  teamA: string, teamB: string,
  predictedWinner: string, predictedScore: string, confidence: string,
): void => {
  getDb().runSync(
    `INSERT INTO predictions (id, team_a, team_b, predicted_winner, predicted_score, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uid(), teamA, teamB, predictedWinner, predictedScore || null, confidence || null, Date.now()],
  );
};

export const getPendingPredictions = (limit = 3): PredictionRow[] =>
  getDb()
    .getAllSync<any>(
      `SELECT * FROM predictions WHERE outcome IS NULL ORDER BY created_at ASC LIMIT ?`,
      [limit],
    )
    .map(r => ({
      id: r.id, teamA: r.team_a, teamB: r.team_b,
      predictedWinner: r.predicted_winner, predictedScore: r.predicted_score,
      confidence: r.confidence, createdAt: r.created_at,
      actualScore: r.actual_score, outcome: r.outcome,
    }));

export const settlePrediction = (id: string, actualScore: string, outcome: 'hit' | 'miss'): void => {
  getDb().runSync(
    'UPDATE predictions SET actual_score = ?, outcome = ? WHERE id = ?',
    [actualScore, outcome, id],
  );
};

export const getPredictionRecord = (): { hits: number; misses: number; pending: number } => {
  const rows = getDb().getAllSync<{ outcome: string | null; n: number }>(
    'SELECT outcome, COUNT(*) as n FROM predictions GROUP BY outcome',
  );
  let hits = 0, misses = 0, pending = 0;
  for (const r of rows) {
    if (r.outcome === 'hit') hits = r.n;
    else if (r.outcome === 'miss') misses = r.n;
    else pending = r.n;
  }
  return { hits, misses, pending };
};
