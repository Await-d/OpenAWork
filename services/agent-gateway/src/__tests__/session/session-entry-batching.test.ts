import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SessionEntryStoreModule from '../../session/session-entry-store.js';
import type { SessionEventID } from '../../session/session-event.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let entryStore: typeof SessionEntryStoreModule;

const SESSION_ID = 'sess-entry-batching';
const USER_ID = 'u-entry-batching';
const CLIENT_REQUEST_ID = 'req-entry-batching';

interface StoredRow {
  seq: number;
  type: string;
  data: string;
}

function readRows(): StoredRow[] {
  return dbModule.sqliteAll<StoredRow>(
    'SELECT seq, type, data FROM session_entry WHERE session_id = ? ORDER BY seq ASC',
    [SESSION_ID],
  );
}

function storedSeqList(): Array<{ seq: number }> {
  return dbModule.sqliteAll<{ seq: number }>(
    'SELECT seq FROM session_entry WHERE session_id = ?',
    [SESSION_ID],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  entryStore = await import('../../session/session-entry-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM session_entry', []);
  dbModule.sqliteRun('DELETE FROM session_run_events', []);
  dbModule.sqliteRun('DELETE FROM notifications', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'entry batching', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterEach(() => {
  entryStore.__resetSessionEntryBatchingForTesting();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('session entry batching', () => {
  it('buffers stream-time events and persists them in order on flush', () => {
    const state = entryStore.createStreamSessionEventState();
    entryStore.persistStreamChunkAsSessionEvents({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      chunk: { type: 'text_delta', delta: 'hello' },
      state,
    });

    // text.started + text.delta 都还在批队列中，未落库。
    expect(storedSeqList()).toHaveLength(0);

    entryStore.flushSessionEntryQueue(SESSION_ID);

    const rows = readRows();
    expect(rows.map((row) => row.type)).toEqual(['text.started', 'text.delta']);
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
    expect((JSON.parse(rows[1]!.data) as { delta?: string }).delta).toBe('hello');
  });

  it('flushes queued events before a synchronous writer so seq stays ordered', () => {
    const state = entryStore.createStreamSessionEventState();
    entryStore.persistStreamChunkAsSessionEvents({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      chunk: { type: 'text_delta', delta: 'queued' },
      state,
    });

    entryStore.appendSessionEvent({
      sessionId: SESSION_ID,
      userId: USER_ID,
      event: {
        id: 'evt-sync' as SessionEventID,
        type: 'text.delta',
        timestamp: Date.now(),
        delta: 'sync',
      },
    });

    const rows = readRows();
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.type)).toEqual(['text.started', 'text.delta', 'text.delta']);
    expect((JSON.parse(rows[2]!.data) as { delta?: string }).delta).toBe('sync');
  });

  it('flushes pending events before replay reads (read-your-writes)', () => {
    const state = entryStore.createStreamSessionEventState();
    entryStore.persistStreamChunkAsSessionEvents({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      chunk: { type: 'text_delta', delta: 'r1' },
      state,
    });

    const events = entryStore.listSessionEvents({ sessionId: SESSION_ID });
    expect(events.map((event) => event.type)).toEqual(['text.started', 'text.delta']);
  });

  it('auto-flushes once the batch size is reached without waiting for the timer', () => {
    const state = entryStore.createStreamSessionEventState();
    // Each chunk queues one event after the opener; queueing enough chunks to
    // cross the cap must persist a full batch without any explicit flush.
    for (let index = 0; index < entryStore.SESSION_ENTRY_FLUSH_BATCH_SIZE; index += 1) {
      entryStore.persistStreamChunkAsSessionEvents({
        sessionId: SESSION_ID,
        userId: USER_ID,
        clientRequestId: CLIENT_REQUEST_ID,
        chunk: { type: 'text_delta', delta: `t${index}` },
        state,
      });
    }

    expect(storedSeqList()).toHaveLength(entryStore.SESSION_ENTRY_FLUSH_BATCH_SIZE);
  });

  it('auto-flushes queued events on the interval timer', async () => {
    const state = entryStore.createStreamSessionEventState();
    entryStore.persistStreamChunkAsSessionEvents({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      chunk: { type: 'text_delta', delta: 'timer' },
      state,
    });
    expect(storedSeqList()).toHaveLength(0);

    await new Promise((resolve) =>
      setTimeout(resolve, entryStore.SESSION_ENTRY_FLUSH_INTERVAL_MS + 40),
    );

    expect(storedSeqList()).toHaveLength(2);
  });

  it('drops pending events on request-scope delete', () => {
    const state = entryStore.createStreamSessionEventState();
    entryStore.persistStreamChunkAsSessionEvents({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      chunk: { type: 'text_delta', delta: 'discarded' },
      state,
    });

    entryStore.deleteSessionEventsByRequestScope({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: CLIENT_REQUEST_ID,
    });

    expect(storedSeqList()).toHaveLength(0);

    entryStore.appendSessionEvent({
      sessionId: SESSION_ID,
      userId: USER_ID,
      event: {
        id: 'evt-after-delete' as SessionEventID,
        type: 'text.delta',
        timestamp: Date.now(),
        delta: 'fresh',
      },
    });
    expect(readRows().map((row) => row.seq)).toEqual([1]);
  });
});
