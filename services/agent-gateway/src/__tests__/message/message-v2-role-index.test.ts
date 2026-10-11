/**
 * Regression test for the `message_v2.role` denormalised column.
 *
 * Background: `/recovery?messageLimit=N` resolves its turn window through
 * `listMessagesByTurnLimit` and reports the total through `countUserMessages`.
 * Both used to filter with `data LIKE '%"role":"user"%'` — a leading wildcard
 * that no index can serve, so every poll re-read **every** `message_v2` row of
 * the session (each row's `data` is a large JSON blob) purely to pattern-match.
 * `/recovery` is polled every 2.5s while a session is `running`, so the cost
 * grew with the whole session history and blocked the single-threaded SQLite
 * event loop the live stream also needs.
 *
 * `role` now lives in its own indexed column, written by the message projector
 * and backfilled for pre-existing rows by `backfillMessageRole`. These cases pin
 * all three links of that chain: projector write → indexed read → backfill.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageStoreV2Module from '../../message/message-store-v2.js';
import type * as MessageV2AdapterModule from '../../message/message-v2-adapter.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'message-v2-role-index-secret-1234567890';

let dbModule: typeof DbModule;
let store: typeof MessageStoreV2Module;
let adapter: typeof MessageV2AdapterModule;

const USER_ID = 'u-role-index';
const SESSION_ID = 'sess-role-index';
const BASE_TIME = 1_700_000_000_000;

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  store = await import('../../message/message-store-v2.js');
  adapter = await import('../../message/message-v2-adapter.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'role-index@example.test',
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

/** 每轮:user 提问 → assistant 回答。 */
function seedTurn(index: number): void {
  const turnBase = BASE_TIME + index * 10_000;
  adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'user',
    clientRequestId: `turn-${index}-user`,
    createdAt: turnBase,
    content: [{ type: 'text', text: `第 ${index} 轮提问` }],
  });
  adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'assistant',
    clientRequestId: `turn-${index}-assistant`,
    createdAt: turnBase + 1,
    content: [{ type: 'text', text: `第 ${index} 轮回答` }],
  });
}

function storedRoles(): string[] {
  return dbModule
    .sqliteAll<{ role: string }>(
      'SELECT role FROM message_v2 WHERE session_id = ? ORDER BY time_created ASC',
      [SESSION_ID],
    )
    .map((row) => row.role);
}

describe('message_v2.role 反规范化列', () => {
  it('projector 写入时同步落 role（读侧索引列不得缺位）', () => {
    seedTurn(0);
    seedTurn(1);

    expect(storedRoles()).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('countUserMessages 走 role 列，只数 user 消息', () => {
    seedTurn(0);
    seedTurn(1);
    seedTurn(2);

    expect(store.countUserMessages({ sessionId: SESSION_ID, userId: USER_ID })).toBe(3);
    expect(store.countMessages({ sessionId: SESSION_ID, userId: USER_ID })).toBe(6);
  });

  it('turnLimit 窗口按 role 列切出最近 N 轮', () => {
    seedTurn(0);
    seedTurn(1);
    seedTurn(2);

    const windowed = store.listMessagesByTurnLimit({
      sessionId: SESSION_ID,
      userId: USER_ID,
      turnLimit: 2,
    });

    // 最近两轮 = 4 条消息（第 1、2 轮各 user+assistant）。
    expect(windowed.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('backfillMessageRole 回填存量行（role 为空但 data 里有 role）', () => {
    seedTurn(0);
    // 模拟迁移前写入的行：role 列缺失（''），role 只存在于 data JSON 里。
    dbModule.sqliteRun('UPDATE message_v2 SET role = ? WHERE session_id = ?', ['', SESSION_ID]);
    expect(store.countUserMessages({ sessionId: SESSION_ID, userId: USER_ID })).toBe(0);

    dbModule.backfillMessageRole();

    expect(storedRoles()).toEqual(['user', 'assistant']);
    expect(store.countUserMessages({ sessionId: SESSION_ID, userId: USER_ID })).toBe(1);
  });

  it('backfill 跳过损坏 / 缺 role 的 data，不抛错也不写坏值', () => {
    seedTurn(0);
    dbModule.sqliteRun('UPDATE message_v2 SET role = ? WHERE session_id = ?', ['', SESSION_ID]);
    dbModule.sqliteRun(
      `INSERT INTO message_v2 (id, session_id, user_id, time_created, role, data)
       VALUES ('m-broken', ?, ?, ?, '', 'not-json')`,
      [SESSION_ID, USER_ID, BASE_TIME + 99_000],
    );

    expect(() => dbModule.backfillMessageRole()).not.toThrow();
    // 合法行被回填，损坏行保持 ''（读侧本就由 tryMessageInfoFromRow 跳过）。
    expect(storedRoles()).toEqual(['user', 'assistant', '']);
    expect(store.countUserMessages({ sessionId: SESSION_ID, userId: USER_ID })).toBe(1);
  });

  it('backfill 幂等：重复执行不会污染已回填的行', () => {
    seedTurn(0);
    dbModule.backfillMessageRole();
    dbModule.backfillMessageRole();

    expect(storedRoles()).toEqual(['user', 'assistant']);
  });
});
