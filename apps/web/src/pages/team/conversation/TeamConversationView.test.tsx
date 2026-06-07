// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamConversationView } from './TeamConversationView.js';

const state = vi.hoisted(() => ({
  messages: [
    {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '团队答复',
      createdAt: Date.now(),
      status: 'completed' as const,
    },
  ],
}));

const mocks = vi.hoisted(() => ({
  setInput: vi.fn(),
  exportMessages: vi.fn(() => '# team export'),
  downloadExport: vi.fn(),
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

vi.mock('./use-team-conversation-state.js', () => ({
  useTeamConversationState: () => ({
    activeModelId: 'gpt-4.1',
    activeProviderId: 'openai',
    bottomRef: { current: null },
    contentColumnRef: { current: null },
    input: '',
    isSessionLoading: false,
    isSessionSnapshotReady: true,
    loadProviders: vi.fn(async () => undefined),
    messages: state.messages,
    onScroll: vi.fn(),
    pendingPermissions: [],
    pendingQuestions: [],
    providers: [],
    providersError: null,
    reload: vi.fn(async () => undefined),
    remoteSessionBusyState: null,
    replyPermission: vi.fn(async () => undefined),
    replyQuestion: vi.fn(async () => undefined),
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
  TeamConversationLayout: () => <div data-testid="team-conversation-layout" />,
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
  TeamSubstateProgressBar: () => <div data-testid="team-substate-bar" />,
}));

vi.mock('./extras/TeamRunStateBanner.js', () => ({
  TeamRunStateBanner: () => <div data-testid="team-run-banner" />,
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
  state.messages = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '团队答复',
      createdAt: Date.now(),
      status: 'completed',
    },
  ];
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
});
