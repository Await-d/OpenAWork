import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  UpdateWorkflowTemplateInput,
  WorkflowTemplateRecord,
  SessionTask,
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  TeamAuditLogRecord,
  TeamRuntimeAlertControlRecord,
  TeamRuntimeDiagnostics,
  TeamMemberRecord,
  TeamMessageRecord,
  TeamRuntimeSessionRecord,
  TeamSessionShareRecord,
  TeamTaskRecord,
  TeamWorkspaceDetail,
  TeamWorkspaceSnapshot,
  TeamWorkspaceSummary,
} from '@openAwork/web-client';
import { createTeamClient } from '@openAwork/web-client';
import { categorizeAlwaysPatterns } from '@openAwork/shared-ui';
import type { CreateTeamSessionInput } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useTeamCollaboration } from '../../hooks/use-team-collaboration.js';
import type { TeamActionFeedback } from '../../hooks/use-team-collaboration.js';
import { getSharedSessionStateLabel } from './team-runtime-model.js';
import { AGENT_TEAMS_EVENT_CONFIG } from './team-runtime-ui-config.js';
import {
  type AgentTeamsConversationCard,
  type AgentTeamsFooterStat,
  type AgentTeamsMessageCard,
  type AgentTeamsMetricCard,
  type AgentTeamsOfficeAgent,
  type AgentTeamsOverviewCard,
  type AgentTeamsReviewCard,
  type AgentTeamsRoleChip,
  type AgentTeamsSidebarSection,
  type AgentTeamsSidebarTeam,
  type AgentTeamsWorkflowTemplateCard,
  type AgentTeamsTaskLane,
  type AgentTeamsTimelineEvent,
  type AgentTeamsTimelineEventType,
  type AgentTeamsWorkspaceGroup,
} from './team-runtime-types.js';
import {
  collectRuntimeTasksForSession,
  mapRuntimeTasksToTeamTaskRecords,
  mapTaskToLaneId,
  resolveTaskRecordsForView,
  sortTeamTaskRecords,
} from './team-runtime-task-lanes.js';
import { collectSessionScope } from './team-runtime-session-scope.js';
import { scopeTeamRuntimeOverviewData } from './team-runtime-overview-scope.js';
import {
  resolveActiveSharedSession,
  resolveSelectedSharedSummary,
} from './team-runtime-shared-context.js';
import { resolveSelectedRuntimeScopeSessionId } from './team-runtime-selection-context.js';
import {
  buildFooterLead,
  buildFooterStats,
  buildMetricCards,
} from './team-runtime-summary-metrics.js';
import {
  resolveTopSummaryAudience,
  resolveTopSummaryDescription,
  resolveTopSummaryStatus,
  resolveTopSummaryTitle,
} from './team-runtime-top-summary.js';
import { useTeamRuntimeProjection } from '../hooks/use-team-runtime-projection.js';
import { useTeamRuntimeRoleBindings } from '../hooks/use-team-runtime-role-bindings.js';
import { useTeamWorkflowTemplates } from '../hooks/use-team-workflow-templates.js';
import { useHandoffStore } from '../../../../stores/team/team-events.js';
import type { TeamSessionCreationDraft } from './team-session-creation.types.js';

interface TaskDraftInput {
  priority: TeamTaskRecord['priority'];
  status: TeamTaskRecord['status'];
  title: string;
}

