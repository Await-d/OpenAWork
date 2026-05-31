import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SQLiteSessionStore } from './sqlite-session-store.js';

/**
 * Regression: `rowToSession` used to `JSON.parse` the `messages_json` /
 * `metadata_json` columns with no tolerance. A single corrupt row (crash
 * mid-write, disk error, hand-edited DB) would throw inside
 * `rows.map(rowToSession)` and make the ENTIRE `list()` — i.e. every session —
 * unreadable. The hardened version degrades a bad column to a fallback
 * (`[]` / `{}`) and warns, so the corrupt session stays visible and the rest
 * of the list still loads.
 */

let dir: string;
let dbPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sqlite-session-store-'));
  dbPath = join(dir, 'sessions.db');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  vi.restoreAllMocks();
});

function corruptColumns(path: string, id: string, messagesJson: string, metadataJson: string) {
  const raw = new Database(path);
  raw
    .prepare('UPDATE sessions SET messages_json = ?, metadata_json = ? WHERE id = ?')
    .run(messagesJson, metadataJson, id);
  raw.close();
}

describe('SQLiteSessionStore corrupt-row tolerance', () => {
  it('list() 不因单条损坏行抛错，损坏会话降级且其余正常', async () => {
    const store = new SQLiteSessionStore(dbPath);
    const good = await store.create({
      messages: [{ role: 'user', content: 'hi' } as never],
      state: { status: 'idle' },
      metadata: { ok: true },
    });
    const bad = await store.create({
      messages: [{ role: 'user', content: 'corrupt me' } as never],
      state: { status: 'idle' },
      metadata: { will: 'break' },
    });
    store.close();

    // Corrupt the bad row's columns directly on disk.
    corruptColumns(dbPath, bad.id, '{not valid json', 'also-not-json');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reopened = new SQLiteSessionStore(dbPath);
    const list = await reopened.list();
    expect(list).toHaveLength(2);

    const reloadedBad = list.find((s) => s.id === bad.id);
    expect(reloadedBad).toBeDefined();
    expect(reloadedBad?.messages).toEqual([]);
    expect(reloadedBad?.metadata).toEqual({});

    const reloadedGood = list.find((s) => s.id === good.id);
    expect(reloadedGood?.messages).toHaveLength(1);
    expect(reloadedGood?.metadata).toEqual({ ok: true });

    expect(warn).toHaveBeenCalled();
    reopened.close();
  });

  it('get() 对损坏行降级而非抛错', async () => {
    const store = new SQLiteSessionStore(dbPath);
    const session = await store.create({
      messages: [{ role: 'user', content: 'x' } as never],
      state: { status: 'idle' },
      metadata: { a: 1 },
    });
    store.close();

    corruptColumns(dbPath, session.id, '\u0000garbage', '[1,2,3]');

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reopened = new SQLiteSessionStore(dbPath);
    const loaded = await reopened.get(session.id);
    expect(loaded).not.toBeNull();
    // messages: invalid JSON -> [].
    expect(loaded?.messages).toEqual([]);
    // metadata: valid JSON but an array, not an object -> {}.
    expect(loaded?.metadata).toEqual({});
    reopened.close();
  });

  it('正常行往返解析不受影响', async () => {
    const store = new SQLiteSessionStore(dbPath);
    const session = await store.create({
      messages: [{ role: 'assistant', content: 'hello' } as never],
      state: { status: 'idle' },
      metadata: { nested: { k: 'v' }, n: 42 },
    });
    const loaded = await store.get(session.id);
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.metadata).toEqual({ nested: { k: 'v' }, n: 42 });
    store.close();
  });
});
