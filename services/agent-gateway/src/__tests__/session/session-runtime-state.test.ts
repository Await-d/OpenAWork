/**
 * 回归（会话状态不变量）：当会话存在活跃信号（在途流或新鲜运行时心跳）时，
 * reconcileSessionStateStatus 绝不能再返回持久化的过期 idle。
 * 这里用 vi.mock 隔离 DB / 在途流注册表 / 运行时心跳存储，保持测试无副作用。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearSessionRuntimeThread: vi.fn(),
  getAnyInFlightStreamRequestForSession: vi.fn(),
  hasFreshSessionRuntimeThread: vi.fn(),
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
}));

vi.mock('../../routes/stream-cancellation.js', () => ({
  getAnyInFlightStreamRequestForSession: mocks.getAnyInFlightStreamRequestForSession,
}));

vi.mock('../../session/session-runtime-thread-store.js', () => ({
  clearSessionRuntimeThread: mocks.clearSessionRuntimeThread,
  hasFreshSessionRuntimeThread: mocks.hasFreshSessionRuntimeThread,
}));

import { reconcileSessionStateStatus } from '../../session/session-runtime-state.js';

const SESSION_ID = 'sess-runtime-state-1';
const USER_ID = 'u-runtime-state-1';

interface FakeState {
  pendingPermissions: number;
  pendingQuestions: number;
  persistStatus: string | null;
}

const stateWrites: Array<{ sessionId: string; status: string; userId: string }> = [];

let state: FakeState;

function sqliteGetImpl(sql: string): unknown {
  if (/FROM\s+sessions/i.test(sql)) {
    return state.persistStatus === null ? undefined : { state_status: state.persistStatus };
  }

  if (/permission_requests/i.test(sql)) {
    return { count: state.pendingPermissions };
  }

  if (/question_requests/i.test(sql)) {
    return { count: state.pendingQuestions };
  }

  return undefined;
}

function sqliteRunImpl(sql: string, params: unknown[] = []): void {
  const placeholderMatch = /UPDATE\s+sessions\s+SET\s+state_status\s*=\s*\?/i.exec(sql);
  if (placeholderMatch) {
    state.persistStatus = String(params[0]);
    stateWrites.push({
      sessionId: String(params[1]),
      status: String(params[0]),
      userId: String(params[2]),
    });
    return;
  }

  const inlineMatch = /UPDATE\s+sessions\s+SET\s+state_status\s*=\s*'([^']+)'/i.exec(sql);
  if (inlineMatch) {
    const status = inlineMatch[1] ?? '';
    state.persistStatus = status;
    stateWrites.push({
      sessionId: String(params[0]),
      status,
      userId: String(params[1]),
    });
  }
}

function seed(input: {
  pendingPermissions?: number;
  pendingQuestions?: number;
  persistStatus: string | null;
  streamInFlight: boolean;
  threadFresh: boolean;
}): void {
  state = {
    pendingPermissions: input.pendingPermissions ?? 0,
    pendingQuestions: input.pendingQuestions ?? 0,
    persistStatus: input.persistStatus,
  };
  stateWrites.length = 0;
  mocks.getAnyInFlightStreamRequestForSession.mockReturnValue(
    input.streamInFlight ? { clientRequestId: 'req-live' } : undefined,
  );
  mocks.hasFreshSessionRuntimeThread.mockReturnValue(input.threadFresh);
}

beforeEach(() => {
  mocks.clearSessionRuntimeThread.mockReset();
  mocks.getAnyInFlightStreamRequestForSession.mockReset();
  mocks.hasFreshSessionRuntimeThread.mockReset();
  mocks.sqliteGet.mockReset();
  mocks.sqliteRun.mockReset();
  mocks.sqliteGet.mockImplementation((sql: string) => sqliteGetImpl(sql));
  mocks.sqliteRun.mockImplementation((sql: string, params: unknown[] = []) =>
    sqliteRunImpl(sql, params),
  );
});

describe('reconcileSessionStateStatus 活跃信号不变量', () => {
  it('存在新鲜运行时心跳且持久化为 idle 时，应返回 running 并回写数据库', () => {
    seed({ persistStatus: 'idle', streamInFlight: false, threadFresh: true });

    const result = reconcileSessionStateStatus({ sessionId: SESSION_ID, userId: USER_ID });

    expect(result.previousStatus).toBe('idle');
    expect(result.status).toBe('running');
    expect(result.wasReset).toBe(false);
    expect(result.sessionContext?.status).toBe('busy');
    expect(state.persistStatus).toBe('running');
    expect(stateWrites).toEqual([{ sessionId: SESSION_ID, status: 'running', userId: USER_ID }]);
  });

  it('存在在途流且有 pending 权限请求时，应返回 paused 并回写数据库', () => {
    seed({
      pendingPermissions: 1,
      persistStatus: 'idle',
      streamInFlight: true,
      threadFresh: false,
    });

    const result = reconcileSessionStateStatus({ sessionId: SESSION_ID, userId: USER_ID });

    expect(result.previousStatus).toBe('idle');
    expect(result.status).toBe('paused');
    expect(result.wasReset).toBe(false);
    expect(result.sessionContext?.status).toBe('paused');
    expect(state.persistStatus).toBe('paused');
    expect(stateWrites).toEqual([{ sessionId: SESSION_ID, status: 'paused', userId: USER_ID }]);
  });

  it('存在在途流且持久化已是 running 时，应保持 running 且无需回写', () => {
    seed({ persistStatus: 'running', streamInFlight: true, threadFresh: false });

    const result = reconcileSessionStateStatus({ sessionId: SESSION_ID, userId: USER_ID });

    expect(result.previousStatus).toBe('running');
    expect(result.status).toBe('running');
    expect(result.wasReset).toBe(false);
    expect(state.persistStatus).toBe('running');
    expect(stateWrites).toEqual([]);
  });

  it('无活跃信号且无待处理交互时，running 应回退为 idle 并标记 wasReset', () => {
    seed({ persistStatus: 'running', streamInFlight: false, threadFresh: false });

    const result = reconcileSessionStateStatus({ sessionId: SESSION_ID, userId: USER_ID });

    expect(result.previousStatus).toBe('running');
    expect(result.status).toBe('idle');
    expect(result.wasReset).toBe(true);
    expect(result.sessionContext?.status).toBe('idle');
    expect(state.persistStatus).toBe('idle');
    expect(stateWrites).toEqual([{ sessionId: SESSION_ID, status: 'idle', userId: USER_ID }]);
  });

  it('无活跃信号但存在 pending 交互时，应保持 paused 分支行为', () => {
    seed({ pendingQuestions: 1, persistStatus: 'idle', streamInFlight: false, threadFresh: false });

    const result = reconcileSessionStateStatus({ sessionId: SESSION_ID, userId: USER_ID });

    expect(result.status).toBe('paused');
    expect(result.wasReset).toBe(false);
    expect(state.persistStatus).toBe('paused');
    expect(stateWrites).toEqual([{ sessionId: SESSION_ID, status: 'paused', userId: USER_ID }]);
  });
});
