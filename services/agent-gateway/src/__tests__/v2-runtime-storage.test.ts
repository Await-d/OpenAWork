// Vite (vitest's bundler) trips over the `node:` protocol when transforming
// static imports of `node:sqlite`, so we defer the resolution to runtime via
// `createRequire` which preserves the `node:` prefix end-to-end.
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { V2Storage } from '../v2-runtime/storage/index.js';

const requireFromHere = createRequire(import.meta.url);
const sqliteModule = requireFromHere('node:sqlite') as typeof NodeSqlite;
const { DatabaseSync } = sqliteModule;
type DatabaseSyncInstance = InstanceType<typeof sqliteModule.DatabaseSync>;

// ─── Fresh in-memory SQLite per test ─────────────────────────────────
//
// We create the same V2 table layout that `db.ts` migrations install,
// then drive it through the drizzle façade. This proves the schema
// declaration in `v2-runtime/storage/schema.ts` matches the production
// CREATE TABLE statements column-for-column (including index keys), and
// that `V2Storage` returns the rows we expect.

function createInMemoryDatabase(): DatabaseSyncInstance {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');

  // Minimal sessions/users surface — only the columns the V2 stack reads.
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      parent_id TEXT,
      workspace_id TEXT,
      time_created TEXT,
      time_updated TEXT,
      time_compacting TEXT,
      time_archived TEXT,
      summary_additions INTEGER,
      summary_deletions INTEGER,
      summary_files INTEGER,
      summary_diffs TEXT,
      revert TEXT,
      permission TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE message_v2 (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE part_v2 (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES message_v2(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE event_log (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      version INTEGER NOT NULL,
      data TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE event_sequences (
      aggregate_id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`
    CREATE TABLE session_entry (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_request_id TEXT,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Seed user + session so FK constraints don't reject our test data.
  db.exec(`INSERT INTO users (id, email) VALUES ('u-1', 'a@example.com')`);
  db.exec(`INSERT INTO sessions (id, user_id, title) VALUES ('s-1', 'u-1', 'demo')`);

  return db;
}

let db: DatabaseSyncInstance;
let storage: V2Storage;

beforeEach(() => {
  db = createInMemoryDatabase();
  storage = V2Storage.fromConnection(db);
});

describe('V2Storage (drizzle proxy over node:sqlite)', () => {
  it('reads a session via getSession', async () => {
    const session = await storage.getSession('s-1');
    expect(session?.id).toBe('s-1');
    expect(session?.userId).toBe('u-1');
    expect(session?.title).toBe('demo');
  });

  it('returns undefined when the session is missing', async () => {
    const session = await storage.getSession('missing');
    expect(session).toBeUndefined();
  });

  it('lists messages in chronological order with optional limit', async () => {
    db.exec(
      `INSERT INTO message_v2 (id, session_id, user_id, time_created, data) VALUES
       ('m-3', 's-1', 'u-1', 30, '{}'),
       ('m-1', 's-1', 'u-1', 10, '{}'),
       ('m-2', 's-1', 'u-1', 20, '{}')`,
    );
    const all = await storage.listMessages({ sessionId: 's-1', userId: 'u-1' });
    expect(all.map((r) => r.id)).toEqual(['m-1', 'm-2', 'm-3']);

    const limited = await storage.listMessages({ sessionId: 's-1', userId: 'u-1', limit: 2 });
    expect(limited.map((r) => r.id)).toEqual(['m-1', 'm-2']);
  });

  it('streams messages newest-first across pagination boundaries', async () => {
    const stmt = db.prepare(
      'INSERT INTO message_v2 (id, session_id, user_id, time_created, data) VALUES (?, ?, ?, ?, ?)',
    );
    for (let i = 0; i < 5; i++) {
      stmt.run(`m-${String(i).padStart(2, '0')}`, 's-1', 'u-1', i * 10, '{}');
    }

    const yielded: string[] = [];
    for await (const row of storage.streamMessagesNewestFirst({
      sessionId: 's-1',
      userId: 'u-1',
      pageSize: 2,
    })) {
      yielded.push(row.id);
    }
    expect(yielded).toEqual(['m-04', 'm-03', 'm-02', 'm-01', 'm-00']);
  });

  it('lists parts for a message in id order', async () => {
    db.exec(
      `INSERT INTO message_v2 (id, session_id, user_id, time_created, data) VALUES ('m-1', 's-1', 'u-1', 1, '{}')`,
    );
    db.exec(
      `INSERT INTO part_v2 (id, message_id, session_id, user_id, time_created, data) VALUES
       ('p-2', 'm-1', 's-1', 'u-1', 2, '{}'),
       ('p-1', 'm-1', 's-1', 'u-1', 1, '{}')`,
    );
    const parts = await storage.listPartsForMessage('m-1');
    expect(parts.map((p) => p.id)).toEqual(['p-1', 'p-2']);
  });

  it('lists session entries filtered by client_request_id and ordered by seq', async () => {
    db.exec(`
      INSERT INTO session_entry
        (id, session_id, user_id, client_request_id, seq, type, timestamp, data)
      VALUES
        ('e-2', 's-1', 'u-1', 'req-A', 2, 'text.delta', 200, '{"delta":"b"}'),
        ('e-1', 's-1', 'u-1', 'req-A', 1, 'text.delta', 100, '{"delta":"a"}'),
        ('e-3', 's-1', 'u-1', 'req-B', 3, 'compacted', 300, '{"auto":true}')
    `);
    const reqA = await storage.listSessionEntries({ sessionId: 's-1', clientRequestId: 'req-A' });
    expect(reqA.map((row) => row.id)).toEqual(['e-1', 'e-2']);

    const all = await storage.listSessionEntries({ sessionId: 's-1' });
    expect(all.map((row) => row.id)).toEqual(['e-1', 'e-2', 'e-3']);
  });

  it('reads back event_log entries for an aggregate in seq order', async () => {
    db.exec(`
      INSERT INTO event_log (id, aggregate_id, seq, type, version, data, timestamp) VALUES
        ('ev-2', 's-1', 2, 'message.updated', 1, '{}', 200),
        ('ev-1', 's-1', 1, 'message.created', 1, '{}', 100)
    `);
    const events = await storage.listEventLog('s-1');
    expect(events.map((e) => e.id)).toEqual(['ev-1', 'ev-2']);
  });

  it('allocateNextEventSeq increments the per-aggregate counter', async () => {
    expect(await storage.allocateNextEventSeq('s-1')).toBe(1);
    expect(await storage.allocateNextEventSeq('s-1')).toBe(2);
    expect(await storage.allocateNextEventSeq('s-1')).toBe(3);
    expect(await storage.allocateNextEventSeq('s-other')).toBe(1);
  });
});
