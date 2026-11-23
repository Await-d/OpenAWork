// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import {
  normalizeChatMessages,
  reconcileSnapshotChatMessages,
} from '../../../components/conversation-runtime/messages/support.js';
import { runSendMessage } from './run-send-message.js';
import type { SendMessageDeps } from './run-send-message.js';
import type { StreamFrameHandle } from '../../../components/conversation-runtime/stream/stream-frame-controller.js';

type Handlers = Parameters<SendMessageDeps['client']['stream']>[2];

function createHarness() {
  let handlers: Handlers | undefined;
  let messages: ChatMessage[] = [];
  const ref = <T>(current: T) => ({ current });
  const deps = {
    activeSessionRef: ref<string | null>('session-1'),
    streamFrameHandleRef: ref<StreamFrameHandle | null>(null),
    streamBufferRef: ref(''),
    streamThinkingBlocksRef: ref([]),
    streamingSegmentsRef: ref([]),
    appendAssistantEventMessages: vi.fn(),
    composerCommandDescriptors: [],
    currentSessionId: 'session-1',
    gatewayUrl: 'http://gateway.test',
    imageGenerationBusy: false,
    imageGenerationMode: false,
    remoteSessionBusyState: null,
    token: null,
    client: {
      getActiveStreamClientRequestId: () => 'request-1',
      stream: (_sid: string, _text: string, callbacks: Handlers) => {
        handlers = callbacks;
      },
    },
    currentAssistantStreamMessageIdRef: ref<string | null>(null),
    dialogueMode: 'coding',
    effectiveAgentId: '',
    effectiveModelId: 'model',
    effectiveProviderId: '',
    ensureSession: async () => ({ sessionId: 'session-1' }),
    isFollowingRef: ref(true),
    prefersReducedMotion: true,
    requestSessionListRefresh: vi.fn(),
    loadCurrentSessionSnapshot: vi.fn(async () => undefined),
    resolveAssistantCapabilityKind: () => 'tool',
    scrollToBottom: vi.fn(),
    sessionModesHydrated: false,
    sessionModelSelectionSourceRef: ref(null),
    setActiveStreamFirstTokenLatencyMs: vi.fn(),
    setActiveStreamRoundStartedAt: vi.fn(),
    setActiveStreamStartedAt: vi.fn(),
    setHasPendingFollowContent: vi.fn(),
    setMessages: (action: Parameters<SendMessageDeps['setMessages']>[0]) => {
      messages = typeof action === 'function' ? action(messages) : action;
      for (const message of messages) {
        message.parts?.forEach(Object.freeze);
        if (message.parts) Object.freeze(message.parts);
        Object.freeze(message);
      }
      Object.freeze(messages);
    },
    setPendingQuestions: vi.fn(),
    openBrowserPreview: vi.fn(),
    setBrowserPreviewUrl: vi.fn(),
    setEditorMode: vi.fn(),
    sessionTerminals: { applyRunEvent: vi.fn() },
    devServerDetectedTerminalIdsRef: ref(new Set<string>()),
    loadPendingQuestionForSession: vi.fn(),
    setReportedStreamUsage: vi.fn(),
    setRightPanelState: vi.fn(),
    setSessionStateStatus: vi.fn(),
    setShowScrollToBottom: vi.fn(),
    setStoppingStream: vi.fn(),
    setStreamBuffer: vi.fn(),
    setStreamError: vi.fn(),
    setStreamThinkingBlocks: vi.fn(),
    setStreamThinkingBuffer: vi.fn(),
    setStreaming: vi.fn(),
    setStreamingSegments: vi.fn(),
    stoppingStreamRef: ref(false),
    streamRevealNextAllowedAtRef: ref(0),
    streamRevealTargetCodePointsRef: ref<string[]>([]),
    streamRevealTargetRef: ref(''),
    streamRevealVisibleCodePointCountRef: ref(0),
    streamRevealVisibleRef: ref(''),
    streaming: false,
    streamingRef: ref(false),
    thinkingEnabled: true,
    webSearchEnabled: false,
    yoloMode: false,
    INITIAL_TURN_LIMIT: 10,
    resetStreamState: vi.fn(() => {
      deps.streamingRef.current = false;
    }),
  } as unknown as SendMessageDeps & {
    setBrowserPreviewUrl: ReturnType<typeof vi.fn>;
    setEditorMode: ReturnType<typeof vi.fn>;
  };
  return {
    deps,
    start: (text = 'hello') => runSendMessage(deps, text),
    messages: () => messages,
    handlers: () => {
      if (!handlers) throw new Error('stream not started');
      return handlers;
    },
    assistants: () => messages.filter((message) => message.role === 'assistant'),
  };
}

