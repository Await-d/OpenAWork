import { describe, expect, it } from 'vitest';
import { isMobileSessionRuntimeActive } from './mobile-status-activity';

function input(overrides: Partial<Parameters<typeof isMobileSessionRuntimeActive>[0]> = {}) {
  return {
    activeStream: null,
    hasRunningLocalWork: false,
    pendingPermissionCount: 0,
    pendingTodoCount: 0,
    sending: false,
    taskStatuses: [] as string[],
    ...overrides,
  };
}

describe('isMobileSessionRuntimeActive', () => {
  it('完全空闲时返回 false（这是本次优化要命中的场景）', () => {
    expect(isMobileSessionRuntimeActive(input())).toBe(false);
  });

  it('本地正在发送时活跃', () => {
    expect(isMobileSessionRuntimeActive(input({ sending: true }))).toBe(true);
  });

  it('有运行中的子代理时活跃', () => {
    expect(isMobileSessionRuntimeActive(input({ hasRunningLocalWork: true }))).toBe(true);
  });

  it('服务端活跃流存在时活跃', () => {
    expect(
      isMobileSessionRuntimeActive(
        input({ activeStream: { sessionId: 's1', heartbeatAtMs: Date.now() } }),
      ),
    ).toBe(true);
  });

  it('有待审批权限时活跃', () => {
    expect(isMobileSessionRuntimeActive(input({ pendingPermissionCount: 1 }))).toBe(true);
  });

  it('有未完成 todo 时活跃', () => {
    expect(isMobileSessionRuntimeActive(input({ pendingTodoCount: 2 }))).toBe(true);
  });

  it('任务列表里还有 pending / running 时活跃', () => {
    expect(isMobileSessionRuntimeActive(input({ taskStatuses: ['completed'] }))).toBe(false);
    expect(isMobileSessionRuntimeActive(input({ taskStatuses: ['completed', 'pending'] }))).toBe(
      true,
    );
    expect(isMobileSessionRuntimeActive(input({ taskStatuses: ['running'] }))).toBe(true);
  });

  /**
   * `activeStream` 为 null 只说明「服务端此刻没有运行时心跳」，不能因此否掉本地
   * 正在发送的事实——否则用户刚发消息、运行时心跳还没落库的那几秒会退到低频。
   */
  it('服务端无心跳时仍尊重本地活跃信号', () => {
    expect(isMobileSessionRuntimeActive(input({ activeStream: null, sending: true }))).toBe(true);
  });

  it('全部信号都为空时才判空闲', () => {
    expect(
      isMobileSessionRuntimeActive(
        input({
          activeStream: undefined,
          hasRunningLocalWork: false,
          pendingPermissionCount: 0,
          pendingTodoCount: 0,
          sending: false,
          taskStatuses: ['cancelled', 'completed'],
        }),
      ),
    ).toBe(false);
  });
});
