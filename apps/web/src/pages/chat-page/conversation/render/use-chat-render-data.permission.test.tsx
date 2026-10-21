// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PendingPermissionRequest } from '@openAwork/web-client';
import type {
  ChatMessage,
  ChatToolPart,
} from '../../../../components/conversation-runtime/messages/support.js';
import type { ChatRenderAction } from '../../../../components/chat/message/chat-message-group-list.js';
import { useChatRenderData, type ChatRenderDataInput } from './use-chat-render-data.js';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => true),
    render: vi.fn(async () => ({ svg: '' })),
  },
}));

const NOOP = (): void => undefined;
const NO_ACTIONS = (): ChatRenderAction[] => [];
const NO_PRICE = (): undefined => undefined;
const MODEL_PRICES: ChatRenderDataInput['modelPrices'] = [];
const NO_TOOL_CARDS: ChatRenderDataInput['toolCallCards'] = [];

function toolPart(
  id: string,
  toolCallId: string,
  pendingPermissionRequestId?: string,
): ChatToolPart {
  return {
    id,
    input: {},
    toolCallId,
    toolName: 'bash',
    type: 'tool',
    ...(pendingPermissionRequestId ? { pendingPermissionRequestId } : {}),
  };
}

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return { content: '正文', role: 'assistant', ...overrides };
}

const PENDING_PERMISSION: PendingPermissionRequest = {
  createdAt: new Date(0).toISOString(),
  requestId: 'perm-1',
  sessionId: 'session-1',
  toolName: 'bash',
  scope: 'ls',
  reason: '需要执行命令',
  riskLevel: 'low',
  status: 'pending',
};

const APPROVAL_ACTIONS: NonNullable<
  ChatRenderDataInput['resolveInlinePermissionActions']
> = () => ({
  items: [],
  pendingLabel: '',
});

const OTHER_ACTIONS: NonNullable<ChatRenderDataInput['resolveInlinePermissionActions']> = () => ({
  items: [],
  pendingLabel: '另一份实现',
});

const PLAIN_MESSAGE = message({ id: 'plain', parts: [toolPart('p-plain', 'call-plain')] });
const APPROVAL_MESSAGE = message({
  id: 'approval',
  parts: [toolPart('p-approval', 'call-approval', 'perm-1')],
});
// 数组引用必须稳定：`assistantUsageDetails` 以 `messages` 引用为缓存键，每次新建
// 数组会重算出新 Map，进而让整表 entry 失效——那样就测不到「权限回调单独变化」了。
const MESSAGES: ChatMessage[] = [PLAIN_MESSAGE, APPROVAL_MESSAGE];
const PENDING_PERMISSIONS: PendingPermissionRequest[] = [PENDING_PERMISSION];

function createInput(overrides: Partial<ChatRenderDataInput> = {}): ChatRenderDataInput {
  return {
    activeModelId: 'gpt-5',
    activeModelOption: undefined,
    activeProviderId: 'openai',
    activeStreamClientRequestId: null,
    activeStreamFirstTokenLatencyMs: null,
    activeStreamMessageId: null,
    buildMessageActions: NO_ACTIONS,
    handleCopyMessageGroup: NOOP,
    messages: MESSAGES,
    modelPrices: MODEL_PRICES,
    openChildSessionInspector: NOOP,
    pendingPermissions: PENDING_PERMISSIONS,
    resolveAssistantCapabilityKind: NO_PRICE,
    resolveInlinePermissionActions: APPROVAL_ACTIONS,
    selectedChildSessionId: null,
    streamingOrderedParts: undefined,
    taskToolRuntimeLookup: undefined,
    toolCallCards: NO_TOOL_CARDS,
    visibleReportedStreamUsage: null,
    visibleStreamBuffer: '',
    visibleStreamStartedAt: null,
    visibleStreaming: false,
    visibleStreamThinkingBlocks: [],
    visibleStreamThinkingBuffer: '',
    ...overrides,
  };
}

describe('useChatRenderData · 审批回调变化时的 entry 复用', () => {
  it('仅审批回调变化：只有带待审批工具的消息换新 entry', () => {
    const { result, rerender } = renderHook(
      ({ input }: { input: ChatRenderDataInput }) => useChatRenderData(input),
      { initialProps: { input: createInput() } },
    );

    const before = result.current.historicalRenderedMessageEntries;
    expect(before).toHaveLength(2);

    rerender({
      input: createInput({ resolveInlinePermissionActions: OTHER_ACTIONS }),
    });

    const after = result.current.historicalRenderedMessageEntries;
    expect(after).toHaveLength(2);
    // 无审批工具的普通消息继续复用旧 entry（不触发分组重渲染）。
    expect(after[0]).toBe(before[0]);
    // 带待审批工具的消息必须拿到新闭包。
    expect(after[1]).not.toBe(before[1]);
  });

  it('审批回调与其它闭包依赖同时变化：按原语义全量重建', () => {
    const { result, rerender } = renderHook(
      ({ input }: { input: ChatRenderDataInput }) => useChatRenderData(input),
      { initialProps: { input: createInput() } },
    );

    const before = result.current.historicalRenderedMessageEntries;

    rerender({
      input: createInput({
        resolveInlinePermissionActions: OTHER_ACTIONS,
        // 其它闭包依赖：不能让旧 entry 继续持有过期闭包。
        visibleStreaming: true,
      }),
    });

    const after = result.current.historicalRenderedMessageEntries;
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('依赖都未变化时整表沿用旧数组', () => {
    const stableInput = createInput();
    const { result, rerender } = renderHook(
      ({ input }: { input: ChatRenderDataInput }) => useChatRenderData(input),
      { initialProps: { input: stableInput } },
    );

    const before = result.current.historicalRenderedMessageEntries;
    rerender({ input: stableInput });

    expect(result.current.historicalRenderedMessageEntries).toBe(before);
  });
});
