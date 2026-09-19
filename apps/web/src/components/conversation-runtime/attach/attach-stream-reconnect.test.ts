import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  handleInterruptedAttachStream,
  INTERRUPTED_ATTACH_RETRY_DELAY_MS,
} from './attach-stream-reconnect.js';
import type {
  InterruptedAttachStreamActions,
  InterruptedAttachStreamState,
} from './attach-stream-reconnect.js';

interface ActionsHarness {
  actions: InterruptedAttachStreamActions;
  scheduleAttachRetry: Mock<InterruptedAttachStreamActions['scheduleAttachRetry']>;
}

function createState(
  overrides: Partial<InterruptedAttachStreamState> = {},
): InterruptedAttachStreamState {
  return {
    accumulatedText: '',
    accumulatedThinkingBlocks: [],
    accumulatedUsage: null,
    attachStateInitialized: false,
    currentAssistantStreamMessageId: null,
    parts: [],
    requestStartedAt: 0,
    toolCalls: [],
    ...overrides,
  };
}

function createActionsHarness(
  overrides: Partial<InterruptedAttachStreamActions> = {},
): ActionsHarness {
  const scheduleAttachRetry = vi.fn<InterruptedAttachStreamActions['scheduleAttachRetry']>();
  const actions: InterruptedAttachStreamActions = {
    cancelPendingRevealAnimation: vi.fn(),
    clearCurrentAssistantStreamMessageId: vi.fn(),
    clearStreamingBuffers: vi.fn(),
    getActiveSessionId: () => 'session-1',
    isCurrentSessionRequest: () => true,
    loadCurrentSessionSnapshot: vi.fn(async () => undefined),
    requestSessionListRefresh: vi.fn(),
    resetAttachAttempt: vi.fn(),
    resetRevealState: vi.fn(),
    scheduleAttachRetry,
    setActiveStreamFirstTokenLatencyMs: vi.fn(),
    setActiveStreamStartedAt: vi.fn(),
    setRecoveredStreamSnapshot: vi.fn(),
    setSessionStateStatus: vi.fn(),
    setStoppingStream: vi.fn(),
    setStreaming: vi.fn(),
    ...overrides,
  };
  return { actions, scheduleAttachRetry };
}

describe('handleInterruptedAttachStream', () => {
  it('同一会话但 epoch 漂移时仍然重新排期，beforeRetry 返回 proceed', () => {
    const { actions, scheduleAttachRetry } = createActionsHarness({
      // 旧 epoch 已失效：这正是历史实现提前放弃重连的场景
      isCurrentSessionRequest: () => false,
      getActiveSessionId: () => 'session-1',
    });

    handleInterruptedAttachStream({
      actions,
      attachSessionViewEpoch: 3,
      sessionId: 'session-1',
      state: createState(),
    });

    expect(actions.setSessionStateStatus).toHaveBeenCalledWith('running');
    expect(scheduleAttachRetry).toHaveBeenCalledTimes(1);
    const scheduled = scheduleAttachRetry.mock.calls.at(0)?.[0];
    expect(scheduled?.sessionId).toBe('session-1');
    expect(scheduled?.delayMs).toBe(INTERRUPTED_ATTACH_RETRY_DELAY_MS);
    expect(actions.resetAttachAttempt).not.toHaveBeenCalled();
    expect(scheduled?.beforeRetry?.()).toBe('proceed');
    expect(actions.resetAttachAttempt).toHaveBeenCalledTimes(1);
    expect(actions.loadCurrentSessionSnapshot).toHaveBeenCalledWith('session-1', {
      expectedSessionViewEpoch: 3,
    });
  });

  it('活跃会话已切换到别的会话时直接放弃', () => {
    const { actions, scheduleAttachRetry } = createActionsHarness({
      getActiveSessionId: () => 'session-2',
    });

    handleInterruptedAttachStream({
      actions,
      attachSessionViewEpoch: 1,
      sessionId: 'session-1',
      state: createState(),
    });

    expect(scheduleAttachRetry).not.toHaveBeenCalled();
    expect(actions.setSessionStateStatus).not.toHaveBeenCalled();
    expect(actions.loadCurrentSessionSnapshot).not.toHaveBeenCalled();
    expect(actions.requestSessionListRefresh).not.toHaveBeenCalled();
  });

  it('排期后会话被切走时 beforeRetry 返回 abort 且不重置 attach 标记', () => {
    let activeSessionId = 'session-1';
    const { actions, scheduleAttachRetry } = createActionsHarness({
      getActiveSessionId: () => activeSessionId,
    });

    handleInterruptedAttachStream({
      actions,
      attachSessionViewEpoch: 1,
      sessionId: 'session-1',
      state: createState(),
    });

    const beforeRetry = scheduleAttachRetry.mock.calls.at(0)?.[0]?.beforeRetry;
    activeSessionId = 'session-2';
    expect(beforeRetry?.()).toBe('abort');
    expect(actions.resetAttachAttempt).not.toHaveBeenCalled();
  });

  it('attach 状态已初始化时先落恢复快照再排期', () => {
    const { actions, scheduleAttachRetry } = createActionsHarness();

    handleInterruptedAttachStream({
      actions,
      attachSessionViewEpoch: 2,
      sessionId: 'session-1',
      state: createState({
        accumulatedText: 'partial text',
        attachStateInitialized: true,
        currentAssistantStreamMessageId: 'message-1',
        requestStartedAt: 123,
      }),
    });

    expect(actions.cancelPendingRevealAnimation).toHaveBeenCalledTimes(1);
    expect(actions.setRecoveredStreamSnapshot).toHaveBeenCalledTimes(1);
    expect(actions.clearStreamingBuffers).toHaveBeenCalledTimes(1);
    expect(actions.setStreaming).toHaveBeenCalledWith(false);
    expect(actions.clearCurrentAssistantStreamMessageId).toHaveBeenCalledTimes(1);
    expect(scheduleAttachRetry).toHaveBeenCalledTimes(1);
  });
});
