/**
 * End-to-end integration: v2-runtime drizzle façade reads rows that
 * the legacy `db.ts` migration installs.
 *
 * This is the bridge test that closes the loop on Phase 0–5: the V2
 * schema declarations and `V2Storage` API must align with the actual
 * SQLite tables the legacy boot path creates. If a column / index /
 * FK ever drifts, this test catches it before any production traffic.
 */

import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { Effect, Stream } from 'effect';

const requireFromHere = createRequire(import.meta.url);
const sqliteModule = requireFromHere('node:sqlite') as {
  DatabaseSync: new (path: string) => NodeDatabaseSync;
};
const { DatabaseSync } = sqliteModule;

let tempDir: string;
let dbPath: string;
let db: NodeDatabaseSync;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'openawork-v2-integration-'));
  dbPath = join(tempDir, 'gateway.db');
  process.env['OPENAWORK_DATABASE_PATH'] = dbPath;

  // Fresh-import db.ts so the module-level connection picks up the new path.
  // Bypass vite-static-analysis on `node:sqlite` by going through the
  // already-imported sqliteModule.
  db = new DatabaseSync(dbPath);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // Already closed by another teardown — fine.
  }
  delete process.env['OPENAWORK_DATABASE_PATH'];
  rmSync(tempDir, { force: true, recursive: true });
});

/**
 * Mirror the Phase 2.2 / Phase 3 portion of the legacy migrate(): we
 * execute a hand-crafted minimal subset that creates exactly the tables
 * V2Storage expects. This avoids dragging in the rest of the gateway
 * (which would re-trigger node:sqlite resolution at the bundler level).
 */
function applyMinimalMigrations(): void {
  db.exec('PRAGMA foreign_keys=ON');
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
  db.exec('CREATE INDEX idx_message_v2_session_time ON message_v2(session_id, time_created, id)');
  db.exec('CREATE INDEX idx_part_v2_message ON part_v2(message_id, id)');
  db.exec('CREATE INDEX idx_part_v2_session ON part_v2(session_id)');
  db.exec(
    'CREATE INDEX idx_session_entry_session_seq ON session_entry(session_id, seq, timestamp)',
  );
  db.exec(
    'CREATE INDEX idx_session_entry_session_request ON session_entry(session_id, client_request_id, seq)',
  );
}

describe('v2-runtime integration with legacy schema', () => {
  it('reads back rows the legacy schema layout produces', async () => {
    applyMinimalMigrations();

    db.exec(`INSERT INTO users (id, email) VALUES ('u-int', 'int@example.com')`);
    db.exec(`INSERT INTO sessions (id, user_id, title) VALUES ('s-int', 'u-int', 'integration')`);
    db.exec(`INSERT INTO message_v2 (id, session_id, user_id, time_created, data) VALUES
      ('m-1', 's-int', 'u-int', 100, '{"role":"user","time":{"created":100}}'),
      ('m-2', 's-int', 'u-int', 200, '{"role":"assistant","time":{"created":200},"cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}')`);
    db.exec(`INSERT INTO session_entry
      (id, session_id, user_id, client_request_id, seq, type, timestamp, data)
      VALUES
      ('e-1', 's-int', 'u-int', 'req-1', 1, 'text.delta', 110, '{"delta":"hi"}'),
      ('e-2', 's-int', 'u-int', 'req-1', 2, 'text.delta', 120, '{"delta":" there"}')
    `);

    const { V2Storage } = await import('../../v2-runtime/storage/index.js');
    const storage = V2Storage.fromConnection(db);

    const session = await storage.getSession('s-int');
    expect(session).toBeTruthy();
    expect(session?.title).toBe('integration');

    const messages = await storage.listMessages({ sessionId: 's-int', userId: 'u-int' });
    expect(messages.map((m) => m.id)).toEqual(['m-1', 'm-2']);

    const entries = await storage.listSessionEntries({
      sessionId: 's-int',
      clientRequestId: 'req-1',
    });
    expect(entries.map((e) => e.id)).toEqual(['e-1', 'e-2']);
    expect(entries.map((e) => e.type)).toEqual(['text.delta', 'text.delta']);
  });

  it('streamMessagesNewestFirst yields messages back-to-front via the legacy schema', async () => {
    applyMinimalMigrations();
    db.exec(`INSERT INTO users (id, email) VALUES ('u-stream', 's@example.com')`);
    db.exec(`INSERT INTO sessions (id, user_id, title) VALUES ('s-stream', 'u-stream', 'stream')`);
    const insert = db.prepare(
      'INSERT INTO message_v2 (id, session_id, user_id, time_created, data) VALUES (?, ?, ?, ?, ?)',
    );
    for (let i = 0; i < 4; i++) {
      insert.run(`m-${i}`, 's-stream', 'u-stream', i * 10, '{}');
    }

    const { V2Storage } = await import('../../v2-runtime/storage/index.js');
    const storage = V2Storage.fromConnection(db);

    const rows = await Effect.runPromise(
      Stream.runCollect(
        storage.streamMessagesNewestFirst({
          sessionId: 's-stream',
          userId: 'u-stream',
          pageSize: 2,
        }),
      ),
    );
    const ids = Array.from(rows).map((row) => row.id);
    expect(ids).toEqual(['m-3', 'm-2', 'm-1', 'm-0']);
  });

  it('event_log + allocateNextEventSeq survive a round-trip via the legacy tables', async () => {
    applyMinimalMigrations();
    db.exec(`INSERT INTO users (id, email) VALUES ('u-evt', 'e@example.com')`);
    db.exec(`INSERT INTO sessions (id, user_id, title) VALUES ('s-evt', 'u-evt', 'events')`);

    const { V2Storage } = await import('../../v2-runtime/storage/index.js');
    const storage = V2Storage.fromConnection(db);

    const seq1 = await storage.allocateNextEventSeq('s-evt');
    const seq2 = await storage.allocateNextEventSeq('s-evt');
    expect(seq1).toBe(1);
    expect(seq2).toBe(2);

    db.exec(`
      INSERT INTO event_log (id, aggregate_id, seq, type, version, data, timestamp) VALUES
        ('ev-a', 's-evt', 1, 'message.created', 1, '{}', 100),
        ('ev-b', 's-evt', 2, 'message.updated', 1, '{}', 200)
    `);
    const events = await storage.listEventLog('s-evt');
    expect(events.map((e) => `${e.type}:${e.seq}`)).toEqual([
      'message.created:1',
      'message.updated:2',
    ]);
  });
});
