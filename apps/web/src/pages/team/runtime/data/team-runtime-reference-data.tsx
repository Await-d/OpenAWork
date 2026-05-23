import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type {
  SharedSessionSummaryRecord,
  TeamAuditLogRecord,
  TeamMemberRecord,
  TeamMessageRecord,
  TeamSessionShareRecord,
  TeamTaskRecord,
  TeamWorkspaceDetail,
  TeamWorkspaceSnapshot,
  TeamWorkspaceSummary,
} from '@openAwork/web-client';
import { createTeamClient } from '@openAwork/web-client';
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
import { useTeamRuntimeProjection } from '../hooks/use-team-runtime-projection.js';
import { useTeamRuntimeRoleBindings } from '../hooks/use-team-runtime-role-bindings.js';
import { useTeamWorkflowTemplates } from '../hooks/use-team-workflow-templates.js';
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
    name: string;
    optionalAgentIds?: string[];
    provider: string;
  }) => Promise<boolean>;
  createWorkspace: (input: {
    name: string;
    description?: string;
    defaultWorkingRoot?: string;
  }) => Promise<boolean>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<boolean>;
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
  /** 别人共享给我的会话摘要。 */
  sharedSessions: SharedSessionSummaryRecord[];
  /** 当前工作区成员列表。 */
  members: TeamMemberRecord[];
  createTask: (input: TaskDraftInput) => Promise<boolean>;
  moveTask: (taskId: string, direction: 'left' | 'right') => Promise<boolean>;
  replyReview: (cardId: string, status: AgentTeamsReviewCard['status']) => Promise<boolean>;
  submitReviewComment: (cardId: string, content: string) => Promise<boolean>;
  selectTeam: (teamId: string) => void;
  sendMessage: (input: { content: string; type?: TeamMessageRecord['type'] }) => Promise<boolean>;
  toggleSessionState: (sessionId: string, currentStatus: string) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<boolean>;
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
  async createSession() {
    return false;
  },
  async createTemplate() {
    return false;
  },
  async createWorkspace() {
    return false;
  },
  async renameWorkspace() {
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
  members: [],
  async createTask() {
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
  async toggleSessionState() {
    return false;
  },
  async deleteSession() {
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

function mapSidebarStatus(stateStatus: string | undefined): AgentTeamsSidebarTeam['status'] {
  if (stateStatus === 'running') {
    return 'running';
  }
  if (stateStatus === 'paused' || stateStatus === 'idle') {
    return 'paused';
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

function mapTaskToLaneId(status: TeamTaskRecord['status']): AgentTeamsTaskLane['id'] {
  if (status === 'in_progress') {
    return 'doing';
  }
  if (status === 'completed' || status === 'failed') {
    return 'review';
  }
  return 'todo';
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
    enabled: options.collaborationEnabled ?? true,
  });
  const roleBindings = useTeamRuntimeRoleBindings();
  const workflowTemplates = useTeamWorkflowTemplates();
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  // 新建 session 后立刻记住 id，让 defaultReceptionSessionId 能在 refresh 完成前就指向它
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);

  const projection = useTeamRuntimeProjection({
    auditLogs: collaboration.auditLogs,
    interactionRewriteArtifact: null,
    members: collaboration.members,
    messages: collaboration.messages,
    onSelectSharedSession: collaboration.setSelectedSharedSessionId,
    selectedSharedSession: collaboration.selectedSharedSession,
    selectedSharedSessionId: collaboration.selectedSharedSessionId,
    runtimeTaskGroups: collaboration.runtimeTaskGroups,
    sessionShares: collaboration.sessionShares,
    sessions: collaboration.sessions,
    sharedSessions: collaboration.sharedSessions,
    tasks: collaboration.tasks,
  });

  const hasAuth = Boolean(accessToken && gatewayUrl);

  const selectTeam = useCallback(
    (teamId: string) => {
      const isSharedSession = collaboration.sharedSessions.some(
        (session) => session.sessionId === teamId,
      );
      const isSession = collaboration.sessions.some((session) => session.id === teamId);
      if (!isSharedSession && !isSession) {
        return;
      }
      collaboration.setSelectedSharedSessionId(isSharedSession ? teamId : null);
    },
    [
      collaboration.setSelectedSharedSessionId,
      collaboration.sharedSessions,
      collaboration.sessions,
    ],
  );

  const sendMessage = useCallback(
    async (input: { content: string; type?: TeamMessageRecord['type'] }) => {
      const content = input.content.trim();
      if (!content) {
        return false;
      }

      return collaboration.createMessage({
        content,
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
          return false;
        }
        // 立刻把新建的 session 注入到 collaboration.sessions 中，
        // 避免等 refresh 完成前 defaultReceptionSessionId 为空导致对话区空白。
        // refresh 完成后会用完整数据覆盖这条临时记录。
        setCreatedSessionId(session.id);
        await collaboration.refresh();
        return true;
      } catch {
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
        return false;
      }

      setSessionActionBusy(true);
      try {
        await teamClient.createWorkspace(accessToken, {
          name: input.name,
          description: input.description ?? null,
          defaultWorkingRoot: input.defaultWorkingRoot ?? null,
        });
        await collaboration.refresh();
        options.onWorkspacesChanged?.();
        return true;
      } catch {
        return false;
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
        await collaboration.refresh();
        options.onWorkspacesChanged?.();
        return true;
      } catch {
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
        return false;
      }
      setSessionActionBusy(true);
      try {
        await teamClient.deleteWorkspace(accessToken, workspaceId);
        await collaboration.refresh();
        options.onWorkspacesChanged?.();
        return true;
      } catch {
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
      const sessionId = collaboration.selectedSharedSession?.share.sessionId;
      if (!sessionId || (status !== 'approved' && status !== 'rejected')) {
        return false;
      }

      const permissionRequest = collaboration.selectedSharedSession?.pendingPermissions.find(
        (request) => `permission-${request.requestId}` === cardId,
      );
      if (permissionRequest) {
        return collaboration.replySharedSessionPermission(sessionId, {
          decision: status === 'approved' ? 'session' : 'reject',
          requestId: permissionRequest.requestId,
        });
      }

      const questionRequest = collaboration.selectedSharedSession?.pendingQuestions.find(
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
      collaboration.replySharedSessionPermission,
      collaboration.replySharedQuestion,
      collaboration.selectedSharedSession,
    ],
  );

  const submitReviewComment = useCallback(
    async (cardId: string, content: string) => {
      const sessionId = collaboration.selectedSharedSession?.share.sessionId;
      const trimmed = content.trim();
      if (!sessionId || !trimmed) {
        return false;
      }
      return collaboration.createSharedSessionComment(sessionId, {
        content: `[${cardId}] ${trimmed}`,
      });
    },
    [collaboration.createSharedSessionComment, collaboration.selectedSharedSession],
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

  const snapshotSharedSessions = activeWorkspaceSnapshot?.sharedSessions ?? [];
  const snapshotSessions = activeWorkspaceSnapshot?.sessions ?? [];

  const selectedSharedSummary = useMemo(() => {
    return (
      (selectedTeamId != null
        ? snapshotSharedSessions.find((session) => session.sessionId === selectedTeamId)
        : null) ??
      (selectedTeamId != null
        ? collaboration.sharedSessions.find((session) => session.sessionId === selectedTeamId)
        : null) ??
      collaboration.selectedSharedSession?.share ??
      snapshotSharedSessions.find(
        (session) => session.sessionId === collaboration.selectedSharedSessionId,
      ) ??
      collaboration.sharedSessions.find(
        (session) => session.sessionId === collaboration.selectedSharedSessionId,
      ) ??
      snapshotSharedSessions[0] ??
      collaboration.sharedSessions[0] ??
      null
    );
  }, [
    selectedTeamId,
    snapshotSharedSessions,
    collaboration.sharedSessions,
    collaboration.selectedSharedSession?.share,
    collaboration.selectedSharedSessionId,
  ]);

  const selectedRuntimeSession = useMemo(() => {
    return (
      (selectedTeamId != null
        ? snapshotSessions.find((session) => session.id === selectedTeamId)
        : null) ??
      (selectedTeamId != null
        ? collaboration.sessions.find((session) => session.id === selectedTeamId)
        : null) ??
      null
    );
  }, [selectedTeamId, snapshotSessions, collaboration.sessions]);

  const isSelectedTeamPaused = useMemo(
    () =>
      selectedSharedSummary?.stateStatus === 'paused' ||
      selectedSharedSummary?.stateStatus === 'idle' ||
      selectedRuntimeSession?.stateStatus === 'paused' ||
      selectedRuntimeSession?.stateStatus === 'idle',
    [selectedSharedSummary?.stateStatus, selectedRuntimeSession?.stateStatus],
  );

  // --- Split memos: workspace groups ---
  const workspaceGroups = useMemo(() => {
    const effectiveSessions =
      snapshotSessions.length > 0 ? snapshotSessions : collaboration.sessions;
    const effectiveSharedSessions =
      snapshotSharedSessions.length > 0 ? snapshotSharedSessions : collaboration.sharedSessions;

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
        status: mapSidebarStatus(session.stateStatus),
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
  }, [
    collaboration.sessions,
    collaboration.sharedSessions,
    collaboration.runtimeTasks,
    snapshotSessions,
    snapshotSharedSessions,
  ]);

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
        snapshotSessions.find(
          (session) =>
            preferredWorkspacePath != null && session.workspacePath === preferredWorkspacePath,
        )?.id ??
        collaboration.sessions.find(
          (session) =>
            preferredWorkspacePath != null && session.workspacePath === preferredWorkspacePath,
        )?.id ??
        collaboration.sharedSessions.find(
          (session) =>
            session.sessionId === collaboration.selectedSharedSessionId &&
            (preferredWorkspacePath == null || session.workspacePath === preferredWorkspacePath),
        )?.sessionId ??
        collaboration.sharedSessions.find(
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
      const allSnapshotSessions =
        snapshotSessions.length > 0 ? snapshotSessions : collaboration.sessions;
      const inWorkspaceRoots = allSnapshotSessions.filter(
        (session) =>
          session.parentSessionId == null &&
          (preferredWorkspacePath == null || session.workspacePath === preferredWorkspacePath),
      );
      const allRoots = allSnapshotSessions.filter((session) => session.parentSessionId == null);
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
      snapshotSessions,
      collaboration.sessions,
      collaboration.sharedSessions,
      collaboration.selectedSharedSessionId,
      createdSessionId,
    ]);

  // --- Split memos: metric cards ---
  const metricCards = useMemo(
    (): AgentTeamsMetricCard[] => [
      {
        icon: 'members',
        label: '成员',
        value: String(collaboration.members.length),
      },
      {
        icon: 'tasks',
        label: '任务',
        value: `${collaboration.tasks.filter((task) => task.status === 'completed').length}/${collaboration.tasks.length}`,
      },
      {
        icon: 'conversation',
        label: '汇报',
        value: String(collaboration.messages.length),
      },
    ],
    [collaboration.members.length, collaboration.tasks, collaboration.messages.length],
  );

  // --- Split memos: task lanes ---
  const taskLanes = useMemo((): AgentTeamsTaskLane[] => {
    const taskSource =
      collaboration.tasks.length > 0 ? collaboration.tasks : collaboration.runtimeTaskRecords;
    const lanes: AgentTeamsTaskLane[] = [
      { id: 'todo', title: '待办', cards: [] },
      { id: 'doing', title: '进行中', cards: [] },
      { id: 'review', title: '待评审', cards: [] },
    ];

    for (const task of taskSource) {
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
  }, [collaboration.tasks, collaboration.runtimeTaskRecords, memberNameById, accentByMemberId]);

  // --- Split memos: conversation cards ---
  const conversationCards = useMemo((): AgentTeamsConversationCard[] => {
    const items = [
      ...collaboration.messages.map((message) => {
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
      ...collaboration.auditLogs.map((log, index) => {
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
  }, [collaboration.messages, collaboration.auditLogs, memberNameById, accentByMemberId]);

  // --- Split memos: message cards ---
  const messageCards = useMemo(
    (): AgentTeamsMessageCard[] =>
      collaboration.messages.length > 0
        ? [...collaboration.messages]
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
                route: message.type === 'question' ? 'unicast' : 'broadcast',
                summary: message.content,
                timestamp: formatClock(message.timestamp),
                to: message.type === 'question' ? '团队负责人' : '全体成员',
                toAccent:
                  message.type === 'question'
                    ? ROLE_SLOT_CONFIG[0].accent
                    : ROLE_SLOT_CONFIG[2].accent,
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
    [collaboration.messages, memberNameById, accentByMemberId],
  );

  // --- Split memos: review cards ---
  const reviewCards = useMemo((): AgentTeamsReviewCard[] => {
    const permissionCards =
      collaboration.selectedSharedSession?.pendingPermissions.map(
        (request, index) =>
          ({
            actionable: true,
            assignee: collaboration.selectedSharedSession?.share.sharedByEmail ?? '共享运行',
            assigneeAccent:
              ROLE_SLOT_CONFIG[index % ROLE_SLOT_CONFIG.length]?.accent ??
              ROLE_SLOT_CONFIG[0].accent,
            id: `permission-${request.requestId}`,
            priority: request.riskLevel,
            requestId: request.requestId,
            reviewKind: 'permission',
            sessionId: collaboration.selectedSharedSession?.share.sessionId,
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
      collaboration.selectedSharedSession?.pendingQuestions.map(
        (request, index) =>
          ({
            actionable: true,
            assignee: collaboration.selectedSharedSession?.share.sharedByEmail ?? '共享运行',
            assigneeAccent:
              ROLE_SLOT_CONFIG[(index + 1) % ROLE_SLOT_CONFIG.length]?.accent ??
              ROLE_SLOT_CONFIG[0].accent,
            id: `question-${request.requestId}`,
            priority: 'medium',
            requestId: request.requestId,
            reviewKind: 'question',
            sessionId: collaboration.selectedSharedSession?.share.sessionId,
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

    const auditCards = collaboration.auditLogs.slice(0, 3).map(
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
  }, [collaboration.selectedSharedSession, collaboration.auditLogs]);

  // --- Split memos: timeline events ---
  const timelineEvents = useMemo((): AgentTeamsTimelineEvent[] => {
    const events = [
      ...collaboration.messages.map(
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
      ...collaboration.auditLogs.map(
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
  }, [collaboration.messages, collaboration.auditLogs, accentByMemberId, memberNameById]);

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
            ? `待处理 ${collaboration.selectedSharedSession?.pendingPermissions.length ?? 0} 个审批`
            : index === 1
              ? `推进 ${taskLanes[1]?.cards.length ?? 0} 个进行中任务`
              : `待回答 ${collaboration.selectedSharedSession?.pendingQuestions.length ?? 0} 个问题`;

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
      collaboration.selectedSharedSession,
      collaboration.tasks,
      taskLanes,
      isSelectedTeamPaused,
    ],
  );

  // --- Split memos: overview cards ---
  const pendingReviewCount =
    (collaboration.selectedSharedSession?.pendingPermissions.length ?? 0) +
    (collaboration.selectedSharedSession?.pendingQuestions.length ?? 0);

  const overviewCards = useMemo((): AgentTeamsOverviewCard[] => {
    const runtimeStartCandidates = [
      ...collaboration.messages.map((message) => message.timestamp),
      ...collaboration.auditLogs.map((log) => new Date(log.createdAt).getTime()),
      ...collaboration.tasks
        .map((task) => task.createdAt)
        .filter((value): value is string => Boolean(value))
        .map((value) => new Date(value).getTime()),
      ...collaboration.sharedSessions.map((session) => new Date(session.shareCreatedAt).getTime()),
    ].filter((value) => Number.isFinite(value));

    return [
      {
        icon: 'members',
        id: 'overview-active-members',
        label: '活跃角色',
        note: `工作中 ${collaboration.members.filter((member) => member.status === 'working').length} · 总成员 ${collaboration.members.length}`,
        trend: collaboration.members.some((member) => member.status === 'working')
          ? 'up'
          : 'stable',
        value: String(collaboration.members.length),
      },
      {
        icon: 'tasks',
        id: 'overview-tasks',
        label: '办公室任务',
        note: `待办 ${taskLanes[0]?.cards.length ?? 0} · 进行中 ${taskLanes[1]?.cards.length ?? 0} · 待评审 ${taskLanes[2]?.cards.length ?? 0}`,
        trend: (taskLanes[1]?.cards.length ?? 0) > 0 ? 'up' : 'stable',
        value: String(collaboration.tasks.length || collaboration.runtimeTaskRecords.length),
      },
      {
        icon: 'overview',
        id: 'overview-shared-runs',
        label: '共享运行',
        note: selectedSharedSummary
          ? `${formatWorkspaceLabel(selectedSharedSummary.workspacePath)} · ${getSharedSessionStateLabel(selectedSharedSummary.stateStatus)}`
          : '当前暂无选中的共享运行',
        trend: collaboration.sharedSessions.length > 0 ? 'up' : 'stable',
        value: String(collaboration.sharedSessions.length),
      },
      {
        icon: 'sync',
        id: 'overview-messages',
        label: 'TeamBus 消息',
        note: `同步 ${collaboration.messages.filter((item) => item.type === 'update').length} · 提问 ${collaboration.messages.filter((item) => item.type === 'question').length}`,
        trend: collaboration.messages.length > 0 ? 'up' : 'stable',
        value: String(collaboration.messages.length),
      },
      {
        icon: 'review',
        id: 'overview-review',
        label: '评审队列',
        note: `权限 ${collaboration.selectedSharedSession?.pendingPermissions.length ?? 0} · 问题 ${collaboration.selectedSharedSession?.pendingQuestions.length ?? 0}`,
        trend: pendingReviewCount > 0 ? 'up' : 'stable',
        value: String(pendingReviewCount),
      },
      {
        icon: 'timer',
        id: 'overview-runtime',
        label: '运行时长',
        note: selectedSharedSummary
          ? `当前会话：${selectedSharedSummary.title ?? selectedSharedSummary.sessionId}`
          : '等待接入新的团队运行',
        trend: 'stable',
        value: formatRuntimeDuration(runtimeStartCandidates),
      },
    ];
  }, [
    collaboration.members,
    collaboration.tasks,
    collaboration.runtimeTaskRecords,
    collaboration.sharedSessions,
    collaboration.messages,
    collaboration.auditLogs,
    collaboration.selectedSharedSession,
    taskLanes,
    selectedSharedSummary,
    pendingReviewCount,
  ]);

  // --- Final assembly memo ---
  const liveValue = useMemo<TeamRuntimeReferenceViewData | null>(() => {
    if (!hasAuth) {
      return null;
    }

    const activeViewerCount =
      collaboration.selectedSharedSession?.presence.filter((entry) => entry.active).length ?? 0;
    const onlineCount =
      activeViewerCount ||
      collaboration.members.filter((member) => member.status === 'working').length;
    const failedTaskCount = collaboration.tasks.filter((task) => task.status === 'failed').length;
    const pendingTaskCount = collaboration.tasks.filter((task) => task.status === 'pending').length;
    const runningTaskCount = collaboration.tasks.filter(
      (task) => task.status === 'in_progress',
    ).length;

    return {
      activeMode: 'live',
      activityStats,
      busy: collaboration.busy || sessionActionBusy,
      canCreateSession: true,
      canCreateTemplate: workflowTemplates.canCreateTemplate,
      canManageRuntime: hasAuth && Boolean(activeWorkspace),
      canManageSessionEntries: hasAuth && Boolean(activeWorkspace),
      conversationCards,
      createSession,
      createTemplate: workflowTemplates.createTemplate,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      createTask,
      defaultSelectedAgentId: roleChips[0]?.id ?? 'leader',
      defaultSelectedTeamId,
      defaultReceptionSessionId,
      error: workspaceError ?? workspaceSnapshotError ?? collaboration.error,
      feedback: collaboration.feedback,
      footerLead: `活跃 ${projection.buddyProjection.activeAgentCount} / 共 ${collaboration.members.length}`,
      footerStats: [
        {
          label: '总',
          value: String(snapshotSharedSessions.length || collaboration.sharedSessions.length),
        },
        { label: '运行', value: String(runningTaskCount) },
        { label: '等待', value: String(pendingTaskCount + pendingReviewCount) },
        { label: '异常', value: String(failedTaskCount) },
      ],
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
      toggleSessionState: collaboration.toggleSessionState,
      deleteSession: collaboration.deleteSession,
      templateCount: workflowTemplates.templateCount,
      templateError: workflowTemplates.error,
      templateLoading: workflowTemplates.loading,
      templates: workflowTemplates.templateCards,
      taskLanes,
      timelineEvents,
      topSummary: {
        description:
          activeWorkspace != null
            ? `${activeWorkspace.name} · ${activeWorkspace.defaultWorkingRoot ?? '未绑定默认工作区'} · 已切换到 TeamWorkspaceSnapshot 主读链`
            : selectedSharedSummary != null
              ? `${formatWorkspaceLabel(selectedSharedSummary.workspacePath)} · ${projection.workspaceOverviewLines[0] ?? '已接入真实 Team Runtime 视图。'}`
              : '当前已切换到真实 Team Runtime 数据源，等待第一条共享运行进入。',
        memberCount: `${collaboration.members.length} 成员`,
        onlineCount: `${onlineCount} 在线`,
        status:
          selectedSharedSummary?.stateStatus === 'paused'
            ? '已暂停'
            : collaboration.sessions.some((s) => s.stateStatus === 'idle')
              ? '已暂停'
              : '运行中',
        title: activeWorkspace?.name ?? selectedSharedSummary?.title ?? '团队工作空间',
      },
      workspaceGroups: effectiveWorkspaceGroups,
      workspaces: options.workspaces ?? [],
      auditLogs: collaboration.auditLogs,
      sessionShares: collaboration.sessionShares,
      sharedSessions: collaboration.sharedSessions,
      members: collaboration.members,
    } satisfies TeamRuntimeReferenceViewData;
  }, [
    hasAuth,
    collaboration.selectedSharedSession,
    collaboration.members,
    collaboration.tasks,
    collaboration.busy,
    collaboration.error,
    collaboration.feedback,
    collaboration.loading,
    collaboration.sharedSessions,
    collaboration.sessions,
    collaboration.sharedOperateBusy,
    collaboration.sharedCommentBusy,
    collaboration.toggleSessionState,
    collaboration.deleteSession,
    sessionActionBusy,
    activeWorkspace,
    workspaceError,
    workspaceSnapshotError,
    workspaceLoading,
    workspaceSnapshotLoading,
    roleBindings.loading,
    workflowTemplates.canCreateTemplate,
    workflowTemplates.createTemplate,
    workflowTemplates.error,
    workflowTemplates.loading,
    workflowTemplates.sections,
    workflowTemplates.templateCount,
    workflowTemplates.templateCards,
    createSession,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    createTask,
    moveTask,
    replyReview,
    selectTeam,
    sendMessage,
    submitReviewComment,
    selectedSharedSummary,
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
    taskLanes,
    timelineEvents,
    options.workspaces,
  ]);

  const resolvedValue = liveValue ?? EMPTY_VIEW_DATA;

  return resolvedValue;
}
