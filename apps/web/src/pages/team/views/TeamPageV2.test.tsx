// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  breakpoint: 'desktop' as 'desktop' | 'tablet' | 'mobile',
  data: null as unknown as Record<string, unknown>,
  handoffs: new Map<string, Record<string, unknown>>(),
  nodes: new Map<string, Record<string, unknown>>(),
  mode: 'running' as 'idle' | 'running' | 'paused',
  snapshotState: null as unknown as Record<string, unknown>,
  workspaceState: null as unknown as Record<string, unknown>,
}));

const mocks = vi.hoisted(() => ({
  cancelHandoff: vi.fn(
    async (): Promise<{ ok: boolean; errorMessage?: string; state?: string }> => ({ ok: true }),
  ),
  connectTeamEvents: vi.fn(),
  createSession: vi.fn(async () => null),
  deleteSession: vi.fn(async () => true),
  deleteWorkspace: vi.fn(async () => true),
  disconnectTeamEvents: vi.fn(),
  navigate: vi.fn(),
  pauseAllRuntimeSessions: vi.fn(
    async (): Promise<Record<string, unknown>> => ({
      pausedCount: 1,
    }),
  ),
  refreshWorkspaceSnapshot: vi.fn(),
  refreshWorkspaces: vi.fn(),
  renameWorkspace: vi.fn(async () => true),
  resumeAllRuntimeSessions: vi.fn(
    async (): Promise<Record<string, unknown>> => ({
      resumedCount: 1,
    }),
  ),
  selectTeam: vi.fn(),
  sendMessage: vi.fn(async () => true),
}));
const toastMock = vi.hoisted(() => vi.fn());
const modalState = vi.hoisted(() => ({
  onCreated: undefined as ((newWorkspaceId?: string) => void) | undefined,
}));
const routeState = vi.hoisted(() => ({
  teamWorkspaceId: 'workspace-1' as string | undefined,
  searchParams: new URLSearchParams(),
}));
const authState = vi.hoisted(() => ({
  accessToken: 'token-test' as string | null,
  gatewayUrl: 'https://gateway.test',
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ teamWorkspaceId: routeState.teamWorkspaceId }),
  useSearchParams: () => [
    routeState.searchParams,
    (next: URLSearchParams, _options?: { replace?: boolean }) => {
      routeState.searchParams = new URLSearchParams(next);
    },
  ],
}));

vi.mock('@openAwork/web-client', () => ({
  createTeamClient: () => ({
    pauseAllRuntimeSessions: mocks.pauseAllRuntimeSessions,
    resumeAllRuntimeSessions: mocks.resumeAllRuntimeSessions,
  }),
  createTeamHandoffsClient: () => ({
    cancelHandoff: mocks.cancelHandoff,
  }),
}));

vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: (
    selector?: (state: { accessToken: string | null; gatewayUrl: string }) => unknown,
  ) => {
    return typeof selector === 'function' ? selector(authState) : authState;
  },
}));

vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: toastMock,
}));

vi.mock('../runtime/data/team-runtime-reference-data.js', () => ({
  TeamRuntimeReferenceDataProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useResolvedTeamRuntimeReferenceData: () => testState.data,
}));

vi.mock('../hooks/use-team-workspace-state.js', () => ({
  useTeamWorkspaceState: () => testState.workspaceState,
}));

vi.mock('../hooks/use-team-workspace-snapshot-state.js', () => ({
  useTeamWorkspaceSnapshotState: () => testState.snapshotState,
}));

vi.mock('../runtime/shell/sidebar/use-team-session-list-runtime-state.js', () => ({
  useTeamSessionListRuntimeState: (workspaceGroups: unknown[]) => ({
    effectiveWorkspaceGroups: workspaceGroups,
  }),
}));

