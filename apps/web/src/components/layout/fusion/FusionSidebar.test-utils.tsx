import { render } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import type { Session } from '../../../hooks/workspace/useSessions.js';
import type {
  TeamSidebarSession,
  TeamWorkspaceGroup,
  UseTeamSidebarSessionsResult,
} from '../../../hooks/workspace/useTeamSidebarSessions.js';
import type {
  WorkspaceSessionGroup,
  WorkspaceSessionTreeGroup,
} from '../../../utils/session/session-grouping.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { FusionSidebar } from './FusionSidebar.js';

export const OPENAWORK_PATH = '/home/await/project/OpenAWork';
export const MARKET_PATH = '/home/await/project/MarketAgent';

interface FusionSidebarSessionsResult {
  readonly collapsedGroups: Set<string>;
  readonly commitRename: (sessionId: string) => Promise<void>;
  readonly exportSessionAsJson: (sessionId: string) => Promise<void>;
  readonly exportSessionAsMarkdown: (sessionId: string) => Promise<void>;
  readonly fetchSessions: () => Promise<void>;
  readonly groupedSessionTrees: WorkspaceSessionTreeGroup<Session>[];
  readonly groupedSessions: WorkspaceSessionGroup<Session>[];
  readonly sessionTreeGroups: WorkspaceSessionTreeGroup<Session>[];
  readonly hoveredSessionId: string | null;
  readonly isDeletingSession: (sessionId: string) => boolean;
  readonly isLoadingSessions: boolean;
  readonly sessionsError: string | null;
  readonly newSession: (
    workspacePath?: string | null,
    parentSessionId?: string | null,
  ) => Promise<void>;
  readonly quickDeleteSession: (sessionId: string) => Promise<boolean>;
  readonly quickExportSession: (sessionId: string) => Promise<void>;
  readonly renameValue: string;
  readonly renamingSessionId: string | null;
  readonly sessionCountByWorkspace: Map<string, number>;
  readonly sessionSearch: string;
  readonly sessions: Session[];
  readonly setHoveredSessionId: (sessionId: string | null) => void;
  readonly setRenameValue: (value: string) => void;
  readonly setSessionSearch: (value: string) => void;
  readonly startRename: (session: Session) => void;
  readonly toggleGroupCollapsed: (key: string) => void;
}

interface FusionSidebarMocks {
  readonly createWorkspaceClient: Mock<() => Record<string, unknown>>;
  /** SSH 客户端：头部选择器的 SSH 来源要用它拉连接列表 / 建连/ 绑远端目录。 */
  readonly createSshClient: Mock<() => Record<string, never>>;
  readonly createSessionsClient: Mock<() => Record<string, never>>;
  readonly preloadRouteModuleByPath: Mock<() => void>;
  readonly useSessions: Mock<() => FusionSidebarSessionsResult>;
  readonly useTeamSidebarSessions: Mock<() => UseTeamSidebarSessionsResult>;
}

/** 与 OPENAWORK_PATH 同值的字面量：vi.hoisted 不能引用模块级常量。 */
const MOCK_WORKSPACE_ROOT = '/home/await/project/OpenAWork';

const fusionSidebarMocks = vi.hoisted((): FusionSidebarMocks => ({
  // 工作区选择弹窗打开即拉根目录与目录树；返回空对象会让弹窗一直停在 busy，
  // 「使用 SSH 远端目录」等按钮被禁用，集成测试就点不动了。
  createWorkspaceClient: vi.fn<() => Record<string, unknown>>(() => ({
    listRootsResult: async () => ({ ok: true, roots: [MOCK_WORKSPACE_ROOT] }),
    fetchTreeResult: async () => ({ ok: true, nodes: [] }),
    createDirectory: async () => undefined,
    validatePath: async () => ({ valid: true, path: MOCK_WORKSPACE_ROOT }),
  })),
  createSshClient: vi.fn<() => Record<string, never>>(() => ({})),
  createSessionsClient: vi.fn<() => Record<string, never>>(() => ({})),
  preloadRouteModuleByPath: vi.fn<() => void>(),
  useSessions: vi.fn<() => FusionSidebarSessionsResult>(),
  useTeamSidebarSessions: vi.fn<() => UseTeamSidebarSessionsResult>(),
}));

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: fusionSidebarMocks.createWorkspaceClient,
  createSshClient: fusionSidebarMocks.createSshClient,
  createSessionsClient: fusionSidebarMocks.createSessionsClient,
}));

vi.mock('../../../hooks/workspace/useSessions.js', () => ({
  useSessions: fusionSidebarMocks.useSessions,
}));

vi.mock('../../../hooks/workspace/useTeamSidebarSessions.js', () => ({
  useTeamSidebarSessions: fusionSidebarMocks.useTeamSidebarSessions,
}));

vi.mock('../../../routes/preloadable-route-modules.js', () => ({
  preloadRouteModuleByPath: fusionSidebarMocks.preloadRouteModuleByPath,
}));

function createSession(id: string, title: string, workspacePath: string): Session {
  return {
    id,
    metadata_json: JSON.stringify({ workingDirectory: workspacePath }),
    state_status: 'idle',
    title,
    updated_at: '2026-07-07T08:00:00.000Z',
  };
}

const openAWorkSession = createSession('open-session', 'OpenAWork plan', OPENAWORK_PATH);
const marketSession = createSession('market-session', 'Market roadmap', MARKET_PATH);

