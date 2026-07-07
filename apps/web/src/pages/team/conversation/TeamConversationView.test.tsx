// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamConversationView } from './TeamConversationView.js';
import { useLayerStore } from '../../../stores/team/team-events.js';
import type { RunEvent } from '@openAwork/shared';

const state = vi.hoisted(() => ({
  childSessions: [] as Array<{
    displayName?: string | null;
    id: string;
    messages: Array<{
      content: string;
      createdAt?: number | string;
      id: string;
      role: 'assistant' | 'user';
    }>;
    role_layer?: string | null;
  }>,
  messages: [
    {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '团队答复',
      createdAt: Date.now(),
      status: 'completed' as const,
    },
  ],
  pendingPermissions: [] as unknown[],
  pendingQuestions: [] as unknown[],
  runEvents: [] as RunEvent[],
}));

const mocks = vi.hoisted(() => ({
  diagnostics: undefined as
    | {
        activeAlerts?: Array<{ message: string }>;
        incidents?: Array<{ message: string }>;
      }
    | undefined,
  setInput: vi.fn(),
  exportMessages: vi.fn(() => '# team export'),
  downloadExport: vi.fn(),
  latestLayoutProps: null as Record<string, unknown> | null,
  replyPermission: vi.fn(async () => undefined),
  replyQuestion: vi.fn(async () => undefined),
}));

vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: (
    selector?: (state: { accessToken: string; gatewayUrl: string; email: string }) => unknown,
  ) => {
    const authState = {
      accessToken: 'token-test',
      gatewayUrl: 'https://gateway.test',
      email: 'team@example.com',
    };
    return typeof selector === 'function' ? selector(authState) : authState;
  },
}));

vi.mock('@openAwork/shared-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/shared-ui')>();
  return {
    ...actual,
    canConfigureThinkingForModel: () => true,
    categorizeAlwaysPatterns: () => [
      {
        category: 'full',
        label: '仅本次指令',
        description: '只覆盖当前命令',
        pattern: 'bash pwd',
      },
    ],
  };
});

vi.mock('./use-team-conversation-state.js', () => ({
  useTeamConversationState: () => ({
    activeModelId: 'gpt-4.1',
    activeProviderId: 'openai',
    bottomRef: { current: null },
    contentColumnRef: { current: null },
    input: '',
    isSessionLoading: false,
    isSessionSnapshotReady: true,
    childSessions: state.childSessions,
    loadProviders: vi.fn(async () => undefined),
    messages: state.messages,
    onScroll: vi.fn(),
    pendingPermissions: state.pendingPermissions,
    pendingQuestions: state.pendingQuestions,
    runEvents: state.runEvents,
    providers: [],
    providersError: null,
    reload: vi.fn(async () => undefined),
    remoteSessionBusyState: null,
    replyPermission: mocks.replyPermission,
    replyQuestion: mocks.replyQuestion,
    reportedStreamUsage: null,
    roleLayer: 'reception',
    scrollRegionRef: { current: null },
    scrollToBottom: vi.fn(),
    sessionMetadata: null,
    sessionStateStatus: 'idle',
    sessionTodos: [],
    setActiveModelId: vi.fn(),
    setActiveProviderId: vi.fn(),
    setInput: mocks.setInput,
    setMessages: vi.fn(),
    setPendingPermissions: vi.fn(),
    setPendingQuestions: vi.fn(),
    setProviders: vi.fn(),
    setProvidersError: vi.fn(),
    setSnapshotError: vi.fn(),
    setStreamError: vi.fn(),
    showScrollToBottom: false,
    snapshotError: null,
    startStream: vi.fn(async () => undefined),
    stopStream: vi.fn(async () => true),
    stoppingStream: false,
    streamBuffer: '',
    streamError: null,
    streamThinkingBlocks: [],
    streamThinkingBuffer: '',
    streaming: false,
    streamingSegments: [],
    substate: null,
    submitInbound: vi.fn(async () => ({ accepted: true, inboundMessageId: 'inbound-1' })),
    textareaRef: { current: null },
    visibleStreaming: false,
    hasPendingFollowContent: false,
  }),
}));