vi.mock('../runtime/shell/controls/ConversationArea.js', () => ({
  ConversationArea: ({
    topBar,
    messagesOverride,
    fallbackContent,
    onNewSession,
    onSubmitMessage,
    onSelectSuggestion,
  }: {
    topBar?: React.ReactNode;
    messagesOverride?: React.ReactNode;
    fallbackContent?: React.ReactNode;
    onNewSession?: (() => void) | undefined;
    onSubmitMessage?: ((text: string) => void | Promise<void>) | undefined;
    onSelectSuggestion?: ((text: string) => void | Promise<void>) | undefined;
  }) => (
    <div>
      <div>{topBar}</div>
      <div
        data-testid="conversation-area-flags"
        data-submit-enabled={String(Boolean(onSubmitMessage))}
        data-suggestion-enabled={String(Boolean(onSelectSuggestion))}
      />
      <div>{messagesOverride ?? fallbackContent}</div>
      {onNewSession ? (
        <button type="button" data-testid="conversation-open-new-session" onClick={onNewSession}>
          新建会话入口
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('../../../stores/team/use-multi-session-attach.js', () => ({
  useMultiSessionAttach: () => undefined,
}));

vi.mock('../runtime/shell/header/TeamStatusBar.js', () => ({
  TeamStatusBar: ({
    onPauseAll,
    onResumeAll,
    paused,
  }: {
    onPauseAll?: () => void;
    onResumeAll?: () => void;
    paused?: boolean;
  }) => (
    <div>
      <span data-testid="team-status-bar-mode">{paused ? 'paused' : 'running'}</span>
      {onPauseAll && !paused ? (
        <button type="button" onClick={onPauseAll}>
          全部暂停
        </button>
      ) : null}
      {onResumeAll && paused ? (
        <button type="button" onClick={onResumeAll}>
          全部恢复
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('../runtime/shell/header/TeamTabBar.js', () => ({
  TeamTabBar: ({
    leadingSlot,
    centerSlot,
    trailingSlot,
  }: {
    leadingSlot?: React.ReactNode;
    centerSlot?: React.ReactNode;
    trailingSlot?: React.ReactNode;
  }) => (
    <div data-testid="team-tab-bar">
      <div>{leadingSlot}</div>
      <div>{centerSlot}</div>
      <div>{trailingSlot}</div>
    </div>
  ),
}));

vi.mock('./team-page-v2-panels.js', () => ({
  IdleHint: () => <div data-testid="idle-hint" />,
  TeamFocusHandoffBanner: () => null,
  TeamPageSuperbarLeading: ({
    memberCount,
    onlineCount,
    selectedTeam,
  }: {
    memberCount: string;
    onlineCount: string;
    selectedTeam: { title: string; subtitle: string } | null;
  }) => (
    <div>
      <div
        data-testid="workspace-switcher"
        data-create-enabled={String(Boolean(authState.accessToken))}
        data-rename-enabled={String(
          Boolean((testState.data as { canManageRuntime?: boolean } | null)?.canManageRuntime),
        )}
        data-delete-enabled={String(
          Boolean((testState.data as { canManageRuntime?: boolean } | null)?.canManageRuntime),
        )}
      />
      {selectedTeam ? (
        <>
          <span data-testid="team-current-session-pill">{`当前会话 ${selectedTeam.title}`}</span>
          <span data-testid="team-current-session-status">{selectedTeam.subtitle}</span>
          <span data-testid="team-current-session-members">{`${memberCount} · ${onlineCount}`}</span>
        </>
      ) : null}
    </div>
  ),
  TeamPageSuperbarSummary: () => null,
  TeamSharedConversationPanel: ({
    sharedSession,
  }: {
    sharedSession: {
      session?: {
        messages?: Array<{
          content?: Array<{ text?: string; type?: string }>;
          role?: string;
        }>;
      };
    } | null;
  }) => {
    const latestOutput =
      sharedSession?.session?.messages
        ?.flatMap((message) =>
          message.role === 'assistant'
            ? (message.content ?? []).flatMap((part) =>
                part.type === 'text' && typeof part.text === 'string' ? [part.text] : [],
              )
            : [],
        )
        .find((value) => value.trim().length > 0) ?? '';
    return (
      <div data-testid="team-shared-conversation-panel">
        <div data-testid="team-shared-conversation-latest-output">{latestOutput}</div>
      </div>
    );
  },
}));

vi.mock('../runtime/shell/header/TeamTopBar.js', () => ({
  TeamTopBar: ({
    leadingSlot,
  }: {
    leadingSlot?: React.ReactNode;
    activePrimary?: unknown;
    onPrimaryChange?: unknown;
    unreadCount?: number;
    clarificationPending?: number;
    showOffice?: boolean;
    officeActive?: boolean;
    onOfficeClick?: unknown;
  }) => (
    <div data-testid="team-top-bar">
      <div>{leadingSlot}</div>
    </div>
  ),
}));

vi.mock('../runtime/shell/controls/TeamBottomStatusBar.js', () => ({
  TeamBottomStatusBar: ({
    paused,
    onPauseAll,
    onResumeAll,
    resumeNoticeTitle,
    resumeNoticeDetail,
    runtimeError,
  }: {
    paused?: boolean;
    onPauseAll?: () => void;
    onResumeAll?: () => void;
    resumeNoticeTitle?: string | null;
    runtimeError?: string | null;
    selectedSessionId?: string | null;
    resumeNoticeDetail?: string | null;
    onDismissResumeNotice?: () => void;
    focusHandoffId?: string | null;
    focusHandoffLabel?: React.ReactNode;
    focusActions?: React.ReactNode;
    onClearFocus?: () => void;
    controlDisabled?: boolean;
    controlBusy?: boolean;
  }) => (
    <div data-testid="team-bottom-status-bar">
      <span data-testid="team-status-bar-mode">{paused ? 'paused' : 'running'}</span>
      {onPauseAll && !paused ? (
        <button type="button" onClick={onPauseAll}>
          全部暂停
        </button>
      ) : null}
      {onResumeAll && paused ? (
        <button type="button" onClick={onResumeAll}>
          全部恢复
        </button>
      ) : null}
      {resumeNoticeTitle ? (
        <span role="status" data-testid="resume-notice">
          {resumeNoticeTitle}
          {resumeNoticeDetail ? ` · ${resumeNoticeDetail}` : ''}
        </span>
      ) : null}
      {runtimeError ? (
        <span role="alert" data-testid="runtime-error">
          {runtimeError}
        </span>
      ) : null}
    </div>
  ),
}));

vi.mock('../runtime/shell/controls/SubTabBar.js', () => ({
  SubTabBar: () => <div data-testid="sub-tab-bar" />,
}));

vi.mock('../runtime/shell/sidebar/TeamSidebarWithFileTree.js', () => ({
  TeamSidebarWithFileTree: ({
    canManageSessionEntries,
    canCreateWorkspace,
    onCreateWorkspace,
    onOpenNewSessionModal,
    onSelectTeam,
    workspaceGroups,
  }: {
    canManageSessionEntries?: boolean;
    canCreateWorkspace?: boolean;
    onCreateWorkspace?: () => void;
    onOpenNewSessionModal?: (templateId?: string | null, workingDirectory?: string | null) => void;
    onSelectTeam?: (teamId: string) => void;
    workspaceGroups?: Array<{ sessions: Array<{ id: string; title: string }> }>;
  }) => (
    <div>
      <div
        data-testid="team-sidebar"
        data-can-manage-session-entries={String(canManageSessionEntries ?? true)}
      />
      {workspaceGroups?.flatMap((group) =>
        group.sessions.map((session) => (
          <button key={session.id} type="button" onClick={() => onSelectTeam?.(session.id)}>
            {session.title}
          </button>
        )),
      )}
      <button
        type="button"
        data-testid="sidebar-open-new-session"
        onClick={() => onOpenNewSessionModal?.()}
      >
        新建会话入口
      </button>
      {canCreateWorkspace ? (
        <button type="button" onClick={() => onCreateWorkspace?.()}>
          新建工作区入口
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('../runtime/shell/header/WorkspaceSwitcher.js', () => ({
  WorkspaceSwitcher: ({
    onCreateNew,
    onRename,
    onRequestDelete,
  }: {
    onCreateNew?: () => void;
    onRename?: ((workspaceId: string, name: string) => Promise<boolean>) | undefined;
    onRequestDelete?: ((workspace: { id: string; name: string }) => void) | undefined;
  }) => (
    <div>
      <div
        data-testid="workspace-switcher"
        data-create-enabled={String(Boolean(onCreateNew))}
        data-rename-enabled={String(Boolean(onRename))}
        data-delete-enabled={String(Boolean(onRequestDelete))}
      />
      <button type="button" onClick={onCreateNew}>
        新建工作区入口
      </button>
    </div>
  ),
}));

vi.mock('../runtime/shell/session-view/LayerConversationDrawer.js', () => ({
  LayerConversationDrawer: () => null,
}));

vi.mock('../runtime/tabs/MiddleTabRouter.js', () => ({
  renderMiddleTabContent: ({
    onCancelHandoff,
    onUseTemplate,
  }: {
    onCancelHandoff: (handoffId: string) => void;
    onUseTemplate?: (templateId: string) => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="middle-tab-content"
        onClick={() => onCancelHandoff('handoff-running')}
      >
        触发取消 handoff
      </button>
      <button
        type="button"
        data-testid="use-template-trigger"
        onClick={() => onUseTemplate?.('tpl-1')}
      >
        使用模板创建会话
      </button>
    </div>
  ),
}));

vi.mock('../runtime/tabs/team-page-v2-tabs.js', () => ({
  LEAF_TO_PRIMARY: new Map([['conversation', 'conversation']]),
  MIDDLE_TAB_KEYS: new Set(['conversation', 'health']),
  getDefaultLeafFor: () => 'conversation',
}));

vi.mock('../runtime/tabs/team-runtime-navigation.js', () => ({
  extractTeamRuntimeHandoffContextFromEvent: () => ({ preferredTab: 'health' }),
}));

vi.mock('../runtime/hooks/use-team-page-state.js', () => ({
  useBreakpoint: () => testState.breakpoint,
  useTeamPageMode: () => testState.mode,
}));

vi.mock('../../../stores/team/team-events.js', () => ({
  connectTeamEvents: mocks.connectTeamEvents,
  disconnectTeamEvents: mocks.disconnectTeamEvents,
  getTeamNotificationEventKey: () => 'event-key',
  useClarificationStore: (selector: (state: { pendingCount: number }) => unknown) =>
    selector({ pendingCount: 0 }),
  useHandoffStore: (
    selector: (state: { handoffs: Map<string, Record<string, unknown>> }) => unknown,
  ) => selector({ handoffs: testState.handoffs }),
  useLayerStore: (selector: (state: { nodes: Map<string, Record<string, unknown>> }) => unknown) =>
    selector({ nodes: testState.nodes }),
  useTeamNotificationStore: (
    selector: (state: {
      events: Array<Record<string, unknown>>;
      readEventKeys: Set<string>;
      unreadCount: number;
    }) => unknown,
  ) =>
    selector({
      events: [],
      readEventKeys: new Set<string>(),
      unreadCount: 0,
    }),
}));

vi.mock('../runtime/tabs/office/OfficeScene.js', () => ({
  useOfficeSceneState: () => ({}),
}));

vi.mock('../runtime/tabs/office/OfficeThreeCanvas.js', () => ({
  OfficeThreeCanvas: () => <div data-testid="office-canvas" />,
}));

const teamConversationViewState = vi.hoisted(() => ({
  sessionIds: [] as string[],
}));

vi.mock('../conversation/TeamConversationView.js', () => ({
  TeamConversationView: ({ sessionId }: { sessionId: string }) => {
    teamConversationViewState.sessionIds.push(sessionId);
    return <div data-testid="team-conversation-view" data-session-id={sessionId} />;
  },
}));

vi.mock('../runtime/shell/modals/NewTeamWorkspaceModal.js', () => ({
  NewTeamWorkspaceModal: ({ onCreated }: { onCreated?: (newWorkspaceId?: string) => void }) => {
    modalState.onCreated = onCreated;
    return (
      <button
        type="button"
        data-testid="new-team-workspace-modal"
        onClick={() => onCreated?.('workspace-2')}
      >
        完成创建工作区
      </button>
    );
  },
}));

vi.mock('../runtime/shell/modals/ConfirmDeleteWorkspaceModal.js', () => ({
  ConfirmDeleteWorkspaceModal: () => null,
}));

vi.mock('../runtime/shell/modals/NewTeamSessionModal.js', () => ({
  NewTeamSessionModal: () => null,
}));

vi.mock('../../../hooks/editor/useFileEditor.js', () => ({
  useFileEditor: () => ({
    openFile: vi.fn(async () => undefined),
    saveFile: vi.fn(async () => undefined),
  }),
}));

vi.mock('../../../components/file-editor/WorkspaceEditorOverlay.js', () => ({
  WorkspaceEditorOverlay: ({
    open,
    browserPreviewUrl,
    activeTab,
  }: {
    open?: boolean;
    browserPreviewUrl?: string | null;
    activeTab?: string;
  }) =>
    open ? (
      <div
        data-testid="workspace-editor-overlay"
        data-browser-preview-url={browserPreviewUrl ?? ''}
        data-active-tab={activeTab ?? ''}
      />
    ) : null,
}));

function createWorkspaceState() {
  return {
    activeWorkspace: {
      defaultTeamRoster: [],
      defaultWorkingRoot: '/workspace/demo',
      id: 'workspace-1',
      name: '团队工作区',
    },
    error: null,
    loading: false,
    refresh: mocks.refreshWorkspaces,
    workspaces: [
      {
        defaultWorkingRoot: '/workspace/demo',
        id: 'workspace-1',
        name: '团队工作区',
      },
    ],
  };
}

function createRuntimeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'session-root',
    metadataJson: '{}',
    parentSessionId: null,
    paused: false,
    roleLayer: 'reception',
    stateStatus: 'running',
    title: '根会话',
    updatedAt: '2026-06-04T09:00:00.000Z',
    workspacePath: '/workspace/demo',
    ...overrides,
  };
}

function createPauseAllResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    depthLimitReached: false,
    handoffIds: ['handoff-running'],
    limitReached: false,
    omittedSessionCount: 0,
    pausedHandoffCount: 1,
    pausedSessionCount: 1,
    sessionId: 'session-root',
    sessionIds: ['session-root'],
    sessionLimit: 200,
    sessionMaxDepth: 16,
    truncated: false,
    ...overrides,
  };
}

function createResumeAllResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    depthLimitReached: false,
    handoffIds: ['handoff-stale'],
    limitReached: false,
    omittedSessionCount: 0,
    resumedHandoffCount: 1,
    resumedSessionCount: 1,
    sessionId: 'session-root',
    sessionIds: ['session-root'],
    sessionLimit: 200,
    sessionMaxDepth: 16,
    staleSessionCount: 0,
    truncated: false,
    ...overrides,
  };
}

function createReferenceData(status: 'running' | 'paused') {
  return {
    activeMode: 'live',
    activityStats: {},
    activeSharedSession: null,
    acknowledgeRuntimeAlert: vi.fn(async () => true),
    auditLogs: [],
    busy: false,
    canCreateSession: true,
    canCreateTemplate: false,
    canManageRuntime: true,
    canManageSessionEntries: true,
    clearRuntimeAlertControl: vi.fn(async () => true),
    conversationCards: [],
    createSession: mocks.createSession,
    createSessionShare: vi.fn(async () => true),
    createTask: vi.fn(async () => true),
    createTemplate: vi.fn(async () => true),
    createWorkspace: vi.fn(async () => 'workspace-2'),
    defaultReceptionSessionId: 'session-root',
    defaultSelectedAgentId: 'agent-1',
    defaultSelectedTeamId: 'session-root',
    deleteSession: mocks.deleteSession,
    deleteSessionShare: vi.fn(async () => true),
    deleteWorkspace: mocks.deleteWorkspace,
    diagnostics: undefined,
    duplicateTemplate: vi.fn(async () => true),
    error: null,
    feedback: null,
    footerLead: '活跃 1 / 共 1',
    footerStats: [
      { label: '总', value: '1' },
      { label: '运行', value: '1' },
      { label: '等待', value: '0' },
      { label: '异常', value: '0' },
    ],
    historyTeams: [],
    loading: false,
    members: [],
    messageCards: [],
    metricCards: [],
    moveTask: vi.fn(async () => true),
    officeAgents: [],
    overviewCards: [],
    reconcileStaleDecisions: vi.fn(async () => true),
    reconcileStaleRuntimeThreads: vi.fn(async () => true),
    removeTemplate: vi.fn(async () => true),
    renameWorkspace: mocks.renameWorkspace,
    replyReview: vi.fn(async () => true),
    reviewBusy: false,
    reviewCards: [],
    roleChips: [],
    runRuntimeAlertRemediation: vi.fn(async () => true),
    runningTeams: [],
    selectTeam: mocks.selectTeam,
    selectedSharedSession: null,
    sendMessage: mocks.sendMessage,
    sessionShares: [],
    setSelectedSharedSessionId: vi.fn(),
    sharedSessionLoading: false,
    sharedSessions: [],
    sidebarSections: [],
    submitReviewComment: vi.fn(async () => true),
    suppressRuntimeAlert: vi.fn(async () => true),
    taskLanes: [],
    templateCount: 0,
    templateError: null,
    templateLoading: false,
    templates: [],
    timelineEvents: [],
    toggleSessionState: vi.fn(async () => true),
    topSummary: {
      description: '当前会话',
      memberCount: '1 成员',
      onlineCount: '1 在线',
      status: status === 'paused' ? '已暂停' : '运行中',
      title: '根会话',
    },
    updateSessionShare: vi.fn(async () => true),
    updateTemplate: vi.fn(async () => true),
    workspaceGroups: [
      {
        sessions: [
          {
            id: 'session-root',
            status,
            subtitle: status === 'paused' ? '已暂停' : '运行中',
            title: '根会话',
            updatedAt: '2026-06-04T09:00:00.000Z',
          },
        ],
        workspaceLabel: 'workspace/demo',
        workspacePath: '/workspace/demo',
      },
    ],
    workspaces: [
      {
        defaultWorkingRoot: '/workspace/demo',
        id: 'workspace-1',
        name: '团队工作区',
      },
    ],
  };
}

function renderPage() {
  return render(<TeamPageV2 />);
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  useUIStateStore.getState().setActiveTeamSessionId(null);
  useUIStateStore.getState().consumeTeamNewSessionSignal();
  useUIStateStore.getState().consumeTeamSelectSessionSignal();
  teamConversationViewState.sessionIds = [];
  toastMock.mockReset();
  mocks.cancelHandoff.mockReset().mockResolvedValue({ ok: true });
  mocks.pauseAllRuntimeSessions.mockReset().mockResolvedValue(createPauseAllResult());
  mocks.resumeAllRuntimeSessions.mockReset().mockResolvedValue(createResumeAllResult());
  modalState.onCreated = undefined;
  routeState.teamWorkspaceId = 'workspace-1';
  routeState.searchParams = new URLSearchParams();
  authState.accessToken = 'token-test';
  testState.breakpoint = 'desktop';
  testState.mode = 'running';
  testState.data = createReferenceData('running');
  testState.workspaceState = createWorkspaceState();
  testState.snapshotState = {
    error: null,
    loading: false,
    refresh: mocks.refreshWorkspaceSnapshot,
    snapshot: {
      runtimeTaskGroups: [],
      sessions: [createRuntimeSession()],
      sharedSessions: [],
    },
  };
  testState.handoffs = new Map([
    [
      'handoff-running',
      {
        fromRoleLayer: 'reception',
        fromSessionId: 'session-root',
        id: 'handoff-running',
        sessionId: 'session-root',
        state: 'running',
        toRoleLayer: 'pm1',
        toSessionId: 'session-root',
        updatedAt: Date.now(),
      },
    ],
  ]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

import TeamPageV2 from './TeamPageV2.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

describe('TeamPageV2', () => {
  it('顶部栏会持续显示当前选中的会话标题', async () => {
    renderPage();

    expect(screen.getByTestId('team-current-session-pill').textContent).toContain('当前会话');
    expect(screen.getByTestId('team-current-session-pill').textContent).toContain('根会话');
    expect(screen.getByTestId('team-current-session-status').textContent).toBe('运行中');
    expect(screen.getByTestId('team-current-session-members').textContent).toBe('1 成员 · 1 在线');
  });

  it('不再把 topSummary 的旧暂停文案当成真实暂停态', async () => {
    const base = createReferenceData('running');
    testState.data = {
      ...base,
      topSummary: {
        ...base.topSummary,
        status: '已暂停',
      },
    };

    renderPage();

    expect(screen.queryByText('LLM 调用已停止')).toBeNull();
    expect(screen.getByTestId('team-status-bar-mode').textContent).toBe('running');
    expect(await screen.findByRole('button', { name: '全部暂停' })).toBeTruthy();
  });

  it('URL query 中带 sessionId 时会自动选中对应 team 会话', async () => {
    routeState.searchParams = new URLSearchParams('sessionId=session-root');

    renderPage();

    await waitFor(() => {
      expect(mocks.selectTeam).toHaveBeenCalledWith('session-root');
    });
  });

  it('选中共享会话时，对话主 tab 会显示共享详情而不是误挂本地 TeamConversationView', async () => {
    testState.data = {
      ...createReferenceData('running'),
      activeSharedSession: {
        comments: [],
        pendingPermissions: [{ requestId: 'perm-1' }],
        pendingQuestions: [{ id: 'question-1' }],
        presence: [
          {
            active: true,
            firstSeenAt: '2026-06-05T08:00:00.000Z',
            lastSeenAt: '2026-06-05T08:10:00.000Z',
            viewerEmail: 'viewer@example.com',
            viewerUserId: 'viewer-1',
          },
        ],
        session: {
          createdAt: 1717555200000,
          id: 'shared-1',
          messages: [
            {
              content: [{ text: '共享运行已完成阶段一。', type: 'text' as const }],
              createdAt: 1717555260000,
              id: 'message-1',
              role: 'assistant' as const,
            },
          ],
        },
        share: {
          createdAt: '2026-06-05T08:00:00.000Z',
          permission: 'operate' as const,
          sessionId: 'shared-1',
          shareCreatedAt: '2026-06-05T08:00:00.000Z',
          shareUpdatedAt: '2026-06-05T08:12:00.000Z',
          sharedByEmail: 'owner@example.com',
          stateStatus: 'running',
          title: '共享会话 A',
          updatedAt: '2026-06-05T08:12:00.000Z',
          workspacePath: '/workspace/shared',
        },
      },
      defaultReceptionSessionId: 'shared-1',
      defaultSelectedTeamId: 'shared-1',
      selectedSharedSession: {
        comments: [],
        pendingPermissions: [{ requestId: 'perm-1' }],
        pendingQuestions: [{ id: 'question-1' }],
        presence: [
          {
            active: true,
            firstSeenAt: '2026-06-05T08:00:00.000Z',
            lastSeenAt: '2026-06-05T08:10:00.000Z',
            viewerEmail: 'viewer@example.com',
            viewerUserId: 'viewer-1',
          },
        ],
        session: {
          createdAt: 1717555200000,
          id: 'shared-1',
          messages: [
            {
              content: [{ text: '共享运行已完成阶段一。', type: 'text' as const }],
              createdAt: 1717555260000,
              id: 'message-1',
              role: 'assistant' as const,
            },
          ],
        },
        share: {
          createdAt: '2026-06-05T08:00:00.000Z',
          permission: 'operate' as const,
          sessionId: 'shared-1',
          shareCreatedAt: '2026-06-05T08:00:00.000Z',
          shareUpdatedAt: '2026-06-05T08:12:00.000Z',
          sharedByEmail: 'owner@example.com',
          stateStatus: 'running',
          title: '共享会话 A',
          updatedAt: '2026-06-05T08:12:00.000Z',
          workspacePath: '/workspace/shared',
        },
      },
      sharedSessions: [
        {
          createdAt: '2026-06-05T08:00:00.000Z',
          permission: 'operate' as const,
          sessionId: 'shared-1',
          shareCreatedAt: '2026-06-05T08:00:00.000Z',
          shareUpdatedAt: '2026-06-05T08:12:00.000Z',
          sharedByEmail: 'owner@example.com',
          stateStatus: 'running',
          title: '共享会话 A',
          updatedAt: '2026-06-05T08:12:00.000Z',
          workspacePath: '/workspace/shared',
        },
      ],
      topSummary: {
        description: '当前共享：共享会话 A · 运行中 · /workspace/shared',
        memberCount: '1 成员',
        onlineCount: '1 在线',
        status: '运行中',
        title: '共享会话 A',
      },
      workspaceGroups: [
        {
          sessions: [
            {
              id: 'shared-1',
              isSharedSession: true,
              status: 'running',
              subtitle: '运行中',
              title: '共享会话 A',
              updatedAt: '2026-06-05T08:12:00.000Z',
            },
          ],
          workspaceLabel: 'workspace/shared',
          workspacePath: '/workspace/shared',
        },
      ],
    };
    testState.snapshotState = {
      error: null,
      loading: false,
      refresh: mocks.refreshWorkspaceSnapshot,
      snapshot: {
        runtimeTaskGroups: [],
        sessions: [],
        sharedSessions: [
          {
            createdAt: '2026-06-05T08:00:00.000Z',
            permission: 'operate' as const,
            sessionId: 'shared-1',
            shareCreatedAt: '2026-06-05T08:00:00.000Z',
            shareUpdatedAt: '2026-06-05T08:12:00.000Z',
            sharedByEmail: 'owner@example.com',
            stateStatus: 'running',
            title: '共享会话 A',
            updatedAt: '2026-06-05T08:12:00.000Z',
            workspacePath: '/workspace/shared',
          },
        ],
      },
    };

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('team-shared-conversation-panel')).toBeTruthy();
    });
    expect(screen.getByTestId('team-shared-conversation-latest-output').textContent).toContain(
      '共享运行已完成阶段一。',
    );
    expect(screen.queryByTestId('team-conversation-view')).toBeNull();
  });

  it('切换 selectedTeamId 时会把新的会话 id 传给右侧 TeamConversationView', async () => {
    testState.data = {
      ...createReferenceData('running'),
      workspaceGroups: [
        {
          sessions: [
            {
              id: 'session-root',
              status: 'running',
              subtitle: '运行中',
              title: '根会话',
              updatedAt: '2026-06-04T09:00:00.000Z',
            },
            {
              id: 'session-pm1',
              status: 'running',
              subtitle: 'PM1',
              title: 'PM1 会话',
              updatedAt: '2026-06-04T09:01:00.000Z',
            },
          ],
          workspaceLabel: 'workspace/demo',
          workspacePath: '/workspace/demo',
        },
      ],
    };

    renderPage();

    expect(screen.queryByTestId('team-conversation-view')).toBeNull();

    act(() => {
      useUIStateStore.getState().triggerTeamSelectSession('workspace-1', 'session-pm1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('team-conversation-view').getAttribute('data-session-id')).toBe(
        'session-pm1',
      );
    });
    expect(teamConversationViewState.sessionIds).toContain('session-pm1');
  });

  it('共享会话仅存在于 snapshot/workspaceGroups 时，仍按共享会话路由而不是误判为本地会话', async () => {
    testState.data = {
      ...createReferenceData('running'),
      activeSharedSession: null,
      defaultReceptionSessionId: 'shared-1',
      defaultSelectedTeamId: 'shared-1',
      selectedSharedSession: null,
      sharedSessionLoading: true,
      sharedSessions: [],
      topSummary: {
        description: '当前共享：共享会话 A · 运行中 · /workspace/shared',
        memberCount: '0 成员',
        onlineCount: '0 在线',
        status: '运行中',
        title: '共享会话 A',
      },
      workspaceGroups: [
        {
          sessions: [
            {
              id: 'shared-1',
              isSharedSession: true,
              status: 'running',
              subtitle: '运行中',
              title: '共享会话 A',
              updatedAt: '2026-06-05T08:12:00.000Z',
            },
          ],
          workspaceLabel: 'workspace/shared',
          workspacePath: '/workspace/shared',
        },
      ],
    };
    testState.snapshotState = {
      error: null,
      loading: false,
      refresh: mocks.refreshWorkspaceSnapshot,
      snapshot: {
        runtimeTaskGroups: [],
        sessions: [],
        sharedSessions: [
          {
            createdAt: '2026-06-05T08:00:00.000Z',
            permission: 'operate' as const,
            sessionId: 'shared-1',
            shareCreatedAt: '2026-06-05T08:00:00.000Z',
            shareUpdatedAt: '2026-06-05T08:12:00.000Z',
            sharedByEmail: 'owner@example.com',
            stateStatus: 'running',
            title: '共享会话 A',
            updatedAt: '2026-06-05T08:12:00.000Z',
            workspacePath: '/workspace/shared',
          },
        ],
      },
    };

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('team-shared-conversation-panel')).toBeTruthy();
    });
    expect(mocks.selectTeam).toHaveBeenCalledWith('shared-1');
    expect(screen.queryByTestId('team-conversation-view')).toBeNull();
  });

  it('点击顶部暂停后会经确认弹层调用真实 pause-all 接口', async () => {
    renderPage();

    const pauseButton = await screen.findByRole('button', { name: '全部暂停' });
    fireEvent.click(pauseButton);

    expect(screen.getByRole('dialog', { name: '确认暂停' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认暂停' }));

    await waitFor(() => {
      expect(mocks.pauseAllRuntimeSessions).toHaveBeenCalledWith('token-test', 'session-root', {
        reason: 'team-page-v2-pause-all',
      });
    });

    await waitFor(() => {
      expect(mocks.refreshWorkspaceSnapshot).toHaveBeenCalled();
    });
  });

  it('工作区切换后旧会话失效时会回退到新的默认会话', async () => {
    const view = renderPage();

    await screen.findByRole('button', { name: '全部暂停' });

    testState.data = {
      ...createReferenceData('running'),
      defaultReceptionSessionId: 'session-next',
      defaultSelectedTeamId: 'session-next',
      workspaceGroups: [
        {
          sessions: [
            {
              id: 'session-next',
              status: 'running',
              subtitle: '运行中',
              title: '新工作区会话',
              updatedAt: '2026-06-05T09:00:00.000Z',
            },
          ],
          workspaceLabel: 'workspace/next',
          workspacePath: '/workspace/next',
        },
      ],
    };
    testState.workspaceState = {
      activeWorkspace: {
        defaultTeamRoster: [],
        defaultWorkingRoot: '/workspace/next',
        id: 'workspace-2',
        name: '团队工作区 2',
      },
      error: null,
      loading: false,
      refresh: mocks.refreshWorkspaces,
      workspaces: [
        {
          defaultWorkingRoot: '/workspace/next',
          id: 'workspace-2',
          name: '团队工作区 2',
        },
      ],
    };
    testState.snapshotState = {
      error: null,
      loading: false,
      refresh: mocks.refreshWorkspaceSnapshot,
      snapshot: {
        runtimeTaskGroups: [],
        sessions: [
          createRuntimeSession({
            id: 'session-next',
            title: '新工作区会话',
            updatedAt: '2026-06-05T09:00:00.000Z',
            workspacePath: '/workspace/next',
          }),
        ],
        sharedSessions: [],
      },
    };

    view.rerender(<TeamPageV2 />);

    fireEvent.click(await screen.findByRole('button', { name: '全部暂停' }));
    fireEvent.click(screen.getByRole('button', { name: '确认暂停' }));

    await waitFor(() => {
      expect(mocks.pauseAllRuntimeSessions).toHaveBeenLastCalledWith('token-test', 'session-next', {
        reason: 'team-page-v2-pause-all',
      });
    });
    expect(mocks.selectTeam).toHaveBeenCalledWith('session-next');
  });

  it('暂停态点击恢复会先打开 stale 弹层，再调用真实 resume-all 接口', async () => {
    testState.data = createReferenceData('paused');
    testState.snapshotState = {
      error: null,
      loading: false,
      refresh: mocks.refreshWorkspaceSnapshot,
      snapshot: {
        runtimeTaskGroups: [],
        sessions: [
          createRuntimeSession({
            paused: true,
            stateStatus: 'running',
          }),
        ],
        sharedSessions: [],
      },
    };
    testState.handoffs = new Map([
      [
        'handoff-stale',
        {
          fromRoleLayer: 'reception',
          fromSessionId: 'session-root',
          id: 'handoff-stale',
          sessionId: 'session-root',
          state: 'pending',
          toRoleLayer: 'pm1',
          toSessionId: 'session-root',
          updatedAt: Date.now(),
        },
      ],
    ]);

    renderPage();

    const resumeButtons = await screen.findAllByRole('button', { name: '全部恢复' });
    const resumeButton = resumeButtons[0];
    if (!resumeButton) {
      throw new Error('未找到恢复按钮');
    }
    fireEvent.click(resumeButton);

    expect(screen.getByRole('dialog', { name: '恢复过期任务' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '恢复全部' }));

    await waitFor(() => {
      expect(mocks.resumeAllRuntimeSessions).toHaveBeenCalledWith('token-test', 'session-root');
    });

    await waitFor(() => {
      expect(mocks.refreshWorkspaceSnapshot).toHaveBeenCalled();
    });
  });

  it('恢复运行树时会向用户展示正在恢复和截断后的后台续跑状态', async () => {
    testState.data = createReferenceData('paused');
    testState.snapshotState = {
      error: null,
      loading: false,
      refresh: mocks.refreshWorkspaceSnapshot,
      snapshot: {
        runtimeTaskGroups: [],
        sessions: [
          createRuntimeSession({
            paused: true,
            stateStatus: 'running',
          }),
        ],
        sharedSessions: [],
      },
    };
    testState.handoffs = new Map();
    let resolveResume: (value: Record<string, unknown>) => void = () => undefined;
    const resumePromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveResume = resolve;
    });
    mocks.resumeAllRuntimeSessions.mockReturnValueOnce(resumePromise);

    renderPage();

    const resumeButtons = await screen.findAllByRole('button', { name: '全部恢复' });
    const resumeButton = resumeButtons[0];
    if (!resumeButton) {
      throw new Error('未找到恢复按钮');
    }
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '恢复中…' })).toBeTruthy();
    });

    resolveResume(
      createResumeAllResult({
        limitReached: true,
        omittedSessionCount: 3,
        truncated: true,
      }),
    );

    await waitFor(() => {
      expect(mocks.refreshWorkspaceSnapshot).toHaveBeenCalled();
    });
  });

  it('移动端默认不展开会话列表抽屉，但会保留浮动入口', async () => {
    testState.breakpoint = 'mobile';

    renderPage();

    expect(screen.queryByRole('dialog', { name: '团队会话列表' })).toBeNull();
    expect(screen.getByRole('button', { name: '展开会话列表' })).toBeTruthy();
    expect(screen.getByTestId('team-tab-bar')).toBeTruthy();
  });

  it('创建工作区成功后会跳转到新工作区', async () => {
    routeState.searchParams = new URLSearchParams('action=newWorkspace');

    renderPage();

    expect(screen.getByTestId('new-team-workspace-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('new-team-workspace-modal'));

    await waitFor(() => {
      expect(mocks.refreshWorkspaces).toHaveBeenCalled();
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/team/workspace-2');
  });

  it('team 页面会响应 openAwork:open-browser 事件并打开默认浏览器预览', async () => {
    renderPage();

    window.dispatchEvent(new CustomEvent('openAwork:open-browser'));

    await waitFor(() => {
      const overlay = screen.getByTestId('workspace-editor-overlay');
      expect(overlay.getAttribute('data-browser-preview-url')).toBe('http://localhost:3000');
      expect(overlay.getAttribute('data-active-tab')).toBe('browser');
    });
  });

  it('team 页面会响应 openawork:browser:open-url 事件并归一化自定义地址', async () => {
    renderPage();

    window.dispatchEvent(
      new CustomEvent('openawork:browser:open-url', {
        detail: { url: 'localhost:4173/demo' },
      }),
    );

    await waitFor(() => {
      const overlay = screen.getByTestId('workspace-editor-overlay');
      expect(overlay.getAttribute('data-browser-preview-url')).toBe('http://localhost:4173/demo');
      expect(overlay.getAttribute('data-active-tab')).toBe('browser');
    });
  });

  it('数据层反馈会在 team 页面统一显示为 toast', async () => {
    testState.data = {
      ...createReferenceData('running'),
      feedback: {
        message: '已发送团队消息',
        tone: 'success' as const,
      },
    };

    renderPage();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('已发送团队消息', 'success');
    });
  });

  it('取消 handoff 成功后会提示成功并刷新快照', async () => {
    localStorage.setItem('teamV2.middleTab', 'health');
    renderPage();

    fireEvent.click(screen.getByTestId('middle-tab-content'));

    await waitFor(() => {
      expect(mocks.cancelHandoff).toHaveBeenCalledWith('token-test', 'handoff-running');
    });
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('已取消运行中任务', 'success');
    });
    await waitFor(() => {
      expect(mocks.refreshWorkspaceSnapshot).toHaveBeenCalled();
    });
  });

  it('取消 handoff 失败后会提示错误，不刷新快照', async () => {
    mocks.cancelHandoff.mockResolvedValueOnce({
      ok: false,
      errorMessage: '当前状态：completed',
    });
    localStorage.setItem('teamV2.middleTab', 'health');

    renderPage();

    fireEvent.click(screen.getByTestId('middle-tab-content'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('取消任务失败：当前状态：completed', 'error');
    });
    expect(mocks.refreshWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('无有效工作区时，新建会话入口会直接提示 warning，不打开弹窗', async () => {
    routeState.teamWorkspaceId = undefined;
    testState.workspaceState = {
      activeWorkspace: null,
      error: null,
      loading: false,
      refresh: mocks.refreshWorkspaces,
      workspaces: [],
    };
    testState.data = {
      ...createReferenceData('running'),
      canCreateSession: false,
      workspaceGroups: [],
      workspaces: [],
    };

    renderPage();

    fireEvent.click(screen.getByTestId('sidebar-open-new-session'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('请先选择工作空间后再创建会话。', 'warning');
    });
    expect(screen.queryByText('MockNewTeamSessionModal')).toBeNull();
  });

  it('真路径会把当前选中会话同步给全局侧栏状态', async () => {
    renderPage();

    await waitFor(() => {
      expect(useUIStateStore.getState().activeTeamSessionId).toBe('session-root');
    });
  });

  it('无写入能力时不会把 idle 建议提交链路传给 ConversationArea', () => {
    testState.data = {
      ...createReferenceData('running'),
      canManageSessionEntries: false,
    };

    renderPage();

    expect(screen.getByTestId('conversation-area-flags').getAttribute('data-submit-enabled')).toBe(
      'false',
    );
    expect(
      screen.getByTestId('conversation-area-flags').getAttribute('data-suggestion-enabled'),
    ).toBe('false');
  });

  it('无运行治理能力时不会把工作区重命名/删除能力下传给 WorkspaceSwitcher', () => {
    testState.data = {
      ...createReferenceData('running'),
      canManageRuntime: false,
    };

    renderPage();

    expect(screen.getByTestId('workspace-switcher').getAttribute('data-rename-enabled')).toBe(
      'false',
    );
    expect(screen.getByTestId('workspace-switcher').getAttribute('data-delete-enabled')).toBe(
      'false',
    );
  });

  it('未认证时不会把新建工作区能力下传给 WorkspaceSwitcher', () => {
    authState.accessToken = null;
    testState.data = {
      ...createReferenceData('running'),
      canManageRuntime: false,
    };

    renderPage();

    expect(screen.getByTestId('workspace-switcher').getAttribute('data-create-enabled')).toBe(
      'false',
    );
  });
});
