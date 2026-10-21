/**
 * Regression tests for `message_v2`「幽灵行」—— `id IS NULL` 的消息行。
 *
 * 成因链（三环，缺一不可）：
 *   1. `id` 是**非 INTEGER** 主键，SQLite 仍允许 NULL，且唯一索引把多个 NULL 视为互不
 *      相同 —— 所以 ON CONFLICT 永不命中，幽灵行可以无限复制；
 *   2. 绑定层把 `undefined` 归一成 NULL（`infra/sqlite-bind-params.ts`），
 *      `messageInfoToRowData()` 又会剥掉 `id`，于是「把行 JSON 还原出来的 info 回投」
 *      的调用方每次都在插入新行；
 *   3. 读路径把这些行当合法消息参与回合归因，于是它们既读得到、又删不掉。
 *
 * 生产库上单个会话因此累积 228 万行 / 805 MiB，`POST /sessions/:id/messages/truncate`
 * 与消息列表接口被拖到秒级（实测：截断前的整会话 SELECT 2.6s，文本兜底 6.6s）。
 *
 * 这里钉住四个环节：写入守卫、状态流转不再自我放大、截断只读被删窗口、存量清理迁移。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageStoreV2Module from '../../message/message-store-v2.js';
import type * as MessageV2AdapterModule from '../../message/message-v2-adapter.js';
import type * as SyncEventModule from '../../session/sync-event.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'message-v2-ghost-rows-secret-1234567890';

let dbModule: typeof DbModule;
let store: typeof MessageStoreV2Module;
let adapter: typeof MessageV2AdapterModule;
let syncEvent: typeof SyncEventModule;

const USER_ID = 'u-ghost-rows';
const SESSION_ID = 'sess-ghost-rows';
const BASE_TIME = 1_700_000_000_000;

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  store = await import('../../message/message-store-v2.js');
  adapter = await import('../../message/message-v2-adapter.js');
  syncEvent = await import('../../session/sync-event.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'ghost-rows@example.test',
    'x',
  ]);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', 'idle', '{}', ?)`,
    [SESSION_ID, USER_ID, SESSION_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM part_v2 WHERE session_id = ?', [SESSION_ID]);
  dbModule.sqliteRun('DELETE FROM message_v2 WHERE session_id = ?', [SESSION_ID]);
});

/** 一轮 = user 提问 + assistant 回答，返回两条消息的 id。 */
function seedTurn(input: {
  index: number;
  requestId: string;
  userText: string;
  assistantText: string;
}): { userId: string; assistantId: string } {
  const turnBase = BASE_TIME + input.index * 10_000;
  const user = adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'user',
    clientRequestId: input.requestId,
    createdAt: turnBase,
    content: [{ type: 'text', text: input.userText }],
  });
  const assistant = adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'assistant',
    clientRequestId: `${input.requestId}:assistant:1`,
    createdAt: turnBase + 1,
    content: [{ type: 'text', text: input.assistantText }],
  });
  return { userId: user.id, assistantId: assistant.id };
}

function rows(): Array<{ id: string | null; role: string; time_created: number }> {
  return dbModule.sqliteAll<{ id: string | null; role: string; time_created: number }>(
    'SELECT id, role, time_created FROM message_v2 WHERE session_id = ? ORDER BY time_created ASC, id ASC',
    [SESSION_ID],
  );
}

function ghostRowCount(): number {
  const row = dbModule.sqliteGet<{ c: number }>(
    'SELECT count(*) AS c FROM message_v2 WHERE session_id = ? AND id IS NULL',
    [SESSION_ID],
  );
  return row?.c ?? 0;
}

/**
 * 直接落一行幽灵行，模拟历史版本（守卫补齐之前）写下的存量数据。payload 与生产现场一致：
 * 它是某条 assistant 消息的 info 被反复回投的产物（因此含 tokens / cost，只是没有 id）。
 */
function seedGhostRow(input: { timeCreated: number; requestId: string }): void {
  dbModule.sqliteRun(
    `INSERT INTO message_v2 (id, session_id, user_id, time_created, role, data)
     VALUES (NULL, ?, ?, ?, 'assistant', ?)`,
    [
      SESSION_ID,
      USER_ID,
      input.timeCreated,
      JSON.stringify({
        clientRequestId: input.requestId,
        agent: 'ghost',
        role: 'assistant',
        time: { created: input.timeCreated },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 }, total: 2 },
        status: 'error',
      }),
    ],
  );
}

