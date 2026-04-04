import * as SQLite from 'expo-sqlite';

export interface LocalSession {
  id: string;
  title: string | null;
  messages_json: string;
  draft: string;
  created_at: number;
  updated_at: number;
}

export interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoningBlocks?: string[];
}

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('openwork.db');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        messages_json TEXT NOT NULL DEFAULT '[]',
        draft TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    `);
  }
  return db;
}

export async function upsertSession(session: LocalSession): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO sessions (id, title, messages_json, draft, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       messages_json = excluded.messages_json,
       draft = excluded.draft,
       updated_at = excluded.updated_at`,
    session.id,
    session.title,
    session.messages_json,
    session.draft,
    session.created_at,
    session.updated_at,
  );
}

export async function getSession(id: string): Promise<LocalSession | null> {
  const database = await getDb();
  return database.getFirstAsync<LocalSession>('SELECT * FROM sessions WHERE id = ?', id);
}

export async function listSessions(): Promise<LocalSession[]> {
  const database = await getDb();
  return database.getAllAsync<LocalSession>('SELECT * FROM sessions ORDER BY updated_at DESC');
}

export async function saveDraft(sessionId: string, draft: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE sessions SET draft = ?, updated_at = ? WHERE id = ?',
    draft,
    Date.now(),
    sessionId,
  );
}

export async function appendMessage(sessionId: string, message: LocalMessage): Promise<void> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ messages_json: string }>(
    'SELECT messages_json FROM sessions WHERE id = ?',
    sessionId,
  );
  const existing: LocalMessage[] = row ? (JSON.parse(row.messages_json) as LocalMessage[]) : [];
  existing.push(message);
  await database.runAsync(
    'UPDATE sessions SET messages_json = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(existing),
    Date.now(),
    sessionId,
  );
}

export async function deleteSession(id: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM sessions WHERE id = ?', id);
}