const openAWorkGroup: WorkspaceSessionGroup<Session> = {
  sessions: [openAWorkSession],
  workspaceLabel: 'OpenAWork',
  workspacePath: OPENAWORK_PATH,
};

const marketGroup: WorkspaceSessionGroup<Session> = {
  sessions: [marketSession],
  workspaceLabel: 'MarketAgent',
  workspacePath: MARKET_PATH,
};

const chatGroups: WorkspaceSessionGroup<Session>[] = [openAWorkGroup, marketGroup];

const chatTreeGroups: WorkspaceSessionTreeGroup<Session>[] = [
  {
    roots: [{ children: [], session: openAWorkSession }],
    sessions: [openAWorkSession],
    workspaceLabel: 'OpenAWork',
    workspacePath: OPENAWORK_PATH,
  },
  {
    roots: [{ children: [], session: marketSession }],
    sessions: [marketSession],
    workspaceLabel: 'MarketAgent',
    workspacePath: MARKET_PATH,
  },
];

const teamSession: TeamSidebarSession = {
  id: 'team-session-1',
  stateStatus: 'running',
  teamWorkspaceId: 'workspace-alpha',
  title: 'Alpha kickoff',
  updatedAt: '2026-07-07T08:00:00.000Z',
  workspacePath: OPENAWORK_PATH,
};

const teamGroups: TeamWorkspaceGroup[] = [
  {
    id: 'workspace-alpha',
    label: 'Alpha Team',
    sessions: [teamSession],
  },
];

function createSessionsResult(): FusionSidebarSessionsResult {
  return {
    collapsedGroups: new Set<string>(),
    commitRename: vi.fn(async () => undefined),
    exportSessionAsJson: vi.fn(async () => undefined),
    exportSessionAsMarkdown: vi.fn(async () => undefined),
    fetchSessions: vi.fn(async () => undefined),
    groupedSessionTrees: chatTreeGroups,
    groupedSessions: chatGroups,
    sessionTreeGroups: chatTreeGroups,
    hoveredSessionId: null,
    isDeletingSession: vi.fn(() => false),
    isLoadingSessions: false,
    sessionsError: null,
    // 模拟真实 newSession 的 store 落点（草稿 + 工作区 + 回首页），
    // 路由跳转由 useSessions 自身负责，集成测试只断言调用与 store 效果。
    newSession: vi.fn(async (workspacePath?: string | null) => {
      useUIStateStore.getState().openDraftSession(workspacePath ?? null);
    }),
    quickDeleteSession: vi.fn(async () => true),
    quickExportSession: vi.fn(async () => undefined),
    renameValue: '',
    renamingSessionId: null,
    sessionCountByWorkspace: new Map([
      [OPENAWORK_PATH, 1],
      [MARKET_PATH, 1],
    ]),
    sessionSearch: '',
    sessions: [openAWorkSession, marketSession],
    setHoveredSessionId: vi.fn(),
    setRenameValue: vi.fn(),
    setSessionSearch: vi.fn(),
    startRename: vi.fn(),
    toggleGroupCollapsed: vi.fn(),
  };
}

function createTeamSidebarSessionsResult(): UseTeamSidebarSessionsResult {
  return {
    error: null,
    loading: false,
    refresh: vi.fn(),
    sessions: [teamSession],
    workspaceGroups: teamGroups,
    workspaces: [],
  };
}

export function resetFusionSidebarUiState(leftSidebarOpen: boolean): void {
  useUIStateStore.setState({
    activeSessionWorkspace: null,
    activeTeamSessionId: null,
    chatView: 'session',
    fileTreeRootPath: OPENAWORK_PATH,
    leftSidebarOpen,
    savedWorkspacePaths: [OPENAWORK_PATH, MARKET_PATH],
    selectedWorkspacePath: OPENAWORK_PATH,
    teamNewSessionSignal: null,
    teamNewWorkspaceSignal: null,
    teamSelectSessionSignal: null,
  });
}

export function prepareFusionSidebarMocks(leftSidebarOpen: boolean): void {
  vi.clearAllMocks();
  fusionSidebarMocks.useSessions.mockImplementation(createSessionsResult);
  fusionSidebarMocks.useTeamSidebarSessions.mockImplementation(createTeamSidebarSessionsResult);
  resetFusionSidebarUiState(leftSidebarOpen);
}

export function getFusionSidebarMocks(): typeof fusionSidebarMocks {
  return fusionSidebarMocks;
}

export function setFusionSidebarChatGroups(
  groupedSessions: WorkspaceSessionGroup<Session>[],
  groupedSessionTrees: WorkspaceSessionTreeGroup<Session>[],
  overrides: Partial<FusionSidebarSessionsResult> = {},
): FusionSidebarSessionsResult {
  const result = createSessionsResult();
  fusionSidebarMocks.useSessions.mockReturnValue({
    ...result,
    groupedSessions,
    groupedSessionTrees,
    sessionTreeGroups: groupedSessionTrees,
    ...overrides,
  });
  return result;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

export function renderFusionSidebar(
  initialPath = '/chat/open-session',
  accessToken: string | null = null,
): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <FusionSidebar accessToken={accessToken} gatewayUrl="http://localhost:3000" />
      <LocationProbe />
    </MemoryRouter>,
  );
}
