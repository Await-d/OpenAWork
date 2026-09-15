import { act, cleanup, renderHook } from '@testing-library/react';
import type { RunEvent } from '@openAwork/shared';
import type { PendingPermissionRequest } from '@openAwork/web-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readAssistantTracePayload,
  type ChatMessage,
  type ChatMessagePart,
} from '../messages/support.js';
import {
  useConversationStream,
  type ConversationStreamConfig,
  type ConversationStreamRefs,
  type ConversationStreamSetters,
} from './use-conversation-stream.js';
import type { StreamingThinkingBlock } from './streaming-thinking.js';
import type { ChatBackendUsageSnapshot } from './stream-usage.js';

const noop = () => undefined;

function createHarness() {
  const messages: { current: ChatMessage[] } = { current: [] };
  const segments: { current: ChatMessagePart[] } = { current: [] };

  const applySetter =
    <T,>(store: { current: T }) =>
    (value: React.SetStateAction<T>) => {
      store.current =
        typeof value === 'function' ? (value as (previous: T) => T)(store.current) : value;
    };

  const setters: ConversationStreamSetters = {
    setMessages: applySetter(messages),
    setStreaming: noop,
    setStoppingStream: noop,
    setStreamBuffer: noop,
    setStreamThinkingBuffer: noop,
    setStreamThinkingBlocks: noop as React.Dispatch<React.SetStateAction<StreamingThinkingBlock[]>>,
    setStreamingSegments: applySetter(segments),
    setReportedStreamUsage: noop as React.Dispatch<
      React.SetStateAction<ChatBackendUsageSnapshot | null>
    >,
    setStreamError: noop,
    setActiveStreamStartedAt: noop,
    setActiveStreamFirstTokenLatencyMs: noop,
    setLatestUpstreamSummary: noop,
    setSessionStateStatus: noop,
    setPendingPermissions: noop as React.Dispatch<React.SetStateAction<PendingPermissionRequest[]>>,
  };

  const refs: ConversationStreamRefs = {
    currentAssistantStreamMessageIdRef: { current: 'round-message' },
    streamingRef: { current: true },
    stoppingStreamRef: { current: false },
  };

  return { messages, refs, segments, setters };
}

function renderStream(config?: Partial<ConversationStreamConfig>) {
  const harness = createHarness();
  const rendered = renderHook(() =>
    useConversationStream(harness.refs, harness.setters, {
      sessionId: 'session-1',
      requestStartedAt: 1_000,
      ...config,
    }),
  );
  return { ...harness, ...rendered };
}

const toolCallDelta: RunEvent = {
  type: 'tool_call_delta',
  toolCallId: 'tool-1',
  toolName: 'read',
  inputDelta: '{"path":"a.ts"}',
};

const toolResult: RunEvent = {
  type: 'tool_result',
  toolCallId: 'tool-1',
  toolName: 'read',
  output: 'ok',
  isError: false,
};

afterEach(() => {
  cleanup();
});

