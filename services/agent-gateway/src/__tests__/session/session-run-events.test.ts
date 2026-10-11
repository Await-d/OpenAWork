import type { RunEvent } from '@openAwork/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SessionRunEventsModule from '../../session/session-run-events.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let sessionRunEvents: typeof SessionRunEventsModule;

const SESSION_ID = 'sess-run-events';
const USER_ID = 'u-run-events';
const CLIENT_REQUEST_ID = 'req-run-events';

let unsubscribeHandlers: Array<() => void> = [];

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
     VALUES (?, ?, 'session run events', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterEach(() => {
  for (const unsubscribe of unsubscribeHandlers) {
    unsubscribe();
  }
  unsubscribeHandlers = [];
  vi.restoreAllMocks();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('session run events', () => {
  describe('listSessionRunEventsByRequestTail', () => {
    function seedDeltas(count: number, clientRequestId = CLIENT_REQUEST_ID): void {
      for (let index = 0; index < count; index += 1) {
        sessionRunEvents.publishSessionRunEvent(
          SESSION_ID,
          {
            type: 'text_delta',
            delta: `片段${index}`,
            eventId: `evt-delta-${index}`,
            occurredAt: 1_700_000_000_000 + index,
          },
          { clientRequestId },
        );
      }
    }

    it('只回尾部 limit 条，且按 seq 升序返回（可直接顺序 reduce）', () => {
      seedDeltas(10);

      const tail = sessionRunEvents.listSessionRunEventsByRequestTail({
        sessionId: SESSION_ID,
        clientRequestId: CLIENT_REQUEST_ID,
        limit: 3,
      });

      expect(tail.map((event) => (event.type === 'text_delta' ? event.delta : null))).toEqual([
        '片段7',
        '片段8',
        '片段9',
      ]);
    });

    it('limit 大于实际行数时返回全部，不补齐也不截断', () => {
      seedDeltas(4);

      const tail = sessionRunEvents.listSessionRunEventsByRequestTail({
        sessionId: SESSION_ID,
        clientRequestId: CLIENT_REQUEST_ID,
        limit: 100,
      });

      expect(tail).toHaveLength(4);
    });

    it('只覆盖目标 scope，不串到同会话的其它 clientRequestId', () => {
      seedDeltas(3);
      seedDeltas(2, 'req-other');

      const tail = sessionRunEvents.listSessionRunEventsByRequestTail({
        sessionId: SESSION_ID,
        clientRequestId: CLIENT_REQUEST_ID,
        limit: 10,
      });

      expect(tail).toHaveLength(3);
      expect(
        sessionRunEvents.listSessionRunEventsByRequest({
          sessionId: SESSION_ID,
          clientRequestId: 'req-other',
        }),
      ).toHaveLength(2);
    });

    it('limit 非正数时返回空数组（调用方无需自行判空）', () => {
      seedDeltas(3);

      expect(
        sessionRunEvents.listSessionRunEventsByRequestTail({
          sessionId: SESSION_ID,
          clientRequestId: CLIENT_REQUEST_ID,
          limit: 0,
        }),
      ).toEqual([]);
      expect(
        sessionRunEvents.listSessionRunEventsByRequestTail({
          sessionId: SESSION_ID,
          clientRequestId: CLIENT_REQUEST_ID,
          limit: -1,
        }),
      ).toEqual([]);
    });

    it('尾部窗口包含仍坐在批量队列里的 delta（read-your-writes）', () => {
      // text_delta 走 queueSessionRunEvent 时会被缓冲到下一个批量 flush，尚未落库。
      // 尾部窗口必须先 flush，否则「最新 N 条」会漏掉刚落地的内容。
      sessionRunEvents.queueSessionRunEvent(
        SESSION_ID,
        {
          type: 'text_delta',
          delta: '排队中的片段',
          eventId: 'evt-queued',
          occurredAt: 1_700_000_009_000,
        },
        { clientRequestId: CLIENT_REQUEST_ID },
      );

      expect(
        dbModule.sqliteAll<{ cnt: number }>(
          'SELECT COUNT(*) AS cnt FROM session_run_events WHERE session_id = ?',
          [SESSION_ID],
        )[0]?.cnt,
      ).toBe(0);

      const tail = sessionRunEvents.listSessionRunEventsByRequestTail({
        sessionId: SESSION_ID,
        clientRequestId: CLIENT_REQUEST_ID,
        limit: 5,
      });

      expect(tail).toEqual([expect.objectContaining({ delta: '排队中的片段' })]);
    });
  });

  it('publishSessionRunEvent 隔离订阅者异常，仍持久化并通知其他订阅者', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const received: RunEvent[] = [];

    unsubscribeHandlers.push(
      sessionRunEvents.subscribeSessionRunEvents(SESSION_ID, () => {
        throw new Error('sse writer failed');
      }),
    );
    unsubscribeHandlers.push(
      sessionRunEvents.subscribeSessionRunEvents(SESSION_ID, (event) => {
        received.push(event);
      }),
    );

    const event: RunEvent = {
      type: 'error',
      code: 'TEST_EVENT',
      message: '测试事件',
      eventId: 'evt-run-events',
      occurredAt: Date.now(),
    };

    expect(() =>
      sessionRunEvents.publishSessionRunEvent(SESSION_ID, event, {
        clientRequestId: CLIENT_REQUEST_ID,
      }),
    ).not.toThrow();

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(event);
    expect(
      sessionRunEvents.listSessionRunEventsByRequest({
        sessionId: SESSION_ID,
        clientRequestId: CLIENT_REQUEST_ID,
      }),
    ).toEqual([expect.objectContaining({ type: 'error', code: 'TEST_EVENT' })]);
    expect(errorSpy).toHaveBeenCalledWith(
      'session run event handler failed',
      expect.objectContaining({
        error: 'sse writer failed',
        eventType: 'error',
        sessionId: SESSION_ID,
      }),
    );
  });

  it('订阅者在回调中退订自己时，其余订阅者仍按快照收到事件', () => {
    const order: string[] = [];

    let unsubSelf: () => void = () => undefined;
    unsubSelf = sessionRunEvents.subscribeSessionRunEvents(SESSION_ID, () => {
      order.push('first');
      unsubSelf();
    });
    unsubscribeHandlers.push(() => unsubSelf());
    unsubscribeHandlers.push(
      sessionRunEvents.subscribeSessionRunEvents(SESSION_ID, () => {
        order.push('second');
      }),
    );

    const event: RunEvent = {
      type: 'error',
      code: 'SNAPSHOT_UNSUB',
      message: '测试',
      eventId: 'evt-unsub',
      occurredAt: Date.now(),
    };
    sessionRunEvents.publishSessionRunEvent(SESSION_ID, event, {
      clientRequestId: CLIENT_REQUEST_ID,
    });

    // 两个订阅者本轮都应收到（退订只影响后续事件，不影响当前快照）。
    expect(order).toEqual(['first', 'second']);
  });

  it('回调中新增的订阅者不会收到当前这一轮事件', () => {
    const lateReceived: RunEvent[] = [];
    unsubscribeHandlers.push(
      sessionRunEvents.subscribeSessionRunEvents(SESSION_ID, () => {
        unsubscribeHandlers.push(
          sessionRunEvents.subscribeSessionRunEvents(SESSION_ID, (late) => {
            lateReceived.push(late);
          }),
        );
      }),
    );

    const first: RunEvent = {
      type: 'error',
      code: 'SNAPSHOT_ADD_1',
      message: '测试',
      eventId: 'evt-add-1',
      occurredAt: Date.now(),
    };
    sessionRunEvents.publishSessionRunEvent(SESSION_ID, first, {
      clientRequestId: CLIENT_REQUEST_ID,
    });
    expect(lateReceived).toHaveLength(0);

    const second: RunEvent = {
      type: 'error',
      code: 'SNAPSHOT_ADD_2',
      message: '测试',
      eventId: 'evt-add-2',
      occurredAt: Date.now(),
    };
    sessionRunEvents.publishSessionRunEvent(SESSION_ID, second, {
      clientRequestId: CLIENT_REQUEST_ID,
    });
    // 下一轮事件中，先前新增的订阅者应已生效。
    expect(lateReceived.length).toBeGreaterThanOrEqual(1);
  });
});
