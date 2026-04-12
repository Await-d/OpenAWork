import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type {
  TeamAuditLogRecord,
  TeamMessageRecord,
  TeamTaskRecord,
  TeamWorkspaceDetail,
  TeamWorkspaceSnapshot,
} from '@openAwork/web-client';
import { createTeamClient } from '@openAwork/web-client';
import { createSessionsClient } from '@openAwork/web-client';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../../../stores/auth.js';
import { useTeamCollaboration } from '../use-team-collaboration.js';
import type { TeamActionFeedback } from '../use-team-collaboration.js';
import { getSharedSessionStateLabel } from './team-runtime-model.js';
import {
  agentTeamsActivityStats,
  AGENT_TEAMS_EVENT_CONFIG,
  agentTeamsConversationCards,
  agentTeamsFooterLead,
  agentTeamsFooterStats,
  agentTeamsHistoryTeams,
  agentTeamsMessageCards,
  agentTeamsMetricCards,
  agentTeamsOfficeAgents,
  agentTeamsOverviewCards,
  agentTeamsReviewCards,
  agentTeamsRoleChips,
  agentTeamsRunningTeams,
  agentTeamsSidebarSections,
  agentTeamsTimelineEvents,
  agentTeamsWorkspaceGroups,
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
  type AgentTeamsTaskLane,
  type AgentTeamsTimelineEvent,
  type AgentTeamsTimelineEventType,
  type AgentTeamsWorkspaceGroup,
} from './team-runtime-reference-mock.js';
import { useTeamRuntimeProjection } from './use-team-runtime-projection.js';
import { useTeamRuntimeRoleBindings } from './use-team-runtime-role-bindings.js';
import { useTeamWorkflowTemplates } from './use-team-workflow-templates.js';

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
  createSession: (workspacePath?: string | null) => Promise<boolean>;
  createTemplate: (input: {
    name: string;
    provider: string;
    roleValues: string[];
  }) => Promise<boolean>;
  defaultSelectedAgentId: string;
  defaultSelectedTeamId: string;
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
  historyTeams: AgentTeamsSidebarTeam[];
  createTask: (input: TaskDraftInput) => Promise<boolean>;
  moveTask: (taskId: string, direction: 'left' | 'right') => Promise<boolean>;
  replyReview: (cardId: string, status: AgentTeamsReviewCard['status']) => Promise<boolean>;
  submitReviewComment: (cardId: string, content: string) => Promise<boolean>;
  selectTeam: (teamId: string) => void;
  sendMessage: (input: { content: string; type?: TeamMessageRecord['type'] }) => Promise<boolean>;
}

interface TeamRuntimeReferenceDataOptions {
  activeWorkspace?: TeamWorkspaceDetail | null;
  activeWorkspaceSnapshot?: TeamWorkspaceSnapshot | null;
  workspaceSnapshotError?: string | null;
  workspaceSnapshotLoading?: boolean;
  workspaceError?: string | null;
  workspaceLoading?: boolean;
}

const TeamRuntimeReferenceDataContext = createContext<TeamRuntimeReferenceViewData | null>(null);

