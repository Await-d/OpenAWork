// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { useChatRenderData, type ChatRenderDataInput } from './use-chat-render-data.js';

vi.mock('../../../../components/chat/session/ChatPageSections.js', () => ({
  renderChatMessageContentWithOptions: vi.fn(() => null),
  renderStreamingChatMessageContentWithOptions: vi.fn(() => null),
}));

const noop = (): undefined => undefined;
const actions = vi.fn(() => []);
const base: ChatRenderDataInput = {
  messages: [],
  pendingPermissions: [],
  modelPrices: [],
  activeProviderId: 'provider',
  activeModelId: 'model',
  activeModelOption: undefined,
  visibleStreaming: false,
  visibleStreamBuffer: '',
  visibleStreamThinkingBuffer: '',
  visibleStreamThinkingBlocks: [],
  visibleStreamStartedAt: null,
  visibleReportedStreamUsage: null,
  activeStreamClientRequestId: null,
  activeStreamFirstTokenLatencyMs: null,
  activeStreamMessageId: null,
  toolCallCards: [],
  resolveAssistantCapabilityKind: noop,
  buildMessageActions: actions,
  handleCopyMessageGroup: noop,
  openChildSessionInspector: noop,
  selectedChildSessionId: null,
  taskToolRuntimeLookup: undefined,
};
const user: ChatMessage = { id: 'u', role: 'user', content: '问题', tokenEstimate: 10 };
const assistant: ChatMessage = { id: 'a', role: 'assistant', content: '回答', tokenEstimate: 5 };
const nextUser: ChatMessage = { id: 'u2', role: 'user', content: '追问', tokenEstimate: 4 };
const nextAssistant: ChatMessage = {
  id: 'a2',
  role: 'assistant',
  content: '第二次回答',
  tokenEstimate: 6,
};

function setup(messages: ChatMessage[], overrides: Partial<ChatRenderDataInput> = {}) {
  const initial = { ...base, messages, ...overrides };
  const hook = renderHook((input: ChatRenderDataInput) => useChatRenderData(input), {
    initialProps: initial,
  });
  return { ...hook, initial };
}