describe('useConversationStream 轮次边界', () => {
  it('工具结果落地后到达的正文开启新一轮，不与工具挤在同一条消息', () => {
    const { messages, result } = renderStream();

    act(() => {
      result.current.handleEvent(toolCallDelta);
      result.current.handleEvent(toolResult);
    });
    expect(messages.current).toHaveLength(0);

    act(() => {
      result.current.handleEvent({ type: 'text_delta', delta: '结论' });
    });

    expect(messages.current).toHaveLength(1);
    expect(messages.current[0]?.parts?.map((part) => part.type)).toEqual(['tool']);
    expect(result.current.getAccumulatedText()).toBe('结论');
    expect(result.current.getCurrentSegments().map((part) => part.type)).toEqual(['text']);
    expect(messages.current[0]?.id).toBe('round-message');
  });

  it('工具结果落地后到达的思考同样开启新一轮', () => {
    const { messages, result } = renderStream();

    act(() => {
      result.current.handleEvent(toolCallDelta);
      result.current.handleEvent(toolResult);
      result.current.handleEvent({ type: 'thinking_delta', delta: '再想一步', itemId: 'r1' });
    });

    expect(messages.current).toHaveLength(1);
    expect(messages.current[0]?.parts?.map((part) => part.type)).toEqual(['tool']);
    expect(result.current.getCurrentSegments().map((part) => part.type)).toEqual(['reasoning']);
  });

  it('同一轮内 tool_call 与 reasoning 交错时不切轮', () => {
    const { messages, result } = renderStream();

    act(() => {
      result.current.handleEvent(toolCallDelta);
      result.current.handleEvent({ type: 'thinking_delta', delta: '先想', itemId: 'r1' });
    });

    expect(messages.current).toHaveLength(0);
    expect(result.current.getCurrentSegments().map((part) => part.type)).toEqual([
      'tool',
      'reasoning',
    ]);
  });

  it('网关回报 usage.round 后到达的正文开启新一轮（没有工具也能切）', () => {
    const { messages, result } = renderStream();

    act(() => {
      result.current.handleEvent({ type: 'text_delta', delta: '第一轮' });
      result.current.handleEvent({
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        round: 1,
      });
    });
    expect(messages.current).toHaveLength(0);

    act(() => {
      result.current.handleEvent({ type: 'text_delta', delta: '第二轮' });
    });

    expect(messages.current).toHaveLength(1);
    expect(readAssistantTracePayload(messages.current[0]!)?.text).toBe('第一轮');
    expect(result.current.getAccumulatedText()).toBe('第二轮');
  });

  it('usage 之后到达的本轮工具结果仍落在本轮消息里', () => {
    const { messages, result } = renderStream();

    act(() => {
      result.current.handleEvent({ type: 'text_delta', delta: '第一轮' });
      result.current.handleEvent(toolCallDelta);
      result.current.handleEvent({
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        round: 1,
      });
      // 工具结果在 usage 之后才到达，不能因为 usage 就把轮次关掉。
      result.current.handleEvent(toolResult);
    });
    expect(messages.current).toHaveLength(0);

    act(() => {
      result.current.handleEvent({ type: 'text_delta', delta: '第二轮' });
    });

    expect(messages.current).toHaveLength(1);
    const committedParts = messages.current[0]?.parts ?? [];
    expect(committedParts.map((part) => part.type)).toEqual(['text', 'tool']);
    expect(committedParts.find((part) => part.type === 'tool')).toMatchObject({
      toolCallId: 'tool-1',
      output: 'ok',
      status: 'completed',
    });
    expect(result.current.getAccumulatedText()).toBe('第二轮');
  });

  it('网关轮次推进后到达的裸工具调用开启新一轮', () => {
    const { messages, result } = renderStream();

    act(() => {
      result.current.handleEvent({ type: 'thinking_delta', delta: '先想', itemId: 'r1' });
      result.current.handleEvent(toolCallDelta);
      result.current.handleEvent(toolResult);
      result.current.handleEvent({
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        round: 1,
      });
    });
    expect(messages.current).toHaveLength(0);

    act(() => {
      // 第二轮以裸工具调用开头：没有任何文本 / 思考做先导。
      result.current.handleEvent({
        type: 'tool_call_delta',
        toolCallId: 'tool-2',
        toolName: 'grep',
        inputDelta: '{}',
      });
    });

    expect(messages.current).toHaveLength(1);
    expect(messages.current[0]?.parts?.map((part) => part.type)).toEqual(['reasoning', 'tool']);
    expect(
      result.current
        .getCurrentSegments()
        .filter((part) => part.type === 'tool')
        .map((part) => (part.type === 'tool' ? part.toolCallId : '')),
    ).toEqual(['tool-2']);
  });

  it('同一轮的并行工具调用（结果前到达）不会被拆成两条消息', () => {
    const { messages, result } = renderStream();

    act(() => {
      result.current.handleEvent(toolCallDelta);
      result.current.handleEvent({
        type: 'tool_call_delta',
        toolCallId: 'tool-2',
        toolName: 'grep',
        inputDelta: '{}',
      });
      result.current.handleEvent(toolResult);
    });

    expect(messages.current).toHaveLength(0);
    expect(
      result.current
        .getCurrentSegments()
        .filter((part) => part.type === 'tool')
        .map((part) => (part.type === 'tool' ? part.toolCallId : '')),
    ).toEqual(['tool-1', 'tool-2']);
  });

  it('每轮都带工具调用时两轮各自提交一条消息，后一轮不覆盖前一轮', () => {
    const { messages, result } = renderStream();

    act(() => {
      // 第一轮：正文 + 工具调用（tool-1），随后网关回报 usage.round=1。
      result.current.handleEvent({ type: 'text_delta', delta: '第一轮结论' });
      result.current.handleEvent(toolCallDelta);
      result.current.handleEvent(toolResult);
      result.current.handleEvent({
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        round: 1,
      });
    });
    expect(messages.current).toHaveLength(0);

    act(() => {
      // 第二轮以裸工具调用（tool-2）开头：轮边界在此应用，第一轮被提交。
      result.current.handleEvent({
        type: 'tool_call_delta',
        toolCallId: 'tool-2',
        toolName: 'grep',
        inputDelta: '{}',
      });
      result.current.handleEvent({
        type: 'tool_result',
        toolCallId: 'tool-2',
        toolName: 'grep',
        output: 'ok',
        isError: false,
      });
      result.current.handleEvent({
        type: 'usage',
        inputTokens: 8,
        outputTokens: 4,
        totalTokens: 12,
        round: 2,
      });
    });
    expect(messages.current).toHaveLength(1);

    act(() => {
      result.current.handleEvent({ type: 'done', stopReason: 'end_turn' });
    });

    // 两轮各自提交一条消息：第二轮的提交不能因累计的工具 ID 覆盖第一轮。
    expect(messages.current).toHaveLength(2);
    expect(messages.current[0]?.id).not.toBe(messages.current[1]?.id);
    expect(readAssistantTracePayload(messages.current[0]!)?.text).toBe('第一轮结论');
    expect(
      readAssistantTracePayload(messages.current[0]!)?.toolCalls.map((tool) => tool.toolCallId),
    ).toEqual(['tool-1']);
    expect(
      readAssistantTracePayload(messages.current[1]!)?.toolCalls.map((tool) => tool.toolCallId),
    ).toEqual(['tool-2']);
    // toolCallCount 取本轮 ID 数，而不是跨轮累计值。
    expect(messages.current[0]?.toolCallCount).toBe(1);
    expect(messages.current[1]?.toolCallCount).toBe(1);
  });
});

