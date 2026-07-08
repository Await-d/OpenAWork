import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import type { Session } from '../../hooks/workspace/useSessions.js';
import type {
  TeamSidebarSession,
  TeamWorkspaceGroup,
} from '../../hooks/workspace/useTeamSidebarSessions.js';
import type {
  WorkspaceSessionGroup,
  WorkspaceSessionTreeGroup,
} from '../../utils/session/session-grouping.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { FusionSidebar } from './FusionSidebar.js';

export const OPENAWORK_PATH = '/home/await/project/OpenAWork';
export const MARKET_PATH = '/home/await/project/MarketAgent';

const fusionSidebarMocks = vi.hoisted(() => ({
  createWorkspaceClient: vi.fn(() => ({})),
  preloadRouteModuleByPath: vi.fn(),
  useSessions: vi.fn(),
  useTeamSidebarSessions: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: fusionSidebarMocks.createWorkspaceClient,
}));

vi.mock('../../hooks/workspace/useSessions.js', () => ({
  useSessions: fusionSidebarMocks.useSessions,
}));

vi.mock('../../hooks/workspace/useTeamSidebarSessions.js', () => ({
  useTeamSidebarSessions: fusionSidebarMocks.useTeamSidebarSessions,
}));

vi.mock('../../routes/preloadable-route-modules.js', () => ({
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

function createSessionsResult() {
  return {
    collapsedGroups: new Set<string>(),
    commitRename: vi.fn(async () => undefined),
    exportSessionAsJson: vi.fn(async () => undefined),
    exportSessionAsMarkdown: vi.fn(async () => undefined),
    groupedSessionTrees: chatTreeGroups,
    groupedSessions: chatGroups,
    hoveredSessionId: null,
    isDeletingSession: vi.fn(() => false),
    newSession: vi.fn(async () => undefined),
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

function createTeamSidebarSessionsResult() {
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
    activeTeamSessionId: null,
    chatView: 'session',
    fileTreeRootPath: OPENAWORK_PATH,
    leftSidebarOpen,
    savedWorkspacePaths: [OPENAWORK_PATH, MARKET_PATH],
    selectedWorkspacePath: OPENAWORK_PATH,
    teamNewSessionSignal: null,
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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

export function renderFusionSidebar(initialPath = '/chat/open-session'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <FusionSidebar accessToken={null} gatewayUrl="http://localhost:3000" />
      <LocationProbe />
    </MemoryRouter>,
  );
}