describe('历史 usage 和 entry 精确复用', () => {
  it('追加消息复用已有 usage/entry/前缀组，且不调用已有 actions 工厂', () => {
    const { result, rerender, initial } = setup([user, assistant]);
    const before = result.current;
    actions.mockClear();
    rerender({ ...initial, messages: [user, assistant, nextUser, nextAssistant] });
    expect(result.current.assistantUsageDetails.get('a')).toBe(
      before.assistantUsageDetails.get('a'),
    );
    expect(result.current.historicalRenderedMessageEntries[0]).toBe(
      before.historicalRenderedMessageEntries[0],
    );
    expect(result.current.historicalRenderedMessageEntries[1]).toBe(
      before.historicalRenderedMessageEntries[1],
    );
    expect(result.current.historicalGroupedMessageEntries[0]).toBe(
      before.historicalGroupedMessageEntries[0],
    );
    expect(actions).toHaveBeenCalledTimes(2);
    expect(result.current.assistantUsageDetails.get('a2')?.inputTokens).toBe(19);
  });

  it('仅数组身份变化保留整个 usage Map 和 entries 数组', () => {
    const { result, rerender, initial } = setup([user, assistant]);
    const before = result.current;
    actions.mockClear();
    rerender({ ...initial, messages: [user, assistant] });
    expect(result.current.assistantUsageDetails).toBe(before.assistantUsageDetails);
    expect(result.current.historicalRenderedMessageEntries).toBe(
      before.historicalRenderedMessageEntries,
    );
    expect(actions).not.toHaveBeenCalled();
  });

  it('前插旧用户消息按 id 复用用户 entry，但更新依赖前文的 usage', () => {
    const { result, rerender, initial } = setup([user, assistant]);
    const before = result.current;
    const older: ChatMessage = { id: 'old', role: 'user', content: '旧消息', tokenEstimate: 7 };
    rerender({ ...initial, messages: [older, user, assistant] });
    expect(result.current.historicalRenderedMessageEntries[1]).toBe(
      before.historicalRenderedMessageEntries[0],
    );
    expect(result.current.historicalRenderedMessageEntries[2]).not.toBe(
      before.historicalRenderedMessageEntries[1],
    );
    expect(result.current.assistantUsageDetails.get('a')?.inputTokens).toBe(17);
  });

  it('前插助手消息更新 requestIndex，移除后恢复正确序号和累计量', () => {
    const { result, rerender, initial } = setup([user, assistant]);
    const older: ChatMessage = {
      id: 'old',
      role: 'assistant',
      content: '旧回答',
      tokenEstimate: 7,
    };
    rerender({ ...initial, messages: [older, user, assistant] });
    expect(result.current.assistantUsageDetails.get('a')).toMatchObject({
      requestIndex: 2,
      inputTokens: 17,
    });
    rerender(initial);
    expect(result.current.assistantUsageDetails.get('a')).toMatchObject({
      requestIndex: 1,
      inputTokens: 10,
    });
  });

  it('前文 tokenEstimate 改变只更新实际受影响的后缀', () => {
    const { result, rerender, initial } = setup([user, assistant, nextUser, nextAssistant]);
    const before = result.current;
    rerender({
      ...initial,
      messages: [user, assistant, { ...nextUser, tokenEstimate: 20 }, nextAssistant],
    });
    expect(result.current.historicalRenderedMessageEntries[1]).toBe(
      before.historicalRenderedMessageEntries[1],
    );
    expect(result.current.historicalRenderedMessageEntries[3]).not.toBe(
      before.historicalRenderedMessageEntries[3],
    );
    expect(result.current.assistantUsageDetails.get('a2')?.inputTokens).toBe(35);
  });

  it('providerUsage 覆盖累计输入时，前插用户消息仍保留已有助手 entry', () => {
    const reported: ChatMessage = {
      ...assistant,
      providerUsage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 },
    };
    const { result, rerender, initial } = setup([user, reported]);
    const before = result.current.historicalRenderedMessageEntries;
    rerender({ ...initial, messages: [{ ...user, id: 'old' }, user, reported] });
    expect(result.current.historicalRenderedMessageEntries[2]).toBe(before[1]);
  });

  it('价格切换更新费用，但不让用户 entry 失效', () => {
    const { result, rerender, initial } = setup([user, assistant], {
      modelPrices: [{ modelName: 'model', inputPer1m: 1, outputPer1m: 2 }],
    });
    const before = result.current.historicalRenderedMessageEntries;
    rerender({ ...initial, modelPrices: [{ modelName: 'model', inputPer1m: 2, outputPer1m: 4 }] });
    expect(result.current.historicalRenderedMessageEntries[0]).toBe(before[0]);
    expect(result.current.historicalRenderedMessageEntries[1]).not.toBe(before[1]);
    expect(result.current.assistantUsageDetails.get('a')?.estimatedCostUsd).toBe(0.00004);
  });

  it('选择子会话或 actions 工厂改变仍更新闭包', () => {
    const { result, rerender, initial } = setup([user, assistant]);
    const before = result.current.historicalRenderedMessageEntries;
    rerender({ ...initial, selectedChildSessionId: 'child' });
    expect(result.current.historicalRenderedMessageEntries[1]).not.toBe(before[1]);
    const selected = result.current.historicalRenderedMessageEntries;
    const replacement = vi.fn(() => []);
    rerender({ ...initial, selectedChildSessionId: 'child', buildMessageActions: replacement });
    expect(result.current.historicalRenderedMessageEntries[1]).not.toBe(selected[1]);
    expect(replacement).toHaveBeenCalledTimes(2);
  });

  it('流式 token 帧仍复用完整历史分组前缀', () => {
    const { result, rerender, initial } = setup([user, assistant, nextUser], {
      visibleStreaming: true,
      activeStreamMessageId: 'live',
      visibleStreamBuffer: '开始',
    });
    const before = result.current.groupedMessageEntries;
    rerender({ ...initial, visibleStreamBuffer: '开始输出下一段' });
    expect(result.current.groupedMessageEntries[0]).toBe(before[0]);
    expect(result.current.groupedMessageEntries[1]).toBe(before[1]);
    expect(result.current.groupedMessageEntries.at(-1)).not.toBe(before.at(-1));
  });

  it('审批回调与 messages 数组同时换新仍只失效真正依赖审批的消息', () => {
    const plain: ChatMessage = {
      ...assistant,
      parts: [{ type: 'text', id: 'text', text: '普通回答' }],
    };
    const approval: ChatMessage = {
      ...nextAssistant,
      parts: [
        {
          type: 'tool',
          id: 'tool',
          toolCallId: 'call',
          toolName: 'bash',
          input: {},
          pendingPermissionRequestId: 'perm',
        },
      ],
    };
    const { result, rerender, initial } = setup([user, plain, approval], {
      pendingPermissions: [
        {
          createdAt: new Date(0).toISOString(),
          requestId: 'perm',
          sessionId: 'session',
          toolName: 'bash',
          scope: 'ls',
          reason: '审批',
          riskLevel: 'low',
          status: 'pending',
        },
      ],
      resolveInlinePermissionActions: () => ({ items: [], pendingLabel: '旧回调' }),
    });
    const before = result.current.historicalRenderedMessageEntries;
    rerender({
      ...initial,
      messages: [user, plain, approval],
      resolveInlinePermissionActions: () => ({ items: [], pendingLabel: '新回调' }),
    });
    expect(result.current.historicalRenderedMessageEntries[0]).toBe(before[0]);
    expect(result.current.historicalRenderedMessageEntries[1]).toBe(before[1]);
    expect(result.current.historicalRenderedMessageEntries[2]).not.toBe(before[2]);
  });

  it('新增 streaming 历史消息会让原光标消息更新，即使消息引用不变', () => {
    const first: ChatMessage = { ...assistant, status: 'streaming' };
    const { result, rerender, initial } = setup([user, first]);
    const before = result.current.historicalRenderedMessageEntries;
    rerender({ ...initial, messages: [user, first, { ...nextAssistant, status: 'streaming' }] });
    expect(result.current.historicalRenderedMessageEntries[0]).toBe(before[0]);
    expect(result.current.historicalRenderedMessageEntries[1]).not.toBe(before[1]);
  });
});
