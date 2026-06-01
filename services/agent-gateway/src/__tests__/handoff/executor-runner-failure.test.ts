/**
 * 端到端健壮性加固 · 🔴#1
 *
 * runExecutionLayer（executor/reviewer 层）此前无脑把 stream 标成 completed：
 *   - 只 catch runSessionInBackground 抛出的异常；
 *   - 但 provider 报错（上游 5xx / 模型内部错误）通常**不抛异常**，而是返回
 *     `{ stopReason: 'error', statusCode, errorSummary }`；
 *   - 旧实现把这种"失败"误判成"成功"，setSubstate('completed') + 写成功
 *     result_json，让 handoff 假完成、上层链路继续派发错误产物。
 *
 * 修复后：抛异常 或 stopReason==='error' 都让 runner 抛出，由 watcher 统一走
 * failHandoff（incident + setSubstate('failed') + publish handoff.failed）。
 *
 * 本测试直接通过 createPhaseCAwareRunner 调用 executor runner，mock
 * runSessionInBackground 的两种失败形态，断言 runner 抛错且 substate 不被标
 * 'completed'。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as Pm1RunnerModule from '../../handoff/runner/pm1-runner.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

// stream-runtime 在被测路径里通过动态 import 引入；用 vi.mock 注入可控的
// runSessionInBackground，避免真正发起 LLM 流式请求。
const runSessionInBackgroundMock = vi.fn();
vi.mock('../../routes/stream-runtime.js', () => ({
  runSessionInBackground: (...args: unknown[]) => runSessionInBackgroundMock(...args),
}));

let dbModule: typeof DbModule;
let store: typeof HandoffStoreModule;
let pm1RunnerModule: typeof Pm1RunnerModule;

const USER_ID = 'u-exec-fail';
const PM2_SESSION_ID = 's-exec-fail-pm2';
const EXECUTOR_SESSION_ID = 's-exec-fail-exec';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, userId: string, roleLayer: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'demo', '{}', ?)`,
    [sessionId, userId, roleLayer],
  );
}

function readSubstate(sessionId: string): string | null {
  const row = dbModule.sqliteGet<{ substate: string | null }>(
    `SELECT substate FROM sessions WHERE id = ? LIMIT 1`,
    [sessionId],
  );
  return row?.substate ?? null;
}

function makeExecutorHandoff(): HandoffStoreModule.HandoffRecord {
  // 直接构造一个 toRoleLayer='executor' 的 handoff 记录（claimed/running 态），
  // 让 createPhaseCAwareRunner 走 runExecutionLayer 分支。
  return store.createHandoff({
    userId: USER_ID,
    fromSessionId: PM2_SESSION_ID,
    fromRoleLayer: 'pm2',
    toRoleLayer: 'executor',
    payload: { title: '实现登录接口', context: '需要 JWT', taskProfile: {} },
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  store = await import('../../handoff/store/handoff-store.js');
  pm1RunnerModule = await import('../../handoff/runner/pm1-runner.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'exec-fail@example.com');
  seedSession(PM2_SESSION_ID, USER_ID, 'pm2');
  seedSession(EXECUTOR_SESSION_ID, USER_ID, 'executor');
  runSessionInBackgroundMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('runExecutionLayer 失败语义（🔴#1）', () => {
  it('stream 返回 stopReason==="error" 时 runner 抛错，substate 不被标 completed', async () => {
    runSessionInBackgroundMock.mockResolvedValue({
      stopReason: 'error',
      statusCode: 502,
      errorSummary: '上游模型服务 502',
    });

    const runner = pm1RunnerModule.createPhaseCAwareRunner();
    const handoff = makeExecutorHandoff();
    const signal = new AbortController().signal;

    await expect(
      runner({ handoff, toSessionId: EXECUTOR_SESSION_ID, signal }),
    ).rejects.toThrow(/executor 层执行失败/);

    // substate 推进到 implementing（开工）但绝不能是 completed。
    expect(readSubstate(EXECUTOR_SESSION_ID)).not.toBe('completed');

    // 不应写入成功 result_json。
    const row = dbModule.sqliteGet<{ result_json: string | null }>(
      `SELECT result_json FROM handoff_records WHERE id = ? LIMIT 1`,
      [handoff.id],
    );
    expect(row?.result_json ?? null).toBeNull();
  });

  it('runSessionInBackground 抛异常时 runner 同样抛错', async () => {
    runSessionInBackgroundMock.mockRejectedValue(new Error('socket hang up'));

    const runner = pm1RunnerModule.createPhaseCAwareRunner();
    const handoff = makeExecutorHandoff();
    const signal = new AbortController().signal;

    await expect(
      runner({ handoff, toSessionId: EXECUTOR_SESSION_ID, signal }),
    ).rejects.toThrow(/executor 层执行失败[\s\S]*socket hang up/);

    expect(readSubstate(EXECUTOR_SESSION_ID)).not.toBe('completed');
  });

  it('stream 正常结束（stopReason==="end_turn"）时标 completed 并写 result_json', async () => {
    runSessionInBackgroundMock.mockResolvedValue({
      stopReason: 'end_turn',
      statusCode: 200,
    });

    const runner = pm1RunnerModule.createPhaseCAwareRunner();
    const handoff = makeExecutorHandoff();
    const signal = new AbortController().signal;

    await runner({ handoff, toSessionId: EXECUTOR_SESSION_ID, signal });

    expect(readSubstate(EXECUTOR_SESSION_ID)).toBe('completed');
    const row = dbModule.sqliteGet<{ result_json: string | null }>(
      `SELECT result_json FROM handoff_records WHERE id = ? LIMIT 1`,
      [handoff.id],
    );
    expect(row?.result_json).toBeTruthy();
    expect(JSON.parse(row!.result_json!)).toMatchObject({ role: 'executor', protocol: 'stream' });
  });
});
