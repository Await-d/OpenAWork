/**
 * 回归：`clearSessionRuntimeThreadIfPresent` 的「无行不发 DELETE」不变量。
 *
 * 背景：`/status`（3s）与 `/recovery`（1s）都会经 `reconcileSessionStateStatus` 高频调用
 * 线程清理，而它触发的前提恰恰是「该会话已无活跃信号」——这批 DELETE 绝大多数命中 0 行。
 * SQLite 的 DELETE 即使影响 0 行也要开写事务抢 WAL 写锁，网关是 bun 单进程 + 同步
 * `bun:sqlite` + `busy_timeout=5000`，撞锁期间整个事件循环连同在途请求一起冻结。故读路径
 * 必须先判存在再删。
 *
 * 这条不变量一旦被改回「无条件 DELETE」，不会有任何业务测试报警——只会表现为偶发的
 * `/status` 挂起数秒，因此需要在此钉死。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
}));

import {
  clearSessionRuntimeThread,
  clearSessionRuntimeThreadIfPresent,
} from '../../session/session-runtime-thread-store.js';

const SESSION_ID = 'sess-thread-store-1';
const USER_ID = 'u-thread-store-1';
const CLIENT_REQUEST_ID = 'req-thread-store-1';

const RUNTIME_THREAD_ROW = {
  client_request_id: CLIENT_REQUEST_ID,
  heartbeat_at_ms: 1_700_000_000_000,
  session_id: SESSION_ID,
  started_at_ms: 1_700_000_000_000,
  user_id: USER_ID,
};

function deleteCalls(): Array<{ params: unknown[]; sql: string }> {
  return mocks.sqliteRun.mock.calls
    .filter((call) => {
      const sql = String(call[0]);
      return /^DELETE\s+FROM\s+session_runtime_threads/i.test(sql);
    })
    .map((call) => ({ params: (call[1] ?? []) as unknown[], sql: String(call[0]) }));
}

beforeEach(() => {
  mocks.sqliteGet.mockReset();
  mocks.sqliteRun.mockReset();
});

describe('clearSessionRuntimeThreadIfPresent', () => {
  it('无残留行时只读不写，不发出任何 DELETE', () => {
    mocks.sqliteGet.mockReturnValue(undefined);

    clearSessionRuntimeThreadIfPresent({ sessionId: SESSION_ID, userId: USER_ID });

    expect(mocks.sqliteGet).toHaveBeenCalledTimes(1);
    expect(deleteCalls()).toEqual([]);
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });

  it('有残留行时执行 DELETE，谓词与参数与会话绑定', () => {
    mocks.sqliteGet.mockReturnValue(RUNTIME_THREAD_ROW);

    clearSessionRuntimeThreadIfPresent({ sessionId: SESSION_ID, userId: USER_ID });

    const deletes = deleteCalls();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.params).toEqual([SESSION_ID, USER_ID]);
    // 不带 clientRequestId 谓词 —— 本变体只做会话级清理。
    expect(deletes[0]?.sql).not.toMatch(/client_request_id/i);
  });

  it('存在性探测走 session_id + user_id 的点查，不扫表', () => {
    mocks.sqliteGet.mockReturnValue(undefined);

    clearSessionRuntimeThreadIfPresent({ sessionId: SESSION_ID, userId: USER_ID });

    const [sql, params] = mocks.sqliteGet.mock.calls[0] ?? [];
    expect(String(sql)).toMatch(/FROM\s+session_runtime_threads/i);
    expect(String(sql)).toMatch(/WHERE\s+session_id\s*=\s*\?\s+AND\s+user_id\s*=\s*\?/i);
    expect(String(sql)).toMatch(/LIMIT\s+1/i);
    expect(params).toEqual([SESSION_ID, USER_ID]);
  });
});

describe('clearSessionRuntimeThread（stream finally 低频路径）', () => {
  it('保持无条件 DELETE：run 结束时清理本世代刚写入的行', () => {
    clearSessionRuntimeThread({ sessionId: SESSION_ID, userId: USER_ID });

    expect(mocks.sqliteGet).not.toHaveBeenCalled();
    const deletes = deleteCalls();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.params).toEqual([SESSION_ID, USER_ID]);
  });

  it('带 clientRequestId 时按世代收敛，DELETE 带该谓词', () => {
    clearSessionRuntimeThread({
      clientRequestId: CLIENT_REQUEST_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    const deletes = deleteCalls();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.sql).toMatch(/client_request_id\s*=\s*\?/i);
    expect(deletes[0]?.params).toEqual([SESSION_ID, USER_ID, CLIENT_REQUEST_ID]);
  });
});
