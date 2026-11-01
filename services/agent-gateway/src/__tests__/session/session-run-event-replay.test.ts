import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDb, closeDb, migrate, sqliteRun, sqliteAll, sqliteGet } from '../../infra/db.js';
import {
  RUN_EVENT_MAX_BYTES,
  RUN_EVENT_PAGE_MAX_BYTES,
  RunEventSizeError,
} from '../../session/run-event-size-budget.js';
import {
  __resetSessionRunEventBatchingForTesting,
  publishSessionRunEvent,
} from '../../session/session-run-events.js';
import {
  createRunEventReplayReader,
  getLatestRequestRunEvent,
  RUN_EVENT_REPLAY_PAGE_SIZE,
} from '../../session/session-run-event-replay.js';

beforeAll(async () => {
  await connectDb();
  await migrate();
});
beforeEach(() => {
  __resetSessionRunEventBatchingForTesting();
  sqliteRun('DELETE FROM sessions');
  sqliteRun('DELETE FROM users');
  sqliteRun(
    "INSERT INTO users (id, email, password_hash) VALUES ('replay-user', 'replay@example.test', 'hash')",
  );
  sqliteRun(
    "INSERT INTO sessions (id, user_id, metadata_json) VALUES ('replay-session', 'replay-user', '{}')",
  );
});
afterEach(() => __resetSessionRunEventBatchingForTesting());
afterAll(async () => {
  await closeDb();
});