describe('projector 写入守卫', () => {
  it('缺 id 的消息事件不再落库（而不是插一行不可寻址的幽灵行）', () => {
    seedTurn({ index: 0, requestId: 'r0', userText: '提问', assistantText: '回答' });
    const before = rows().length;

    // 历史故障现场：info 来自行 JSON（没有 id），回投后 id 变成 undefined → 绑定成 NULL。
    syncEvent.emitEvent({
      definition: syncEvent.MessageEvents.Updated,
      aggregateID: SESSION_ID,
      data: {
        sessionID: SESSION_ID,
        info: { role: 'assistant', status: 'error', clientRequestId: 'r0:assistant:1' },
      },
    });

    expect(rows().length).toBe(before);
    expect(ghostRowCount()).toBe(0);
  });

  it('守卫只丢弃写入，事件仍进 event_log（回放对称性不变）', () => {
    const countBefore = dbModule.sqliteGet<{ c: number }>(
      'SELECT count(*) AS c FROM event_log WHERE aggregate_id = ?',
      [SESSION_ID],
    )?.c;

    syncEvent.emitEvent({
      definition: syncEvent.MessageEvents.Updated,
      aggregateID: SESSION_ID,
      data: { sessionID: SESSION_ID, info: { role: 'assistant' } },
    });

    const countAfter = dbModule.sqliteGet<{ c: number }>(
      'SELECT count(*) AS c FROM event_log WHERE aggregate_id = ?',
      [SESSION_ID],
    )?.c;
    expect(countAfter).toBe((countBefore ?? 0) + 1);
  });
});

describe('状态流转不再自我放大', () => {
  it('按回合范围改状态时保留 id：行数不增长，也不会插幽灵行', () => {
    const turn = seedTurn({
      index: 0,
      requestId: 'req-1',
      userText: '提问',
      assistantText: '回答',
    });
    const before = rows().length;
    expect(turn.assistantId).toBeTruthy();

    adapter.updateSessionMessagesStatusByRequestScope({
      clientRequestId: 'req-1',
      sessionId: SESSION_ID,
      userId: USER_ID,
      status: 'error',
      roles: ['assistant'],
    });

    // 旧实现每次调用都会为每条命中行插一行新幽灵行（2 → 4 → 8 …，最终 228 万行）。
    expect(rows().length).toBe(before);
    expect(ghostRowCount()).toBe(0);

    // 重复调用同样幂等。
    adapter.updateSessionMessagesStatusByRequestScope({
      clientRequestId: 'req-1',
      sessionId: SESSION_ID,
      userId: USER_ID,
      status: 'error',
      roles: ['assistant'],
    });
    expect(rows().length).toBe(before);

    const assistantRow = dbModule.sqliteGet<{ data: string }>(
      'SELECT data FROM message_v2 WHERE id = ?',
      [turn.assistantId],
    );
    expect(JSON.parse(assistantRow?.data ?? '{}')).toMatchObject({ status: 'error' });
    // 落库形态与 projector 一致：data 里不重复存 id。
    expect(JSON.parse(assistantRow?.data ?? '{}')).not.toHaveProperty('id');
  });
});

