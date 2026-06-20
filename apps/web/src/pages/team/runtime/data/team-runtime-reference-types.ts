import type {
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  TeamAuditLogRecord,
  TeamMemberRecord,
  TeamMessageRecord,
  TeamRuntimeAlertControlRecord,
  TeamRuntimeDiagnostics,
  TeamRuntimeSessionRecord,
  TeamSessionShareRecord,
  TeamTaskRecord,
  TeamWorkspaceDetail,
  TeamWorkspaceSnapshot,
  TeamWorkspaceSummary,
  UpdateWorkflowTemplateInput,
  WorkflowTemplateRecord,
} from '@openAwork/web-client';
import type { TeamActionFeedback } from '../../hooks/use-team-collaboration.js';
import type { TeamSessionCreationDraft } from './team-session-creation.types.js';
import type {
  AgentTeamsConversationCard,
  AgentTeamsFooterStat,
  AgentTeamsMessageCard,
  AgentTeamsMetricCard,
  AgentTeamsOfficeAgent,
  AgentTeamsOverviewCard,
  AgentTeamsReviewCard,
  AgentTeamsRoleChip,
  AgentTeamsSidebarSection,
  AgentTeamsSidebarTeam,
  AgentTeamsTaskLane,
  AgentTeamsTimelineEvent,
  AgentTeamsWorkspaceGroup,
  AgentTeamsWorkflowTemplateCard,
} from './team-runtime-types.js';

export interface TaskDraftInput {
  priority: TeamTaskRecord['priority'];
  status: TeamTaskRecord['status'];
  title: string;
}

