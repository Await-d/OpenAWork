// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  accessToken: 'token-test' as string | null,
  gatewayUrl: 'https://gateway.test',
  navigate: vi.fn(),
  useMultiSessionAttach: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => testState.navigate,
  useParams: () => ({ teamWorkspaceId: 'workspace-1' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: (
    selector?: (state: { accessToken: string | null; gatewayUrl: string }) => unknown,
  ) => {
    const state = {
      accessToken: testState.accessToken,
      gatewayUrl: testState.gatewayUrl,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('../../../stores/team/use-multi-session-attach.js', () => ({
  useMultiSessionAttach: testState.useMultiSessionAttach,
}));

vi.mock('../runtime/data/team-runtime-reference-data.js', () => ({
  TeamRuntimeReferenceDataProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useResolvedTeamRuntimeReferenceData: () => ({
    activeSharedSession: null,
    canManageRuntime: false,
    canManageSessionEntries: false,
    createSession: vi.fn(async () => null),
    defaultReceptionSessionId: null,
    defaultSelectedAgentId: '',
    defaultSelectedTeamId: '',
    deleteSession: vi.fn(async () => true),
    deleteWorkspace: vi.fn(async () => true),
    feedback: null,
    footerLead: '',
    footerStats: [],
    renameSession: vi.fn(async () => true),
    roleChips: [],
    selectTeam: vi.fn(),
    selectedSharedSession: null,
    sendMessage: vi.fn(async () => true),
    setSelectedSharedSessionId: vi.fn(),
    sharedSessionLoading: false,
    toggleSessionState: vi.fn(async () => true),
    topSummary: {
      description: '',
      memberCount: '0',
      onlineCount: '0',
      status: '运行中',
    },
    workspaceGroups: [],
  }),
}));

vi.mock('../hooks/use-team-workspace-state.js', () => ({
  useTeamWorkspaceState: () => ({
    activeWorkspace: {
      defaultTeamRoster: [],
      defaultWorkingRoot: '/workspace/demo',
      id: 'workspace-1',
      name: '团队工作区',
    },
    error: null,
    loading: false,
    refresh: vi.fn(),
    workspaces: [
      {
        defaultWorkingRoot: '/workspace/demo',
        id: 'workspace-1',
        name: '团队工作区',
      },
    ],
  }),
}));

vi.mock('../hooks/use-team-workspace-snapshot-state.js', () => ({
  useTeamWorkspaceSnapshotState: () => ({
    error: null,
    loading: false,
    refresh: vi.fn(),
    snapshot: {
      sessions: [],
      sharedSessions: [],
      runtimeTaskGroups: [],
    },
  }),
}));

vi.mock('../runtime/shell/controls/ConversationArea.js', () => ({
  ConversationArea: () => <div data-testid="conversation-area" />,
}));

vi.mock('../conversation/TeamConversationView.js', () => ({
  TeamConversationView: () => <div data-testid="team-conversation-view" />,
}));

vi.mock('../runtime/shell/header/TeamStatusBar.js', () => ({
  TeamStatusBar: () => <div data-testid="team-status-bar" />,
}));

vi.mock('../runtime/shell/controls/PauseResumeControls.js', () => ({
  PauseConfirmDialog: () => null,
  ResumeStaleDialog: () => null,
}));

vi.mock('../runtime/shell/session-view/LayerConversationDrawer.js', () => ({
  LayerConversationDrawer: () => null,
}));

vi.mock('../runtime/shell/sidebar/TeamSidebarWithFileTree.js', () => ({
  TeamSidebarWithFileTree: () => <div data-testid="team-sidebar" />,
}));

vi.mock('../runtime/shell/modals/NewTeamWorkspaceModal.js', () => ({
  NewTeamWorkspaceModal: () => null,
}));

vi.mock('../runtime/shell/modals/ConfirmDeleteWorkspaceModal.js', () => ({
  ConfirmDeleteWorkspaceModal: () => null,
}));

vi.mock('../runtime/tabs/MiddleTabRouter.js', () => ({
  renderMiddleTabContent: () => <div data-testid="middle-tab-content" />,
}));

vi.mock('../runtime/tabs/team-runtime-navigation.js', () => ({
  extractTeamRuntimeHandoffContextFromEvent: () => null,
}));

vi.mock('../runtime/tabs/team-page-v2-tabs.js', () => ({
  LEAF_TO_PRIMARY: new Map([['conversation', 'conversation']]),
  MIDDLE_TAB_KEYS: new Set(['conversation']),
  getDefaultLeafFor: () => 'conversation',
}));

vi.mock('../runtime/shell/header/TeamTabBar.js', () => ({
  TeamTabBar: () => <div data-testid="team-tab-bar" />,
}));

vi.mock('../runtime/hooks/use-team-page-state.js', () => ({
  useBreakpoint: () => 'desktop',
  useTeamPageMode: () => 'running',
}));

vi.mock('../../../stores/team/team-events.js', () => ({
  connectTeamEvents: vi.fn(),
  disconnectTeamEvents: vi.fn(),
  getTeamNotificationEventKey: (event: { id?: string; timestamp?: number }) =>
    event.id ?? String(event.timestamp ?? 0),
  useClarificationStore: (selector: (state: { pendingCount: number }) => unknown) =>
    selector({ pendingCount: 0 }),
  useHandoffStore: (
    selector: (state: { handoffs: Map<string, Record<string, unknown>> }) => unknown,
  ) => selector({ handoffs: new Map() }),
  useLayerStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {};
    return typeof selector === 'function' ? selector(state) : state;
  },
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

vi.mock('../runtime/tabs/office/OfficeThreeCanvas.js', () => ({
  OfficeThreeCanvas: () => <div data-testid="office-canvas" />,
}));

vi.mock('../runtime/tabs/office/OfficeScene.js', () => ({
  useOfficeSceneState: () => ({}),
}));

vi.mock('@openAwork/web-client', () => ({
  createTeamClient: () => ({
    pauseAllRuntimeSessions: vi.fn(async () => ({})),
    resumeAllRuntimeSessions: vi.fn(async () => ({})),
  }),
  createTeamHandoffsClient: () => ({
    cancelHandoff: vi.fn(async () => ({ ok: true })),
  }),
}));

vi.mock('./team-page-v2-runtime-controls.js', () => ({
  countRuntimeTreeHandoffs: () => ({ activeCount: 0, staleCount: 0 }),
  resolveEffectiveTeamPageMode: (_mode: string, paused: boolean) => (paused ? 'paused' : 'running'),
}));

vi.mock('../runtime/data/team-runtime-session-scope.js', () => ({
  collectSessionScope: () => null,
  countUnreadNotificationEventsInScope: () => 0,
  isHandoffInSessionScope: () => false,
}));

vi.mock('../../../hooks/editor/useFileEditor.js', () => ({
  useFileEditor: () => ({
    openFile: vi.fn(async () => undefined),
    saveFile: vi.fn(async () => undefined),
  }),
}));

vi.mock('../../../components/file-editor/WorkspaceEditorOverlay.js', () => ({
  WorkspaceEditorOverlay: () => null,
}));

vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: vi.fn(),
}));

vi.mock('../../../utils/session/session-list-events.js', () => ({
  requestSessionListRefresh: vi.fn(),
}));

vi.mock('./team-page-v2-panels.js', () => ({
  IdleHint: () => <div data-testid="idle-hint" />,
  TeamFocusHandoffBanner: () => null,
  TeamPageSuperbarLeading: () => <div data-testid="superbar-leading" />,
  TeamPageSuperbarSummary: () => <div data-testid="superbar-summary" />,
  TeamSharedConversationPanel: () => <div data-testid="shared-conversation-panel" />,
}));

vi.mock('../runtime/data/team-runtime-shared-context.js', () => ({
  resolveMatchedSharedSessionDetail: () => null,
}));

import TeamPageV2 from './TeamPageV2.js';

describe('TeamPageV2 multi-attach wiring', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    testState.accessToken = 'token-test';
    testState.gatewayUrl = 'https://gateway.test';
  });

  afterEach(() => {
    cleanup();
  });

  it('渲染时会启动 team 多路流式 attach', () => {
    render(<TeamPageV2 />);

    expect(testState.useMultiSessionAttach).toHaveBeenCalledWith({
      token: 'token-test',
      gatewayUrl: 'https://gateway.test',
      enabled: true,
    });
  });

  it('未登录时仍会传 disabled 配置，避免误连流式通道', () => {
    testState.accessToken = null;

    render(<TeamPageV2 />);

    expect(testState.useMultiSessionAttach).toHaveBeenCalledWith({
      token: null,
      gatewayUrl: 'https://gateway.test',
      enabled: false,
    });
  });
});
