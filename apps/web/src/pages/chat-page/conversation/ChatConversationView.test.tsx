// @vitest-environment jsdom
/**
 * ChatConversationView 装配层回归护栏（重组前置 P0 tripwire）
 *
 * 背景：ChatPage 组装层瘦身方案会重建本组件的调用点，最大风险是
 * 「props 被丢弃 / 改名」——这类回归不会让页面报错，只会静默少渲染一块 UI。
 * 因此本文件对**每一个 load-bearing prop** 都断言其可观测产物：
 *  - slot（topBar / beforeMessages / afterMessages）挂载位置
 *  - 消息组渲染（groupedMessageEntries → MessageRow → renderContent）
 *  - hiddenMessageCount → 「加载更早」按钮 + onLoadEarlier 回调
 *  - showSessionSwitchSkeleton → 骨架屏
 *  - composerDisabled / composerDisabledHint → 禁用提示替代 composer
 *  - streamError → 错误栏、remoteSessionBusyState → 运行状态条
 *  - welcomeScreen / emptyContent → 空态分支
 *
 * 不变量：不触碰 fold-policy 的 data-collapsed 语义，也不依赖虚拟列表
 * resolveGroupHeight 的内部实现（本文件消息数远低于虚拟化阈值 32）。
 *
 * 参考：pages/team/conversation/TeamConversationLayout.test.tsx 的 fixture 风格。
 */

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import { ChatConversationView, type ChatConversationViewProps } from './ChatConversationView.js';

afterEach(() => {
  cleanup();
  useDisplayPreferencesStore.setState({ messageLayout: 'unified' });
});

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    role: 'user',
    content: '默认消息内容',
    ...overrides,
  };
}

function makeGroup(message: ChatMessage) {
  return {
    kind: 'messages' as const,
    key: `group-${message.id}`,
    role: message.role,
    entries: [
      {
        message,
        renderContent: (entry: ChatMessage) => <span>{entry.content}</span>,
      },
    ],
  };
}

/**
 * 完整 props fixture。所有必填字段都给出可观测的最小实现；
 * 可选字段默认不传，由各用例按需注入（这样「可选槽位消失」也能被测出）。
 */
function createViewProps(
  overrides: Partial<ChatConversationViewProps> = {},
): ChatConversationViewProps {
  const messages: ChatMessage[] = overrides.messages ?? [];
  return {
    sessionId: 'session-1',
    sessionSource: 'chat',
    currentUserEmail: 'qa@example.com',
    gatewayUrl: 'https://gateway.test',
    token: 'token-test',

    messages,
    groupedMessageEntries: overrides.groupedMessageEntries ?? messages.map(makeGroup),
    visibleMessageCount: messages.length,
    hiddenMessageCount: 0,
    visibleStreaming: false,
    showSessionSwitchSkeleton: false,
    remoteSessionBusyState: null,
    pendingPermissions: [],
    providerCatalog: new Map([['openai', { id: 'openai', name: 'OpenAI', type: 'openai' }]]),
    activeProviderId: 'openai',
    activeModelId: 'gpt-5.4',
    onLoadEarlier: vi.fn(),

    streaming: false,
    stoppingStream: false,
    streamError: null,
    latestUpstreamSummary: null,
    onDismissStreamError: vi.fn(),
    checkpointCount: 0,
    pendingQuestionsCount: 0,
    stopCapability: 'none',
    onOpenRecovery: vi.fn(),

    scrollRegionRef: createRef<HTMLDivElement>(),
    contentColumnRef: createRef<HTMLDivElement>(),
    bottomRef: createRef<HTMLDivElement>(),
    onScroll: vi.fn(),
    showScrollToBottom: false,
    hasPendingFollowContent: false,
    onScrollToBottom: vi.fn(),
    editorMode: false,

    sessionTodos: [],
    rightOpen: false,

    inlineQuestionAnswers: [],
    inlineQuestionCustomInputs: [],
    inlineQuestionReplyStatus: null,
    inlineQuestionReplyError: null,
    onToggleInlineQuestionOption: vi.fn(),
    onChangeInlineQuestionCustomInput: vi.fn(),
    onReplyInlineQuestion: vi.fn(),

    historyEditPrompt: null,
    onCloseHistoryEdit: vi.fn(),
    onResendHistoryEdit: vi.fn(),
    onContinueHistoryEdit: vi.fn(),
    onCreateBranchFromHistoryEdit: vi.fn(),

    retryPrompt: null,
    onCloseRetry: vi.fn(),
    onRetryCurrent: vi.fn(),
    onRetryBranch: vi.fn(),

    chatSearch: {
      close: vi.fn(),
      currentIndex: 0,
      gotoMatch: vi.fn(),
      gotoNext: vi.fn(),
      gotoPrev: vi.fn(),
      isOpen: false,
      matches: [],
      open: vi.fn(),
      query: '',
      roleFilter: null,
      setQuery: vi.fn(),
      setRoleFilter: vi.fn(),
    },

    composerVariant: 'session',
    providers: [],
    canStopCurrentSessionStream: false,
    dialogueMode: 'coding',
    manualAgentId: '',
    permissionMode: 'ask',
    webSearchEnabled: false,
    thinkingEnabled: false,
    reasoningEffort: 'medium',
    selectedImageEditReferenceArtifactId: null,

    input: '',
    setInput: vi.fn(),
    textareaRef: createRef<HTMLTextAreaElement>(),
    onComposerSubmit: vi.fn(),
    onStopComposer: vi.fn(),
    onToggleWebSearch: vi.fn(),
    onThinkingEnabledChange: vi.fn(),
    onReasoningEffortChange: vi.fn(),
    onManualAgentChange: vi.fn(),
    onClearManualAgentId: vi.fn(),

    ...overrides,
  };
}