describe('useConversationStream 提交消息的请求 ID', () => {
  it('配置 clientRequestId 时中间轮盖派生 ID、done 提交盖原始 ID', () => {
    const { messages, result } = renderStream({ clientRequestId: 'req-1' });

    act(() => {
      result.current.handleEvent({ type: 'text_delta', delta: '第一轮' });
      result.current.handleEvent({
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        round: 1,
      });
    });

    expect(messages.current).toHaveLength(0);

    act(() => {
      // 新一轮正文到达才应用边界：提交第一轮并累计第二轮。
      result.current.handleEvent({ type: 'text_delta', delta: '第二轮' });
    });

    expect(messages.current).toHaveLength(1);
    expect(messages.current[0]?.clientRequestId).toBe('req-1:assistant:1');

    act(() => {
      result.current.handleEvent({
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        round: 2,
      });
      result.current.handleEvent({ type: 'text_delta', delta: '第三轮' });
    });

    expect(messages.current).toHaveLength(2);
    expect(messages.current[1]?.clientRequestId).toBe('req-1:assistant:2');

    act(() => {
      result.current.handleEvent({ type: 'done', stopReason: 'end_turn' });
    });

    expect(messages.current).toHaveLength(3);
    expect(messages.current[2]?.clientRequestId).toBe('req-1');
  });

  it('未配置 clientRequestId 时提交不写入该字段', () => {
    const { messages, result } = renderStream();

    act(() => {
      result.current.handleEvent({ type: 'text_delta', delta: '第一轮' });
      result.current.handleEvent({
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        round: 1,
      });
      result.current.handleEvent({ type: 'text_delta', delta: '第二轮' });
      result.current.handleEvent({
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        round: 2,
      });
      result.current.handleEvent({ type: 'text_delta', delta: '第三轮' });
      result.current.handleEvent({ type: 'done', stopReason: 'end_turn' });
    });

    expect(messages.current).toHaveLength(3);
    expect(messages.current[0]?.clientRequestId).toBeUndefined();
    expect(messages.current[1]?.clientRequestId).toBeUndefined();
    expect(messages.current[2]?.clientRequestId).toBeUndefined();
    expect('clientRequestId' in messages.current[0]!).toBe(false);
    expect('clientRequestId' in messages.current[1]!).toBe(false);
    expect('clientRequestId' in messages.current[2]!).toBe(false);
  });
});