describe('truncate 只读被删窗口', () => {
  function seedThreeTurns() {
    const t0 = seedTurn({ index: 0, requestId: 'r0', userText: '第一问', assistantText: '第一答' });
    const t1 = seedTurn({ index: 1, requestId: 'r1', userText: '第二问', assistantText: '第二答' });
    const t2 = seedTurn({ index: 2, requestId: 'r2', userText: '第三问', assistantText: '第三答' });
    return { t0, t1, t2 };
  }

  it('inclusive（缺省）从定位点起删，receipt 只含被删行', () => {
    const { t1, t2 } = seedThreeTurns();

    const result = adapter.truncateSessionMessagesAfterV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      messageId: t1.userId,
    });

    expect(result.removedMessageIds).toEqual([
      t1.userId,
      t1.assistantId,
      t2.userId,
      t2.assistantId,
    ]);
    expect(result.invalidatedClientRequestIds).toEqual([
      'r1',
      'r1:assistant:1',
      'r2',
      'r2:assistant:1',
    ]);
    expect(result.cutoffTimeMs).toBe(BASE_TIME + 10_000);
    expect(result.messages.map((message) => message.content[0])).toEqual([
      expect.objectContaining({ text: '第一问' }),
      expect.objectContaining({ text: '第一答' }),
    ]);
    expect(rows().map((row) => row.id)).toHaveLength(2);
  });

  it('inclusive: false 只删定位点之后的行', () => {
    const { t1, t2 } = seedThreeTurns();

    const result = adapter.truncateSessionMessagesAfterV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      messageId: t1.userId,
      inclusive: false,
    });

    expect(result.removedMessageIds).toEqual([t1.assistantId, t2.userId, t2.assistantId]);
    expect(result.cutoffTimeMs).toBe(BASE_TIME + 10_001);
    expect(rows().map((row) => row.id)).toHaveLength(3);
  });

  it('定位点不存在且无 messageText：no-op（不删、不发明窗口）', () => {
    seedThreeTurns();

    const result = adapter.truncateSessionMessagesAfterV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      messageId: 'msg-does-not-exist',
    });

    expect(result.removedMessageIds).toEqual([]);
    expect(result.invalidatedClientRequestIds).toEqual([]);
    expect(result.cutoffTimeMs).toBe(0);
    expect(rows()).toHaveLength(6);
  });

  it('前端 id 与后端不一致时按正文兜底定位最后一条匹配的 user 消息', () => {
    const { t1, t2 } = seedThreeTurns();

    const result = adapter.truncateSessionMessagesAfterV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      messageId: 'msg_frontend_ordered_id_not_in_backend',
      messageText: '第二问',
    });

    expect(result.removedMessageIds).toEqual([
      t1.userId,
      t1.assistantId,
      t2.userId,
      t2.assistantId,
    ]);
    expect(rows().map((row) => row.id)).not.toContain(t2.userId);
  });

  it('存量幽灵行不进入 receipt（removedMessageIds 里不得出现 null）', () => {
    seedTurn({ index: 0, requestId: 'r0', userText: '第一问', assistantText: '第一答' });
    seedGhostRow({ timeCreated: BASE_TIME + 5_000, requestId: 'r0:assistant:1' });

    const result = adapter.truncateSessionMessagesAfterV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      messageId: 'msg-frontend-order-id',
      messageText: '第一问',
    });

    expect(result.removedMessageIds.length).toBeGreaterThan(0);
    expect(result.removedMessageIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(
      true,
    );
    expect(result.invalidatedClientRequestIds).not.toContain(null);
  });
});

describe('存量幽灵行清理迁移', () => {
  it('按批次删除 id IS NULL 的行并落 app_meta 标记（幂等）', () => {
    const markerKey = 'message_v2_ghost_row_purge_v1';
    dbModule.sqliteRun('DELETE FROM app_meta WHERE key = ?', [markerKey]);
    seedTurn({ index: 0, requestId: 'r0', userText: '提问', assistantText: '回答' });
    seedGhostRow({ timeCreated: BASE_TIME + 1, requestId: 'r0:assistant:1' });
    seedGhostRow({ timeCreated: BASE_TIME + 2, requestId: 'r0:assistant:1' });
    expect(ghostRowCount()).toBe(2);

    dbModule.purgeUnidentifiableMessageRows();

    expect(ghostRowCount()).toBe(0);
    expect(dbModule.getAppMetaValue(markerKey)).toBe('done');
    // 正常行不受影响。
    expect(store.countMessages({ sessionId: SESSION_ID, userId: USER_ID })).toBe(2);

    // 标记已落：再次调用直接短路，不抛错。
    expect(() => dbModule.purgeUnidentifiableMessageRows()).not.toThrow();
  });

  it('没有幽灵行时也落标记，避免每次启动都扫一遍', () => {
    const markerKey = 'message_v2_ghost_row_purge_v1';
    dbModule.sqliteRun('DELETE FROM app_meta WHERE key = ?', [markerKey]);

    dbModule.purgeUnidentifiableMessageRows();

    expect(dbModule.getAppMetaValue(markerKey)).toBe('done');
  });
});