describe('ChatConversationView — 基础骨架', () => {
  it('渲染滚动区域 / 内容列，并透传 messageLayout 到 data 属性', () => {
    render(<ChatConversationView {...createViewProps()} />);

    const scrollRegion = screen.getByTestId('chat-scroll-region');
    const contentColumn = screen.getByTestId('chat-content-column');

    expect(scrollRegion.contains(contentColumn)).toBe(true);
    expect(contentColumn.getAttribute('data-message-layout')).toBe('unified');
  });

  it('display preference 切到 split 时内容列 data-message-layout 同步变化', () => {
    useDisplayPreferencesStore.setState({ messageLayout: 'split' });

    render(<ChatConversationView {...createViewProps()} />);

    expect(screen.getByTestId('chat-content-column').getAttribute('data-message-layout')).toBe(
      'split',
    );
  });

  it('topBar / beforeMessages / afterMessages 三个 slot 都挂在预期位置', () => {
    render(
      <ChatConversationView
        {...createViewProps({
          topBar: <div data-testid="slot-top-bar">顶栏</div>,
          beforeMessages: <div data-testid="slot-before-messages">消息前</div>,
          afterMessages: <div data-testid="slot-after-messages">消息后</div>,
        })}
      />,
    );

    const topBar = screen.getByTestId('slot-top-bar');
    const beforeMessages = screen.getByTestId('slot-before-messages');
    const scrollRegion = screen.getByTestId('chat-scroll-region');
    const afterMessages = screen.getByTestId('slot-after-messages');

    // beforeMessages 是「对话流列」的前一个兄弟节点（与列同级、位于列之前）。
    const streamColumn = scrollRegion.parentElement;
    expect(beforeMessages.parentElement).toBe(streamColumn?.parentElement);
    expect(beforeMessages.nextElementSibling).toBe(streamColumn);
    expect(
      topBar.compareDocumentPosition(scrollRegion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      scrollRegion.compareDocumentPosition(afterMessages) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('composer slot（composerFooterSlot / composerRightSlot）透传到 composer 区域', () => {
    render(
      <ChatConversationView
        {...createViewProps({
          composerFooterSlot: <div data-testid="slot-composer-footer">工作区</div>,
          composerRightSlot: <div data-testid="slot-composer-right">右槽</div>,
        })}
      />,
    );

    expect(screen.getByTestId('slot-composer-footer')).not.toBeNull();
    expect(screen.getByTestId('slot-composer-right')).not.toBeNull();
  });
});

describe('ChatConversationView — 消息列表与空态', () => {
  it('把 groupedMessageEntries 渲染成消息组，并透传 renderContent', () => {
    const userMessage = makeMessage({ id: 'user-1', role: 'user', content: '会话里的用户提问' });
    const assistantMessage = makeMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: '会话里的助手回答',
    });

    render(
      <ChatConversationView
        {...createViewProps({
          messages: [userMessage, assistantMessage],
          groupedMessageEntries: [makeGroup(userMessage), makeGroup(assistantMessage)],
        })}
      />,
    );

    expect(screen.getByText('会话里的用户提问')).not.toBeNull();
    expect(screen.getByText('会话里的助手回答')).not.toBeNull();
    expect(document.querySelectorAll('[data-chat-group-root="true"]')).toHaveLength(2);
    expect(document.querySelector('[data-chat-group-root="true"]')?.getAttribute('data-role')).toBe(
      'user',
    );
    // 有消息时不应误渲染欢迎页
    expect(screen.queryByText('选择模式，然后开始对话')).toBeNull();
  });

  it('hiddenMessageCount > 0 时渲染「加载更早」按钮并回调 onLoadEarlier', () => {
    const onLoadEarlier = vi.fn();
    const message = makeMessage({ content: '尾部消息' });

    render(
      <ChatConversationView
        {...createViewProps({
          messages: [message],
          groupedMessageEntries: [makeGroup(message)],
          hiddenMessageCount: 37,
          onLoadEarlier,
        })}
      />,
    );

    const button = screen.getByTestId('chat-load-earlier');
    expect(button.textContent).toContain('加载更早的 20 条消息');
    expect(button.textContent).toContain('37');

    fireEvent.click(button);
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });

  it('hiddenMessageCount = 0 时不渲染「加载更早」按钮', () => {
    const message = makeMessage({ content: '仅剩一条' });
    render(
      <ChatConversationView
        {...createViewProps({
          messages: [message],
          groupedMessageEntries: [makeGroup(message)],
          hiddenMessageCount: 0,
        })}
      />,
    );

    expect(screen.queryByTestId('chat-load-earlier')).toBeNull();
  });

  it('无消息且提供 welcomeScreen 时渲染欢迎页', () => {
    render(
      <ChatConversationView
        {...createViewProps({
          messages: [],
          welcomeScreen: {
            hasWorkspace: true,
            dialogueMode: 'coding',
            onNewSession: vi.fn(),
            onOpenWorkspace: vi.fn(),
            onSelectMode: vi.fn(),
          },
        })}
      />,
    );

    expect(screen.getByText('选择模式，然后开始对话')).not.toBeNull();
  });

  it('无消息且提供 emptyContent 时渲染空态 slot（未提供 welcomeScreen）', () => {
    render(
      <ChatConversationView
        {...createViewProps({
          messages: [],
          emptyContent: <div data-testid="custom-empty">等待团队派发任务</div>,
        })}
      />,
    );

    expect(screen.getByTestId('custom-empty')).not.toBeNull();
    expect(screen.queryByText('选择模式，然后开始对话')).toBeNull();
  });

  it('showSessionSwitchSkeleton = true 时渲染骨架屏并让位给消息列表', () => {
    const message = makeMessage({ content: '切换前的旧消息' });
    render(
      <ChatConversationView
        {...createViewProps({
          messages: [message],
          groupedMessageEntries: [makeGroup(message)],
          showSessionSwitchSkeleton: true,
        })}
      />,
    );

    expect(screen.getByTestId('chat-session-skeleton')).not.toBeNull();
    expect(screen.queryByText('切换前的旧消息')).toBeNull();
  });
});

describe('ChatConversationView — 状态条 / 错误栏 / composer 分支', () => {
  it('streamError 非空时渲染错误栏并透传 dismiss 回调', () => {
    const onDismissStreamError = vi.fn();
    render(
      <ChatConversationView
        {...createViewProps({ streamError: '流式响应中断', onDismissStreamError })}
      />,
    );

    const errorBar = screen.getByTestId('chat-stream-error-bar');
    expect(errorBar.textContent).toContain('流式响应中断');

    fireEvent.click(screen.getByTestId('chat-stream-error-dismiss'));
    expect(onDismissStreamError).toHaveBeenCalledTimes(1);
  });

  it('streamError 为空时不渲染错误栏', () => {
    render(<ChatConversationView {...createViewProps({ streamError: null })} />);
    expect(screen.queryByTestId('chat-stream-error-bar')).toBeNull();
  });

  it('remoteSessionBusyState 非空时渲染会话运行状态条', () => {
    render(<ChatConversationView {...createViewProps({ remoteSessionBusyState: 'paused' })} />);
    expect(screen.getByTestId('chat-session-runtime-status')).not.toBeNull();
  });

  it('composerDisabled + hint 时用禁用提示替代 composer', () => {
    render(
      <ChatConversationView
        {...createViewProps({
          composerDisabled: true,
          composerDisabledHint: '只读会话，暂不可发言',
        })}
      />,
    );

    expect(screen.getByText('只读会话，暂不可发言')).not.toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('composer 可用时渲染 textarea 并透传 composerPlaceholder', () => {
    render(
      <ChatConversationView
        {...createViewProps({ composerPlaceholder: '输入消息，交给 Agent 执行' })}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox');
    expect(textarea.placeholder).toBe('输入消息，交给 Agent 执行');
  });
});
