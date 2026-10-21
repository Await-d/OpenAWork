import { act, cleanup, renderHook } from '@testing-library/react';
import type { RunEvent } from '@openAwork/shared';
import type { PendingPermissionRequest } from '@openAwork/web-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readAssistantTracePayload,
  type ChatMessage,
  type ChatMessagePart,
  type ChatToolPart,
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

function createHarness(setterOverrides?: Partial<ConversationStreamSetters>) {
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
    ...setterOverrides,
  };

  const refs: ConversationStreamRefs = {
    currentAssistantStreamMessageIdRef: { current: 'round-message' },
    streamingRef: { current: true },
    stoppingStreamRef: { current: false },
    streamClientRequestIdRef: { current: null },
    requestProviderIdRef: { current: undefined },
    requestModelLabelRef: { current: undefined },
    requestAgentIdRef: { current: undefined },
  };

  return { messages, refs, segments, setters };
}

function renderStream(
  config?: Partial<ConversationStreamConfig>,
  setterOverrides?: Partial<ConversationStreamSetters>,
) {
  const harness = createHarness(setterOverrides);
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

/**
 * 事件幂等。
 *
 * 回归背景：`handleEvent` 的契约注释声明「同一 eventId 幂等」，但实现里对
 * `text_delta` 无条件累加、对 `tool_call_delta` 无条件拼接入参。断线重连 / attach
 * 重放已展示过的 chunk 时，正文会成倍重复、工具入参会被拼坏。
 */
describe('useConversationStream 事件幂等', () => {
  it('同一 eventId 的 text_delta 重放只投递一次', () => {
    const { result } = renderStream();
    const event: RunEvent = { type: 'text_delta', delta: '同一段', eventId: 'run-1:evt:1' };

    act(() => {
      result.current.handleEvent(event);
      result.current.handleEvent(event);
      result.current.handleEvent(event);
    });

    expect(result.current.getAccumulatedText()).toBe('同一段');
  });

  it('不同 eventId 的 text_delta 正常累加', () => {
    const { result } = renderStream();

    act(() => {
      result.current.handleEvent({ type: 'text_delta', delta: '甲', eventId: 'run-1:evt:1' });
      result.current.handleEvent({ type: 'text_delta', delta: '乙', eventId: 'run-1:evt:2' });
    });

    expect(result.current.getAccumulatedText()).toBe('甲乙');
  });

  it('缺 eventId 的 text_delta 照常投递（正文允许合法重复，不能按内容去重）', () => {
    const { result } = renderStream();

    act(() => {
      result.current.handleEvent({ type: 'text_delta', delta: '重复' });
      result.current.handleEvent({ type: 'text_delta', delta: '重复' });
    });

    expect(result.current.getAccumulatedText()).toBe('重复重复');
  });

  it('tool_progress 会实时写入当前工具段的 _batchProgress（长命令不再只有“运行中”）', () => {
    const { result, segments } = renderStream();

    act(() => {
      result.current.handleEvent({
        type: 'tool_call_delta',
        toolCallId: 'tool-1',
        toolName: 'bash',
        inputDelta: '{"command":"bun test"}',
      });
      result.current.handleEvent({
        type: 'tool_progress',
        toolCallId: 'tool-1',
        toolName: 'bash',
        subTools: [{ index: 0, tool: 'bash', status: 'running', partialOutput: 'PASS 1 test' }],
        completedCount: 0,
        totalCount: 1,
      });
    });

    const tool = segments.current.find((part): part is ChatToolPart => part.type === 'tool');
    expect(tool?.input['command']).toBe('bun test');
    expect(tool?.input['_batchProgress']).toEqual({
      subTools: [{ index: 0, tool: 'bash', status: 'running', partialOutput: 'PASS 1 test' }],
      completedCount: 0,
      totalCount: 1,
    });
  });

  it('同一 eventId 的 tool_call_delta 重放不重复拼接入参', () => {
    const { result } = renderStream();
    const event: RunEvent = {
      type: 'tool_call_delta',
      toolCallId: 'tool-1',
      toolName: 'read',
      inputDelta: '{"path":"a.ts"}',
      eventId: 'run-1:evt:9',
    };

    act(() => {
      result.current.handleEvent(event);
      result.current.handleEvent(event);
    });

    const toolParts = result.current.getCurrentSegments().filter((part) => part.type === 'tool');
    expect(toolParts).toHaveLength(1);
    expect(toolParts[0]?.type === 'tool' ? toolParts[0].input : undefined).toEqual({
      path: 'a.ts',
    });
  });

  it('resetRoundAccumulators 后同一 eventId 可再次投递（新一轮不误判为重放）', () => {
    const { result } = renderStream();
    const event: RunEvent = { type: 'text_delta', delta: '新一轮', eventId: 'run-1:evt:1' };

    act(() => {
      result.current.handleEvent(event);
    });
    expect(result.current.getAccumulatedText()).toBe('新一轮');

    act(() => {
      result.current.resetRoundAccumulators();
    });
    expect(result.current.getAccumulatedText()).toBe('');

    act(() => {
      result.current.handleEvent(event);
    });
    expect(result.current.getAccumulatedText()).toBe('新一轮');
  });
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
    const { messages, refs, result } = renderStream();
    // 消费点在事件回调里惰性读 ref，故在发事件前赋值即可。
    refs.streamClientRequestIdRef.current = 'req-1';

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

/**
 * 错误码分级。
 *
 * 回归背景：`TOOL_ERROR` 只是「单次工具调用被上游放弃」，流仍在继续；把它当
 * 流式失败处理会在正文气泡与顶部横幅同时渲染一条错误，而用户实际什么都没坏。
 * 名单与传输层（useGatewayClient）、右侧面板状态（chat-stream-state）共用。
 */
describe('useConversationStream 错误码分级', () => {
  it('流内非终态错误（TOOL_ERROR）不写入 streamError', () => {
    const setStreamError = vi.fn();
    const { result } = renderStream(undefined, { setStreamError });

    act(() => {
      result.current.handleEvent({
        type: 'error',
        code: 'TOOL_ERROR',
        message: 'Tool bash 的入参不是合法 JSON，已放弃本次调用',
      });
    });

    expect(setStreamError).not.toHaveBeenCalled();
  });

  it('终态错误照常写入 streamError', () => {
    const setStreamError = vi.fn();
    const { result } = renderStream(undefined, { setStreamError });

    act(() => {
      result.current.handleEvent({
        type: 'error',
        code: 'MODEL_ERROR',
        message: '上游 500',
      });
    });

    expect(setStreamError).toHaveBeenCalledTimes(1);
  });
});
