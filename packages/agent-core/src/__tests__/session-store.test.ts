import { describe, it, expect } from 'vitest';
import { InMemorySessionStore, SessionNotFoundError } from '../session-store.js';
import type { Message } from '@openAwork/shared';

const makeMessage = (id: string): Message => ({
  id,
  role: 'user',
  content: [{ type: 'text', text: 'hello' }],
  createdAt: Date.now(),
});

describe('InMemorySessionStore: create & get', () => {
  it('creates a session with generated id', async () => {
    const store = new InMemorySessionStore();
    const session = await store.create({
      messages: [],
      state: { status: 'idle' },
      metadata: {},
    });
    expect(session.id).toBeTruthy();
    expect(session.state.status).toBe('idle');
  });

  it('get returns null for unknown id', async () => {
    const store = new InMemorySessionStore();
    expect(await store.get('nonexistent')).toBeNull();
  });

  it('get returns created session', async () => {
    const store = new InMemorySessionStore();
    const session = await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
    const fetched = await store.get(session.id);
    expect(fetched?.id).toBe(session.id);
  });
});

describe('InMemorySessionStore: list', () => {
  it('returns sessions sorted by updatedAt descending', async () => {
    const store = new InMemorySessionStore();
    const s1 = await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
    const list = await store.list();
    expect(list[0]?.id).toBe(s2.id);
    expect(list[1]?.id).toBe(s1.id);
  });

  it('respects limit and offset', async () => {
    const store = new InMemorySessionStore();
    for (let i = 0; i < 5; i++) {
      await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
    }
    const page = await store.list(2, 1);
    expect(page).toHaveLength(2);
  });
});

describe('InMemorySessionStore: update', () => {
  it('updates messages', async () => {
    const store = new InMemorySessionStore();
    const session = await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
    const msg = makeMessage('m1');
    const updated = await store.update(session.id, { messages: [msg] });
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0]?.id).toBe('m1');
  });

  it('throws SessionNotFoundError for unknown id', async () => {
    const store = new InMemorySessionStore();
    await expect(store.update('ghost', { messages: [] })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });

  it('preserves original createdAt', async () => {
    const store = new InMemorySessionStore();
    const session = await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
    const updated = await store.update(session.id, { metadata: { foo: 'bar' } });
    expect(updated.createdAt).toBe(session.createdAt);
  });
});

describe('InMemorySessionStore: delete', () => {
  it('removes session', async () => {
    const store = new InMemorySessionStore();
    const session = await store.create({ messages: [], state: { status: 'idle' }, metadata: {} });
    await store.delete(session.id);
    expect(await store.get(session.id)).toBeNull();
  });

  it('is idempotent for unknown id', async () => {
    const store = new InMemorySessionStore();
    await expect(store.delete('ghost')).resolves.toBeUndefined();
  });
});

describe('InMemorySessionStore: checkpoint & restore', () => {
  it('creates a checkpoint with current messages and state', async () => {
    const store = new InMemorySessionStore();
    const msg = makeMessage('m1');
    const session = await store.create({
      messages: [msg],
      state: { status: 'idle' },
      metadata: { key: 'val' },
    });
    const checkpoint = await store.checkpoint(session.id);
    expect(checkpoint.sessionId).toBe(session.id);
    expect(checkpoint.messages).toHaveLength(1);
    expect(checkpoint.stateStatus).toBe('idle');
    expect(checkpoint.metadata['key']).toBe('val');
  });

  it('throws SessionNotFoundError for unknown session', async () => {
    const store = new InMemorySessionStore();
    await expect(store.checkpoint('ghost')).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it('restores session from checkpoint with idle state', async () => {
    const store = new InMemorySessionStore();
    const msg = makeMessage('m2');
    const original = await store.create({
      messages: [msg],
      state: { status: 'idle' },
      metadata: {},
    });
    const checkpoint = await store.checkpoint(original.id);
    const restored = await store.restoreFromCheckpoint(checkpoint);
    expect(restored.id).not.toBe(original.id);
    expect(restored.state.status).toBe('idle');
    expect(restored.messages).toHaveLength(1);
    expect(restored.messages[0]?.id).toBe('m2');
    expect(restored.metadata['restoredFrom']).toBe(checkpoint.checkpointAt);
  });
});