function seed(seq: number, request = 'request', invalid = false) {
  sqliteRun(
    `INSERT INTO session_run_events (session_id, user_id, client_request_id, seq, event_type, occurred_at_ms, payload_json)
    VALUES ('replay-session', 'replay-user', ?, ?, 'text_delta', ?, ?)`,
    [
      request,
      seq,
      seq,
      invalid ? '{bad' : JSON.stringify({ type: 'text_delta', delta: String(seq) }),
    ],
  );
}
describe('bounded run event replay', () => {
  it('yields through many corrupt tail pages without OFFSET and preserves legacy NULL ordering', async () => {
    seed(1);
    for (let seq = 2; seq <= 520; seq += 1) seed(seq, 'request', true);
    let yielded = false;
    const turn = new Promise<void>((resolve) =>
      setImmediate(() => {
        yielded = true;
        resolve();
      }),
    );
    expect(await getLatestRequestRunEvent('replay-session', 'request')).toMatchObject({
      delta: '1',
    });
    expect(yielded).toBe(true);
    await turn;
    sqliteRun(
      `INSERT INTO session_run_events (session_id, client_request_id, seq, event_type, occurred_at_ms, payload_json)
      VALUES ('replay-session', 'request', NULL, 'done', NULL, ?)`,
      [JSON.stringify({ type: 'done', stopReason: 'end_turn' })],
    );
    expect(await getLatestRequestRunEvent('replay-session', 'request')).toMatchObject({
      type: 'done',
    });
  });

  it('uses the latest-event index without a temporary sort for both NULL and normal seq', () => {
    for (const nullSeq of [true, false]) {
      const plan = sqliteAll<{ detail: string }>(
        `EXPLAIN QUERY PLAN SELECT id, seq FROM session_run_events
        WHERE session_id = ? AND client_request_id = ? AND seq IS ${nullSeq ? '' : 'NOT '}NULL
        ORDER BY ${nullSeq ? '' : 'seq DESC, '}COALESCE(occurred_at_ms, 0) DESC, id DESC LIMIT 128`,
        ['replay-session', 'request'],
      );
      expect(plan.map((row) => row.detail).join('\n')).not.toContain('TEMP B-TREE');
    }
  });

  it('splits large pages by UTF-8 bytes while retaining every event', () => {
    const payload = JSON.stringify({ type: 'text_delta', delta: '中'.repeat(200_000) });
    for (let seq = 1; seq <= 8; seq += 1) {
      seed(seq);
      sqliteRun('UPDATE session_run_events SET payload_json = ? WHERE seq = ?', [payload, seq]);
    }
    const read = createRunEventReplayReader({
      sessionId: 'replay-session',
      clientRequestId: 'request',
    });
    const cursors: number[] = [];
    let after = 0;
    while (true) {
      const page = read(after);
      expect(page.events.length * Buffer.byteLength(payload)).toBeLessThanOrEqual(
        RUN_EVENT_PAGE_MAX_BYTES,
      );
      cursors.push(...page.events.map((entry) => entry.cursor));
      after = page.nextCursor;
      if (!page.more) break;
    }
    expect(cursors).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('does not skip an oversized row or destroy its stored payload', () => {
    seed(1);
    seed(2);
    seed(3);
    const payload = JSON.stringify({ type: 'text_delta', delta: 'x'.repeat(RUN_EVENT_MAX_BYTES) });
    sqliteRun('UPDATE session_run_events SET payload_json = ? WHERE seq = 2', [payload]);
    const read = createRunEventReplayReader({
      sessionId: 'replay-session',
      clientRequestId: 'request',
    });
    const first = read(0);
    expect(first.nextCursor).toBe(1);
    expect(first.more).toBe(true);
    expect(() => read(first.nextCursor)).toThrow(RunEventSizeError);
    expect(
      sqliteGet<{ payload_json: string }>(
        'SELECT payload_json FROM session_run_events WHERE seq = 2',
      )?.payload_json,
    ).toBe(payload);
  });

  it('uses exclusive seq pages, skips the consumed prefix and freezes the high-water mark', () => {
    for (let seq = 1; seq <= 13070; seq += 1) seed(seq);
    const read = createRunEventReplayReader({
      sessionId: 'replay-session',
      clientRequestId: 'request',
    });
    seed(13071);
    const first = read(12809);
    expect(first.events).toHaveLength(RUN_EVENT_REPLAY_PAGE_SIZE);
    expect(first.events[0]?.cursor).toBe(12810);
    let page = first;
    const events = [...first.events];
    while (page.more) {
      page = read(page.nextCursor);
      events.push(...page.events);
    }
    expect(events.map((event) => event.cursor)).toEqual(
      Array.from({ length: 261 }, (_, index) => 12810 + index),
    );
    expect(events.at(-1)?.cursor).toBe(13070);
  });

  it('advances through a whole page of corrupted JSON without losing the following page', () => {
    for (let seq = 1; seq <= RUN_EVENT_REPLAY_PAGE_SIZE; seq += 1) seed(seq, 'request', true);
    seed(RUN_EVENT_REPLAY_PAGE_SIZE + 1);
    const read = createRunEventReplayReader({
      sessionId: 'replay-session',
      clientRequestId: 'request',
    });
    const first = read(0);
    expect(first.events).toEqual([]);
    expect(first.more).toBe(true);
    expect(first.nextCursor).toBe(RUN_EVENT_REPLAY_PAGE_SIZE);
    expect(read(first.nextCursor).events[0]?.cursor).toBe(RUN_EVENT_REPLAY_PAGE_SIZE + 1);
  });

  it('multi-attach spans requests and replays more than 500 rows using row-id cursors', () => {
    for (let seq = 1; seq <= 620; seq += 1) seed(seq, seq % 2 ? 'one' : 'two');
    const read = createRunEventReplayReader({ sessionId: 'replay-session' });
    let cursor = 0;
    const events = [];
    while (true) {
      const page = read(cursor);
      events.push(...page.events);
      cursor = page.nextCursor;
      if (!page.more) break;
    }
    expect(events).toHaveLength(620);
    expect(new Set(events.map((event) => event.cursor)).size).toBe(620);
    expect(new Set(events.map((event) => event.clientRequestId))).toEqual(new Set(['one', 'two']));
  });

  it('reads the last valid event and includes queued deltas in the replay snapshot', async () => {
    seed(1);
    seed(2, 'request', true);
    expect(await getLatestRequestRunEvent('replay-session', 'request')).toMatchObject({
      delta: '1',
    });
    publishSessionRunEvent(
      'replay-session',
      { type: 'text_delta', delta: 'queued' },
      { clientRequestId: 'request', seq: 3 },
    );
    const read = createRunEventReplayReader({
      sessionId: 'replay-session',
      clientRequestId: 'request',
    });
    expect(read(2).events[0]?.event).toMatchObject({ delta: 'queued' });
  });
});
