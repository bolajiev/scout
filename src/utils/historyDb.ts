import * as SQLite from 'expo-sqlite';

export type ScreenType = 'matchai' | 'predictor' | 'scoutlens';

export interface Session {
  id: string;
  screen: ScreenType;
  title: string;
  createdAt: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

let _db: SQLite.SQLiteDatabase | null = null;

const getDb = (): SQLite.SQLiteDatabase => {
  if (!_db) {
    _db = SQLite.openDatabaseSync('scout.db');
    _db.execSync(`
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
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_screen  ON sessions(screen, created_at DESC);
    `);
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
  getDb().runSync('DELETE FROM messages WHERE session_id = ?', [sessionId]);
  getDb().runSync('DELETE FROM sessions WHERE id = ?', [sessionId]);
};

// ── Messages ──────────────────────────────────────────────────────────────────

export const addMessage = (
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): void => {
  getDb().runSync(
    'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [uid(), sessionId, role, content, Date.now()],
  );
};

export const getMessages = (sessionId: string): Message[] =>
  getDb()
    .getAllSync<{ id: string; session_id: string; role: string; content: string; created_at: number }>(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId],
    )
    .map(r => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      createdAt: r.created_at,
    }));

// Update the final assistant message content (streaming completes after initial insert)
export const updateLastAssistantMessage = (sessionId: string, content: string): void => {
  getDb().runSync(
    `UPDATE messages SET content = ?
     WHERE session_id = ? AND role = 'assistant'
     ORDER BY created_at DESC LIMIT 1`,
    [content, sessionId],
  );
};
