// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessagePart } from '../../../components/conversation-runtime/messages/support.js';
import type { StreamFrameHandle } from '../../../components/conversation-runtime/stream/stream-frame-controller.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import { createInitialChatRightPanelState } from '../state/chat-stream-state.js';
import { runChatSessionSwitchEffect } from './run-chat-session-switch-effect.js';
import type { ChatSessionSwitchDeps } from './run-chat-session-switch-effect.js';

const { fetchRecovery } = vi.hoisted(() => ({ fetchRecovery: vi.fn() }));
vi.mock('../../../utils/session/session-recovery-flight.js', () => ({
  fetchSessionRecoveryOnce: fetchRecovery,
}));

function createHarness(handleSessionId = 'A') {
  const events: string[] = [];
  const ref = <T>(current: T) => ({ current });
  const deps: ChatSessionSwitchDeps = {
    activateSessionView: vi.fn((sessionId) => {
      deps.activeSessionRef.current = sessionId;
      events.push('activate');
      return 2;
    }),
    activeSessionRef: ref<string | null>('A'),
    activeStreamStartedAtRef: ref(100),
    attachAttemptedSessionRef: ref(null),
    cancelAttachRetry: vi.fn(),
    chatView: 'session',
    clearSessionMetadataDirty: vi.fn(),
    currentAssistantStreamMessageIdRef: ref('assistant-A'),
    currentLoadedSessionIdRef: ref<string | null>('A'),
    forceFollowToLatest: vi.fn(() => vi.fn()),
    gatewayUrl: 'http://gateway.test',
    isCurrentSessionView: vi.fn(() => false),
    lastPersistedSessionMetadataSnapshotRef: ref(null),
    latestUpstreamSummary: null,
    messagesRef: ref([{ id: 'user-A', role: 'user', content: '问题 A' }]),
    navigateToHome: vi.fn(),
    navigateToSession: vi.fn(),
    pendingBootstrapSessionRef: ref(null),
    pendingSessionNormalizeTimeoutRef: ref(null),
    reportedStreamUsageRef: ref(null),
    resetStreamState: vi.fn(() => {
      events.push('reset');
      deps.streamFrameHandleRef.current?.dispose();
      deps.streamFrameHandleRef.current = null;
      deps.streamingRef.current = false;
      deps.streamBufferRef.current = '';
      deps.streamingSegmentsRef.current = [];
      deps.streamThinkingBlocksRef.current = [];
    }),
    restoreScrollTop: vi.fn(),
    rightPanelStateRef: ref(createInitialChatRightPanelState()),
    scrollRegionRef: ref(null),
    sessionId: 'B',
    sessionMetadataDirtyRef: ref(false),
    sessionModelSelectionSourceRef: ref(null),
    sessionReloadNonce: 0,
    sessionRestoredFromCacheRef: ref(false),
    sessionStateStatus: 'running',
    sessionViewCache: {
      save: vi.fn(() => {
        events.push('save');
      }),
      restore: vi.fn(() => null),
      invalidate: vi.fn(),
    },
    setActiveModelId: vi.fn(),
    setActiveProviderId: vi.fn(),
    setChildSessions: vi.fn(),
    setCurrentSessionId: vi.fn(),
    setDialogueMode: vi.fn(),
    setIsSessionLoading: vi.fn(),
    setIsSessionSnapshotReady: vi.fn(),
    setManualAgentId: vi.fn(),
    setMessageRatings: vi.fn(),
    setMessages: vi.fn(),
    setPendingPermissions: vi.fn(),
    setPendingQuestions: vi.fn(),
    setPermissionMode: vi.fn(),
    setReasoningEffort: vi.fn(),
    setRecoveredStreamSnapshot: vi.fn(),
    setRecoveryActiveStream: vi.fn(),
    setRightPanelState: vi.fn(),
    setSelectedChildSessionId: vi.fn(),
    setServerTotalTurnCount: vi.fn(),
    setSessionModesHydrated: vi.fn(),
    setSessionStateStatus: vi.fn(),
    setSessionTasks: vi.fn(),
    setSessionTodos: vi.fn(),
    setShowSkeletonAfterDelay: vi.fn(),
    setSubagentNotices: vi.fn(),
    setThinkingEnabled: vi.fn(),
    setVisibleMessageCount: vi.fn(),
    setWebSearchEnabled: vi.fn(),
    setWorkflowRuntime: vi.fn(),
    skeletonDelayTimerRef: ref(null),
    startSessionSwitchTransition: (callback) => callback(),
    streamFrameHandleRef: ref<StreamFrameHandle | null>(null),
    streamBufferRef: ref('已绘制正文'),
    streamThinkingBlocksRef: ref<StreamingThinkingBlock[]>([]),
    streamingRef: ref(true),
    streamingSegmentsRef: ref<ChatMessagePart[]>([
      { id: 'text-A', type: 'text', text: '已绘制正文' },
    ]),
    syncRecoveredStreamSnapshot: vi.fn(),
    tokenRef: ref('token'),
    webSearchAvailable: false,
    DEFAULT_VISIBLE_MESSAGE_COUNT: 20,
    INITIAL_TURN_LIMIT: 10,
  };
  const flushToRefs = vi.fn(() => {
    expect(deps.activeSessionRef.current).toBe('B');
    events.push('flush');
    deps.streamBufferRef.current = '已绘制正文与未绘制尾部';
    deps.streamingSegmentsRef.current = [
      { id: 'text-A', type: 'text', text: '已绘制正文与未绘制尾部' },
    ];
    deps.streamThinkingBlocksRef.current = [
      { key: 'reason-A', text: '未绘制思考尾部', startedAt: 101, endedAt: 102 },
    ];
  });
  const dispose = vi.fn(() => {
    events.push('dispose');
  });
  deps.streamFrameHandleRef.current = { sessionId: handleSessionId, flushToRefs, dispose };
  return { deps, events, flushToRefs, dispose };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchRecovery.mockRejectedValue(new Error('本测试不恢复目标会话'));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('runChatSessionSwitchEffect 切走时保存未绘制流式尾部', () => {
  it('即使 active 已切到 B，仍在保存 A 的快照前 flush，再重置并释放旧 handle', () => {
    const h = createHarness();
    const cleanup = runChatSessionSwitchEffect(h.deps);

    expect(h.events).toEqual(['activate', 'flush', 'save', 'reset', 'dispose']);
    expect(h.flushToRefs).toHaveBeenCalledOnce();
    expect(h.deps.sessionViewCache.save).toHaveBeenCalledWith(
      'A',
      [{ id: 'user-A', role: 'user', content: '问题 A' }],
      null,
      expect.objectContaining({
        recoveredStream: expect.objectContaining({
          messageId: 'assistant-A',
          parts: [{ id: 'text-A', type: 'text', text: '已绘制正文与未绘制尾部' }],
          text: '已绘制正文与未绘制尾部',
          thinkingBlocks: [
            { key: 'reason-A', text: '未绘制思考尾部', startedAt: 101, endedAt: 102 },
          ],
        }),
      }),
    );
    expect(h.deps.streamBufferRef.current).toBe('');
    expect(h.deps.streamFrameHandleRef.current).toBeNull();
    cleanup?.();
  });

  it('不 flush 属于其他会话的 handle，避免将其尾部写入 A 的快照', () => {
    const h = createHarness('B');
    const cleanup = runChatSessionSwitchEffect(h.deps);

    expect(h.flushToRefs).not.toHaveBeenCalled();
    expect(h.events).toEqual(['activate', 'save', 'reset', 'dispose']);
    expect(h.deps.sessionViewCache.save).toHaveBeenCalledWith(
      'A',
      h.deps.messagesRef.current,
      null,
      expect.objectContaining({
        recoveredStream: expect.objectContaining({
          text: '已绘制正文',
          parts: [{ id: 'text-A', type: 'text', text: '已绘制正文' }],
          thinkingBlocks: [],
        }),
      }),
    );
    cleanup?.();
  });

  it('同会话本地流继续运行，不 flush、不缓存、不 reset 或 dispose', () => {
    const h = createHarness();
    const cleanup = runChatSessionSwitchEffect({ ...h.deps, sessionId: 'A' });

    expect(h.deps.activateSessionView).toHaveBeenCalledWith('A', { incrementEpoch: false });
    expect(h.flushToRefs).not.toHaveBeenCalled();
    expect(h.deps.sessionViewCache.save).not.toHaveBeenCalled();
    expect(h.deps.resetStreamState).not.toHaveBeenCalled();
    expect(h.dispose).not.toHaveBeenCalled();
    expect(fetchRecovery).not.toHaveBeenCalled();
    expect(h.deps.streamingRef.current).toBe(true);
    expect(h.deps.streamFrameHandleRef.current?.sessionId).toBe('A');
    expect(cleanup).toBeUndefined();
  });
});
