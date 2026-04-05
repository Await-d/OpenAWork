import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, unlinkSync } from 'fs';

const sqliteMock = vi.hoisted(() => {
  interface MockSessionRow {
    id: string;
    created_at: number;
    updated_at: number;
    state_status: string;
    messages_json: string;
    metadata_json: string;
  }

  interface MockCheckpointRow {
    checkpoint_at: number;
    metadata_json: string;
    messages_json: string;
    session_id: string;
    state_status: string;
  }

  interface MockDatabaseState {
    checkpoints: MockCheckpointRow[];
    sessions: Map<string, MockSessionRow>;
  }

  const stores = new Map<string, MockDatabaseState>();

  const getState = (dbPath: string): MockDatabaseState => {
    const existing = stores.get(dbPath);
    if (existing) {
      return existing;
    }

    const created: MockDatabaseState = {
      checkpoints: [],
      sessions: new Map<string, MockSessionRow>(),
    };
    stores.set(dbPath, created);
    return created;
  };

  class MockStatement {
    public constructor(
      private readonly state: MockDatabaseState,
      private readonly sql: string,
    ) {}

    public run(...args: unknown[]): { changes: number } {
      if (this.sql.includes('INSERT INTO sessions')) {
        const [id, createdAt, updatedAt, stateStatus, messagesJson, metadataJson] = args as [
          string,
          number,
          number,
          string,
          string,
          string,
        ];
        this.state.sessions.set(id, {
          created_at: createdAt,
          id,
          messages_json: messagesJson,
          metadata_json: metadataJson,
          state_status: stateStatus,
          updated_at: updatedAt,
        });
        return { changes: 1 };
      }

      if (this.sql.includes('UPDATE sessions SET')) {
        const [updatedAt, stateStatus, messagesJson, metadataJson, id] = args as [
          number,
          string,
          string,
          string,
          string,
        ];
        const current = this.state.sessions.get(id);
        if (!current) {
          return { changes: 0 };
        }
        this.state.sessions.set(id, {
          ...current,
          messages_json: messagesJson,
          metadata_json: metadataJson,
          state_status: stateStatus,
          updated_at: updatedAt,
        });
        return { changes: 1 };
      }

      if (this.sql.includes('DELETE FROM sessions')) {
        const [id] = args as [string];
        this.state.sessions.delete(id);
        return { changes: 1 };
      }

      if (this.sql.includes('INSERT INTO checkpoints')) {
        const [sessionId, checkpointAt, stateStatus, messagesJson, metadataJson] = args as [
          string,
          number,
          string,
          string,
          string,
        ];
        this.state.checkpoints.push({
          checkpoint_at: checkpointAt,
          metadata_json: metadataJson,
          messages_json: messagesJson,
          session_id: sessionId,
          state_status: stateStatus,
        });
        return { changes: 1 };
      }

      return { changes: 0 };
    }

    public get(...args: unknown[]): MockSessionRow | undefined {
      if (this.sql.includes('SELECT * FROM sessions WHERE id = ?')) {
        const [id] = args as [string];
        return this.state.sessions.get(id);
      }

      return undefined;
    }

    public all(...args: unknown[]): MockSessionRow[] {
      if (this.sql.includes('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?')) {
        const [limit, offset] = args as [number, number];
        return [...this.state.sessions.values()]
          .sort((left, right) => right.updated_at - left.updated_at)
          .slice(offset, offset + limit);
      }

      return [];
    }
  }

  class MockDatabase {
    private readonly state: MockDatabaseState;

    public constructor(dbPath: string) {
      this.state = getState(dbPath);
    }

    public pragma(_statement: string): void {}

    public exec(_sql: string): void {}

    public prepare(sql: string): MockStatement {
      return new MockStatement(this.state, sql);
    }

    public close(): void {}
  }

  return {
    MockDatabase,
    clearDb: (dbPath: string) => {
      stores.delete(dbPath);
    },
  };
});

vi.mock('better-sqlite3', () => ({
  default: sqliteMock.MockDatabase,
}));

import { SQLiteSessionStore } from '../sqlite-session-store.js';
import { SessionNotFoundError } from '../session-store.js';
import type { Message } from '@openAwork/shared';

const TEST_DB = '/tmp/test-agent-core-sessions.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  sqliteMock.clearDb(TEST_DB);
}

const makeMsg = (id: string): Message => ({
  id,
  role: 'user',
  content: [{ type: 'text', text: 'hello' }],
  createdAt: Date.now(),
});

afterEach(() => cleanup());
cleanup();

