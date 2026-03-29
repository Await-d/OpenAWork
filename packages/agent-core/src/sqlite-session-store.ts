import Database from 'better-sqlite3';
import type { SessionStore } from './session-store.js';
import { SessionNotFoundError } from './session-store.js';
import type { ConversationSession, SessionCheckpoint, AgentStatus } from './types.js';
import type { Message } from '@openAwork/shared';

export class SQLiteSessionStore implements SessionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
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
      | SessionRow
      | undefined;
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
      stateStatus: session.state.status as AgentStatus,
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

function rowToSession(row: SessionRow): ConversationSession {
  const messages = JSON.parse(row.messages_json) as Message[];
  const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
    state: { status: 'idle' },
    metadata,
  };
}
