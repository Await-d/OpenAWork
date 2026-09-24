// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { resolveSessionStopCapability } from './session-runtime.js';

function resolve(
  overrides: Partial<Parameters<typeof resolveSessionStopCapability>[0]> = {},
): ReturnType<typeof resolveSessionStopCapability> {
  return resolveSessionStopCapability({
    canStopCurrentSessionStream: false,
    currentSessionId: 'session-1',
    remoteSessionBusyState: null,
    sessionStateStatus: null,
    streaming: false,
    ...overrides,
  });
}

describe('resolveSessionStopCapability', () => {
  it('本地流式中给出 precise', () => {
    expect(resolve({ streaming: true, sessionStateStatus: 'running' })).toBe('precise');
  });

  it('已接管活跃流时给出 precise', () => {
    expect(resolve({ canStopCurrentSessionStream: true })).toBe('precise');
  });

  it('远端运行中（status running）给出 best_effort', () => {
    expect(resolve({ remoteSessionBusyState: 'running', sessionStateStatus: 'running' })).toBe(
      'best_effort',
    );
  });

  it('等待审批 / 等待回答的暂停必须为 none，不能退化成停止按钮', () => {
    expect(
      resolve({
        remoteSessionBusyState: 'paused',
        sessionStateStatus: 'paused',
      }),
    ).toBe('none');
  });

  it('仍有待审批交互时优先于 running 瞬态（批量审批续跑场景）', () => {
    expect(
      resolve({
        remoteSessionBusyState: 'paused',
        sessionStateStatus: 'running',
      }),
    ).toBe('none');
  });

  it('暂停优先于 observe_only（即使网关状态尚未收敛）', () => {
    expect(
      resolve({
        remoteSessionBusyState: 'paused',
        sessionStateStatus: 'idle',
      }),
    ).toBe('none');
  });

  it('远端运行但未接管原始请求时给出 observe_only', () => {
    expect(
      resolve({
        remoteSessionBusyState: 'running',
        sessionStateStatus: 'idle',
      }),
    ).toBe('observe_only');
  });

  it('空闲会话给出 none', () => {
    expect(resolve({ sessionStateStatus: 'idle' })).toBe('none');
  });
});