describe('SQLiteSessionStore: create & get', () => {
  it('creates a session and retrieves it by id', async () => {
    const store = new SQLiteSessionStore(TEST_DB);
    try {
      const session = await store.create({
        messages: [],
        state: { status: 'idle' },
        metadata: {},
      });
      expect(session.id).toBeTruthy();
      expect(session.state.status).toBe('idle');
      const fetched = await store.get(session.id);
      expect(fetched?.id).toBe(session.id);
    } finally {
      store.close();
    }
  });

  it('returns null for unknown id', async () => {
    const store = new SQLiteSessionStore(TEST_DB);
    try {
      expect(await store.get('nonexistent')).toBeNull();
    } finally {
      store.close();
    }
  });
});

describe('SQLiteSessionStore: list', () => {
  it('lists sessions sorted by updatedAt desc', async () => {
    const store = new SQLiteSessionStore(TEST_DB);
    try {
      await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
      await new Promise((r) => setTimeout(r, 5));
      const s2 = await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
      const list = await store.list();
      expect(list[0]?.id).toBe(s2.id);
    } finally {
      store.close();
    }
  });

  it('respects limit and offset', async () => {
    const store = new SQLiteSessionStore(TEST_DB);
    try {
      for (let i = 0; i < 5; i++) {
        await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
      }
      const page = await store.list(2, 1);
      expect(page).toHaveLength(2);
    } finally {
      store.close();
    }
  });
});

describe('SQLiteSessionStore: update', () => {
  it('updates messages and reflects in get()', async () => {
    const store = new SQLiteSessionStore(TEST_DB);
    try {
      const session = await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
      const msg = makeMsg('m1');
      const updated = await store.update(session.id, { messages: [msg] });
      expect(updated.messages).toHaveLength(1);
      const fetched = await store.get(session.id);
      expect(fetched?.messages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('throws SessionNotFoundError for unknown id', async () => {
    const store = new SQLiteSessionStore(TEST_DB);
    try {
      await expect(store.update('ghost', { messages: [] })).rejects.toBeInstanceOf(
        SessionNotFoundError,
      );
    } finally {
      store.close();
    }
  });
});

describe('SQLiteSessionStore: delete', () => {
  it('removes the session', async () => {
    const store = new SQLiteSessionStore(TEST_DB);
    try {
      const session = await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
      await store.delete(session.id);
      expect(await store.get(session.id)).toBeNull();
    } finally {
      store.close();
    }
  });

  it('is idempotent for unknown id', async () => {
    const store = new SQLiteSessionStore(TEST_DB);
    try {
      await expect(store.delete('ghost')).resolves.toBeUndefined();
    } finally {
      store.close();
    }
  });
});

describe('SQLiteSessionStore: checkpoint & restore', () => {
  it('checkpoints current state and restores to a new session', async () => {
    const store = new SQLiteSessionStore(TEST_DB);
    try {
      const msg = makeMsg('m1');
      const session = await store.create({
        messages: [msg],
        state: { status: 'idle' },
        metadata: { key: 'val' },
      });
      const checkpoint = await store.checkpoint(session.id);
      expect(checkpoint.sessionId).toBe(session.id);
      expect(checkpoint.messages).toHaveLength(1);
      expect(checkpoint.stateStatus).toBe('idle');

      const restored = await store.restoreFromCheckpoint(checkpoint);
      expect(restored.id).not.toBe(session.id);
      expect(restored.state.status).toBe('idle');
      expect(restored.messages).toHaveLength(1);
      expect(restored.metadata['restoredFrom']).toBe(checkpoint.checkpointAt);
    } finally {
      store.close();
    }
  });

  it('throws SessionNotFoundError for unknown session', async () => {
    const store = new SQLiteSessionStore(TEST_DB);
    try {
      await expect(store.checkpoint('ghost')).rejects.toBeInstanceOf(SessionNotFoundError);
    } finally {
      store.close();
    }
  });

  it('persistence survives store close and reopen', async () => {
    const store1 = new SQLiteSessionStore(TEST_DB);
    const msg = makeMsg('m2');
    const session = await store1.create({
      messages: [msg],
      state: { status: 'idle' },
      metadata: {},
    });
    const id = session.id;
    store1.close();

    const store2 = new SQLiteSessionStore(TEST_DB);
    try {
      const fetched = await store2.get(id);
      expect(fetched?.id).toBe(id);
      expect(fetched?.messages).toHaveLength(1);
      expect(fetched?.messages[0]?.id).toBe('m2');
    } finally {
      store2.close();
    }
  });
});
