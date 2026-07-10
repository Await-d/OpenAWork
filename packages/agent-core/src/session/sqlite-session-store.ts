import Database from 'better-sqlite3';
import type { SessionStore } from './session-store.js';
import { SessionNotFoundError } from './session-store.js';
import type { ConversationSession, SessionCheckpoint } from './types.js';
import type { Message } from '@openAwork/shared';

export class SQLiteSessionStore implements SessionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    // Wait up to 5s for a competing writer to release its lock instead of
    // throwing SQLITE_BUSY immediately. WAL allows concurrent readers but
    // still serialises writers; without this a burst of concurrent session
    // writes surfaces as hard errors to callers.
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        state_status TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        checkpoint_at INTEGER NOT NULL,
        state_status TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
    `);
  }

  async create(
    partial: Omit<ConversationSession, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ConversationSession> {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO sessions (id, created_at, updated_at, state_status, messages_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        now,
        now,
        partial.state.status,
        JSON.stringify(partial.messages),
        JSON.stringify(partial.metadata),
      );
    return { ...partial, id, createdAt: now, updatedAt: now };
  }

  async get(id: string): Promise<ConversationSession | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  async list(limit = 20, offset = 0): Promise<ConversationSession[]> {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as SessionRow[];
    return rows.map(rowToSession);
  }

  async update(
    id: string,
    patch: Partial<Pick<ConversationSession, 'messages' | 'state' | 'metadata'>>,
  ): Promise<ConversationSession> {
    const existing = await this.get(id);
    if (!existing) throw new SessionNotFoundError(id);
    const now = Date.now();
    const next: ConversationSession = {
      ...existing,
      ...patch,
      id,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    this.db
      .prepare(
        'UPDATE sessions SET updated_at=?, state_status=?, messages_json=?, metadata_json=? WHERE id=?',
      )
      .run(
        now,
        next.state.status,
        JSON.stringify(next.messages),
        JSON.stringify(next.metadata),
        id,
      );
    return next;
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  async checkpoint(sessionId: string): Promise<SessionCheckpoint> {
    const session = await this.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO checkpoints (session_id, checkpoint_at, state_status, messages_json, metadata_json) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        sessionId,
        now,
        session.state.status,
        JSON.stringify(session.messages),
        JSON.stringify(session.metadata),
      );
    return {
      sessionId,
      checkpointAt: now,
      messages: [...session.messages],
      stateStatus: session.state.status,
      metadata: { ...session.metadata },
    };
  }

  async restoreFromCheckpoint(checkpoint: SessionCheckpoint): Promise<ConversationSession> {
    return this.create({
      messages: checkpoint.messages.map((m) => ({ ...m })),
      state: { status: 'idle' },
      metadata: { ...checkpoint.metadata, restoredFrom: checkpoint.checkpointAt },
    });
  }

  close(): void {
    this.db.close();
  }
}

interface SessionRow {
  id: string;
  created_at: number;
  updated_at: number;
  state_status: string;
  messages_json: string;
  metadata_json: string;
}

/**
 * Parse a JSON DB column without letting a single corrupt row throw.
 *
 * `messages_json` / `metadata_json` are persisted via `JSON.stringify`, but a
 * crash mid-write, a disk error, or a hand-edited DB can leave a column that
 * is not valid JSON (or not the expected shape). In `list()` a single such row
 * would otherwise abort `rows.map(rowToSession)` and make EVERY session
 * unreadable — the same fail-the-whole-subsystem class fixed for the artifacts
 * index. Degrade the bad column to a fallback and warn instead, so the session
 * entry stays visible and the rest of the list still loads.
 */
function parseJsonColumn<T>(raw: string, fallback: T, context: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(
      `[sqlite-session-store] ${context} 列 JSON 解析失败，降级为默认值：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return fallback;
  }
  if (Array.isArray(fallback)) {
    if (!Array.isArray(parsed)) {
      console.warn(`[sqlite-session-store] ${context} 列不是数组，降级为默认值。`);
      return fallback;
    }
    return parsed as T;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn(`[sqlite-session-store] ${context} 列不是对象，降级为默认值。`);
    return fallback;
  }
  return parsed as T;
}

function rowToSession(row: SessionRow): ConversationSession {
  const messages = parseJsonColumn<Message[]>(row.messages_json, [], `session ${row.id} messages`);
  const metadata = parseJsonColumn<Record<string, unknown>>(
    row.metadata_json,
    {},
    `session ${row.id} metadata`,
  );
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
    state: { status: 'idle' },
    metadata,
  };
}