vi.mock('../../../hooks/chat/useChatKeyboardShortcuts.js', () => ({
  useChatKeyboardShortcuts: () => undefined,
}));

vi.mock('../../../hooks/chat/useComposerWorkspaceCatalog.js', () => ({
  useComposerWorkspaceCatalog: () => ({
    agents: [],
    agentTools: [],
    installedSkills: [],
    mcpServers: [],
  }),
}));

vi.mock('../../../components/chat/search/chat-search-overlay.js', () => ({
  useChatSearch: () => ({
    close: vi.fn(),
    isOpen: false,
    open: vi.fn(),
  }),
}));

vi.mock('../../../components/chat/message/message-multi-select.js', () => ({
  useMessageMultiSelect: () => ({
    disableMultiSelect: vi.fn(),
    enableMultiSelect: vi.fn(),
    multiSelect: { enabled: false, selectedIds: new Set<string>() },
    selectAll: vi.fn(),
  }),
}));

vi.mock('../../../components/chat/message/message-export.js', () => ({
  copyExportToClipboard: vi.fn(async () => true),
  downloadExport: mocks.downloadExport,
  exportMessages: mocks.exportMessages,
}));

vi.mock('./TeamConversationLayout.js', () => ({
  TeamConversationLayout: ({
    beforeMessages,
    topBar,
    ...rest
  }: {
    beforeMessages?: ReactNode;
    topBar?: ReactNode;
    [key: string]: unknown;
  }) => {
    mocks.latestLayoutProps = rest;
    return (
      <div data-testid="team-conversation-layout">
        <div data-testid="team-conversation-topbar">{topBar}</div>
        <div data-testid="team-conversation-before-messages">{beforeMessages}</div>
        {rest['activePendingQuestion'] ? (
          <button
            type="button"
            onClick={() => {
              void (rest['onReplyInlineQuestion'] as (status: 'answered') => Promise<void>)(
                'answered',
              );
            }}
          >
            提交行内提问
          </button>
        ) : null}
      </div>
    );
  },
}));

vi.mock('./build-team-grouped-message-entries.js', () => ({
  buildTeamGroupedMessageEntries: () => [],
}));

vi.mock('../../../components/chat/misc/prompt-template-panel.js', () => ({
  PromptTemplatePanel: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="prompt-template-panel">{isOpen ? 'open' : 'closed'}</div>
  ),
}));

vi.mock('./extras/TeamSubstateProgressBar.js', () => ({
  TeamSubstateProgressBar: ({ rightSlot }: { rightSlot?: ReactNode }) => (
    <div data-testid="team-substate-bar">{rightSlot}</div>
  ),
}));

vi.mock('./extras/TeamRunStateBanner.js', () => ({
  TeamRunStateBanner: ({
    diagnostics,
    rightSlot,
  }: {
    diagnostics?: {
      activeAlerts?: Array<{ message: string }>;
      incidents?: Array<{ message: string }>;
    };
    rightSlot?: ReactNode;
  }) => (
    <div
      data-active-alert={diagnostics?.activeAlerts?.[0]?.message ?? ''}
      data-incident={diagnostics?.incidents?.[0]?.message ?? ''}
      data-testid="team-run-banner"
    >
      {rightSlot}
    </div>
  ),
}));

vi.mock('../runtime/data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    diagnostics: mocks.diagnostics,
  }),
}));

vi.mock('./extras/TeamSessionEmptyState.js', () => ({
  TeamSessionEmptyState: () => null,
}));

vi.mock('./extras/TeamSessionHeader.js', () => ({
  TeamSessionHeader: () => null,
}));

vi.mock('./extras/TeamUserJumpRail.js', () => ({
  TeamUserJumpRail: () => null,
}));

vi.mock('./extras/TeamRoleTypingIndicator.js', () => ({
  TeamRoleTypingIndicator: () => null,
}));

