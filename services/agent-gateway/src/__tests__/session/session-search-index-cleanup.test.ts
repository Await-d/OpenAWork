/**
 * Regression coverage for the search-index cleanup shared by every
 * session-removal path outside the HTTP routes.
 *
 * Paths covered here:
 *   1. `SessionEvents.Deleted` projector (message-v2-projectors.ts).
 *   2. `deleteSessionWithMalformedRecovery` (FK-off recovery statement list).
 *   3. The migration-time orphan repair (infra/db.ts).
 *
 * `session_messages_fts` is a regular FTS5 table with no FK to `sessions`, so
 * none of these paths can rely on a cascade to keep it consistent.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['JWT_SECRET'] = 'session-search-index-cleanup-secret-1234567890';

let dbModule: typeof DbModule;

const USER_ID = 'u-session-search-index';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function seedSession(sessionId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'session', '{}', 'idle')`,
    [sessionId, USER_ID],
  );
}

async function appendIndexedMessage(sessionId: string, text: string): Promise<string> {
  const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
  const messageId = `${sessionId}-msg-${text}`;
  appendSessionMessageV2({
    sessionId,
    userId: USER_ID,
    role: 'user',
    content: [{ type: 'text', text }],
    messageId,
  });
  return messageId;
}

function countSearchRowsForSession(sessionId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM session_messages_fts WHERE session_id = ?',
    [sessionId],
  );
  return row?.count ?? 0;
}

function countShadowContentRowsForSession(sessionId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM session_messages_fts_content WHERE c1 = ?',
    [sessionId],
  );
  return row?.count ?? 0;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM session_messages_fts', []);
  dbModule.sqliteRun('DELETE FROM event_sequences', []);
  dbModule.sqliteRun('DELETE FROM event_log', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('SessionEvents.Deleted projector', () => {
  it('removes the index rows of the deleted session and keeps the survivor rows', async () => {
    const { emitSessionDeleted } = await import('../../message/message-v2-adapter.js');
    seedSession('proj-deleted');
    seedSession('proj-survivor');
    await appendIndexedMessage('proj-deleted', 'projector-deleted');
    await appendIndexedMessage('proj-survivor', 'projector-survivor');

    emitSessionDeleted({
      sessionID: 'proj-deleted',
      info: {
        id: 'proj-deleted',
        userID: USER_ID,
        title: 'deleted',
        time: { created: 1, updated: 2 },
      },
    });

    expect(countSearchRowsForSession('proj-deleted')).toBe(0);
    expect(countShadowContentRowsForSession('proj-deleted')).toBe(0);
    expect(countSearchRowsForSession('proj-survivor')).toBe(1);
  });
});

describe('deleteSessionWithMalformedRecovery', () => {
  it('removes the index rows of the recovered session and keeps the survivor rows', async () => {
    const { deleteSessionWithMalformedRecovery } =
      await import('../../session/session-delete-recovery.js');
    seedSession('recovery-deleted');
    seedSession('recovery-survivor');
    await appendIndexedMessage('recovery-deleted', 'recovery-deleted');
    await appendIndexedMessage('recovery-survivor', 'recovery-survivor');

    deleteSessionWithMalformedRecovery({ sessionId: 'recovery-deleted', userId: USER_ID });

    expect(countSearchRowsForSession('recovery-deleted')).toBe(0);
    expect(countShadowContentRowsForSession('recovery-deleted')).toBe(0);
    expect(countSearchRowsForSession('recovery-survivor')).toBe(1);
  });
});

describe('deleteSessionMessageSearchDocumentsForSession', () => {
  it('scopes the delete to the exact session id (no prefix or neighbour over-deletion)', async () => {
    const { deleteSessionMessageSearchDocumentsForSession } =
      await import('../../session/session-search-store.js');
    seedSession('scope-a');
    seedSession('scope-ab');
    seedSession('scope-c');
    await appendIndexedMessage('scope-a', 'a');
    await appendIndexedMessage('scope-ab', 'ab');
    await appendIndexedMessage('scope-c', 'c');

    deleteSessionMessageSearchDocumentsForSession('scope-a');

    expect(countSearchRowsForSession('scope-a')).toBe(0);
    expect(countSearchRowsForSession('scope-ab')).toBe(1);
    expect(countSearchRowsForSession('scope-c')).toBe(1);
  });
});

describe('orphaned search-index repair', () => {
  it('migration removes index rows whose session no longer exists and keeps legitimate rows', async () => {
    const { searchSessionMessages, upsertSessionMessageSearchDocument } =
      await import('../../session/session-search-store.js');
    seedSession('repair-legit');
    const legitContentJson = JSON.stringify([{ type: 'text', text: 'legit-repair-message' }]);
    dbModule.sqliteRun(
      `INSERT INTO session_messages (id, session_id, user_id, seq, role, content_json, created_at_ms)
       VALUES ('repair-legit-msg', 'repair-legit', ?, 1, 'user', ?, 1)`,
      [USER_ID, legitContentJson],
    );
    // A populated `message_v2` makes the one-shot V1→V2 migration a no-op, the
    // same state as any installed database.
    dbModule.sqliteRun(
      `INSERT INTO message_v2 (id, session_id, user_id, time_created, data)
       VALUES ('repair-legit-v2-msg', 'repair-legit', ?, 1, '{}')`,
      [USER_ID],
    );
    upsertSessionMessageSearchDocument({
      contentJson: legitContentJson,
      id: 'repair-legit-msg',
      role: 'user',
      sessionId: 'repair-legit',
      userId: USER_ID,
    });

    // A dangling `session_messages` row can only be produced by a write with
    // FK enforcement off, which is exactly the state the repair must survive.
    dbModule.db.exec('PRAGMA foreign_keys=OFF');
    try {
      dbModule.sqliteRun(
        `INSERT INTO session_messages (id, session_id, user_id, seq, role, content_json, created_at_ms)
         VALUES ('repair-ghost-msg', 'repair-ghost', ?, 1, 'user', ?, 1)`,
        [USER_ID, JSON.stringify([{ type: 'text', text: 'ghost-repair-message' }])],
      );
    } finally {
      dbModule.db.exec('PRAGMA foreign_keys=ON');
    }
    upsertSessionMessageSearchDocument({
      contentJson: JSON.stringify([{ type: 'text', text: 'ghost-repair-message' }]),
      id: 'repair-ghost-msg',
      role: 'user',
      sessionId: 'repair-ghost',
      userId: USER_ID,
    });
    dbModule.sqliteRun('INSERT INTO event_sequences (aggregate_id, seq) VALUES (?, ?)', [
      'repair-ghost',
      3,
    ]);

    expect(countSearchRowsForSession('repair-ghost')).toBe(1);

    await dbModule.migrate();

    expect(countSearchRowsForSession('repair-ghost')).toBe(0);
    expect(countShadowContentRowsForSession('repair-ghost')).toBe(0);
    expect(countSearchRowsForSession('repair-legit')).toBe(1);
    expect(countShadowContentRowsForSession('repair-legit')).toBe(1);
    // The repair touches only the derived search index: append-only history
    // (dangling `session_messages` / `event_sequences` rows) stays as-is.
    const ghostMessage = dbModule.sqliteGet<{ id: string }>(
      'SELECT id FROM session_messages WHERE id = ?',
      ['repair-ghost-msg'],
    );
    expect(ghostMessage?.id).toBe('repair-ghost-msg');
    const ghostSeq = dbModule.sqliteGet<{ seq: number }>(
      'SELECT seq FROM event_sequences WHERE aggregate_id = ?',
      ['repair-ghost'],
    );
    expect(ghostSeq?.seq).toBe(3);

    const hits = searchSessionMessages({
      limit: 5,
      query: 'legit-repair-message',
      userId: USER_ID,
    });
    expect(hits.map((hit) => hit.sessionId)).toEqual(['repair-legit']);
  });

  it('is idempotent when run repeatedly', async () => {
    const { repairOrphanedSessionMessageSearchDocuments } = await import('../../infra/db.js');
    const { upsertSessionMessageSearchDocument } =
      await import('../../session/session-search-store.js');
    seedSession('repair-idempotent');
    const contentJson = JSON.stringify([{ type: 'text', text: 'idempotent-message' }]);
    upsertSessionMessageSearchDocument({
      contentJson,
      id: randomUUID(),
      role: 'user',
      sessionId: 'repair-idempotent',
      userId: USER_ID,
    });
    upsertSessionMessageSearchDocument({
      contentJson,
      id: randomUUID(),
      role: 'user',
      sessionId: 'repair-orphan',
      userId: USER_ID,
    });

    repairOrphanedSessionMessageSearchDocuments();
    repairOrphanedSessionMessageSearchDocuments();

    expect(countSearchRowsForSession('repair-orphan')).toBe(0);
    expect(countSearchRowsForSession('repair-idempotent')).toBe(1);
  });
});
