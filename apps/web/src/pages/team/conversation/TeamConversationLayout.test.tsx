// @vitest-environment jsdom

import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TeamConversationLayout,
  type TeamConversationLayoutProps,
} from './TeamConversationLayout.js';

vi.mock('@openAwork/shared-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/shared-ui')>();
  return {
    ...actual,
    describeReasoningEffort: (level: string) => level,
    getSupportedReasoningEffortsForModel: () => ['low', 'medium', 'high'],
  };
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/composer-input-history')) {
        return Response.json({ entries: [] });
      }
      if (url.endsWith('/composer-queue')) {
        return Response.json({ items: [] });
      }
      throw new Error(`未声明的测试请求：${url}`);
    }),
  );
});

afterEach(async () => {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  cleanup();
  vi.unstubAllGlobals();
});

function createLayoutProps(
  overrides: Partial<TeamConversationLayoutProps> = {},
): TeamConversationLayoutProps {
  return {
    sessionId: 'team-session-1',
    sessionSource: 'team',
    currentUserEmail: 'team@example.com',
    gatewayUrl: 'https://gateway.test',
    token: 'token-test',
    composerDisabled: false,
    messages: [],
    groupedMessageEntries: [],
    visibleMessageCount: 0,
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
    onDismissStreamError: vi.fn(),
    checkpointCount: 0,
    pendingQuestionsCount: 0,
    stopCapability: 'none',
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
    activePendingQuestion: null,
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
    retryPrompt: null,
    onCloseRetry: vi.fn(),
    onRetryCurrent: vi.fn(),
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
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        enabled: true,
        defaultModels: [
          {
            id: 'gpt-5.4',
            label: 'GPT-5.4',
            enabled: true,
            supportsThinking: true,
          },
        ],
      },
    ],
    activeProvider: { name: 'OpenAI', type: 'openai' },
    activeModelOption: { id: 'gpt-5.4', label: 'GPT-5.4', supportsThinking: true },
    activeModelCanConfigureThinking: true,
    canStopCurrentSessionStream: false,
    dialogueMode: 'coding',
    manualAgentId: '',
    yoloMode: false,
    webSearchEnabled: false,
    thinkingEnabled: false,
    reasoningEffort: 'medium',
    selectedImageEditReferenceArtifactId: null,
    input: '',
    setInput: vi.fn(),
    textareaRef: createRef<HTMLTextAreaElement>(),
    onComposerSubmit: vi.fn(),
    onStopComposer: vi.fn(),
    onComposerModelSelect: vi.fn(),
    onToggleWebSearch: vi.fn(),
    onThinkingEnabledChange: vi.fn(),
    onReasoningEffortChange: vi.fn(),
    onManualAgentChange: vi.fn(),
    onClearManualAgentId: vi.fn(),
    ...overrides,
  };
}