vi.mock('./extras/TeamInitModal.js', () => ({
  TeamInitModal: () => null,
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.setInput.mockReset();
  mocks.replyPermission.mockReset();
  mocks.replyQuestion.mockReset();
  mocks.latestLayoutProps = null;
  state.messages = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '团队答复',
      createdAt: Date.now(),
      status: 'completed',
    },
  ];
  state.childSessions = [];
  state.pendingPermissions = [];
  state.pendingQuestions = [];
  state.runEvents = [];
  useLayerStore.getState().clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  mocks.diagnostics = undefined;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TeamConversationView', () => {
  it('响应 openAwork:open-templates 事件并打开模板面板', async () => {
    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    expect(screen.getByTestId('prompt-template-panel').textContent).toBe('closed');

    window.dispatchEvent(new CustomEvent('openAwork:open-templates'));

    await waitFor(() => {
      expect(screen.getByTestId('prompt-template-panel').textContent).toBe('open');
    });
  });

  it('响应 openAwork:export-chat 事件并导出当前 team 对话', async () => {
    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    window.dispatchEvent(new CustomEvent('openAwork:export-chat'));

    await waitFor(() => {
      expect(mocks.exportMessages).toHaveBeenCalledWith(state.messages, 'markdown');
      expect(mocks.downloadExport).toHaveBeenCalledWith(
        '# team export',
        expect.stringMatching(/^team-chat-export-\d+\.md$/),
        'text/markdown',
      );
    });
  });

  it('响应 openawork:composer:insert 事件并把内容注入 team composer', async () => {
    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    window.dispatchEvent(
      new CustomEvent('openawork:composer:insert', {
        detail: { text: '[参考页](https://example.com)', mode: 'append' },
      }),
    );

    await waitFor(() => {
      expect(mocks.setInput).toHaveBeenCalledTimes(1);
    });

    const updater = mocks.setInput.mock.calls[0]?.[0];
    expect(typeof updater).toBe('function');
    expect(updater('已有内容')).toBe('已有内容\n[参考页](https://example.com)');
    expect(updater('')).toBe('[参考页](https://example.com)');
  });

  it('桌面宽度存在子层消息时自动展开团队层级消息汇总', async () => {
    state.childSessions = [
      {
        id: 'child-pm1',
        role_layer: 'pm1',
        messages: [{ id: 'pm1-msg', role: 'assistant', content: 'PM1 详情' }],
      },
    ];

    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    const panel = await screen.findByLabelText('团队层级消息汇总');
    await waitFor(() => {
      expect(panel.getAttribute('style')).toContain('display: flex');
    });
  });

  it('顶部视图切换器使用可读文案暴露分层入口', () => {
    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    expect(screen.getByRole('button', { name: '单栏视图' }).textContent).toContain('主对话');
    expect(screen.getByRole('button', { name: '分层并排视图' }).textContent).toContain('分层并排');
  });

  it('分层并排模式支持切回旧版分层面板', async () => {
    state.childSessions = [
      {
        id: 'child-pm1',
        role_layer: 'pm1',
        messages: [{ id: 'pm1-msg', role: 'assistant', content: 'PM1 详情' }],
      },
    ];

    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    const oldLayerButton = await screen.findByRole('button', {
      name: '切换到旧版分层标签视图',
    });
    fireEvent.click(oldLayerButton);

    expect(await screen.findByText('团队分层流程')).toBeTruthy();
  });

  it('群聊汇总流用父级角色实例名标注子层 user 消息', async () => {
    useLayerStore.getState().addNode({
      sessionId: 'session-1',
      parentSessionId: null,
      roleLayer: 'pm2',
      state: 'running',
      displayName: '产品经理二号',
    });
    useLayerStore.getState().addNode({
      sessionId: 'child-executor',
      parentSessionId: 'session-1',
      roleLayer: 'executor',
      state: 'running',
      displayName: '前端开发者',
    });
    state.childSessions = [
      {
        id: 'child-executor',
        role_layer: 'executor',
        displayName: '前端开发者',
        messages: [
          {
            id: 'handoff-user',
            role: 'user',
            content: '请实现前端会话列表。',
            createdAt: Date.parse('2026-07-04T10:00:00.000Z'),
          },
          {
            id: 'executor-reply',
            role: 'assistant',
            content: '前端开发者开始处理。',
            createdAt: Date.parse('2026-07-04T10:01:00.000Z'),
          },
        ],
      },
    ];

    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    await screen.findByText('请实现前端会话列表。');
    expect(screen.getAllByText('产品经理二号').length).toBeGreaterThan(0);
    expect(screen.getAllByText('前端开发者').length).toBeGreaterThan(0);
    expect(screen.queryByText('team@example.com')).toBeNull();
  });

  it('存在 runEvents 时会展示过程时间线预览', () => {
    state.runEvents = [
      { type: 'text_delta', delta: '正在分析当前任务上下文' },
      {
        type: 'tool_call_delta',
        toolCallId: 'tool-1',
        toolName: 'read',
        inputDelta: '{"filePath":"README.md"}',
      },
    ];

    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    expect(screen.getByText('过程时间线')).toBeTruthy();
    expect(screen.getByText('文本生成')).toBeTruthy();
    expect(screen.getByText('工具调用 · read')).toBeTruthy();
  });

  it('focusedLayer 会让团队层级消息汇总直接展示指定层消息', async () => {
    state.childSessions = [
      {
        id: 'child-pm1',
        role_layer: 'pm1',
        messages: [{ id: 'pm1-msg', role: 'assistant', content: 'PM1 详情' }],
      },
      {
        id: 'child-executor',
        role_layer: 'executor',
        messages: [{ id: 'executor-msg', role: 'assistant', content: '执行详情' }],
      },
    ];

    render(<TeamConversationView focusedLayer="pm1" sessionId="session-1" composerEnabled />);

    await waitFor(() => {
      expect(screen.getByText('PM1 详情')).toBeTruthy();
    });
  });

  it('其它层级详情默认展示完整消息而不是截断摘要', async () => {
    const longMessage =
      'PM1 长消息：这是一个超过一百个字符的历史规划内容，用来确认侧栏详情不会只显示摘要。它应该保留后半段关键信息：需要先补齐历史会话树，再检查窄屏和筛选交互。';
    state.childSessions = [
      {
        id: 'child-pm1-long',
        role_layer: 'pm1',
        messages: [{ id: 'pm1-long-msg', role: 'assistant', content: longMessage }],
      },
    ];

    render(<TeamConversationView focusedLayer="pm1" sessionId="session-1" composerEnabled />);

    await waitFor(() => {
      expect(screen.getByText(longMessage)).toBeTruthy();
    });
  });

  it('tester 子层消息不会被多层详情过滤掉', async () => {
    state.childSessions = [
      {
        id: 'child-tester',
        role_layer: 'tester',
        messages: [{ id: 'tester-msg', role: 'assistant', content: '测试详情' }],
      },
    ];

    render(<TeamConversationView focusedLayer="tester" sessionId="session-1" composerEnabled />);

    await waitFor(() => {
      expect(screen.getByText('测试详情')).toBeTruthy();
    });
  });

  it('窄屏下 focusedLayer 不会强制展开双栏挤压布局', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    state.childSessions = [
      {
        id: 'child-pm1',
        role_layer: 'pm1',
        messages: [{ id: 'pm1-msg', role: 'assistant', content: 'PM1 详情' }],
      },
    ];

    render(<TeamConversationView focusedLayer="pm1" sessionId="session-1" composerEnabled />);

    const panel = await screen.findByLabelText('团队层级消息汇总');
    await waitFor(() => {
      expect(panel.getAttribute('style')).toContain('display: none');
    });
  });

  it('会把审批动作解析器传给布局层', () => {
    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    expect(mocks.latestLayoutProps?.['resolveInlinePermissionActions']).toEqual(
      expect.any(Function),
    );
  });

  it('有待处理权限或提问时，顶部会显示待处理入口', async () => {
    state.pendingPermissions = [
      {
        requestId: 'perm-1',
        sessionId: 'session-1',
        toolName: 'bash',
        scope: 'bash pwd',
        reason: '读取目录',
        riskLevel: 'low',
        status: 'pending',
        createdAt: '2026-06-15T00:00:00.000Z',
      },
    ];
    state.pendingQuestions = [
      {
        requestId: 'question-1',
        sessionId: 'session-1',
        title: '需要你确认',
        toolName: 'AskQuestion',
        status: 'pending',
        questions: [],
        createdAt: '2026-06-15T00:00:00.000Z',
      },
    ];

    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '查看待处理交互' })).toBeTruthy();
    });
  });

  it('顶部待处理入口只统计真正 pending 的项', async () => {
    state.pendingPermissions = [
      {
        requestId: 'perm-pending',
        sessionId: 'session-1',
        toolName: 'bash',
        scope: 'bash pwd',
        reason: '读取目录',
        riskLevel: 'low',
        status: 'pending',
        createdAt: '2026-06-15T00:00:00.000Z',
      },
      {
        requestId: 'perm-approved',
        sessionId: 'session-1',
        toolName: 'bash',
        scope: 'bash ls',
        reason: '列目录',
        riskLevel: 'low',
        status: 'approved',
        decision: 'once',
        createdAt: '2026-06-15T00:00:00.000Z',
      },
    ];
    state.pendingQuestions = [
      {
        requestId: 'question-pending',
        sessionId: 'session-1',
        title: '需要你确认',
        toolName: 'AskQuestion',
        status: 'pending',
        questions: [],
        createdAt: '2026-06-15T00:00:00.000Z',
      },
      {
        requestId: 'question-answered',
        sessionId: 'session-1',
        title: '已答复问题',
        toolName: 'AskQuestion',
        status: 'answered',
        questions: [],
        createdAt: '2026-06-15T00:00:00.000Z',
      },
    ];

    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    await waitFor(() => {
      expect(screen.getByText('审批 1 · 提问 1')).toBeTruthy();
    });
  });

  it('接待层横幅会收到运行时 diagnostics 摘要数据', () => {
    mocks.diagnostics = {
      activeAlerts: [{ message: '存在 stale runtime thread' }],
      incidents: [{ message: 'team-events reconnecting' }],
    };

    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    const banner = screen.getByTestId('team-run-banner');
    expect(banner.getAttribute('data-active-alert')).toBe('存在 stale runtime thread');
    expect(banner.getAttribute('data-incident')).toBe('team-events reconnecting');
  });

  it('点击待处理入口时会优先定位到对应的权限审批区域', async () => {
    state.pendingPermissions = [
      {
        requestId: 'perm-focus',
        sessionId: 'session-1',
        toolName: 'bash',
        scope: 'bash pwd',
        reason: '读取目录',
        riskLevel: 'low',
        status: 'pending',
        createdAt: '2026-06-15T00:00:00.000Z',
      },
    ];

    const target = document.createElement('div');
    target.setAttribute('data-permission-request-id', 'perm-focus');
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    document.body.appendChild(target);

    render(<TeamConversationView sessionId="session-1" composerEnabled />);

    fireEvent.click(await screen.findByRole('button', { name: '查看待处理交互' }));

    expect(scrollIntoView).toHaveBeenCalled();

    target.remove();
  });

  it('行内回复子会话提问时会传递问题所属会话 ID', async () => {
    state.pendingQuestions = [
      {
        requestId: 'question-child',
        sessionId: 'child-session-1',
        title: '需要你确认',
        toolName: 'AskQuestion',
        status: 'pending',
        questions: [],
        createdAt: '2026-06-15T00:00:00.000Z',
      },
    ];

    render(<TeamConversationView sessionId="session-root" composerEnabled />);

    fireEvent.click(await screen.findByRole('button', { name: '提交行内提问' }));

    await waitFor(() => {
      expect(mocks.replyQuestion).toHaveBeenCalledWith('question-child', 'answered', [], {
        targetSessionId: 'child-session-1',
      });
    });
  });
});