export interface TeamRuntimeReferenceViewData {
  activeMode: 'live' | 'empty';
  activityStats: Record<string, number>;
  busy: boolean;
  canCreateSession: boolean;
  canCreateTemplate: boolean;
  canManageRuntime: boolean;
  canManageSessionEntries: boolean;
  conversationCards: AgentTeamsConversationCard[];
  createSession: (draft: TeamSessionCreationDraft) => Promise<string | null>;
  createTemplate: (input: {
    defaultBindings?: Record<
      string,
      { agentId: string; providerId?: string; modelId?: string; variant?: string }
    >;
    description?: string;
    name: string;
    optionalAgentIds?: string[];
    provider: string;
    templateExtra?: {
      templateScale?: import('@openAwork/web-client').WorkflowTemplateScale | null;
      templateFocus?: string | null;
      recommendedFor?: string | null;
      recommendedDefault?: boolean | null;
    };
  }) => Promise<boolean>;
  duplicateTemplate: (template: WorkflowTemplateRecord) => Promise<boolean>;
  updateTemplate: (templateId: string, input: UpdateWorkflowTemplateInput) => Promise<boolean>;
  removeTemplate: (templateId: string) => Promise<boolean>;
  createWorkspace: (input: {
    name: string;
    description?: string;
    defaultWorkingRoot?: string;
  }) => Promise<string | null>;
  createSessionShare: (input: {
    memberId: string;
    permission?: TeamSessionShareRecord['permission'];
    sessionId: string;
  }) => Promise<boolean>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<boolean>;
  renameSession: (sessionId: string, title: string) => Promise<boolean>;
  deleteWorkspace: (workspaceId: string) => Promise<boolean>;
  defaultSelectedAgentId: string;
  defaultSelectedTeamId: string;
  /**
   * 默认 reception/b session id（当前工作区中第一个无 parentSessionId 的根会话）。
   * 用于 ConversationArea 在没有显式选中 session 时回落到此 session 的 chat 渲染。
   * 若工作区暂无任何 session，则为空串。
   */
  defaultReceptionSessionId: string;
  error: string | null;
  feedback: TeamActionFeedback | null;
  footerLead: string;
  footerStats: AgentTeamsFooterStat[];
  loading: boolean;
  messageCards: AgentTeamsMessageCard[];
  metricCards: AgentTeamsMetricCard[];
  officeAgents: AgentTeamsOfficeAgent[];
  overviewCards: AgentTeamsOverviewCard[];
  reviewCards: AgentTeamsReviewCard[];
  reviewBusy: boolean;
  roleChips: AgentTeamsRoleChip[];
  runningTeams: AgentTeamsSidebarTeam[];
  sidebarSections: AgentTeamsSidebarSection[];
  templateCount: number;
  templateError: string | null;
  templateLoading: boolean;
  refreshTemplates: () => Promise<WorkflowTemplateRecord[]>;
  taskLanes: AgentTeamsTaskLane[];
  timelineEvents: AgentTeamsTimelineEvent[];
  topSummary: {
    description: string;
    memberCount: string;
    onlineCount: string;
    status: string;
    title: string;
  };
  workspaceGroups: AgentTeamsWorkspaceGroup[];
  workspaces: TeamWorkspaceSummary[];
  historyTeams: AgentTeamsSidebarTeam[];
  auditLogs: TeamAuditLogRecord[];
  sessionShares: TeamSessionShareRecord[];
  sessions: TeamRuntimeSessionRecord[];
  sharedSessions: SharedSessionSummaryRecord[];
  selectedSharedSession: SharedSessionDetailRecord | null;
  activeSharedSession: SharedSessionDetailRecord | null;
  sharedSessionLoading: boolean;
  setSelectedSharedSessionId: (sessionId: string | null) => void;
  members: TeamMemberRecord[];
  diagnostics: TeamRuntimeDiagnostics | undefined;
  acknowledgeRuntimeAlert: (
    alertCode: TeamRuntimeAlertControlRecord['alertCode'],
    note?: string,
    options?: { sessionId?: string },
  ) => Promise<boolean>;
  clearRuntimeAlertControl: (
    alertCode: TeamRuntimeAlertControlRecord['alertCode'],
    options?: { sessionId?: string },
  ) => Promise<boolean>;
  suppressRuntimeAlert: (
    alertCode: TeamRuntimeAlertControlRecord['alertCode'],
    input?: { minutes?: number; note?: string; sessionId?: string },
  ) => Promise<boolean>;
  runRuntimeAlertRemediation: (
    alertCode: TeamRuntimeAlertControlRecord['alertCode'],
    options?: { force?: boolean; handoffId?: string; sessionId?: string },
  ) => Promise<boolean>;
  reconcileStaleDecisions: () => Promise<boolean>;
  reconcileStaleRuntimeThreads: () => Promise<boolean>;
  createTask: (input: TaskDraftInput) => Promise<boolean>;
  moveTask: (taskId: string, direction: 'left' | 'right') => Promise<boolean>;
  replyReview: (cardId: string, status: AgentTeamsReviewCard['status']) => Promise<boolean>;
  submitReviewComment: (cardId: string, content: string) => Promise<boolean>;
  createSharedSessionComment: (content: string) => Promise<boolean>;
  selectTeam: (teamId: string) => void;
  sendMessage: (input: {
    content: string;
    recipientMemberId?: string | null;
    replyToMessageId?: string | null;
    sessionId?: string | null;
    type?: TeamMessageRecord['type'];
  }) => Promise<boolean>;
  toggleSessionState: (sessionId: string, currentStatus: string) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  updateSessionShare: (
    shareId: string,
    input: { permission: TeamSessionShareRecord['permission'] },
  ) => Promise<boolean>;
  deleteSessionShare: (shareId: string) => Promise<boolean>;
  templates: AgentTeamsWorkflowTemplateCard[];
}

export interface TeamRuntimeReferenceDataOptions {
  activeWorkspace?: TeamWorkspaceDetail | null;
  collaborationEnabled?: boolean;
  teamWorkspaceId?: string | null;
  activeWorkspaceSnapshot?: TeamWorkspaceSnapshot | null;
  selectedTeamId?: string | null;
  workspaceSnapshotError?: string | null;
  workspaceSnapshotLoading?: boolean;
  workspaceError?: string | null;
  workspaceLoading?: boolean;
  workspaces?: TeamWorkspaceSummary[];
  onWorkspacesChanged?: () => void;
}