describe('TeamConversationLayout', () => {
  it('在 composer 上方展示当前接收目标，回接待只切换明确的会话而不提交草稿', () => {
    const onOpenSession = vi.fn();
    const props = createLayoutProps({
      input: '尚未发送的草稿',
      composerRecipient: {
        roleLayer: 'executor',
        displayName: '前端执行成员',
        sessionMetadata: { teamRoleInstance: { displayName: '元数据成员' } },
        receptionSessionId: 'my-reception',
        onOpenSession,
      },
    });
    render(<TeamConversationLayout {...props} />);

    expect(screen.getByText('发送给：前端执行成员')).toBeTruthy();
    expect(screen.queryByText('发送给：元数据成员')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '回到接待' }));
    expect(onOpenSession).toHaveBeenCalledExactlyOnceWith('my-reception');
    expect(props.onComposerSubmit).not.toHaveBeenCalled();
    expect(props.setInput).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('尚未发送的草稿');
  });

  it.each([
    ['reception', '接待别名', { teamRoleInstance: { displayName: '其他名字' } }, '接待'],
    ['executor', '  ', { teamRoleInstance: { displayName: '元数据成员' } }, '元数据成员'],
    ['executor', null, null, '执行层'],
    ['pm1', null, null, 'PM1 规划层'],
    ['pm2', null, null, 'PM2 管控层'],
    ['reviewer', null, null, '评审层'],
    ['tester', null, null, '测试层'],
    ['unknown', null, null, '未指定'],
    [null, null, null, '未指定'],
  ])('接收身份 %s 正确回落至 %s / %s / %s', (roleLayer, displayName, sessionMetadata, expected) => {
    render(
      <TeamConversationLayout
        {...createLayoutProps({ composerRecipient: { roleLayer, displayName, sessionMetadata } })}
      />,
    );

    const recipient = screen.getByText(`发送给：${expected}`);
    expect(recipient.getAttribute('title')).toBe(`发送给：${expected}`);
    expect(screen.queryByRole('button', { name: '回到接待' })).toBeNull();
    expect(
      recipient.compareDocumentPosition(screen.getByRole('textbox')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    { roleLayer: 'reception', receptionSessionId: 'my-reception', onOpenSession: vi.fn() },
    { roleLayer: 'executor', receptionSessionId: 'team-session-1', onOpenSession: vi.fn() },
    { roleLayer: 'executor', receptionSessionId: 'my-reception' },
    { roleLayer: 'executor', receptionSessionId: '  ', onOpenSession: vi.fn() },
  ])('没有可安全切换的接待目标时隐藏返回入口 %#', (recipient) => {
    render(
      <TeamConversationLayout
        {...createLayoutProps({ composerRecipient: { ...recipient, sessionMetadata: null } })}
      />,
    );
    expect(screen.queryByRole('button', { name: '回到接待' })).toBeNull();
  });

  it('只读会话不显示 composer 接收目标或返回动作', () => {
    render(
      <TeamConversationLayout
        {...createLayoutProps({
          composerDisabled: true,
          composerRecipient: {
            roleLayer: 'executor',
            displayName: '前端执行成员',
            sessionMetadata: null,
            receptionSessionId: 'my-reception',
            onOpenSession: vi.fn(),
          },
        })}
      />,
    );
    expect(screen.queryByText('发送给：前端执行成员')).toBeNull();
    expect(screen.queryByRole('button', { name: '回到接待' })).toBeNull();
  });

  it('opens the Fast model settings entry from team composer', () => {
    render(<TeamConversationLayout {...createLayoutProps()} />);

    fireEvent.click(screen.getByLabelText('打开模型设置与思考等级'));

    expect(screen.getByText('Fast 快速模型')).toBeTruthy();
    // 思考等级已改为滑块:可配置时滑条不应禁用(档位标签现为中文短名,不再是有名按钮)
    const slider = screen.getByLabelText('思考等级') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
  });

  it('renders beforeMessages above the scroll region inside the main conversation column', () => {
    render(
      <TeamConversationLayout
        {...createLayoutProps({
          beforeMessages: <div data-testid="team-before-messages">顶部信息条</div>,
        })}
      />,
    );

    const beforeMessages = screen.getByTestId('team-before-messages');
    const scrollRegion = screen.getByTestId('chat-scroll-region');

    expect(beforeMessages.parentElement).toBe(scrollRegion.parentElement);
    expect(beforeMessages.nextElementSibling).toBe(scrollRegion);
  });

  it('仅在输入框上方展示远端会话状态', () => {
    render(
      <TeamConversationLayout
        {...createLayoutProps({
          remoteSessionBusyState: 'paused',
          pendingQuestionsCount: 1,
        })}
      />,
    );

    const status = screen.getByTestId('chat-session-runtime-status');
    const composer = screen.getByRole('textbox');

    expect(
      status.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByTestId('chat-remote-stream-placeholder')).toBeNull();
  });

  it('team 不渲染审批方式档位控件（composerExtras.permissionMode = false）', () => {
    render(<TeamConversationLayout {...createLayoutProps()} />);

    expect(screen.queryByRole('button', { name: /每次询问|编辑自动|免审批/ })).toBeNull();
  });

  it('team 不渲染语音输入入口（composerExtras.voice = false）', () => {
    render(<TeamConversationLayout {...createLayoutProps()} />);

    expect(screen.queryByTitle('语音输入')).toBeNull();
  });
});
