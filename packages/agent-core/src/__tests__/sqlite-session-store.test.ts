import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { SQLiteSessionStore } from '../sqlite-session-store.js';
import { SessionNotFoundError } from '../session-store.js';
import type { Message } from '@openAwork/shared';

const TEST_DB = '/tmp/test-agent-core-sessions.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
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
