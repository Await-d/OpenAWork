import type { RunEvent } from '@openAwork/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SessionRunEventsModule from '../../session/session-run-events.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let sessionRunEvents: typeof SessionRunEventsModule;

const SESSION_ID = 'sess-run-event-batching';
const USER_ID = 'u-run-event-batching';
const CLIENT_REQUEST_ID = 'req-run-event-batching';

let unsubscribeHandlers: Array<() => void> = [];

function textDelta(delta: string): RunEvent {
  return { type: 'text_delta', delta, occurredAt: Date.now() };
}

interface StoredRow {
  seq: number;
  event_type: string;
  payload_json: string;
}

function readStoredRows(): StoredRow[] {
  return dbModule.sqliteAll<StoredRow>(
    'SELECT seq, event_type, payload_json FROM session_run_events WHERE session_id = ? ORDER BY seq ASC',
    [SESSION_ID],
  );
}

function storedSeqList(): Array<{ seq: number }> {
  return dbModule.sqliteAll<{ seq: number }>(
    'SELECT seq FROM session_run_events WHERE session_id = ?',
    [SESSION_ID],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  sessionRunEvents = await import('../../session/session-run-events.js');
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
     VALUES (?, ?, 'run event batching', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterEach(() => {
  for (const unsubscribe of unsubscribeHandlers) {
    unsubscribe();
  }
  unsubscribeHandlers = [];
  sessionRunEvents.__resetSessionRunEventBatchingForTesting();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('session run event batching', () => {
  it('buffers delayable deltas and persists them in seq order on flush', () => {
    const first = sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('a'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });
    const second = sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('b'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });
    const third = sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('c'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });

    expect([first.seq, second.seq, third.seq]).toEqual([1, 2, 3]);
    // 入队阶段不应落库——只保留在批队列中。
    expect(storedSeqList()).toHaveLength(0);

    sessionRunEvents.flushSessionRunEventQueue(SESSION_ID);

    const rows = readStoredRows();
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows.map((row) => (JSON.parse(row.payload_json) as { delta?: string }).delta)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('flushes queued deltas before a synchronous writer so seq stays ordered', () => {
    sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('first'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });
    sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('second'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });

    const toolResult: RunEvent = {
      type: 'tool_result',
      toolCallId: 'call-1',
      toolName: 'bash',
      output: 'ok',
      isError: false,
      occurredAt: Date.now(),
    };
    const persisted = sessionRunEvents.publishSessionRunEvent(SESSION_ID, toolResult, {
      clientRequestId: CLIENT_REQUEST_ID,
    });

    expect(persisted.seq).toBe(3);
    const rows = readStoredRows();
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.event_type)).toEqual([
      'text_delta',
      'text_delta',
      'tool_result',
    ]);
  });

  it('persists non-delayable events synchronously through the queue entry point', () => {
    sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('pending'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });

    const { seq } = sessionRunEvents.queueSessionRunEvent(
      SESSION_ID,
      { type: 'done', stopReason: 'end_turn', occurredAt: Date.now() },
      { clientRequestId: CLIENT_REQUEST_ID },
    );

    expect(seq).toBe(2);
    // 无需显式 flush：非延迟事件已先把队列写入并同步落库。
    const rows = readStoredRows();
    expect(rows.map((row) => row.event_type)).toEqual(['text_delta', 'done']);
  });

  it('broadcasts queued events only after flush, with seq and rowId meta', () => {
    const received: Array<{ event: RunEvent; meta?: { seq?: number; rowId?: number } }> = [];
    unsubscribeHandlers.push(
      sessionRunEvents.subscribeSessionRunEvents(SESSION_ID, (event, meta) => {
        received.push({ event, meta });
      }),
    );

    sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('x'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(received).toHaveLength(0);

    sessionRunEvents.flushSessionRunEventQueue(SESSION_ID);

    expect(received).toHaveLength(1);
    expect(received[0]?.meta?.seq).toBe(1);
    expect(typeof received[0]?.meta?.rowId).toBe('number');
  });

  it('flushes pending deltas before replay reads (read-your-writes)', () => {
    sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('r1'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });

    const replayed = sessionRunEvents.listSessionRunEventsByRequest({
      sessionId: SESSION_ID,
      clientRequestId: CLIENT_REQUEST_ID,
    });

    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({ type: 'text_delta', delta: 'r1' });
  });

  it('drops pending deltas and resets the seq cursor on request-scope delete', () => {
    sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('gone'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });

    sessionRunEvents.deleteSessionRunEventsByRequest({
      sessionId: SESSION_ID,
      clientRequestId: CLIENT_REQUEST_ID,
    });

    expect(storedSeqList()).toHaveLength(0);

    const next = sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('fresh'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(next.seq).toBe(1);
    sessionRunEvents.flushSessionRunEventQueue(SESSION_ID);
    expect(readStoredRows().map((row) => row.seq)).toEqual([1]);
  });

  it('auto-flushes once the batch size is reached without waiting for the timer', () => {
    const batchSize = sessionRunEvents.RUN_EVENT_FLUSH_BATCH_SIZE;
    let lastSeq: number | null = null;
    for (let index = 0; index < batchSize; index += 1) {
      lastSeq = sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta(`t${index}`), {
        clientRequestId: CLIENT_REQUEST_ID,
      }).seq;
    }

    expect(lastSeq).toBe(batchSize);
    // 阈值触发自动 flush，无需调用方介入。
    expect(storedSeqList()).toHaveLength(batchSize);
  });

  it('auto-flushes queued deltas on the interval timer', async () => {
    sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('timer'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(storedSeqList()).toHaveLength(0);

    await new Promise((resolve) =>
      setTimeout(resolve, sessionRunEvents.RUN_EVENT_FLUSH_INTERVAL_MS + 40),
    );

    expect(storedSeqList()).toHaveLength(1);
  });

  it('keeps seq cursors isolated between request scopes', () => {
    const otherRequestId = `${CLIENT_REQUEST_ID}-other`;
    sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('scope-a'), {
      clientRequestId: CLIENT_REQUEST_ID,
    });
    sessionRunEvents.queueSessionRunEvent(SESSION_ID, textDelta('scope-b'), {
      clientRequestId: otherRequestId,
    });

    sessionRunEvents.flushSessionRunEventQueue(SESSION_ID);

    const rows = dbModule.sqliteAll<{ client_request_id: string; seq: number }>(
      'SELECT client_request_id, seq FROM session_run_events WHERE session_id = ? ORDER BY client_request_id ASC',
      [SESSION_ID],
    );
    expect(rows).toEqual([
      { client_request_id: CLIENT_REQUEST_ID, seq: 1 },
      { client_request_id: otherRequestId, seq: 1 },
    ]);
  });
});
