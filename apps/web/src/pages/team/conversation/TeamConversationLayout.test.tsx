// @vitest-environment jsdom

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  cleanup();
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
  it('opens the Fast model settings entry from team composer', () => {
    render(<TeamConversationLayout {...createLayoutProps()} />);

    fireEvent.click(screen.getByLabelText('打开模型设置与思考等级'));

    expect(screen.getByText('Fast 快速模型')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /high/i }).disabled).toBe(false);
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
});
