import { AGENT_TEAMS_EVENT_CONFIG } from './team-runtime-ui-config.js';
import type { TeamRuntimeReferenceViewData } from './team-runtime-reference-types.js';

function buildEmptyActivityStats(): Record<string, number> {
  const stats: Record<string, number> = {};

  for (const type of Object.keys(AGENT_TEAMS_EVENT_CONFIG)) {
    stats[type] = 0;
  }

  return stats;
}

function ignoreSelectedSharedSession(): void {
  return undefined;
}

function ignoreSelectedTeam(): void {
  return undefined;
}

async function returnFalse(): Promise<boolean> {
  return false;
}

async function returnNull(): Promise<null> {
  return null;
}

async function returnEmptyArray<T>(): Promise<T[]> {
  return [];
}

export const EMPTY_VIEW_DATA: TeamRuntimeReferenceViewData = {
  activeMode: 'empty',
  activityStats: buildEmptyActivityStats(),
  busy: false,
  canCreateSession: false,
  canCreateTemplate: false,
  canManageRuntime: false,
  canManageSessionEntries: false,
  conversationCards: [],
  sessions: [],
  createSession: returnNull,
  createTemplate: returnFalse,
  duplicateTemplate: returnFalse,
  updateTemplate: returnFalse,
  removeTemplate: returnFalse,
  createWorkspace: returnNull,
  createSessionShare: returnFalse,
  renameWorkspace: returnFalse,
  renameSession: returnFalse,
  deleteWorkspace: returnFalse,
  defaultSelectedAgentId: 'leader',
  defaultSelectedTeamId: '',
  defaultReceptionSessionId: '',
  error: null,
  feedback: null,
  footerLead: '活跃 0 / 共 0',
  footerStats: [],
  loading: false,
  messageCards: [],
  metricCards: [],
  officeAgents: [],
  overviewCards: [],
  reviewCards: [],
  reviewBusy: false,
  roleChips: [],
  runningTeams: [],
  sidebarSections: [],
  templateCount: 0,
  templateError: null,
  templateLoading: false,
  refreshTemplates: returnEmptyArray,
  templates: [],
  taskLanes: [
    { id: 'todo', title: '待办', cards: [] },
    { id: 'doing', title: '进行中', cards: [] },
    { id: 'review', title: '待评审', cards: [] },
  ],
  timelineEvents: [],
  topSummary: {
    description: '当前还没有可展示的 Team Runtime 数据。',
    memberCount: '0 成员',
    onlineCount: '0 在线',
    status: '等待接入',
    title: '团队工作空间',
  },
  workspaceGroups: [],
  workspaces: [],
  historyTeams: [],
  auditLogs: [],
  sessionShares: [],
  sharedSessions: [],
  selectedSharedSession: null,
  activeSharedSession: null,
  sharedSessionLoading: false,
  setSelectedSharedSessionId: ignoreSelectedSharedSession,
  members: [],
  diagnostics: undefined,
  createTask: returnFalse,
  acknowledgeRuntimeAlert: returnFalse,
  clearRuntimeAlertControl: returnFalse,
  suppressRuntimeAlert: returnFalse,
  runRuntimeAlertRemediation: returnFalse,
  reconcileStaleDecisions: returnFalse,
  reconcileStaleRuntimeThreads: returnFalse,
  moveTask: returnFalse,
  replyReview: returnFalse,
  selectTeam: ignoreSelectedTeam,
  sendMessage: returnFalse,
  submitReviewComment: returnFalse,
  createSharedSessionComment: returnFalse,
  toggleSessionState: returnFalse,
  deleteSession: returnFalse,
  updateSessionShare: returnFalse,
  deleteSessionShare: returnFalse,
};
