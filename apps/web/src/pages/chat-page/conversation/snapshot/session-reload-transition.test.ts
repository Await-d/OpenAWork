import { describe, expect, it } from 'vitest';

import { shouldPreserveActiveLocalStream } from './session-reload-transition.js';

describe('shouldPreserveActiveLocalStream', () => {
  it('同一会话的本地流仍在运行时保留消息和流状态', () => {
    expect(
      shouldPreserveActiveLocalStream({
        activeSessionId: 'session-1',
        isStreaming: true,
        requestedSessionId: 'session-1',
      }),
    ).toBe(true);
  });

  it('会话已切换或本地流已结束时允许重新加载快照', () => {
    expect(
      shouldPreserveActiveLocalStream({
        activeSessionId: 'session-1',
        isStreaming: true,
        requestedSessionId: 'session-2',
      }),
    ).toBe(false);
    expect(
      shouldPreserveActiveLocalStream({
        activeSessionId: 'session-1',
        isStreaming: false,
        requestedSessionId: 'session-1',
      }),
    ).toBe(false);
  });

  it('路由 ref 已指向新会话时仍以已加载会话决定是否保留流', () => {
    expect(
      shouldPreserveActiveLocalStream({
        activeSessionId: 'session-2',
        isStreaming: true,
        loadedSessionId: 'session-1',
        requestedSessionId: 'session-2',
      }),
    ).toBe(false);
  });
});