export interface TeamRuntimeReferenceViewData {
  activeMode: 'live' | 'mock';
  activityStats: Record<string, number>;
  busy: boolean;
  canCreateSession: boolean;
  canCreateTemplate: boolean;
  canManageRuntime: boolean;
  canManageSessionEntries: boolean;
  conversationCards: AgentTeamsConversationCard[];
  createSession: (draft: TeamSessionCreationDraft) => Promise<boolean>;
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
  /** 协作审计日志（共享 / 评论 / 权限变更等）。 */
  auditLogs: TeamAuditLogRecord[];
  /** 当前工作区已共享出去的会话。 */
  sessionShares: TeamSessionShareRecord[];
  /** 当前运行时会话快照。 */
  sessions: TeamRuntimeSessionRecord[];
  /** 别人共享给我的会话摘要；优先暴露 workspace snapshot 中已同步的共享列表。 */
  sharedSessions: SharedSessionSummaryRecord[];
  /** 当前选中的共享会话详情。 */
  selectedSharedSession: SharedSessionDetailRecord | null;
  /** 当前选中的 team 若本身是共享会话，则这里返回对应详情；否则为 null。 */
  activeSharedSession: SharedSessionDetailRecord | null;
  sharedSessionLoading: boolean;
  /** 选中某条共享会话，驱动共享详情 / presence / 评论等区域切换。 */
  setSelectedSharedSessionId: (sessionId: string | null) => void;
  /** 当前工作区成员列表。 */
  members: TeamMemberRecord[];
  /** Team runtime 健康诊断。 */
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

interface TeamRuntimeReferenceDataOptions {
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

const TeamRuntimeReferenceDataContext = createContext<TeamRuntimeReferenceViewData | null>(null);

const ROLE_SLOT_CONFIG = [
  {
    accent: 'var(--warning)',
    badge: '团',
    fallbackLabel: '团队负责人',
    fallbackProvider: 'Planner',
    id: 'leader',
    leader: true,
  },
  {
    accent: 'var(--accent)',
    badge: '研',
    fallbackLabel: '研究员A',
    fallbackProvider: 'Researcher',
    id: 'researcher-a',
    leader: false,
  },
  {
    accent: 'var(--complement)',
    badge: '执',
    fallbackLabel: '执行者',
    fallbackProvider: 'Executor',
    id: 'researcher-b',
    leader: false,
  },
  {
    accent: 'var(--danger)',
    badge: '审',
    fallbackLabel: '批评者',
    fallbackProvider: 'Reviewer',
    id: 'critic',
    leader: false,
  },
] as const;

const OFFICE_AGENT_POSITIONS = [
  { x: 73, y: 59 },
  { x: 80, y: 63 },
  { x: 85, y: 66 },
  { x: 76, y: 69 },
] as const;

function mapOfficeStatusFromRole(role: 'planner' | 'researcher' | 'executor' | 'reviewer') {
  switch (role) {
    case 'planner':
      return 'discussing' as const;
    case 'researcher':
    case 'executor':
      return 'working' as const;
    case 'reviewer':
      return 'resting' as const;
  }
}

function resolveOfficeRole(
  role: string | null | undefined,
  index: number,
): 'planner' | 'researcher' | 'executor' | 'reviewer' {
  if (role === 'planner' || role === 'researcher' || role === 'executor' || role === 'reviewer') {
    return role;
  }

  return index === 0
    ? 'planner'
    : index === 1
      ? 'researcher'
      : index === 2
        ? 'executor'
        : 'reviewer';
}

function buildEmptyActivityStats(): Record<string, number> {
  const stats: Record<string, number> = {};

  for (const type of Object.keys(AGENT_TEAMS_EVENT_CONFIG)) {
    stats[type] = 0;
  }

  return stats;
}

const EMPTY_VIEW_DATA: TeamRuntimeReferenceViewData = {
  activeMode: 'mock',
  activityStats: buildEmptyActivityStats(),
  busy: false,
  canCreateSession: false,
  canCreateTemplate: false,
  canManageRuntime: false,
  canManageSessionEntries: false,
  conversationCards: [],
  sessions: [],
  async createSession() {
    return false;
  },
  async createTemplate() {
    return false;
  },
  async duplicateTemplate() {
    return false;
  },
  async updateTemplate() {
    return false;
  },
  async removeTemplate() {
    return false;
  },
  async createWorkspace() {
    return null;
  },
  async createSessionShare() {
    return false;
  },
  async renameWorkspace() {
    return false;
  },
  async renameSession() {
    return false;
  },
  async deleteWorkspace() {
    return false;
  },
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
  setSelectedSharedSessionId() {},
  members: [],
  diagnostics: undefined,
  async createTask() {
    return false;
  },
  async acknowledgeRuntimeAlert() {
    return false;
  },
  async clearRuntimeAlertControl() {
    return false;
  },
  async suppressRuntimeAlert() {
    return false;
  },
  async runRuntimeAlertRemediation() {
    return false;
  },
  async reconcileStaleDecisions() {
    return false;
  },
  async reconcileStaleRuntimeThreads() {
    return false;
  },
  async moveTask() {
    return false;
  },
  async replyReview() {
    return false;
  },
  selectTeam() {},
  async sendMessage() {
    return false;
  },
  async submitReviewComment() {
    return false;
  },
  async createSharedSessionComment() {
    return false;
  },
  async toggleSessionState() {
    return false;
  },
  async deleteSession() {
    return false;
  },
  async updateSessionShare() {
    return false;
  },
  async deleteSessionShare() {
    return false;
  },
};

function formatWorkspaceLabel(workspacePath: string | null): string {
  if (!workspacePath) {
    return '未绑定工作区';
  }

  const segments = workspacePath.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? workspacePath;
}

function formatClock(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  if (Number.isNaN(delta) || delta < 0) {
    return '刚刚';
  }
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function formatRuntimeDuration(values: number[]): string {
  if (values.length === 0) {
    return '0m 00s';
  }

  const startedAt = Math.min(...values);
  const delta = Math.max(0, Date.now() - startedAt);
  const totalMinutes = Math.floor(delta / 60_000);
  const seconds = Math.floor(delta / 1000) % 60;
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`;
}

function mapMemberStatusLabel(status: string | undefined): string {
  if (status === 'working') {
    return '工作中';
  }
  if (status === 'done') {
    return '已完成';
  }
  if (status === 'error') {
    return '异常';
  }
  return '空闲';
}

function isRuntimeSessionPaused(stateStatus: string | undefined, paused?: boolean): boolean {
  if (paused === true) {
    return true;
  }
  return stateStatus === 'paused' || stateStatus === 'idle';
}

function isSharedSessionPaused(stateStatus: string | undefined): boolean {
  return stateStatus === 'paused' || stateStatus === 'idle';
}

function mapSidebarStatus(
  stateStatus: string | undefined,
  paused?: boolean,
): AgentTeamsSidebarTeam['status'] {
  if (isRuntimeSessionPaused(stateStatus, paused)) {
    return 'paused';
  }
  if (stateStatus === 'running') {
    return 'running';
  }
  return 'completed';
}

function mapMessageCardType(type: TeamMessageRecord['type']): AgentTeamsMessageCard['type'] {
  return type;
}

function mapConversationType(type: TeamMessageRecord['type']): AgentTeamsConversationCard['type'] {
  if (type === 'question') {
    return 'question';
  }
  if (type === 'result') {
    return 'result';
  }
  if (type === 'error') {
    return 'direct';
  }
  return 'broadcast';
}

function mapTimelineEventTypeFromMessage(
  type: TeamMessageRecord['type'],
): AgentTeamsTimelineEventType {
  if (type === 'question') {
    return 'user_input';
  }
  if (type === 'error') {
    return 'error';
  }
  if (type === 'result') {
    return 'task_complete';
  }
  return 'assistant_message';
}

function mapTimelineEventTypeFromAudit(
  action: TeamAuditLogRecord['action'],
): AgentTeamsTimelineEventType {
  if (action === 'capability_violation') {
    return 'error';
  }
  if (action === 'shared_comment_created') {
    return 'assistant_message';
  }
  if (action === 'shared_question_replied') {
    return 'user_input';
  }
  if (action === 'shared_permission_replied') {
    return 'waiting_confirmation';
  }
  if (action === 'share_created') {
    return 'session_start';
  }
  if (action === 'share_deleted') {
    return 'write';
  }
  return 'tool_use';
}

function mapTimelineEventTypeFromRuntimeTask(
  status: SessionTask['status'],
): AgentTeamsTimelineEventType {
  if (status === 'completed') {
    return 'task_complete';
  }
  if (status === 'failed') {
    return 'error';
  }
  if (status === 'running') {
    return 'thinking';
  }
  return 'waiting_confirmation';
}

function buildTaskUpdateStatus(
  currentStatus: TeamTaskRecord['status'],
  direction: 'left' | 'right',
): 'pending' | 'in_progress' | 'done' | 'failed' | null {
  if (currentStatus === 'pending') {
    return direction === 'right' ? 'in_progress' : null;
  }
  if (currentStatus === 'in_progress') {
    return direction === 'left' ? 'pending' : 'done';
  }
  if (currentStatus === 'completed' || currentStatus === 'failed') {
    return direction === 'left' ? 'in_progress' : null;
  }
  return null;
}

export function TeamRuntimeReferenceDataProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: TeamRuntimeReferenceViewData;
}) {
  return (
    <TeamRuntimeReferenceDataContext value={value}>{children}</TeamRuntimeReferenceDataContext>
  );
}

export function useTeamRuntimeReferenceViewData(): TeamRuntimeReferenceViewData {
  return useContext(TeamRuntimeReferenceDataContext) ?? EMPTY_VIEW_DATA;
}

export function useResolvedTeamRuntimeReferenceData(
  options: TeamRuntimeReferenceDataOptions = {},
): TeamRuntimeReferenceViewData {
  const activeWorkspace = options.activeWorkspace ?? null;
  const activeWorkspaceSnapshot = options.activeWorkspaceSnapshot ?? null;
  const selectedTeamId = options.selectedTeamId ?? null;
  const workspaceSnapshotError = options.workspaceSnapshotError ?? null;
  const workspaceSnapshotLoading = options.workspaceSnapshotLoading ?? false;
  const workspaceError = options.workspaceError ?? null;
  const workspaceLoading = options.workspaceLoading ?? false;
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const teamClient = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);
  const collaboration = useTeamCollaboration(options.teamWorkspaceId ?? undefined, {
    autoSelectSharedSession: false,
    enabled: options.collaborationEnabled ?? true,
  });
  const roleBindings = useTeamRuntimeRoleBindings();
  const workflowTemplates = useTeamWorkflowTemplates();
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [localFeedback, setLocalFeedback] = useState<TeamActionFeedback | null>(null);
  // 新建 session 后立刻记住 id，让 defaultReceptionSessionId 能在 refresh 完成前就指向它
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const snapshotSharedSessions = activeWorkspaceSnapshot?.sharedSessions ?? [];
  const snapshotSessions = activeWorkspaceSnapshot?.sessions ?? [];
  const effectiveSessions = snapshotSessions.length > 0 ? snapshotSessions : collaboration.sessions;
  const effectiveSharedSessions =
    snapshotSharedSessions.length > 0 ? snapshotSharedSessions : collaboration.sharedSessions;

  useEffect(() => {
    if (!localFeedback || typeof window === 'undefined') {
      return;
    }
    const timer = window.setTimeout(() => {
      setLocalFeedback(null);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [localFeedback]);

  // 真实执行流的 handoff（reception→pm1→pm2→executor…）。概览的"团队活动"指标
  // 必须基于它 + runtimeTasks + sessions，而不是 V1 的 team_messages/team_tasks
  // 手动协作表——后者在团队自动执行时根本不写入，导致概览长期显示 0（用了却统计不到）。
  const handoffsMap = useHandoffStore((state) => state.handoffs);

  const selectedSharedSummary = useMemo(
    () =>
      resolveSelectedSharedSummary({
        selectedTeamId,
        snapshotSharedSessions,
        sharedSessions: collaboration.sharedSessions,
        selectedSharedSessionShare: collaboration.selectedSharedSession?.share ?? null,
        selectedSharedSessionId: collaboration.selectedSharedSessionId,
      }),
    [
      selectedTeamId,
      snapshotSharedSessions,
      collaboration.sharedSessions,
      collaboration.selectedSharedSession?.share,
      collaboration.selectedSharedSessionId,
    ],
  );

  const activeSharedSession = useMemo(
    () =>
      resolveActiveSharedSession({
        selectedTeamId,
        selectedSharedSession: collaboration.selectedSharedSession,
      }),
    [collaboration.selectedSharedSession, selectedTeamId],
  );

  const selectedRuntimeSession = useMemo(() => {
    return (
      (selectedTeamId != null
        ? effectiveSessions.find((session) => session.id === selectedTeamId)
        : null) ?? null
    );
  }, [effectiveSessions, selectedTeamId]);
  const selectedRuntimeScopeSessionId = useMemo(
    () =>
      resolveSelectedRuntimeScopeSessionId({
        selectedTeamId,
        sessions: effectiveSessions,
      }),
    [effectiveSessions, selectedTeamId],
  );

  const projection = useTeamRuntimeProjection({
    autoSelectSharedSession: false,
    auditLogs: collaboration.auditLogs,
    interactionRewriteArtifact: null,
    members: collaboration.members,
    messages: collaboration.messages,
    onSelectSharedSession: collaboration.setSelectedSharedSessionId,
    selectedSharedSession: activeSharedSession,
    selectedSharedSessionId: collaboration.selectedSharedSessionId,
    runtimeTaskGroups: collaboration.runtimeTaskGroups,
    sessionShares: collaboration.sessionShares,
    sessions: effectiveSessions,
    sharedSessions: effectiveSharedSessions,
    tasks: collaboration.tasks,
  });

  const hasAuth = Boolean(accessToken && gatewayUrl);

  const selectTeam = useCallback(
    (teamId: string) => {
      const isSharedSession = effectiveSharedSessions.some(
        (session) => session.sessionId === teamId,
      );
      const isSession = effectiveSessions.some((session) => session.id === teamId);
      if (!isSharedSession && !isSession) {
        return;
      }
      collaboration.setSelectedSharedSessionId(isSharedSession ? teamId : null);
    },
    [collaboration.setSelectedSharedSessionId, effectiveSessions, effectiveSharedSessions],
  );

  const sendMessage = useCallback(
    async (input: {
      content: string;
      recipientMemberId?: string | null;
      replyToMessageId?: string | null;
      type?: TeamMessageRecord['type'];
    }) => {
      const content = input.content.trim();
      if (!content) {
        return false;
      }

      return collaboration.createMessage({
        content,
        recipientMemberId: input.recipientMemberId ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
        senderId: collaboration.members[0]?.id,
        type: input.type ?? 'update',
      });
    },
    [collaboration.createMessage, collaboration.members],
  );

  const createSession = useCallback(
    async (draft: TeamSessionCreationDraft) => {
      const targetWorkspace =
        options.workspaces?.find((ws) => ws.id === draft.teamWorkspaceId) ??
        activeWorkspace ??
        options.workspaces?.[0] ??
        null;
      if (!accessToken || !targetWorkspace) {
        setLocalFeedback({
          message: '当前工作区不可用，无法创建团队会话',
          tone: 'error',
        });
        return false;
      }

      // 把前端 draft 完整转成后端 createTeamSessionSchema 期望的 payload。
      // 注意：draft.source.kind 仅有 'blank' | 'saved-template'（向导未暴露
      // 'builtin-template'），后端 schema 兼容这两种。
      const payload: CreateTeamSessionInput = {
        ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
        source: { kind: draft.source.kind },
        memberSlots: draft.memberSlots,
        optionalAgentIds: draft.optionalAgentIds,
        defaultProvider: draft.defaultProvider,
        workingDirectory: draft.workingDirectory,
      };
      if (draft.source.kind === 'saved-template' && draft.source.templateId) {
        payload.source = {
          kind: 'saved-template',
          templateId: draft.source.templateId,
        };
      }

      setSessionActionBusy(true);
      try {
        const session = await teamClient.createSession(accessToken, targetWorkspace.id, payload);
        if (!session.id) {
          setLocalFeedback({
            message: '创建团队会话失败，请稍后重试',
            tone: 'error',
          });
          return false;
        }
        // 立刻把新建的 session 注入到 collaboration.sessions 中，
        // 避免等 refresh 完成前 defaultReceptionSessionId 为空导致对话区空白。
        // refresh 完成后会用完整数据覆盖这条临时记录。
        setCreatedSessionId(session.id);
        const refreshed = await collaboration.refresh();
        setLocalFeedback({
          message: refreshed
            ? '已创建团队会话'
            : '已创建团队会话，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '创建团队会话失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, activeWorkspace, collaboration, options.workspaces, teamClient],
  );

  const createWorkspace = useCallback(
    async (input: { name: string; description?: string; defaultWorkingRoot?: string }) => {
      if (!accessToken) {
        setLocalFeedback({
          message: '当前未连接到网关，无法创建工作区',
          tone: 'error',
        });
        return null;
      }

      setSessionActionBusy(true);
      try {
        const created = await teamClient.createWorkspace(accessToken, {
          name: input.name,
          description: input.description ?? null,
          defaultWorkingRoot: input.defaultWorkingRoot ?? null,
        });
        const refreshed = await collaboration.refresh();
        options.onWorkspacesChanged?.();
        setLocalFeedback({
          message: refreshed
            ? '已创建工作区'
            : '已创建工作区，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return created.id;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '创建工作区失败',
          tone: 'error',
        });
        return null;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, options.onWorkspacesChanged, teamClient],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      if (!accessToken || !workspaceId || !name.trim()) {
        return false;
      }
      setSessionActionBusy(true);
      try {
        await teamClient.updateWorkspace(accessToken, workspaceId, { name: name.trim() });
        const refreshed = await collaboration.refresh();
        options.onWorkspacesChanged?.();
        setLocalFeedback({
          message: refreshed
            ? '已重命名工作区'
            : '已重命名工作区，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '重命名工作区失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, options.onWorkspacesChanged, teamClient],
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!accessToken || !workspaceId) {
        setLocalFeedback({
          message: '当前工作区不可用，无法删除',
          tone: 'error',
        });
        return false;
      }
      setSessionActionBusy(true);
      try {
        await teamClient.deleteWorkspace(accessToken, workspaceId);
        const refreshed = await collaboration.refresh();
        options.onWorkspacesChanged?.();
        setLocalFeedback({
          message: refreshed
            ? '已删除工作区'
            : '已删除工作区，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '删除工作区失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, options.onWorkspacesChanged, teamClient],
  );

  const createTask = useCallback(
    async (input: TaskDraftInput) => {
      if (!input.title.trim()) {
        return false;
      }

      return collaboration.createTask({
        assigneeId: collaboration.members[0]?.id,
        priority: input.priority,
        status:
          input.status === 'completed'
            ? 'done'
            : input.status === 'in_progress'
              ? 'in_progress'
              : 'pending',
        title: input.title.trim(),
      });
    },
    [collaboration.createTask, collaboration.members],
  );

  const acknowledgeRuntimeAlert = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      note?: string,
      callOptions?: { sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      setSessionActionBusy(true);
      try {
        const result = await teamClient.acknowledgeRuntimeAlert(accessToken, alertCode, {
          ...(note ? { note } : {}),
          ...(callOptions?.sessionId ? { sessionId: callOptions.sessionId } : {}),
          ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
        });
        const refreshed = await collaboration.refresh();
        if (!refreshed && result.runtime?.diagnostics) {
          collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
        }
        setLocalFeedback({
          message: refreshed
            ? '已确认当前告警'
            : '已确认当前告警，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '确认告警失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, teamClient],
  );

  const clearRuntimeAlertControl = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      callOptions?: { sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      setSessionActionBusy(true);
      try {
        const result = await teamClient.clearRuntimeAlertControl(accessToken, alertCode, {
          ...(callOptions?.sessionId ? { sessionId: callOptions.sessionId } : {}),
          ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
        });
        const refreshed = await collaboration.refresh();
        if (!refreshed && result.runtime?.diagnostics) {
          collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
        }
        setLocalFeedback({
          message: refreshed
            ? '已清除告警控制'
            : '已清除告警控制，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '清除告警控制失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, teamClient],
  );

  const suppressRuntimeAlert = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      input?: { minutes?: number; note?: string; sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      setSessionActionBusy(true);
      try {
        const result = await teamClient.suppressRuntimeAlert(accessToken, alertCode, {
          ...input,
          ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
        });
        const refreshed = await collaboration.refresh();
        if (!refreshed && result.runtime?.diagnostics) {
          collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
        }
        setLocalFeedback({
          message: refreshed
            ? '已静音当前告警'
            : '已静音当前告警，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '静音告警失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, teamClient],
  );

  const reconcileStaleRuntimeThreads = useCallback(async () => {
    if (!accessToken) {
      return false;
    }
    setSessionActionBusy(true);
    try {
      const result = await teamClient.reconcileStaleRuntimeThreads(accessToken, {
        ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
      });
      const refreshed = await collaboration.refresh();
      if (!refreshed && result.runtime?.diagnostics) {
        collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
      }
      setLocalFeedback({
        message: refreshed
          ? '已发起线程修复'
          : '已发起线程修复，但最新运行时快照暂未刷新，系统会自动重试。',
        tone: 'success',
      });
      return true;
    } catch (reason) {
      setLocalFeedback({
        message: reason instanceof Error ? reason.message : '线程修复失败',
        tone: 'error',
      });
      return false;
    } finally {
      setSessionActionBusy(false);
    }
  }, [accessToken, collaboration, options.teamWorkspaceId, teamClient]);

  const reconcileStaleDecisions = useCallback(async () => {
    if (!accessToken) {
      return false;
    }
    setSessionActionBusy(true);
    try {
      const result = await teamClient.reconcileStaleDecisions(accessToken, {
        ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
      });
      const refreshed = await collaboration.refresh();
      if (!refreshed && result.runtime?.diagnostics) {
        collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
      }
      setLocalFeedback({
        message: refreshed
          ? '已释放超时交互'
          : '已释放超时交互，但最新运行时快照暂未刷新，系统会自动重试。',
        tone: 'success',
      });
      return true;
    } catch (reason) {
      setLocalFeedback({
        message: reason instanceof Error ? reason.message : '释放超时交互失败',
        tone: 'error',
      });
      return false;
    } finally {
      setSessionActionBusy(false);
    }
  }, [accessToken, collaboration, options.teamWorkspaceId, teamClient]);

  const runRuntimeAlertRemediation = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      remediationOptions?: { force?: boolean; handoffId?: string; sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      setSessionActionBusy(true);
      try {
        const result = await teamClient.runRuntimeAlertRemediation(accessToken, alertCode, {
          ...(remediationOptions?.force ? { force: remediationOptions.force } : {}),
          ...(remediationOptions?.handoffId ? { handoffId: remediationOptions.handoffId } : {}),
          ...(remediationOptions?.sessionId ? { sessionId: remediationOptions.sessionId } : {}),
          ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
        });
        const refreshed = await collaboration.refresh();
        if (!refreshed && result.runtime?.diagnostics) {
          collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
        }
        setLocalFeedback({
          message: refreshed
            ? '已触发运行修复'
            : '已触发运行修复，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '运行修复失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, options.teamWorkspaceId, teamClient],
  );

  const moveTask = useCallback(
    async (taskId: string, direction: 'left' | 'right') => {
      const currentTask = collaboration.tasks.find((task) => task.id === taskId);
      if (!currentTask) {
        return false;
      }

      const nextStatus = buildTaskUpdateStatus(currentTask.status, direction);
      if (!nextStatus) {
        return false;
      }

      return collaboration.updateTask(taskId, { status: nextStatus });
    },
    [collaboration.tasks, collaboration.updateTask],
  );

  const replyReview = useCallback(
    async (cardId: string, status: AgentTeamsReviewCard['status']) => {
      const sessionId = activeSharedSession?.share.sessionId;
      if (!sessionId || (status !== 'approved' && status !== 'rejected')) {
        return false;
      }

      const permissionRequest = activeSharedSession?.pendingPermissions.find(
        (request) => `permission-${request.requestId}` === cardId,
      );
      if (permissionRequest) {
        const scopeLevel = categorizeAlwaysPatterns(
          permissionRequest.previewAction,
          permissionRequest.scope,
          permissionRequest.always,
        ).at(-1);
        return collaboration.replySharedSessionPermission(sessionId, {
          ...(status === 'approved' && scopeLevel ? { alwaysOverride: [scopeLevel.pattern] } : {}),
          decision: status === 'approved' ? 'session' : 'reject',
          requestId: permissionRequest.requestId,
        });
      }

      const questionRequest = activeSharedSession?.pendingQuestions.find(
        (request) => `question-${request.requestId}` === cardId,
      );
      if (questionRequest) {
        return collaboration.replySharedQuestion(sessionId, {
          answers: status === 'approved' ? [['已在 Team 页面完成处理。']] : undefined,
          requestId: questionRequest.requestId,
          status: status === 'approved' ? 'answered' : 'dismissed',
        });
      }

      return false;
    },
    [
      activeSharedSession,
      collaboration.replySharedSessionPermission,
      collaboration.replySharedQuestion,
    ],
  );

  const submitReviewComment = useCallback(
    async (cardId: string, content: string) => {
      const sessionId = activeSharedSession?.share.sessionId;
      const trimmed = content.trim();
      if (!sessionId || !trimmed) {
        return false;
      }
      return collaboration.createSharedSessionComment(sessionId, {
        content: `[${cardId}] ${trimmed}`,
      });
    },
    [activeSharedSession, collaboration.createSharedSessionComment],
  );

  const createSharedSessionComment = useCallback(
    async (content: string) => {
      const sessionId = activeSharedSession?.share.sessionId;
      const trimmed = content.trim();
      if (!sessionId || !trimmed) {
        return false;
      }
      return collaboration.createSharedSessionComment(sessionId, {
        content: trimmed,
      });
    },
    [activeSharedSession, collaboration.createSharedSessionComment],
  );

  // --- Split memos: shared intermediates ---
  const roleChips = useMemo(
    () =>
      ROLE_SLOT_CONFIG.map((slot, index) => {
        const member = collaboration.members[index] ?? null;
        const binding = roleBindings.roleCards[index] ?? null;
        const boundAgent = binding?.selectedAgent ?? null;
        return {
          accent: slot.accent,
          badge:
            boundAgent?.label.slice(0, 1).toUpperCase() ??
            member?.name.slice(0, 1).toUpperCase() ??
            slot.badge,
          id: boundAgent?.id ?? member?.id ?? slot.id,
          leader: slot.leader || binding?.role === 'planner',
          provider:
            boundAgent?.label ?? boundAgent?.id ?? binding?.roleLabel ?? slot.fallbackProvider,
          role: boundAgent?.label ?? member?.name ?? slot.fallbackLabel,
          status: mapMemberStatusLabel(member?.status),
        } satisfies AgentTeamsRoleChip;
      }),
    [collaboration.members, roleBindings.roleCards],
  );

  const accentByMemberId = useMemo(() => {
    const map = new Map<string, string>();
    roleChips.forEach((chip, index) => {
      const memberId = collaboration.members[index]?.id;
      if (memberId) {
        map.set(memberId, chip.accent);
      }
    });
    return map;
  }, [collaboration.members, roleChips]);

  const memberNameById = useMemo(
    () => new Map(collaboration.members.map((member) => [member.id, member.name])),
    [collaboration.members],
  );

  const selectedSessionScope = useMemo(() => {
    return selectedRuntimeScopeSessionId
      ? collectSessionScope(selectedRuntimeScopeSessionId, effectiveSessions)
      : null;
  }, [effectiveSessions, selectedRuntimeScopeSessionId]);

  const scopedOverviewData = useMemo(
    () =>
      scopeTeamRuntimeOverviewData({
        selectedSessionId: selectedRuntimeScopeSessionId,
        handoffs: Array.from(handoffsMap.values()),
        runtimeTasks: collaboration.runtimeTasks,
        sessions: effectiveSessions,
        messages: collaboration.messages,
        auditLogs: collaboration.auditLogs,
        sharedSessions: effectiveSharedSessions,
      }),
    [
      collaboration.auditLogs,
      collaboration.messages,
      collaboration.runtimeTasks,
      effectiveSharedSessions,
      effectiveSessions,
      handoffsMap,
      selectedRuntimeScopeSessionId,
    ],
  );

  const isSelectedTeamPaused = useMemo(
    () =>
      isSharedSessionPaused(selectedSharedSummary?.stateStatus) ||
      isRuntimeSessionPaused(selectedRuntimeSession?.stateStatus, selectedRuntimeSession?.paused),
    [
      selectedRuntimeSession?.paused,
      selectedRuntimeSession?.stateStatus,
      selectedSharedSummary?.stateStatus,
    ],
  );

  // --- Split memos: workspace groups ---
  const workspaceGroups = useMemo(() => {
    if (effectiveSessions.length === 0 && effectiveSharedSessions.length === 0) {
      return [];
    }

    // 预聚合：以 sessionId 为 key 的任务统计（runtimeTasks 含 SessionTask.sessionId 字段）
    interface TaskAgg {
      total: number;
      running: number;
      completed: number;
      failed: number;
      pending: number;
      // 当前最早开始的 running 任务（用于显示「正在做：X」）
      currentTaskTitle?: string;
      currentTaskStartedAt?: number;
      // 参与的 agent 集合
      agents: Set<string>;
      // 全部任务的最早 startedAt 和最晚 completedAt（用于耗时）
      earliestStartedAt?: number;
      latestCompletedAt?: number;
    }
    const taskStats = new Map<string, TaskAgg>();
    for (const task of collaboration.runtimeTasks) {
      const sid = task.sessionId;
      if (!sid) continue;
      const cur =
        taskStats.get(sid) ??
        ({
          total: 0,
          running: 0,
          completed: 0,
          failed: 0,
          pending: 0,
          agents: new Set<string>(),
        } satisfies TaskAgg);
      cur.total += 1;
      if (task.status === 'running') {
        cur.running += 1;
        // 记录最早开始的 running 任务作为「正在做」展示
        if (
          task.startedAt != null &&
          (cur.currentTaskStartedAt == null || task.startedAt < cur.currentTaskStartedAt)
        ) {
          cur.currentTaskStartedAt = task.startedAt;
          cur.currentTaskTitle = task.title;
        } else if (cur.currentTaskTitle == null) {
          cur.currentTaskTitle = task.title;
        }
      } else if (task.status === 'completed') cur.completed += 1;
      else if (task.status === 'failed') cur.failed += 1;
      else if (task.status === 'pending') cur.pending += 1;

      if (task.assignedAgent && task.assignedAgent.length > 0) {
        cur.agents.add(task.assignedAgent);
      }
      if (task.startedAt != null) {
        if (cur.earliestStartedAt == null || task.startedAt < cur.earliestStartedAt) {
          cur.earliestStartedAt = task.startedAt;
        }
      }
      if (task.completedAt != null) {
        if (cur.latestCompletedAt == null || task.completedAt > cur.latestCompletedAt) {
          cur.latestCompletedAt = task.completedAt;
        }
      }
      taskStats.set(sid, cur);
    }

    const buildExtraFields = (sid: string) => {
      const stats = taskStats.get(sid);
      if (!stats) return {};
      const out: Partial<AgentTeamsSidebarTeam> = {
        taskTotal: stats.total,
        taskRunning: stats.running,
        taskCompleted: stats.completed,
        taskFailed: stats.failed,
        taskPending: stats.pending,
      };
      if (stats.currentTaskTitle) out.currentTaskTitle = stats.currentTaskTitle;
      if (stats.agents.size > 0) {
        out.agents = Array.from(stats.agents).sort();
      }
      // 计算耗时：仍在运行 → 从 earliestStartedAt 到现在；已结束 → 从 earliestStartedAt 到 latestCompletedAt
      if (stats.earliestStartedAt != null) {
        const endTs = stats.running > 0 ? Date.now() : (stats.latestCompletedAt ?? Date.now());
        const ms = Math.max(0, endTs - stats.earliestStartedAt);
        if (ms > 0) out.durationMs = ms;
      }
      return out;
    };

    // 反向汇总：parent → 子会话数
    const childCount = new Map<string, number>();
    for (const session of effectiveSessions) {
      if (session.parentSessionId) {
        childCount.set(session.parentSessionId, (childCount.get(session.parentSessionId) ?? 0) + 1);
      }
    }

    // 解析 metadataJson 工具
    const parseWorkingDirectory = (metadataJson: string): string | undefined => {
      if (!metadataJson) return undefined;
      try {
        const meta = JSON.parse(metadataJson) as Record<string, unknown>;
        const wd = meta['workingDirectory'];
        return typeof wd === 'string' && wd.length > 0 ? wd : undefined;
      } catch {
        return undefined;
      }
    };

    const groups = new Map<string, AgentTeamsWorkspaceGroup>();
    const seenSessionIds = new Set<string>();

    for (const session of effectiveSessions) {
      if (seenSessionIds.has(session.id)) continue;
      seenSessionIds.add(session.id);
      const key = session.workspacePath ?? '__unbound__';
      const current = groups.get(key) ?? {
        workspaceLabel: formatWorkspaceLabel(session.workspacePath),
        workspacePath: session.workspacePath,
        sessions: [],
      };
      const wd = parseWorkingDirectory(session.metadataJson ?? '');
      current.sessions.push({
        id: session.id,
        isSharedSession: false,
        status: mapSidebarStatus(session.stateStatus, session.paused),
        subtitle: getSharedSessionStateLabel(session.stateStatus),
        title: session.title ?? session.id,
        updatedAt: session.updatedAt,
        ...buildExtraFields(session.id),
        ...(childCount.has(session.id) ? { childSessionCount: childCount.get(session.id) } : {}),
        ...(wd ? { workingDirectory: wd } : {}),
        ...(session.parentSessionId ? { isDerived: true } : {}),
      });
      groups.set(key, current);
    }

    for (const sharedSession of effectiveSharedSessions) {
      if (seenSessionIds.has(sharedSession.sessionId)) continue;
      seenSessionIds.add(sharedSession.sessionId);
      const key = sharedSession.workspacePath ?? '__unbound__';
      const current = groups.get(key) ?? {
        workspaceLabel: formatWorkspaceLabel(sharedSession.workspacePath),
        workspacePath: sharedSession.workspacePath,
        sessions: [],
      };
      current.sessions.push({
        id: sharedSession.sessionId,
        isSharedSession: true,
        status: mapSidebarStatus(sharedSession.stateStatus),
        subtitle: getSharedSessionStateLabel(sharedSession.stateStatus),
        title: sharedSession.title ?? sharedSession.sessionId,
        updatedAt: sharedSession.shareUpdatedAt,
        ...buildExtraFields(sharedSession.sessionId),
        ...(childCount.has(sharedSession.sessionId)
          ? { childSessionCount: childCount.get(sharedSession.sessionId) }
          : {}),
      });
      groups.set(key, current);
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((left, right) =>
        left.title.localeCompare(right.title, 'zh-CN'),
      ),
    }));
  }, [collaboration.runtimeTasks, effectiveSessions, effectiveSharedSessions]);

  const effectiveWorkspaceGroups = useMemo(() => {
    if (!activeWorkspace?.defaultWorkingRoot) {
      return workspaceGroups;
    }
    const filteredGroups = workspaceGroups.filter(
      (group) => group.workspacePath === activeWorkspace.defaultWorkingRoot,
    );
    return filteredGroups.length > 0 ? filteredGroups : workspaceGroups;
  }, [activeWorkspace?.defaultWorkingRoot, workspaceGroups]);

  const { runningTeams, historyTeams, defaultSelectedTeamId, defaultReceptionSessionId } =
    useMemo(() => {
      const allSidebarTeams = effectiveWorkspaceGroups.flatMap((group) => group.sessions);
      const running = allSidebarTeams.filter((team) => team.status === 'running');
      const history = allSidebarTeams.filter((team) => team.status !== 'running');
      const preferredWorkspacePath = activeWorkspace?.defaultWorkingRoot ?? null;
      const defaultId =
        effectiveSessions.find(
          (session) =>
            preferredWorkspacePath != null && session.workspacePath === preferredWorkspacePath,
        )?.id ??
        effectiveSharedSessions.find(
          (session) =>
            session.sessionId === collaboration.selectedSharedSessionId &&
            (preferredWorkspacePath == null || session.workspacePath === preferredWorkspacePath),
        )?.sessionId ??
        effectiveSharedSessions.find(
          (session) =>
            preferredWorkspacePath != null && session.workspacePath === preferredWorkspacePath,
        )?.sessionId ??
        collaboration.selectedSharedSessionId ??
        running[0]?.id ??
        history[0]?.id ??
        '';

      // defaultReceptionSessionId · Phase A
      // 选取首个「根会话」作为 reception/b session：
      //   1. 优先匹配当前 workspace 的 root sessions（parentSessionId == null）
      //   2. 没匹配上时回退到任意 root session
      //   3. 还是没有就回退到 defaultSelectedTeamId
      // 这与"每个 workspace 有且仅有一个常驻 b session"的约定对齐；
      // 即使后端暂时没有 role_layer 字段，根 session = b session 这条
      // 启发式在当前 team runtime 协议下是稳定成立的。
      const inWorkspaceRoots = effectiveSessions.filter(
        (session) =>
          session.parentSessionId == null &&
          (preferredWorkspacePath == null || session.workspacePath === preferredWorkspacePath),
      );
      const allRoots = effectiveSessions.filter((session) => session.parentSessionId == null);
      const receptionId =
        inWorkspaceRoots[0]?.id ?? allRoots[0]?.id ?? createdSessionId ?? defaultId;

      return {
        runningTeams: running,
        historyTeams: history,
        defaultSelectedTeamId: defaultId,
        defaultReceptionSessionId: receptionId,
      };
    }, [
      effectiveWorkspaceGroups,
      activeWorkspace?.defaultWorkingRoot,
      effectiveSessions,
      effectiveSharedSessions,
      collaboration.selectedSharedSessionId,
      createdSessionId,
    ]);

  // --- Split memos: metric cards ---
  // --- Split memos: task lanes ---
  const runtimeTaskGroupsSource =
    activeWorkspaceSnapshot?.runtimeTaskGroups.length != null &&
    activeWorkspaceSnapshot.runtimeTaskGroups.length > 0
      ? activeWorkspaceSnapshot.runtimeTaskGroups
      : collaboration.runtimeTaskGroups;

  const selectedRuntimeTaskRecords = useMemo(
    () =>
      resolveTaskRecordsForView({
        selectedSessionId: selectedRuntimeScopeSessionId,
        runtimeTaskGroups: runtimeTaskGroupsSource,
        teamTasks: collaboration.tasks,
        runtimeTaskRecords: collaboration.runtimeTaskRecords,
      }),
    [
      collaboration.runtimeTaskRecords,
      collaboration.tasks,
      runtimeTaskGroupsSource,
      selectedRuntimeScopeSessionId,
    ],
  );

  const taskLanes = useMemo((): AgentTeamsTaskLane[] => {
    const lanes: AgentTeamsTaskLane[] = [
      { id: 'todo', title: '待办', cards: [] },
      { id: 'doing', title: '进行中', cards: [] },
      { id: 'review', title: '待评审', cards: [] },
    ];

    for (const task of selectedRuntimeTaskRecords) {
      const assigneeName = task.assigneeId
        ? (memberNameById.get(task.assigneeId) ?? '未分配')
        : '未分配';
      const assigneeAccent =
        (task.assigneeId ? accentByMemberId.get(task.assigneeId) : undefined) ??
        ROLE_SLOT_CONFIG[1].accent;
      lanes
        .find((lane) => lane.id === mapTaskToLaneId(task.status))
        ?.cards.push({
          assignee: assigneeName,
          assigneeAccent,
          description: task.result ?? '等待进一步推进与同步。',
          id: task.id,
          mutable: collaboration.tasks.some((item) => item.id === task.id),
          priority: task.priority,
          tags:
            task.status === 'failed'
              ? ['阻塞']
              : task.status === 'completed'
                ? ['已完成']
                : task.status === 'in_progress'
                  ? ['推进中']
                  : ['待认领'],
          title: task.title,
        });
    }
    return lanes;
  }, [selectedRuntimeTaskRecords, memberNameById, accentByMemberId]);

  // --- Split memos: conversation cards ---
  const conversationCards = useMemo((): AgentTeamsConversationCard[] => {
    const items = [
      ...scopedOverviewData.messages.map((message) => {
        const name = memberNameById.get(message.memberId) ?? '团队成员';
        const title =
          message.content.length > 20 ? `${message.content.slice(0, 20)}…` : message.content;
        return {
          body: message.content,
          agentId: message.memberId,
          id: `message-${message.id}`,
          meta: `${name} · 团队消息`,
          role: name,
          roleAccent: accentByMemberId.get(message.memberId) ?? ROLE_SLOT_CONFIG[0].accent,
          timestamp: formatClock(message.timestamp),
          title,
          type: mapConversationType(message.type),
        } satisfies AgentTeamsConversationCard;
      }),
      ...scopedOverviewData.auditLogs.map((log, index) => {
        const accent =
          ROLE_SLOT_CONFIG[index % ROLE_SLOT_CONFIG.length]?.accent ?? ROLE_SLOT_CONFIG[0].accent;
        return {
          body: log.detail ?? log.summary,
          agentId: log.actorUserId ?? undefined,
          id: `audit-${log.id}`,
          meta: `${log.actorEmail ?? '系统'} · 审计轨迹`,
          role: log.actorEmail ?? '系统',
          roleAccent: accent,
          timestamp: formatClock(log.createdAt),
          title: log.summary,
          type: 'result' as const,
        } satisfies AgentTeamsConversationCard;
      }),
    ]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp, 'zh-CN'))
      .slice(0, 6);

    return items.length > 0
      ? items
      : [
          {
            body: '当前还没有团队消息，发送第一条同步消息后这里会展示真实协作轨迹。',
            agentId: undefined,
            id: 'empty-conversation',
            meta: '实时协作 · 等待启动',
            role: 'Team Runtime',
            roleAccent: ROLE_SLOT_CONFIG[0].accent,
            timestamp: '刚刚',
            title: '等待第一条协作消息',
            type: 'broadcast',
          },
        ];
  }, [scopedOverviewData.messages, scopedOverviewData.auditLogs, memberNameById, accentByMemberId]);

  // --- Split memos: message cards ---
  const messageCards = useMemo(
    (): AgentTeamsMessageCard[] =>
      scopedOverviewData.messages.length > 0
        ? [...scopedOverviewData.messages]
            .sort((left, right) => right.timestamp - left.timestamp)
            .slice(0, 8)
            .map((message) => {
              const from = memberNameById.get(message.memberId) ?? '团队成员';
              const fromAccent =
                accentByMemberId.get(message.memberId) ?? ROLE_SLOT_CONFIG[0].accent;
              return {
                from,
                fromAccent,
                id: message.id,
                ...(message.memberId ? { memberId: message.memberId } : {}),
                ...(message.recipientMemberId !== undefined
                  ? { recipientMemberId: message.recipientMemberId }
                  : {}),
                ...(message.replyToMessageId !== undefined
                  ? { replyToMessageId: message.replyToMessageId }
                  : {}),
                route:
                  message.recipientMemberId != null || message.replyToMessageId != null
                    ? 'followup'
                    : 'broadcast',
                summary: message.content,
                timestamp: formatClock(message.timestamp),
                to:
                  message.recipientMemberId != null
                    ? (memberNameById.get(message.recipientMemberId) ?? '指定成员')
                    : message.replyToMessageId != null
                      ? '当前线程'
                      : '全体成员',
                toAccent:
                  message.recipientMemberId != null
                    ? (accentByMemberId.get(message.recipientMemberId) ??
                      ROLE_SLOT_CONFIG[1]?.accent ??
                      ROLE_SLOT_CONFIG[0].accent)
                    : message.type === 'update'
                      ? ROLE_SLOT_CONFIG[2].accent
                      : (ROLE_SLOT_CONFIG[1]?.accent ?? ROLE_SLOT_CONFIG[0].accent),
                type: mapMessageCardType(message.type),
              } satisfies AgentTeamsMessageCard;
            })
        : [
            {
              from: 'Team Runtime',
              fromAccent: ROLE_SLOT_CONFIG[0].accent,
              id: 'empty-message',
              route: 'broadcast',
              summary: '当前消息总线为空，发送广播后这里会开始显示真实消息。',
              timestamp: '刚刚',
              to: '全体成员',
              toAccent: ROLE_SLOT_CONFIG[2]?.accent ?? ROLE_SLOT_CONFIG[0].accent,
              type: 'update',
            },
          ],
    [scopedOverviewData.messages, memberNameById, accentByMemberId],
  );

  // --- Split memos: review cards ---
  const reviewCards = useMemo((): AgentTeamsReviewCard[] => {
    const permissionCards =
      activeSharedSession?.pendingPermissions.map(
        (request, index) =>
          ({
            actionable: true,
            assignee: activeSharedSession?.share.sharedByEmail ?? '共享运行',
            assigneeAccent:
              ROLE_SLOT_CONFIG[index % ROLE_SLOT_CONFIG.length]?.accent ??
              ROLE_SLOT_CONFIG[0].accent,
            id: `permission-${request.requestId}`,
            priority: request.riskLevel,
            requestId: request.requestId,
            reviewKind: 'permission',
            sessionId: activeSharedSession?.share.sessionId,
            status:
              request.status === 'pending'
                ? 'pending'
                : request.status === 'approved'
                  ? 'approved'
                  : 'rejected',
            summary: `${request.reason} · 作用域 ${request.scope}`,
            title: `权限审批 · ${request.toolName}`,
            type: 'security',
          }) satisfies AgentTeamsReviewCard,
      ) ?? [];

    const questionCards =
      activeSharedSession?.pendingQuestions.map(
        (request, index) =>
          ({
            actionable: true,
            assignee: activeSharedSession?.share.sharedByEmail ?? '共享运行',
            assigneeAccent:
              ROLE_SLOT_CONFIG[(index + 1) % ROLE_SLOT_CONFIG.length]?.accent ??
              ROLE_SLOT_CONFIG[0].accent,
            id: `question-${request.requestId}`,
            priority: 'medium',
            requestId: request.requestId,
            reviewKind: 'question',
            sessionId: activeSharedSession?.share.sessionId,
            status:
              request.status === 'pending'
                ? 'pending'
                : request.status === 'answered'
                  ? 'approved'
                  : 'rejected',
            summary: request.questions[0]?.question ?? request.title,
            title: `待答复 · ${request.title}`,
            type: 'content',
          }) satisfies AgentTeamsReviewCard,
      ) ?? [];

    const auditCards = scopedOverviewData.auditLogs.slice(0, 3).map(
      (log, index) =>
        ({
          actionable: false,
          assignee: log.actorEmail ?? '系统',
          assigneeAccent:
            ROLE_SLOT_CONFIG[(index + 2) % ROLE_SLOT_CONFIG.length]?.accent ??
            ROLE_SLOT_CONFIG[0].accent,
          id: `audit-${log.id}`,
          priority: 'low',
          reviewKind: 'audit',
          status: 'approved',
          summary: log.detail ?? log.summary,
          title: log.summary,
          type: 'code',
        }) satisfies AgentTeamsReviewCard,
    );

    const cards = [...permissionCards, ...questionCards, ...auditCards].slice(0, 8);
    return cards.length > 0
      ? cards
      : [
          {
            actionable: false,
            assignee: 'Team Runtime',
            assigneeAccent: ROLE_SLOT_CONFIG[0].accent,
            id: 'review-empty',
            priority: 'low',
            status: 'approved',
            summary: '当前共享运行没有待处理的权限请求或提问，最近审计轨迹也已归档。',
            title: '暂无待审事项',
            type: 'design',
          } satisfies AgentTeamsReviewCard,
        ];
  }, [activeSharedSession, scopedOverviewData.auditLogs]);

  // --- Split memos: timeline events ---
  const timelineEvents = useMemo((): AgentTeamsTimelineEvent[] => {
    const events = [
      ...scopedOverviewData.handoffs.map(
        (handoff) =>
          ({
            agentAccent: ROLE_SLOT_CONFIG[0].accent,
            agentId: handoff.id,
            agentName: `${handoff.fromRoleLayer} → ${handoff.toRoleLayer}`,
            detail:
              handoff.summary ?? `${handoff.toRoleLayer} 层交接状态已更新为 ${handoff.state}。`,
            id: `handoff-${handoff.id}`,
            timestamp: new Date(handoff.updatedAt).toISOString(),
            type:
              handoff.state === 'completed'
                ? 'turn_complete'
                : handoff.state === 'failed' || handoff.state === 'cancelled'
                  ? 'error'
                  : handoff.state === 'running'
                    ? 'thinking'
                    : 'waiting_confirmation',
          }) satisfies AgentTeamsTimelineEvent,
      ),
      ...scopedOverviewData.runtimeTasks.map(
        (task) =>
          ({
            agentAccent:
              task.assignedAgent && accentByMemberId.get(task.assignedAgent)
                ? accentByMemberId.get(task.assignedAgent)!
                : ROLE_SLOT_CONFIG[2].accent,
            agentId: task.assignedAgent ?? task.id,
            agentName: task.assignedAgent
              ? (memberNameById.get(task.assignedAgent) ?? task.assignedAgent)
              : '运行时任务',
            detail: task.errorMessage ?? task.result ?? task.description ?? task.title,
            id: `runtime-task-${task.id}`,
            timestamp: new Date(task.updatedAt).toISOString(),
            type: mapTimelineEventTypeFromRuntimeTask(task.status),
          }) satisfies AgentTeamsTimelineEvent,
      ),
      ...scopedOverviewData.messages.map(
        (message) =>
          ({
            agentAccent: accentByMemberId.get(message.memberId) ?? ROLE_SLOT_CONFIG[0].accent,
            agentId: message.memberId,
            agentName: memberNameById.get(message.memberId) ?? '团队成员',
            detail: message.content,
            id: `message-${message.id}`,
            timestamp: new Date(message.timestamp).toISOString(),
            type: mapTimelineEventTypeFromMessage(message.type),
          }) satisfies AgentTeamsTimelineEvent,
      ),
      ...scopedOverviewData.auditLogs.map(
        (log, index) =>
          ({
            agentAccent:
              ROLE_SLOT_CONFIG[index % ROLE_SLOT_CONFIG.length]?.accent ??
              ROLE_SLOT_CONFIG[0].accent,
            agentId: log.actorUserId ?? `audit-${index}`,
            agentName: log.actorEmail ?? '系统',
            detail: log.detail ?? log.summary,
            id: `audit-${log.id}`,
            timestamp: log.createdAt,
            type: mapTimelineEventTypeFromAudit(log.action),
          }) satisfies AgentTeamsTimelineEvent,
      ),
    ]
      .sort(
        (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
      )
      .slice(0, 16);

    return events;
  }, [accentByMemberId, memberNameById, scopedOverviewData]);

  const activityStats = useMemo(() => {
    const stats = timelineEvents.reduce<Record<string, number>>((acc, event) => {
      acc[event.type] = (acc[event.type] ?? 0) + 1;
      return acc;
    }, {});

    for (const type of Object.keys(AGENT_TEAMS_EVENT_CONFIG)) {
      stats[type] = stats[type] ?? 0;
    }
    return stats;
  }, [timelineEvents]);

  // --- Split memos: office agents ---
  const officeAgents = useMemo(
    (): AgentTeamsOfficeAgent[] =>
      OFFICE_AGENT_POSITIONS.map((position, index) => {
        const chip = roleChips[index]!;
        const binding = roleBindings.roleCards[index] ?? null;
        const boundRole = binding?.role ?? null;
        const boundAgent = binding?.selectedAgent ?? null;
        const effectiveRole = resolveOfficeRole(
          boundAgent?.canonicalRole?.coreRole ?? boundRole,
          index,
        );
        const taskNote =
          index === 0
            ? `待处理 ${activeSharedSession?.pendingPermissions.length ?? 0} 个审批`
            : index === 1
              ? `推进 ${taskLanes[1]?.cards.length ?? 0} 个进行中任务`
              : `待回答 ${activeSharedSession?.pendingQuestions.length ?? 0} 个问题`;

        const extraNote =
          index === 2 && collaboration.tasks.filter((task) => task.status === 'failed').length > 0
            ? `阻塞 ${collaboration.tasks.filter((task) => task.status === 'failed').length} 项`
            : undefined;

        const agentStatus = isSelectedTeamPaused
          ? 'resting'
          : mapOfficeStatusFromRole(effectiveRole);

        return {
          accent: chip.accent,
          crown: effectiveRole === 'planner' || chip.leader,
          extraNote,
          id: boundAgent?.id ?? chip.id,
          label:
            effectiveRole === 'planner'
              ? `[L] ${boundAgent?.label ?? chip.role}`
              : (boundAgent?.label ?? chip.role),
          note: taskNote,
          status: agentStatus,
          x: position.x,
          y: position.y,
        } satisfies AgentTeamsOfficeAgent;
      }),
    [
      roleChips,
      roleBindings.roleCards,
      activeSharedSession,
      collaboration.tasks,
      taskLanes,
      isSelectedTeamPaused,
    ],
  );

  // --- Split memos: overview cards ---
  const pendingReviewCount =
    (activeSharedSession?.pendingPermissions.length ?? 0) +
    (activeSharedSession?.pendingQuestions.length ?? 0);

  // 真实执行活动聚合：来自 handoff（层间交接）+ runtimeTasks（各层 session 任务）+
  // sessions（运行状态）。这是团队"自动跑起来"后唯一真正变化的数据源；V1 的
  // team_messages/team_tasks 只有用户手动操作才写，团队执行时恒为空，所以概览
  // 不能再依赖它们来判断"团队是否在干活"。
  const runtimeActivity = useMemo(() => {
    const handoffs = scopedOverviewData.handoffs;
    const activeHandoffs = handoffs.filter(
      (h) => h.state === 'running' || h.state === 'claimed' || h.state === 'pending',
    ).length;
    const completedHandoffs = handoffs.filter((h) => h.state === 'completed').length;
    const failedHandoffs = handoffs.filter(
      (h) => h.state === 'failed' || h.state === 'cancelled',
    ).length;

    const runtimeTasks = scopedOverviewData.runtimeTasks;
    const runningTasks = runtimeTasks.filter((t) => t.status === 'running').length;
    const completedTasks = runtimeTasks.filter((t) => t.status === 'completed').length;
    const failedTasks = runtimeTasks.filter((t) => t.status === 'failed').length;

    const sessions = scopedOverviewData.sessions;
    const runningSessions = sessions.filter((s) => s.stateStatus === 'running').length;
    // 参与执行的角色层（去重）：从 handoff 的 to/from 层 + 有 roleLayer 的 session 收集。
    // 注意这是"曾参与"的层（含已完成的 handoff），用于反映团队规模/活动广度，
    // 不等于"此刻正在跑"的层。
    const participatingLayers = new Set<string>();
    for (const h of handoffs) {
      if (h.toRoleLayer) participatingLayers.add(h.toRoleLayer);
      if (h.fromRoleLayer) participatingLayers.add(h.fromRoleLayer);
    }
    for (const s of sessions) {
      if (s.roleLayer) participatingLayers.add(s.roleLayer);
    }

    // 运行时长起点：最早的 handoff/任务开始时间（毫秒）。
    const startCandidates: number[] = [];
    for (const h of handoffs) {
      const started = h.startedAt ?? h.updatedAt;
      if (Number.isFinite(started)) startCandidates.push(started);
    }
    for (const t of runtimeTasks) {
      if (t.startedAt != null && Number.isFinite(t.startedAt)) startCandidates.push(t.startedAt);
    }

    return {
      handoffTotal: handoffs.length,
      activeHandoffs,
      completedHandoffs,
      failedHandoffs,
      runtimeTaskTotal: runtimeTasks.length,
      runningTasks,
      completedTasks,
      failedTasks,
      runningSessions,
      sessionTotal: sessions.length,
      participatingLayerCount: participatingLayers.size,
      startCandidates,
    };
  }, [scopedOverviewData]);
  const sharedActiveViewerCount = useMemo(
    () => activeSharedSession?.presence.filter((entry) => entry.active).length ?? 0,
    [activeSharedSession],
  );
  const sharedCommentCount = activeSharedSession?.comments.length ?? 0;

  const overviewCards = useMemo((): AgentTeamsOverviewCard[] => {
    const runtimeStartCandidates = [
      ...scopedOverviewData.messages.map((message) => message.timestamp),
      ...scopedOverviewData.auditLogs.map((log) => new Date(log.createdAt).getTime()),
      ...(selectedSessionScope
        ? []
        : collaboration.tasks
            .map((task) => task.createdAt)
            .filter((value): value is string => Boolean(value))
            .map((value) => new Date(value).getTime())),
      ...scopedOverviewData.sharedSessions.map((session) =>
        new Date(session.shareCreatedAt).getTime(),
      ),
      // 把真实执行流的开始时间（handoff / runtimeTask）也纳入，否则团队自动跑起来
      // 但用户没手动发消息/建任务时，运行时长恒为 0。
      ...runtimeActivity.startCandidates,
    ].filter((value) => Number.isFinite(value));

    // 任务数优先用真实执行任务（runtimeTasks），回退到手动 team_tasks。
    const effectiveTaskTotal = selectedSessionScope
      ? runtimeActivity.runtimeTaskTotal || selectedRuntimeTaskRecords.length
      : runtimeActivity.runtimeTaskTotal > 0
        ? runtimeActivity.runtimeTaskTotal
        : collaboration.tasks.length || collaboration.runtimeTaskRecords.length;

    // 活跃角色：手动 team_members（V1）+ 真实执行中参与的角色层取较大值，
    // 让团队自动执行时也能反映"有几层在干活"。
    const workingMembers = collaboration.members.filter(
      (member) => member.status === 'working',
    ).length;
    const effectiveActiveRoles = Math.max(
      selectedSessionScope ? runtimeActivity.participatingLayerCount : collaboration.members.length,
      runtimeActivity.participatingLayerCount,
    );

    return [
      {
        icon: 'members',
        id: 'overview-active-members',
        label: '活跃角色',
        note: selectedSessionScope
          ? `参与层级 ${runtimeActivity.participatingLayerCount} · 子树会话 ${runtimeActivity.sessionTotal} · 运行中 ${runtimeActivity.runningSessions}`
          : `参与层级 ${runtimeActivity.participatingLayerCount} · 工作中成员 ${workingMembers} · 总成员 ${collaboration.members.length}`,
        trend: selectedSessionScope
          ? runtimeActivity.runningSessions > 0
            ? 'up'
            : 'stable'
          : runtimeActivity.runningSessions > 0 || workingMembers > 0
            ? 'up'
            : 'stable',
        value: String(effectiveActiveRoles),
      },
      {
        icon: 'tasks',
        id: 'overview-tasks',
        label: '办公室任务',
        note: `进行中 ${runtimeActivity.runningTasks} · 已完成 ${runtimeActivity.completedTasks} · 失败 ${runtimeActivity.failedTasks}`,
        trend: runtimeActivity.runningTasks > 0 ? 'up' : 'stable',
        value: String(effectiveTaskTotal),
      },
      {
        icon: 'overview',
        id: 'overview-shared-runs',
        label: '运行会话',
        note: selectedSessionScope
          ? `运行中 ${runtimeActivity.runningSessions} · 子树会话 ${runtimeActivity.sessionTotal} · 当前范围`
          : `运行中 ${runtimeActivity.runningSessions} · 共享 ${effectiveSharedSessions.length} · 总计 ${runtimeActivity.sessionTotal}`,
        trend: selectedSessionScope
          ? runtimeActivity.runningSessions > 0
            ? 'up'
            : 'stable'
          : runtimeActivity.runningSessions > 0 || effectiveSharedSessions.length > 0
            ? 'up'
            : 'stable',
        value: String(
          selectedSessionScope
            ? runtimeActivity.sessionTotal
            : runtimeActivity.sessionTotal || effectiveSharedSessions.length,
        ),
      },
      {
        icon: 'sync',
        id: 'overview-handoffs',
        label: '团队交接',
        note: `进行中 ${runtimeActivity.activeHandoffs} · 已完成 ${runtimeActivity.completedHandoffs} · 失败 ${runtimeActivity.failedHandoffs}`,
        trend: runtimeActivity.activeHandoffs > 0 ? 'up' : 'stable',
        value: String(runtimeActivity.handoffTotal),
      },
      {
        icon: 'review',
        id: 'overview-review',
        label: '评审队列',
        note: `权限 ${activeSharedSession?.pendingPermissions.length ?? 0} · 问题 ${activeSharedSession?.pendingQuestions.length ?? 0}`,
        trend: pendingReviewCount > 0 ? 'up' : 'stable',
        value: String(pendingReviewCount),
      },
      {
        icon: 'timer',
        id: 'overview-runtime',
        label: '运行时长',
        note: selectedSessionScope
          ? `${runtimeActivity.activeHandoffs} 个交接进行中 · 当前会话子树`
          : selectedSharedSummary
            ? `当前会话：${selectedSharedSummary.title ?? selectedSharedSummary.sessionId}`
            : runtimeActivity.handoffTotal > 0
              ? `${runtimeActivity.activeHandoffs} 个交接进行中`
              : '等待接入新的团队运行',
        trend: 'stable',
        value: formatRuntimeDuration(runtimeStartCandidates),
      },
    ];
  }, [
    collaboration.members,
    collaboration.tasks,
    collaboration.runtimeTaskRecords,
    activeSharedSession,
    selectedSessionScope,
    scopedOverviewData,
    runtimeActivity,
    selectedSharedSummary,
    pendingReviewCount,
    selectedRuntimeTaskRecords.length,
  ]);

  const metricCards = useMemo(
    (): AgentTeamsMetricCard[] =>
      buildMetricCards({
        scoped: Boolean(selectedSessionScope),
        sharedSelected: Boolean(selectedSharedSummary),
        membersCount: collaboration.members.length,
        teamCompletedTaskCount: collaboration.tasks.filter((task) => task.status === 'completed')
          .length,
        teamTaskCount: collaboration.tasks.length,
        teamMessageCount: collaboration.messages.length,
        selectedSessionScopeSize: selectedSessionScope?.size ?? 0,
        participatingLayerCount: runtimeActivity.participatingLayerCount,
        runtimeTaskTotal:
          runtimeActivity.runtimeTaskTotal > 0
            ? runtimeActivity.runtimeTaskTotal
            : selectedRuntimeTaskRecords.length,
        completedRuntimeTasks: runtimeActivity.completedTasks,
        failedRuntimeTasks: runtimeActivity.failedTasks,
        runningRuntimeTasks: runtimeActivity.runningTasks,
        pendingRuntimeTasks: selectedRuntimeTaskRecords.filter((task) => task.status === 'pending')
          .length,
        handoffTotal: runtimeActivity.handoffTotal,
        sharedSessionCount: effectiveSharedSessions.length,
        pendingReviewCount,
        sharedCommentCount,
        sharedViewerCount: sharedActiveViewerCount,
        sharedRunning: selectedSharedSummary?.stateStatus === 'running',
        sharedFailed: selectedSharedSummary?.stateStatus === 'failed',
      }),
    [
      collaboration.members.length,
      collaboration.messages.length,
      effectiveSharedSessions.length,
      collaboration.tasks,
      pendingReviewCount,
      runtimeActivity.completedTasks,
      runtimeActivity.failedTasks,
      runtimeActivity.handoffTotal,
      runtimeActivity.participatingLayerCount,
      runtimeActivity.runningTasks,
      runtimeActivity.runtimeTaskTotal,
      selectedRuntimeTaskRecords,
      selectedSessionScope,
      sharedActiveViewerCount,
      sharedCommentCount,
      selectedSharedSummary?.stateStatus,
      snapshotSharedSessions.length,
    ],
  );

  // --- Final assembly memo ---
  const liveValue = useMemo<TeamRuntimeReferenceViewData | null>(() => {
    if (!hasAuth) {
      return null;
    }

    const activeViewerCount = sharedActiveViewerCount;
    const workspaceOnlineCount = collaboration.members.filter(
      (member) => member.status === 'working',
    ).length;
    const topSummaryAudience = resolveTopSummaryAudience({
      sharedSelected: Boolean(selectedSharedSummary),
      sharedPresenceCount: activeSharedSession?.presence.length ?? 0,
      sharedActiveViewerCount: activeViewerCount,
      workspaceMemberCount: collaboration.members.length,
      workspaceOnlineCount,
    });
    // 运行/等待/异常计数：优先用真实执行任务(runtimeActivity)，团队自动跑起来时
    // V1 的 collaboration.tasks 恒为 0，回退到它只是为了手动建任务的兼容场景。
    const failedTaskCount =
      runtimeActivity.failedTasks ||
      collaboration.tasks.filter((task) => task.status === 'failed').length;
    const pendingTaskCount = collaboration.tasks.filter((task) => task.status === 'pending').length;
    const runningTaskCount =
      runtimeActivity.runningTasks ||
      collaboration.tasks.filter((task) => task.status === 'in_progress').length;

    return {
      activeMode: 'live',
      activityStats,
      busy: collaboration.busy || sessionActionBusy,
      canCreateSession: hasAuth && Boolean(activeWorkspace),
      canCreateTemplate: workflowTemplates.canCreateTemplate,
      canManageRuntime: hasAuth && Boolean(activeWorkspace),
      canManageSessionEntries: hasAuth && Boolean(activeWorkspace),
      conversationCards,
      createSession,
      createTemplate: workflowTemplates.createTemplate,
      duplicateTemplate: workflowTemplates.duplicateTemplate,
      createWorkspace,
      createSessionShare: collaboration.createSessionShare,
      renameWorkspace,
      renameSession: collaboration.renameSession,
      deleteWorkspace,
      createTask,
      defaultSelectedAgentId: roleChips[0]?.id ?? 'leader',
      defaultSelectedTeamId,
      defaultReceptionSessionId,
      error: workspaceError ?? workspaceSnapshotError ?? collaboration.error,
      feedback: localFeedback ?? collaboration.feedback,
      footerLead: buildFooterLead({
        activeAgentCount: projection.buddyProjection.activeAgentCount,
        totalMembers: collaboration.members.length,
        scoped: Boolean(selectedSessionScope),
        sharedSelected: Boolean(selectedSharedSummary),
        sharedCommentCount,
        sharedViewerCount: activeViewerCount,
        participatingLayerCount: runtimeActivity.participatingLayerCount,
        selectedSessionScopeSize: selectedSessionScope?.size ?? 0,
      }),
      footerStats: buildFooterStats({
        scoped: Boolean(selectedSessionScope),
        sharedSelected: Boolean(selectedSharedSummary),
        membersCount: collaboration.members.length,
        teamCompletedTaskCount: collaboration.tasks.filter((task) => task.status === 'completed')
          .length,
        teamTaskCount: collaboration.tasks.length,
        teamMessageCount: collaboration.messages.length,
        selectedSessionScopeSize: selectedSessionScope?.size ?? 0,
        participatingLayerCount: runtimeActivity.participatingLayerCount,
        runtimeTaskTotal:
          runtimeActivity.runtimeTaskTotal > 0
            ? runtimeActivity.runtimeTaskTotal
            : selectedRuntimeTaskRecords.length,
        completedRuntimeTasks: runtimeActivity.completedTasks,
        failedRuntimeTasks: runtimeActivity.failedTasks,
        runningRuntimeTasks: runningTaskCount,
        pendingRuntimeTasks: selectedSessionScope
          ? selectedRuntimeTaskRecords.filter((task) => task.status === 'pending').length
          : pendingTaskCount,
        handoffTotal: runtimeActivity.handoffTotal,
        sharedSessionCount: effectiveSharedSessions.length,
        pendingReviewCount,
        sharedCommentCount,
        sharedViewerCount: activeViewerCount,
        sharedRunning: selectedSharedSummary?.stateStatus === 'running',
        sharedFailed: selectedSharedSummary?.stateStatus === 'failed',
      }),
      historyTeams,
      loading:
        collaboration.loading ||
        roleBindings.loading ||
        workspaceLoading ||
        workspaceSnapshotLoading,
      messageCards,
      metricCards,
      moveTask,
      officeAgents,
      overviewCards,
      reviewCards,
      reviewBusy: collaboration.sharedOperateBusy || collaboration.sharedCommentBusy,
      replyReview,
      roleChips,
      runningTeams,
      selectTeam,
      sendMessage,
      sidebarSections: workflowTemplates.sections,
      submitReviewComment,
      createSharedSessionComment,
      toggleSessionState: collaboration.toggleSessionState,
      deleteSession: collaboration.deleteSession,
      updateSessionShare: collaboration.updateSessionShare,
      deleteSessionShare: collaboration.deleteSessionShare,
      templateCount: workflowTemplates.templateCount,
      templateError: workflowTemplates.error,
      templateLoading: workflowTemplates.loading,
      templates: workflowTemplates.templateCards,
      updateTemplate: workflowTemplates.updateTemplate,
      removeTemplate: workflowTemplates.removeTemplate,
      taskLanes,
      timelineEvents,
      topSummary: {
        description: resolveTopSummaryDescription({
          activeWorkspaceName: activeWorkspace?.name ?? null,
          activeWorkspaceWorkingRoot: activeWorkspace?.defaultWorkingRoot ?? null,
          selectedRuntimeSessionTitle: selectedRuntimeSession?.title ?? null,
          selectedRuntimeSessionId: selectedRuntimeSession?.id ?? null,
          selectedRuntimeSessionPaused: selectedRuntimeSession?.paused ?? null,
          selectedRuntimeSessionStateStatus: selectedRuntimeSession?.stateStatus ?? null,
          selectedSharedSessionTitle: selectedSharedSummary?.title ?? null,
          selectedSharedSessionId: selectedSharedSummary?.sessionId ?? null,
          selectedSharedSessionStateStatus: selectedSharedSummary?.stateStatus ?? null,
          selectedSharedWorkspaceLabel: selectedSharedSummary
            ? formatWorkspaceLabel(selectedSharedSummary.workspacePath)
            : null,
          workspaceOverviewLead: projection.workspaceOverviewLines[0] ?? null,
        }),
        memberCount: topSummaryAudience.memberCount,
        onlineCount: topSummaryAudience.onlineCount,
        status: resolveTopSummaryStatus({
          hasPausedRuntimeSessions: effectiveSessions.some((session) =>
            isRuntimeSessionPaused(session.stateStatus, session.paused),
          ),
          selectedRuntimeSessionPaused: selectedRuntimeSession?.paused ?? null,
          selectedRuntimeSessionStateStatus: selectedRuntimeSession?.stateStatus ?? null,
          selectedSharedSessionStateStatus: selectedSharedSummary?.stateStatus ?? null,
        }),
        title: resolveTopSummaryTitle({
          activeWorkspaceName: activeWorkspace?.name ?? null,
          selectedRuntimeSessionTitle: selectedRuntimeSession?.title ?? null,
          selectedRuntimeSessionId: selectedRuntimeSession?.id ?? null,
          selectedSharedSessionTitle: selectedSharedSummary?.title ?? null,
          selectedSharedSessionId: selectedSharedSummary?.sessionId ?? null,
        }),
      },
      workspaceGroups: effectiveWorkspaceGroups,
      workspaces: options.workspaces ?? [],
      auditLogs: collaboration.auditLogs,
      sessions: effectiveSessions,
      sessionShares: collaboration.sessionShares,
      sharedSessions: effectiveSharedSessions,
      selectedSharedSession: collaboration.selectedSharedSession,
      activeSharedSession,
      sharedSessionLoading: collaboration.sharedSessionLoading,
      setSelectedSharedSessionId: collaboration.setSelectedSharedSessionId,
      members: collaboration.members,
      diagnostics: collaboration.diagnostics,
      acknowledgeRuntimeAlert,
      clearRuntimeAlertControl,
      suppressRuntimeAlert,
      runRuntimeAlertRemediation,
      reconcileStaleDecisions,
      reconcileStaleRuntimeThreads,
    } satisfies TeamRuntimeReferenceViewData;
  }, [
    hasAuth,
    activeSharedSession,
    sharedActiveViewerCount,
    sharedCommentCount,
    collaboration.members,
    collaboration.tasks,
    collaboration.busy,
    collaboration.error,
    collaboration.feedback,
    localFeedback,
    collaboration.loading,
    collaboration.sharedSessions,
    collaboration.sharedSessionLoading,
    collaboration.sharedOperateBusy,
    collaboration.sharedCommentBusy,
    collaboration.toggleSessionState,
    collaboration.deleteSession,
    collaboration.updateSessionShare,
    collaboration.deleteSessionShare,
    sessionActionBusy,
    activeWorkspace,
    workspaceError,
    workspaceSnapshotError,
    workspaceLoading,
    workspaceSnapshotLoading,
    roleBindings.loading,
    workflowTemplates.canCreateTemplate,
    workflowTemplates.createTemplate,
    workflowTemplates.duplicateTemplate,
    workflowTemplates.error,
    workflowTemplates.loading,
    workflowTemplates.sections,
    workflowTemplates.templateCount,
    workflowTemplates.templateCards,
    workflowTemplates.updateTemplate,
    workflowTemplates.removeTemplate,
    createSession,
    createWorkspace,
    collaboration.createSessionShare,
    renameWorkspace,
    collaboration.renameSession,
    deleteWorkspace,
    createTask,
    acknowledgeRuntimeAlert,
    clearRuntimeAlertControl,
    suppressRuntimeAlert,
    runRuntimeAlertRemediation,
    reconcileStaleDecisions,
    reconcileStaleRuntimeThreads,
    moveTask,
    replyReview,
    selectTeam,
    sendMessage,
    submitReviewComment,
    createSharedSessionComment,
    selectedSharedSummary,
    effectiveSessions,
    snapshotSharedSessions,
    projection.buddyProjection.activeAgentCount,
    projection.workspaceOverviewLines,
    pendingReviewCount,
    activityStats,
    conversationCards,
    defaultSelectedTeamId,
    defaultReceptionSessionId,
    effectiveWorkspaceGroups,
    historyTeams,
    messageCards,
    metricCards,
    officeAgents,
    overviewCards,
    reviewCards,
    roleChips,
    runningTeams,
    runtimeActivity,
    taskLanes,
    timelineEvents,
    options.workspaces,
    collaboration.diagnostics,
    collaboration.setSelectedSharedSessionId,
    collaboration.selectedSharedSession,
  ]);

  const resolvedValue = liveValue ?? EMPTY_VIEW_DATA;

  return resolvedValue;
}