const ROLE_SLOT_CONFIG = [
  {
    accent: '#d59b11',
    badge: '团',
    fallbackLabel: '团队负责人',
    fallbackProvider: 'Planner',
    id: 'leader',
    leader: true,
  },
  {
    accent: '#5b5bd8',
    badge: '研',
    fallbackLabel: '研究员A',
    fallbackProvider: 'Researcher',
    id: 'researcher-a',
    leader: false,
  },
  {
    accent: '#c03d7a',
    badge: '执',
    fallbackLabel: '执行者',
    fallbackProvider: 'Executor',
    id: 'researcher-b',
    leader: false,
  },
  {
    accent: '#d04e4e',
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
] as const;

const MOCK_VIEW_DATA: TeamRuntimeReferenceViewData = {
  activeMode: 'mock',
  activityStats: agentTeamsActivityStats,
  busy: false,
  canCreateSession: false,
  canCreateTemplate: false,
  canManageRuntime: false,
  canManageSessionEntries: false,
  conversationCards: agentTeamsConversationCards,
  async createSession() {
    return false;
  },
  async createTemplate() {
    return false;
  },
  defaultSelectedAgentId: agentTeamsRoleChips[0]?.id ?? 'leader',
  defaultSelectedTeamId: agentTeamsRunningTeams[0]?.id ?? 'team-research',
  error: null,
  feedback: null,
  footerLead: agentTeamsFooterLead,
  footerStats: agentTeamsFooterStats,
  loading: false,
  messageCards: agentTeamsMessageCards,
  metricCards: agentTeamsMetricCards,
  officeAgents: agentTeamsOfficeAgents,
  overviewCards: agentTeamsOverviewCards,
  reviewCards: agentTeamsReviewCards,
  reviewBusy: false,
  roleChips: agentTeamsRoleChips,
  runningTeams: agentTeamsRunningTeams,
  sidebarSections: agentTeamsSidebarSections,
  templateCount: agentTeamsSidebarSections.reduce(
    (count, section) => count + section.items.length,
    0,
  ),
  templateError: null,
  templateLoading: false,
  taskLanes: [
    { id: 'todo', title: '待办', cards: [] },
    { id: 'doing', title: '进行中', cards: [] },
    { id: 'review', title: '待评审', cards: [] },
  ],
  timelineEvents: agentTeamsTimelineEvents,
  topSummary: {
    description: '当前未接入真实 Team Runtime，使用参考布局 mock 数据展示。',
    memberCount: '4 成员',
    onlineCount: '4 在线',
    status: '已暂停',
    title: '研究团队-2026-03-31',
  },
  workspaceGroups: agentTeamsWorkspaceGroups,
  historyTeams: agentTeamsHistoryTeams,
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
  if (stateStatus === 'paused') {
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
    return 'file_write';
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
    <TeamRuntimeReferenceDataContext.Provider value={value}>
      {children}
    </TeamRuntimeReferenceDataContext.Provider>
  );
}

export function useTeamRuntimeReferenceViewData(): TeamRuntimeReferenceViewData {
  return useContext(TeamRuntimeReferenceDataContext) ?? MOCK_VIEW_DATA;
}

export function useResolvedTeamRuntimeReferenceData(
  options: TeamRuntimeReferenceDataOptions = {},
): TeamRuntimeReferenceViewData {
  const activeWorkspace = options.activeWorkspace ?? null;
  const activeWorkspaceSnapshot = options.activeWorkspaceSnapshot ?? null;
  const workspaceSnapshotError = options.workspaceSnapshotError ?? null;
  const workspaceSnapshotLoading = options.workspaceSnapshotLoading ?? false;
  const workspaceError = options.workspaceError ?? null;
  const workspaceLoading = options.workspaceLoading ?? false;
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const navigate = useNavigate();
  const teamClient = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);
  const collaboration = useTeamCollaboration();
  const roleBindings = useTeamRuntimeRoleBindings();
  const workflowTemplates = useTeamWorkflowTemplates();
  const [sessionActionBusy, setSessionActionBusy] = useState(false);

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
      if (!collaboration.sharedSessions.some((session) => session.sessionId === teamId)) {
        return;
      }
      collaboration.setSelectedSharedSessionId(teamId);
    },
    [collaboration.setSelectedSharedSessionId, collaboration.sharedSessions],
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
    async (workspacePath?: string | null) => {
      if (!accessToken) {
        return false;
      }

      setSessionActionBusy(true);
      try {
        if (activeWorkspace) {
          const session = await teamClient.createThread(accessToken, activeWorkspace.id, {
            metadata: workspacePath ? { workingDirectory: workspacePath } : undefined,
          });
          if (!session.id) {
            return false;
          }
          await collaboration.refresh();
          return true;
        }

        const session = await createSessionsClient(gatewayUrl).create(accessToken, {
          metadata: workspacePath ? { workingDirectory: workspacePath } : {},
        });
        if (!session.id) {
          return false;
        }
        void navigate(`/chat/${session.id}`);
        return true;
      } catch {
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, activeWorkspace, collaboration, gatewayUrl, navigate, teamClient],
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
        return collaboration.replySharedPermission(sessionId, {
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
      collaboration.replySharedPermission,
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

  const liveValue = useMemo<TeamRuntimeReferenceViewData>(() => {
    if (!hasAuth) {
      return MOCK_VIEW_DATA;
    }

    const roleChips = ROLE_SLOT_CONFIG.map((slot, index) => {
      const member = collaboration.members[index] ?? null;
      const binding = roleBindings.roleCards[index] ?? null;
      return {
        accent: slot.accent,
        badge: member?.name.slice(0, 1).toUpperCase() ?? slot.badge,
        id: member?.id ?? slot.id,
        leader: slot.leader,
        provider:
          binding?.selectedAgent?.label ??
          binding?.selectedAgent?.id ??
          binding?.roleLabel ??
          slot.fallbackProvider,
        role: member?.name ?? slot.fallbackLabel,
        status: mapMemberStatusLabel(member?.status),
      } satisfies AgentTeamsRoleChip;
    });

    const accentByMemberId = new Map<string, string>();
    roleChips.forEach((chip, index) => {
      const memberId = collaboration.members[index]?.id;
      if (memberId) {
        accentByMemberId.set(memberId, chip.accent);
      }
    });
    const memberNameById = new Map(collaboration.members.map((member) => [member.id, member.name]));
    const activeViewerCount =
      collaboration.selectedSharedSession?.presence.filter((entry) => entry.active).length ?? 0;
    const onlineCount =
      activeViewerCount ||
      collaboration.members.filter((member) => member.status === 'working').length;
    const snapshotSharedSessions = activeWorkspaceSnapshot?.sharedSessions ?? [];
    const snapshotSessions = activeWorkspaceSnapshot?.sessions ?? [];
    const selectedSharedSummary =
      collaboration.selectedSharedSession?.share ??
      snapshotSharedSessions.find(
        (session) => session.sessionId === collaboration.selectedSharedSessionId,
      ) ??
      collaboration.sharedSessions.find(
        (session) => session.sessionId === collaboration.selectedSharedSessionId,
      ) ??
      snapshotSharedSessions[0] ??
      collaboration.sharedSessions[0] ??
      null;

    const workspaceGroups = (() => {
      if (snapshotSharedSessions.length === 0 && snapshotSessions.length === 0) {
        if (collaboration.sharedSessions.length === 0 && collaboration.sessions.length === 0) {
          return agentTeamsWorkspaceGroups;
        }
      }

      if (snapshotSharedSessions.length === 0 && snapshotSessions.length === 0) {
        if (collaboration.sharedSessions.length === 0 && collaboration.sessions.length === 0) {
          return agentTeamsWorkspaceGroups;
        }

        const groups = new Map<string, AgentTeamsWorkspaceGroup>();
        for (const sharedSession of collaboration.sharedSessions) {
          const key = sharedSession.workspacePath ?? '__unbound__';
          const current = groups.get(key) ?? {
            workspaceLabel: formatWorkspaceLabel(sharedSession.workspacePath),
            workspacePath: sharedSession.workspacePath,
            sessions: [],
          };
          current.sessions.push({
            id: sharedSession.sessionId,
            status: mapSidebarStatus(sharedSession.stateStatus),
            subtitle: `${getSharedSessionStateLabel(sharedSession.stateStatus)} · ${formatRelativeTime(sharedSession.shareUpdatedAt)}`,
            title: sharedSession.title ?? sharedSession.sessionId,
          });
          groups.set(key, current);
        }

        if (groups.size === 0) {
          for (const session of collaboration.sessions) {
            const key = session.workspacePath ?? '__unbound__';
            const current = groups.get(key) ?? {
              workspaceLabel: formatWorkspaceLabel(session.workspacePath),
              workspacePath: session.workspacePath,
              sessions: [],
            };
            current.sessions.push({
              id: session.id,
              status: 'completed',
              subtitle: `最近更新 · ${formatRelativeTime(session.updatedAt)}`,
              title: session.title ?? session.id,
            });
            groups.set(key, current);
          }
        }

        return Array.from(groups.values()).map((group) => ({
          ...group,
          sessions: [...group.sessions].sort((left, right) =>
            left.title.localeCompare(right.title, 'zh-CN'),
          ),
        }));
      }

      const groups = new Map<string, AgentTeamsWorkspaceGroup>();
      for (const sharedSession of snapshotSharedSessions) {
        const key = sharedSession.workspacePath ?? '__unbound__';
        const current = groups.get(key) ?? {
          workspaceLabel: formatWorkspaceLabel(sharedSession.workspacePath),
          workspacePath: sharedSession.workspacePath,
          sessions: [],
        };
        current.sessions.push({
          id: sharedSession.sessionId,
          status: mapSidebarStatus(sharedSession.stateStatus),
          subtitle: `${getSharedSessionStateLabel(sharedSession.stateStatus)} · ${formatRelativeTime(sharedSession.shareUpdatedAt)}`,
          title: sharedSession.title ?? sharedSession.sessionId,
        });
        groups.set(key, current);
      }

      if (groups.size === 0) {
        for (const session of snapshotSessions) {
          const key = session.workspacePath ?? '__unbound__';
          const current = groups.get(key) ?? {
            workspaceLabel: formatWorkspaceLabel(session.workspacePath),
            workspacePath: session.workspacePath,
            sessions: [],
          };
          current.sessions.push({
            id: session.id,
            status: 'completed',
            subtitle: `最近更新 · ${formatRelativeTime(session.updatedAt)}`,
            title: session.title ?? session.id,
          });
          groups.set(key, current);
        }
      }

      return Array.from(groups.values()).map((group) => ({
        ...group,
        sessions: [...group.sessions].sort((left, right) =>
          left.title.localeCompare(right.title, 'zh-CN'),
        ),
      }));
    })();

    const effectiveWorkspaceGroups = (() => {
      if (!activeWorkspace?.defaultWorkingRoot) {
        return workspaceGroups;
      }

      const filteredGroups = workspaceGroups.filter(
        (group) => group.workspacePath === activeWorkspace.defaultWorkingRoot,
      );

      return filteredGroups.length > 0 ? filteredGroups : workspaceGroups;
    })();

    const allSidebarTeams = effectiveWorkspaceGroups.flatMap((group) => group.sessions);
    const runningTeams = allSidebarTeams.filter((team) => team.status === 'running');
    const historyTeams = allSidebarTeams.filter((team) => team.status !== 'running');
    const preferredWorkspacePath = activeWorkspace?.defaultWorkingRoot ?? null;
    const defaultSelectedTeamId =
      snapshotSharedSessions.find(
        (session) =>
          session.sessionId === collaboration.selectedSharedSessionId &&
          (preferredWorkspacePath == null || session.workspacePath === preferredWorkspacePath),
      )?.sessionId ??
      snapshotSharedSessions.find(
        (session) =>
          preferredWorkspacePath != null && session.workspacePath === preferredWorkspacePath,
      )?.sessionId ??
      snapshotSessions.find(
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
      runningTeams[0]?.id ??
      historyTeams[0]?.id ??
      MOCK_VIEW_DATA.defaultSelectedTeamId;

    const metricCards: AgentTeamsMetricCard[] = [
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
    ];

    const taskSource =
      collaboration.tasks.length > 0 ? collaboration.tasks : collaboration.runtimeTaskRecords;
    const taskLanes: AgentTeamsTaskLane[] = [
      { id: 'todo', title: '待办', cards: [] },
      { id: 'doing', title: '进行中', cards: [] },
      { id: 'review', title: '待评审', cards: [] },
    ];
    const todoLane = taskLanes[0];
    const doingLane = taskLanes[1];
    const reviewLane = taskLanes[2];

    for (const task of taskSource) {
      const assigneeName = task.assigneeId
        ? (memberNameById.get(task.assigneeId) ?? '未分配')
        : '未分配';
      const assigneeAccent =
        (task.assigneeId ? accentByMemberId.get(task.assigneeId) : undefined) ??
        ROLE_SLOT_CONFIG[1].accent;
      taskLanes
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

    const conversationCards = (() => {
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

      const fallbackCards: AgentTeamsConversationCard[] = [
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

      return items.length > 0 ? items : fallbackCards;
    })();

    const messageCards: AgentTeamsMessageCard[] =
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
          ];

    const pendingReviewCount =
      (collaboration.selectedSharedSession?.pendingPermissions.length ?? 0) +
      (collaboration.selectedSharedSession?.pendingQuestions.length ?? 0);

    const runtimeStartCandidates = [
      ...collaboration.messages.map((message) => message.timestamp),
      ...collaboration.auditLogs.map((log) => new Date(log.createdAt).getTime()),
      ...collaboration.tasks
        .map((task) => task.createdAt)
        .filter((value): value is string => Boolean(value))
        .map((value) => new Date(value).getTime()),
      ...collaboration.sharedSessions.map((session) => new Date(session.shareCreatedAt).getTime()),
    ].filter((value) => Number.isFinite(value));

    const overviewCards: AgentTeamsOverviewCard[] = [
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
        note: `待办 ${todoLane?.cards.length ?? 0} · 进行中 ${doingLane?.cards.length ?? 0} · 待评审 ${reviewLane?.cards.length ?? 0}`,
        trend: (doingLane?.cards.length ?? 0) > 0 ? 'up' : 'stable',
        value: String(taskSource.length),
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

    const reviewCards = (() => {
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
    })();

    const timelineEvents = (() => {
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

      return events.length > 0 ? events : agentTeamsTimelineEvents;
    })();

    const activityStats = timelineEvents.reduce<Record<string, number>>((stats, event) => {
      stats[event.type] = (stats[event.type] ?? 0) + 1;
      return stats;
    }, {});

    for (const type of Object.keys(AGENT_TEAMS_EVENT_CONFIG)) {
      activityStats[type] = activityStats[type] ?? 0;
    }

    const officeAgents = OFFICE_AGENT_POSITIONS.map((position, index) => {
      const chip = roleChips[index]!;
      const taskNote =
        index === 0
          ? `待处理 ${collaboration.selectedSharedSession?.pendingPermissions.length ?? 0} 个审批`
          : index === 1
            ? `推进 ${doingLane?.cards.length ?? 0} 个进行中任务`
            : `待回答 ${collaboration.selectedSharedSession?.pendingQuestions.length ?? 0} 个问题`;

      const extraNote =
        index === 2 && collaboration.tasks.filter((task) => task.status === 'failed').length > 0
          ? `阻塞 ${collaboration.tasks.filter((task) => task.status === 'failed').length} 项`
          : undefined;

      const agentStatus =
        index === 0
          ? ('discussing' as const)
          : index === 1
            ? ('working' as const)
            : ('resting' as const);

      return {
        accent: chip.accent,
        crown: chip.leader,
        extraNote,
        id: chip.id,
        label: index === 0 ? `[L] ${chip.role}` : chip.role,
        note: taskNote,
        status: agentStatus,
        x: position.x,
        y: position.y,
      } satisfies AgentTeamsOfficeAgent;
    });

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
      canManageRuntime: false,
      canManageSessionEntries: false,
      conversationCards,
      createSession,
      createTemplate: workflowTemplates.createTemplate,
      createTask,
      defaultSelectedAgentId: roleChips[0]?.id ?? MOCK_VIEW_DATA.defaultSelectedAgentId,
      defaultSelectedTeamId,
      error: workspaceError ?? collaboration.error,
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
      loading: collaboration.loading || roleBindings.loading || workspaceLoading,
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
      templateCount: workflowTemplates.templateCount,
      templateError: workflowTemplates.error,
      templateLoading: workflowTemplates.loading,
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
        status: selectedSharedSummary?.stateStatus === 'paused' ? '已暂停' : '运行中',
        title: activeWorkspace?.name ?? selectedSharedSummary?.title ?? '团队工作空间',
      },
      workspaceGroups: effectiveWorkspaceGroups,
    } satisfies TeamRuntimeReferenceViewData;
  }, [
    activeWorkspace,
    activeWorkspaceSnapshot,
    collaboration.auditLogs,
    collaboration.busy,
    createSession,
    collaboration.error,
    collaboration.feedback,
    collaboration.loading,
    collaboration.members,
    collaboration.messages,
    collaboration.runtimeTaskRecords,
    collaboration.selectedSharedSession,
    collaboration.selectedSharedSessionId,
    collaboration.sessions,
    collaboration.sharedCommentBusy,
    collaboration.sharedOperateBusy,
    collaboration.sharedSessions,
    collaboration.tasks,
    workflowTemplates.canCreateTemplate,
    workflowTemplates.createTemplate,
    workflowTemplates.error,
    workflowTemplates.loading,
    workflowTemplates.sections,
    workflowTemplates.templateCount,
    createTask,
    hasAuth,
    moveTask,
    projection.buddyProjection.activeAgentCount,
    projection.buddyProjection,
    projection.workspaceOverviewLines,
    roleBindings.loading,
    roleBindings.roleCards,
    replyReview,
    sessionActionBusy,
    selectTeam,
    sendMessage,
    submitReviewComment,
    workspaceError,
    workspaceLoading,
  ]);

  return liveValue;
}