let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map();
  let next = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const reason = (delta: string, eventId: string) => ({
  type: 'thinking_delta' as const,
  delta,
  eventId,
  itemId: 'reason',
  occurredAt: 100,
});

describe('runSendMessage stream delta batching', () => {
  it('发送流检测开发服务时通过布局入口打开预览且每个终端只打开一次', async () => {
    const h = createHarness();
    await h.start();
    const event = {
      type: 'terminal_output' as const,
      terminalId: 'dev',
      outputBytesTotal: 29,
      outputTail: 'Local: http://localhost:5173/',
    };
    h.handlers().onEvent?.(event);
    h.handlers().onEvent?.(event);
    expect(h.deps.openBrowserPreview).toHaveBeenCalledExactlyOnceWith(
      'http://localhost:5173/',
      'currentTab',
    );
    expect(h.deps.setBrowserPreviewUrl).not.toHaveBeenCalled();
    expect(h.deps.setEditorMode).not.toHaveBeenCalled();
  });

  it('切换会话后迟到的开发服务输出不打开预览', async () => {
    const h = createHarness();
    await h.start();
    h.deps.activeSessionRef.current = 'session-2';
    h.handlers().onEvent?.({
      type: 'terminal_output',
      terminalId: 'dev',
      outputBytesTotal: 29,
      outputTail: 'Local: http://localhost:5173/',
    });
    expect(h.deps.openBrowserPreview).not.toHaveBeenCalled();
  });

  it.each([null, 'request-1', 'stale-request'])(
    '仅关联本次乐观用户消息，已有请求为 %s',
    async (existingRequestId) => {
      const h = createHarness();
      const otherMessages: ChatMessage[] = [
        { id: 'other-user', role: 'user', content: 'hello', clientRequestId: 'other-request' },
        { id: 'other-assistant', role: 'assistant', content: 'hello' },
      ];
      h.deps.setMessages(otherMessages);
      const stream = h.deps.client.stream;
      let optimistic: ChatMessage | undefined;
      h.deps.client.stream = (sid, text, callbacks) => {
        stream(sid, text, callbacks);
        if (existingRequestId) {
          h.deps.setMessages((previous) =>
            previous.map((message, index) =>
              index === 2 ? { ...message, clientRequestId: existingRequestId } : message,
            ),
          );
        }
        optimistic = h.messages()[2];
      };
      if (existingRequestId === null) {
        h.deps.client.getActiveStreamClientRequestId = () => null;
      }

      await h.start();
      expect(h.messages()[0]).toBe(otherMessages[0]);
      expect(h.messages()[1]).toBe(otherMessages[1]);
      expect(h.messages()[2]?.clientRequestId).toBe(
        existingRequestId === null ? undefined : 'request-1',
      );
      if (existingRequestId === 'stale-request') expect(h.messages()[2]).not.toBe(optimistic);
      else expect(h.messages()[2]).toBe(optimistic);
    },
  );

  it.each([
    [-60_000, 'hello'],
    [60_000, 'hello'],
    [-60_000, '服务端改写后的正文'],
    [60_000, '服务端改写后的正文'],
  ])('普通发送在时钟偏差 %s 和正文规范化后按请求对账：%s', async (clockOffset, serverText) => {
    const h = createHarness();
    const serverTime = Date.now() + clockOffset;
    const snapshot = normalizeChatMessages([
      {
        id: 'server-user',
        role: 'user',
        content: [{ type: 'text', text: `${serverText}  \n` }],
        createdAt: serverTime,
        clientRequestId: 'request-1',
      },
      {
        id: 'server-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        createdAt: serverTime + 1,
        clientRequestId: 'request-1',
      },
    ]);
    vi.mocked(h.deps.loadCurrentSessionSnapshot).mockImplementation(async () => {
      h.deps.setMessages((previous) => reconcileSnapshotChatMessages(previous, snapshot));
    });

    await h.start('hello  \n');
    expect.soft(h.messages()[0]?.clientRequestId).toBe('request-1');
    h.handlers().onDelta?.('reply');
    h.handlers().onDone?.('end_turn');
    await vi.advanceTimersByTimeAsync(799);
    expect(h.deps.loadCurrentSessionSnapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.deps.loadCurrentSessionSnapshot).toHaveBeenCalledWith('session-1', {
      messageLimit: 10,
    });
    expect.soft(h.messages().map((message) => message.role)).toEqual(['user', 'assistant']);
    expect
      .soft(h.messages().map((message) => message.id))
      .toEqual(['server-user', 'server-assistant']);

    const otherUser: ChatMessage = {
      id: 'other-user',
      role: 'user',
      content: serverText,
      createdAt: serverTime,
      clientRequestId: 'other-request',
    };
    h.deps.setMessages((previous) => [...previous, otherUser]);
    await h.deps.loadCurrentSessionSnapshot('session-1');
    const secondSnapshot = h.messages();
    await h.deps.loadCurrentSessionSnapshot('session-1');
    expect(h.messages()).toEqual(secondSnapshot);
    expect(h.messages()).toHaveLength(3);
    expect(h.messages().find((message) => message.id === 'other-user')).toBe(otherUser);
  });

  it.each([true, false])(
    '收尾快照已持久化最新回复=%s 时，旧历史不会挤出最近 20 条消息',
    async (hasPersistedReply) => {
      const h = createHarness();
      const now = Date.now();
      const history = normalizeChatMessages(
        Array.from({ length: 24 }, (_, index) => [
          {
            id: `user-${index}`,
            role: 'user',
            content: `问题 ${index}`,
            createdAt: now - 60_000 + index * 2,
            clientRequestId: `request-old-${index}`,
          },
          {
            id: `assistant-${index}`,
            role: 'assistant',
            content: `回答 ${index}`,
            createdAt: now - 60_000 + index * 2 + 1,
            clientRequestId: `request-old-${index}:assistant:0`,
          },
        ]).flat(),
      );
      h.deps.setMessages(history);

      await h.start('最新问题');
      h.handlers().onDelta?.('最新回答');
      h.handlers().onDone?.('end_turn');
      const [latestUser, latestAssistant] = h.messages().slice(-2);
      expect(latestUser?.content).toBe('最新问题');
      expect(latestAssistant?.parts?.at(-1)).toMatchObject({ text: '最新回答' });

      const snapshot = hasPersistedReply
        ? [...history.slice(-18), latestUser!, { ...latestAssistant!, id: 'persisted-latest' }]
        : history.slice(-20);
      vi.mocked(h.deps.loadCurrentSessionSnapshot).mockImplementation(async () => {
        h.deps.setMessages((previous) => reconcileSnapshotChatMessages(previous, snapshot));
      });
      await vi.advanceTimersByTimeAsync(800);

      expect(h.messages().slice(0, -2)).toEqual(history);
      expect(h.messages().slice(-20).at(-2)?.content).toBe('最新问题');
      expect(h.messages().slice(-20).at(-1)?.parts?.at(-1)).toMatchObject({ text: '最新回答' });
    },
  );

  it('commits wire ordering and thinking end before the pending frame runs', async () => {
    const h = createHarness();
    await h.start();
    const callbacks = h.handlers();
    callbacks.onThinkingDelta?.(reason('think', '1'));
    callbacks.onThinkingEnd?.({ type: 'thinking_end', itemId: 'reason', occurredAt: 150 });
    callbacks.onDelta?.('before');
    callbacks.onEvent?.({
      type: 'tool_call_delta',
      toolCallId: 'tool',
      toolName: 'bash',
      inputDelta: '{}',
    });
    callbacks.onDelta?.('after');
    callbacks.onDone?.('end_turn');
    expect(h.assistants()).toHaveLength(1);
    expect(h.assistants()[0]?.parts).toMatchObject([
      { type: 'reasoning', text: 'think', endedAt: 150 },
      { type: 'text', text: 'before' },
      { type: 'tool', toolCallId: 'tool' },
      { type: 'text', text: 'after' },
    ]);
    expect(frames.size).toBe(0);
  });

  it('flushes each round before resetting accumulators and persists the final tail', async () => {
    const h = createHarness();
    await h.start();
    const callbacks = h.handlers();
    callbacks.onThinkingDelta?.(reason('first thought', '1'));
    callbacks.onDelta?.('first');
    callbacks.onEvent?.({ type: 'usage', round: 1 } as Parameters<
      NonNullable<Handlers['onEvent']>
    >[0]);
    callbacks.onDelta?.('second');
    callbacks.onThinkingDelta?.(reason('second thought', '2'));
    callbacks.onDone?.('end_turn');
    expect(h.assistants()).toHaveLength(2);
    expect(h.assistants()[0]?.parts).toMatchObject([
      { type: 'reasoning', text: 'first thought' },
      { type: 'text', text: 'first' },
    ]);
    expect(h.assistants()[1]?.parts).toMatchObject([
      { type: 'text', text: 'second' },
      { type: 'reasoning', text: 'second thought' },
    ]);
    expect(frames.size).toBe(0);
  });

  it.each(['cancelled', 'error'] as const)('flushes pending thinking on %s', async (terminal) => {
    const h = createHarness();
    await h.start();
    h.handlers().onThinkingDelta?.(reason('tail thought', '1'));
    if (terminal === 'cancelled') h.handlers().onDone?.('cancelled');
    else h.handlers().onError?.('TEST_ERROR', 'failed');
    expect(h.assistants()).toHaveLength(1);
    expect(h.assistants()[0]).toMatchObject({ status: terminal });
    expect(JSON.stringify(h.assistants()[0])).toContain('tail thought');
    expect(frames.size).toBe(0);
  });

  it('releases local streaming state when the run pauses for a question', async () => {
    const h = createHarness();
    await h.start();
    const callbacks = h.handlers();
    callbacks.onDelta?.('before question');
    callbacks.onEvent?.({
      type: 'question_asked',
      requestId: 'question-1',
      toolName: 'question',
      title: '需要补充信息',
    });
    callbacks.onDone?.('end_turn');

    expect(h.deps.streamingRef.current).toBe(false);
    expect(h.deps.setStreaming).toHaveBeenLastCalledWith(false);
    expect(h.deps.setSessionStateStatus).toHaveBeenCalledWith('paused');
    expect(h.deps.setStreamBuffer).toHaveBeenCalledWith('before question');
    expect(h.deps.resetStreamState).not.toHaveBeenCalled();
  });

  it('flushes the wire tail to cache refs after active session changes without publishing state', async () => {
    const h = createHarness();
    await h.start();
    h.handlers().onThinkingDelta?.(reason('cached thought', '1'));
    h.handlers().onDelta?.('cached text');
    vi.mocked(h.deps.setStreamingSegments).mockClear();
    vi.mocked(h.deps.setStreamThinkingBlocks).mockClear();
    h.deps.activeSessionRef.current = 'session-2';
    h.deps.streamFrameHandleRef.current?.flushToRefs();
    expect(h.deps.streamBufferRef.current).toBe('cached text');
    expect(h.deps.streamThinkingBlocksRef.current[0]?.text).toBe('cached thought');
    expect(h.deps.streamingSegmentsRef.current).toMatchObject([
      { type: 'reasoning', text: 'cached thought' },
      { type: 'text', text: 'cached text' },
    ]);
    expect(h.deps.setStreamingSegments).not.toHaveBeenCalled();
    expect(h.deps.setStreamThinkingBlocks).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it.each(['done', 'error'] as const)(
    'late %s cannot clear a newer request on the same session',
    async (terminal) => {
      const h = createHarness();
      await h.start();
      const old = h.handlers();
      h.deps.streamingRef.current = false;
      await h.start();
      const current = h.deps.streamFrameHandleRef.current;
      const resets = vi.mocked(h.deps.resetStreamState).mock.calls.length;
      if (terminal === 'done') old.onDone?.('end_turn');
      else old.onError?.('LATE', 'old error');
      expect(h.deps.streamFrameHandleRef.current).toBe(current);
      expect(h.deps.resetStreamState).toHaveBeenCalledTimes(resets);
      expect(h.assistants()).toEqual([]);
    },
  );

  it('keeps the same handle across rounds and flushes only the new round', async () => {
    const h = createHarness();
    await h.start();
    const handle = h.deps.streamFrameHandleRef.current;
    h.handlers().onDelta?.('first');
    handle?.flushToRefs();
    const oldParts = h.deps.streamingSegmentsRef.current;
    h.handlers().onEvent?.({ type: 'usage', round: 1 } as Parameters<
      NonNullable<Handlers['onEvent']>
    >[0]);
    h.handlers().onDelta?.('second');
    handle?.flushToRefs();
    expect(h.deps.streamFrameHandleRef.current).toBe(handle);
    expect(h.deps.streamBufferRef.current).toBe('second');
    expect(h.deps.streamingSegmentsRef.current).toMatchObject([{ type: 'text', text: 'second' }]);
    expect(oldParts).toMatchObject([{ type: 'text', text: 'first' }]);
  });

  it('ignores queued frames and late completion after a session switch', async () => {
    const h = createHarness();
    await h.start();
    h.handlers().onThinkingDelta?.(reason('old thought', '1'));
    h.deps.activeSessionRef.current = 'session-2';
    for (const callback of frames.values()) callback(0);
    expect(h.deps.setStreamingSegments).not.toHaveBeenCalled();
    expect(h.deps.setStreamThinkingBlocks).toHaveBeenCalledTimes(1);
    h.handlers().onDone?.('end_turn');
    expect(h.assistants()).toEqual([]);
    expect(h.deps.resetStreamState).not.toHaveBeenCalled();
  });
});
