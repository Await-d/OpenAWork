// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
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
    ensureSession: async () => 'session-1',
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
  } as unknown as SendMessageDeps;
  return {
    deps,
    start: () => runSendMessage(deps, 'hello'),
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
