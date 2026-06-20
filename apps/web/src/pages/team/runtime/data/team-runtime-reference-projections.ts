import type {
  SessionTask,
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  TeamAuditLogRecord,
  TeamMessageRecord,
  TeamRuntimeSessionRecord,
  TeamTaskRecord,
} from '@openAwork/web-client';
import type { HandoffEntry } from '../../../../stores/team/team-events.js';
import { AGENT_TEAMS_EVENT_CONFIG } from './team-runtime-ui-config.js';
import {
  formatClock,
  formatRuntimeDuration,
  formatTimelineDetail,
  formatWorkspaceLabel,
  mapConversationType,
  mapMessageCardType,
  mapSidebarStatus,
  mapTimelineEventTypeFromAudit,
  mapTimelineEventTypeFromMessage,
  mapTimelineEventTypeFromRuntimeTask,
} from './team-runtime-reference-formatters.js';
import { getSharedSessionStateLabel } from './team-runtime-model.js';
import {
  OFFICE_AGENT_POSITIONS,
  ROLE_SLOT_CONFIG,
  mapOfficeStatusFromRole,
  resolveOfficeRole,
} from './team-runtime-reference-config.js';
import type { TeamRuntimeSemanticStatus } from './team-runtime-status.js';
import type {
  AgentTeamsConversationCard,
  AgentTeamsMessageCard,
  AgentTeamsOfficeAgent,
  AgentTeamsOverviewCard,
  AgentTeamsReviewCard,
  AgentTeamsRoleChip,
  AgentTeamsSidebarTeam,
  AgentTeamsTimelineEvent,
  AgentTeamsWorkspaceGroup,
} from './team-runtime-types.js';

interface TaskAggregate {
  total: number;
  running: number;
  completed: number;
  failed: number;
  pending: number;
  currentTaskTitle?: string;
  currentTaskStartedAt?: number;
  agents: Set<string>;
  earliestStartedAt?: number;
  latestCompletedAt?: number;
}

export interface TeamRuntimeActivityProjection {
  handoffTotal: number;
  activeHandoffs: number;
  completedHandoffs: number;
  failedHandoffs: number;
  runtimeTaskTotal: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningSessions: number;
  sessionTotal: number;
  participatingLayerCount: number;
  startCandidates: number[];
}

export interface TeamRuntimeWorkspaceGroupsProjection {
  workspaceGroups: AgentTeamsWorkspaceGroup[];
  runningTeams: AgentTeamsSidebarTeam[];
  historyTeams: AgentTeamsSidebarTeam[];
  defaultSelectedTeamId: string;
  defaultReceptionSessionId: string;
}

function parseWorkingDirectory(metadataJson: string): string | undefined {
  if (!metadataJson) {
    return undefined;
  }

  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    const workingDirectory = meta['workingDirectory'];
    return typeof workingDirectory === 'string' && workingDirectory.length > 0
      ? workingDirectory
      : undefined;
  } catch {
    return undefined;
  }
}

function buildTaskStats(tasks: SessionTask[]): Map<string, TaskAggregate> {
  const taskStats = new Map<string, TaskAggregate>();
  for (const task of tasks) {
    if (!task.sessionId) {
      continue;
    }
    const current =
      taskStats.get(task.sessionId) ??
      ({
        total: 0,
        running: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        agents: new Set<string>(),
      } satisfies TaskAggregate);
    current.total += 1;
    if (task.status === 'running') {
      current.running += 1;
      if (
        task.startedAt != null &&
        (current.currentTaskStartedAt == null || task.startedAt < current.currentTaskStartedAt)
      ) {
        current.currentTaskStartedAt = task.startedAt;
        current.currentTaskTitle = task.title;
      } else if (current.currentTaskTitle == null) {
        current.currentTaskTitle = task.title;
      }
    } else if (task.status === 'completed') {
      current.completed += 1;
    } else if (task.status === 'failed') {
      current.failed += 1;
    } else if (task.status === 'pending') {
      current.pending += 1;
    }

    if (task.assignedAgent) {
      current.agents.add(task.assignedAgent);
    }
    if (task.startedAt != null) {
      if (current.earliestStartedAt == null || task.startedAt < current.earliestStartedAt) {
        current.earliestStartedAt = task.startedAt;
      }
    }
    if (task.completedAt != null) {
      if (current.latestCompletedAt == null || task.completedAt > current.latestCompletedAt) {
        current.latestCompletedAt = task.completedAt;
      }
    }
    taskStats.set(task.sessionId, current);
  }
  return taskStats;
}

function buildWorkspaceExtraFields(
  taskStats: Map<string, TaskAggregate>,
  sessionId: string,
): Partial<AgentTeamsSidebarTeam> {
  const stats = taskStats.get(sessionId);
  if (!stats) {
    return {};
  }

  const out: Partial<AgentTeamsSidebarTeam> = {
    taskTotal: stats.total,
    taskRunning: stats.running,
    taskCompleted: stats.completed,
    taskFailed: stats.failed,
    taskPending: stats.pending,
  };
  if (stats.currentTaskTitle) {
    out.currentTaskTitle = stats.currentTaskTitle;
  }
  if (stats.agents.size > 0) {
    out.agents = Array.from(stats.agents).sort();
  }
  if (stats.earliestStartedAt != null) {
    const endTs = stats.running > 0 ? Date.now() : (stats.latestCompletedAt ?? Date.now());
    const durationMs = Math.max(0, endTs - stats.earliestStartedAt);
    if (durationMs > 0) {
      out.durationMs = durationMs;
    }
  }
  return out;
}

export function buildWorkspaceGroupsProjection(input: {
  activeWorkspaceDefaultWorkingRoot?: string | null;
  createdSessionId: string | null;
  effectiveSharedSessions: SharedSessionSummaryRecord[];
  effectiveSessions: TeamRuntimeSessionRecord[];
  runtimeSessionStatuses: ReadonlyMap<string, TeamRuntimeSemanticStatus>;
  sharedSessionStatuses: ReadonlyMap<string, TeamRuntimeSemanticStatus>;
  runtimeTasks: SessionTask[];
  selectedSharedSessionId: string | null;
}): TeamRuntimeWorkspaceGroupsProjection {
  if (input.effectiveSessions.length === 0 && input.effectiveSharedSessions.length === 0) {
    return {
      defaultReceptionSessionId: '',
      defaultSelectedTeamId: '',
      historyTeams: [],
      runningTeams: [],
      workspaceGroups: [],
    };
  }

  const taskStats = buildTaskStats(input.runtimeTasks);
  const childCount = new Map<string, number>();
  for (const session of input.effectiveSessions) {
    if (session.parentSessionId) {
      childCount.set(session.parentSessionId, (childCount.get(session.parentSessionId) ?? 0) + 1);
    }
  }

  const groups = new Map<string, AgentTeamsWorkspaceGroup>();
  const seenSessionIds = new Set<string>();

  for (const session of input.effectiveSessions) {
    // 跳过 team 层级角色派生的子会话（pm1/pm2/executor/reviewer 等），
    // 只展示用户创建的根团队会话。
    if (session.parentSessionId != null) {
      continue;
    }
    if (seenSessionIds.has(session.id)) {
      continue;
    }
    seenSessionIds.add(session.id);
    const key = session.workspacePath ?? '__unbound__';
    const current =
      groups.get(key) ?? {
        workspaceLabel: formatWorkspaceLabel(session.workspacePath),
        workspacePath: session.workspacePath,
        sessions: [],
      };
    const workingDirectory = parseWorkingDirectory(session.metadataJson ?? '');
    current.sessions.push({
      id: session.id,
      isSharedSession: false,
      status: mapSidebarStatus(input.runtimeSessionStatuses.get(session.id) ?? 'idle'),
      subtitle: getSharedSessionStateLabel(session.stateStatus),
      title: session.title ?? session.id,
      updatedAt: session.updatedAt,
      parentSessionId: session.parentSessionId,
      roleLayer: session.roleLayer ?? session.roleInstance?.roleLayer ?? null,
      ...buildWorkspaceExtraFields(taskStats, session.id),
      ...(childCount.has(session.id) ? { childSessionCount: childCount.get(session.id) } : {}),
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(session.parentSessionId ? { isDerived: true } : {}),
    });
    groups.set(key, current);
  }

  for (const sharedSession of input.effectiveSharedSessions) {
    if (seenSessionIds.has(sharedSession.sessionId)) {
      continue;
    }
    seenSessionIds.add(sharedSession.sessionId);
    const key = sharedSession.workspacePath ?? '__unbound__';
    const current =
      groups.get(key) ?? {
        workspaceLabel: formatWorkspaceLabel(sharedSession.workspacePath),
        workspacePath: sharedSession.workspacePath,
        sessions: [],
      };
    current.sessions.push({
      id: sharedSession.sessionId,
      isSharedSession: true,
      status: mapSidebarStatus(input.sharedSessionStatuses.get(sharedSession.sessionId) ?? 'idle'),
      subtitle: getSharedSessionStateLabel(sharedSession.stateStatus),
      title: sharedSession.title ?? sharedSession.sessionId,
      updatedAt: sharedSession.shareUpdatedAt,
      ...buildWorkspaceExtraFields(taskStats, sharedSession.sessionId),
      ...(childCount.has(sharedSession.sessionId)
        ? { childSessionCount: childCount.get(sharedSession.sessionId) }
        : {}),
    });
    groups.set(key, current);
  }

  const workspaceGroups = Array.from(groups.values()).map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((left, right) =>
        left.title.localeCompare(right.title, 'zh-CN'),
      ),
    }));

  const effectiveWorkspaceGroups =
    input.activeWorkspaceDefaultWorkingRoot == null
      ? workspaceGroups
      : (() => {
          const filteredGroups = workspaceGroups.filter(
            (group) => group.workspacePath === input.activeWorkspaceDefaultWorkingRoot,
          );
          return filteredGroups.length > 0 ? filteredGroups : workspaceGroups;
        })();

  const allSidebarTeams = effectiveWorkspaceGroups.flatMap((group) => group.sessions);
  const runningTeams = allSidebarTeams.filter((team) => team.status === 'running');
  const historyTeams = allSidebarTeams.filter((team) => team.status !== 'running');
  const preferredWorkspacePath = input.activeWorkspaceDefaultWorkingRoot ?? null;
  const defaultSelectedTeamId =
    input.effectiveSessions.find(
      (session) =>
        preferredWorkspacePath != null && session.workspacePath === preferredWorkspacePath,
    )?.id ??
    input.effectiveSharedSessions.find(
      (session) =>
        session.sessionId === input.selectedSharedSessionId &&
        (preferredWorkspacePath == null || session.workspacePath === preferredWorkspacePath),
    )?.sessionId ??
    input.effectiveSharedSessions.find(
      (session) =>
        preferredWorkspacePath != null && session.workspacePath === preferredWorkspacePath,
    )?.sessionId ??
    input.selectedSharedSessionId ??
    runningTeams[0]?.id ??
    historyTeams[0]?.id ??
    '';

  const inWorkspaceRoots = input.effectiveSessions.filter(
    (session) =>
      session.parentSessionId == null &&
      (preferredWorkspacePath == null || session.workspacePath === preferredWorkspacePath),
  );
  const allRoots = input.effectiveSessions.filter((session) => session.parentSessionId == null);
  const defaultReceptionSessionId =
    inWorkspaceRoots[0]?.id ?? allRoots[0]?.id ?? input.createdSessionId ?? defaultSelectedTeamId;

  return {
    defaultReceptionSessionId,
    defaultSelectedTeamId,
    historyTeams,
    runningTeams,
    workspaceGroups: effectiveWorkspaceGroups,
  };
}

export function buildConversationCardsProjection(input: {
  auditLogs: Array<
    Pick<TeamAuditLogRecord, 'actorEmail' | 'actorUserId' | 'createdAt' | 'detail' | 'id' | 'summary'>
  >;
  accentByMemberId: ReadonlyMap<string, string>;
  memberNameById: ReadonlyMap<string, string>;
  messages: Array<Pick<TeamMessageRecord, 'content' | 'id' | 'memberId' | 'timestamp' | 'type'>>;
}): AgentTeamsConversationCard[] {
  const items = [
    ...input.messages.map((message) => {
      const name = input.memberNameById.get(message.memberId) ?? '团队成员';
      const cleanContent = formatTimelineDetail(message.content);
      const title = cleanContent.length > 20 ? `${cleanContent.slice(0, 20)}…` : cleanContent;
      return {
        body: cleanContent,
        agentId: message.memberId,
        id: `message-${message.id}`,
        meta: `${name} · 团队消息`,
        role: name,
        roleAccent: input.accentByMemberId.get(message.memberId) ?? ROLE_SLOT_CONFIG[0].accent,
        timestamp: formatClock(message.timestamp),
        title,
        type: mapConversationType(message.type),
      } satisfies AgentTeamsConversationCard;
    }),
    ...input.auditLogs.map((log, index) => {
      const accent =
        ROLE_SLOT_CONFIG[index % ROLE_SLOT_CONFIG.length]?.accent ?? ROLE_SLOT_CONFIG[0].accent;
      return {
        body: formatTimelineDetail(log.detail ?? log.summary),
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
}

export function buildMessageCardsProjection(input: {
  accentByMemberId: ReadonlyMap<string, string>;
  memberNameById: ReadonlyMap<string, string>;
  messages: Array<
    Pick<
      TeamMessageRecord,
      | 'content'
      | 'id'
      | 'memberId'
      | 'recipientMemberId'
      | 'replyToMessageId'
      | 'sessionId'
      | 'timestamp'
      | 'type'
    >
  >;
}): AgentTeamsMessageCard[] {
  return input.messages.length > 0
    ? [...input.messages]
        .sort((left, right) => right.timestamp - left.timestamp)
        .map((message) => {
          const from = input.memberNameById.get(message.memberId) ?? '团队成员';
          const fromAccent = input.accentByMemberId.get(message.memberId) ?? ROLE_SLOT_CONFIG[0].accent;
          return {
            from,
            fromAccent,
            id: message.id,
            ...(message.sessionId !== undefined ? { sessionId: message.sessionId } : {}),
            ...(message.memberId ? { memberId: message.memberId } : {}),
            ...(message.recipientMemberId !== undefined
              ? { recipientMemberId: message.recipientMemberId }
              : {}),
            ...(message.replyToMessageId !== undefined ? { replyToMessageId: message.replyToMessageId } : {}),
            route:
              message.recipientMemberId != null || message.replyToMessageId != null
                ? 'followup'
                : 'broadcast',
            summary: formatTimelineDetail(message.content),
            timestamp: formatClock(message.timestamp),
            to:
              message.recipientMemberId != null
                ? (input.memberNameById.get(message.recipientMemberId) ?? '指定成员')
                : message.replyToMessageId != null
                  ? '当前线程'
                  : '全体成员',
            toAccent:
              message.recipientMemberId != null
                ? (input.accentByMemberId.get(message.recipientMemberId) ??
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
      ];
}

export function buildReviewCardsProjection(input: {
  activeSharedSession: SharedSessionDetailRecord | null;
  auditLogs: Array<Pick<TeamAuditLogRecord, 'actorEmail' | 'detail' | 'id' | 'summary'>>;
}): AgentTeamsReviewCard[] {
  const permissionCards =
    input.activeSharedSession?.pendingPermissions.map(
      (request, index) =>
        ({
          actionable: true,
          assignee: input.activeSharedSession?.share.sharedByEmail ?? '共享运行',
          assigneeAccent:
            ROLE_SLOT_CONFIG[index % ROLE_SLOT_CONFIG.length]?.accent ?? ROLE_SLOT_CONFIG[0].accent,
          id: `permission-${request.requestId}`,
          priority: request.riskLevel,
          requestId: request.requestId,
          reviewKind: 'permission',
          sessionId: input.activeSharedSession?.share.sessionId,
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
    input.activeSharedSession?.pendingQuestions.map(
      (request, index) =>
        ({
          actionable: true,
          assignee: input.activeSharedSession?.share.sharedByEmail ?? '共享运行',
          assigneeAccent:
            ROLE_SLOT_CONFIG[(index + 1) % ROLE_SLOT_CONFIG.length]?.accent ??
            ROLE_SLOT_CONFIG[0].accent,
          id: `question-${request.requestId}`,
          priority: 'medium',
          requestId: request.requestId,
          reviewKind: 'question',
          sessionId: input.activeSharedSession?.share.sessionId,
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

  const auditCards = input.auditLogs.slice(0, 3).map(
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
}

/**
 * 构建运行时任务的时间线摘要文本。
 *
 * 优先级：subject（任务主题）> title + description（任务标题和描述）> title + result（标题和结果）> errorMessage（错误信息）
 * 当任务有丰富主题时直接展示；有标题/描述时以"标题：描述"形式展示；失败时追加错误信息。
 */
function buildTaskDetail(task: {
  title: string;
  subject?: string | null;
  description?: string | null;
  result?: string | null;
  errorMessage?: string | null;
  status: string;
}): string {
  const subject = formatTimelineDetail(task.subject, 200);
  const title = formatTimelineDetail(task.title, 80);
  const desc = formatTimelineDetail(task.description, 120);
  const errMsg = formatTimelineDetail(task.errorMessage, 80);
  const result = formatTimelineDetail(task.result, 120);
  const isFailed = task.status === 'failed';

  // 1. 优先使用 subject（后端通常把自然语言任务主题放在这里）
  if (subject) {
    return isFailed && errMsg ? `${subject}（失败：${errMsg}）` : subject;
  }

  // 2. 标题 + 描述（任务描述）
  if (title && desc) {
    return isFailed && errMsg ? `${title}：${desc}（失败：${errMsg}）` : `${title}：${desc}`;
  }
  if (title) {
    return isFailed && errMsg
      ? `${title}（失败：${errMsg}）`
      : result
        ? `${title}：${result}`
        : title;
  }

  // 3. 只有描述
  if (desc) {
    return isFailed && errMsg ? `${desc}（失败：${errMsg}）` : desc;
  }

  // 4. 回退到结果或错误
  return result ?? errMsg ?? '运行时任务';
}

export function buildTimelineProjection(input: {
  accentByMemberId: ReadonlyMap<string, string>;
  auditLogs: Array<Pick<TeamAuditLogRecord, 'action' | 'actorEmail' | 'actorUserId' | 'createdAt' | 'detail' | 'id' | 'summary'>>;
  handoffs: Array<
    Pick<HandoffEntry, 'fromRoleLayer' | 'id' | 'state' | 'summary' | 'toRoleLayer' | 'updatedAt'>
  >;
  memberNameById: ReadonlyMap<string, string>;
  messages: Array<Pick<TeamMessageRecord, 'content' | 'id' | 'memberId' | 'timestamp' | 'type'>>;
  runtimeTasks: Array<Pick<SessionTask, 'assignedAgent' | 'description' | 'errorMessage' | 'id' | 'result' | 'status' | 'subject' | 'title' | 'updatedAt'>>;
}): {
  activityStats: Record<string, number>;
  timelineEvents: AgentTeamsTimelineEvent[];
} {
  const timelineEvents = [
    ...input.handoffs.map(
      (handoff, index) =>
        ({
          agentAccent: ROLE_SLOT_CONFIG[index % ROLE_SLOT_CONFIG.length]?.accent ?? ROLE_SLOT_CONFIG[0].accent,
          agentId: handoff.id,
          agentName: `${handoff.fromRoleLayer} → ${handoff.toRoleLayer ?? handoff.fromRoleLayer}`,
          detail: formatTimelineDetail(
            handoff.summary ?? `${handoff.toRoleLayer ?? '下一层'} 层交接状态已更新为 ${handoff.state}。`,
          ),
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
    ...input.runtimeTasks.map(
      (task) =>
        ({
          agentAccent:
            task.assignedAgent && input.accentByMemberId.get(task.assignedAgent)
              ? input.accentByMemberId.get(task.assignedAgent)!
              : ROLE_SLOT_CONFIG[2].accent,
          agentId: task.assignedAgent ?? task.id,
          agentName: task.assignedAgent
            ? (input.memberNameById.get(task.assignedAgent) ?? task.assignedAgent)
            : '运行时任务',
          detail: formatTimelineDetail(buildTaskDetail(task)),
          id: `runtime-task-${task.id}`,
          timestamp: new Date(task.updatedAt).toISOString(),
          type: mapTimelineEventTypeFromRuntimeTask(task.status),
        }) satisfies AgentTeamsTimelineEvent,
    ),
    ...input.messages.map(
      (message) =>
        ({
          agentAccent: input.accentByMemberId.get(message.memberId) ?? ROLE_SLOT_CONFIG[0].accent,
          agentId: message.memberId,
          agentName: input.memberNameById.get(message.memberId) ?? '团队成员',
          detail: formatTimelineDetail(message.content),
          id: `message-${message.id}`,
          timestamp: new Date(message.timestamp).toISOString(),
          type: mapTimelineEventTypeFromMessage(message.type),
        }) satisfies AgentTeamsTimelineEvent,
    ),
    ...input.auditLogs.map(
      (log, index) =>
        ({
          agentAccent:
            ROLE_SLOT_CONFIG[index % ROLE_SLOT_CONFIG.length]?.accent ?? ROLE_SLOT_CONFIG[0].accent,
          agentId: log.actorUserId ?? `audit-${index}`,
          agentName: log.actorEmail ?? '系统',
          detail: formatTimelineDetail(log.detail ?? log.summary),
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

  const activityStats = timelineEvents.reduce<Record<string, number>>((acc, event) => {
    acc[event.type] = (acc[event.type] ?? 0) + 1;
    return acc;
  }, {});
  for (const type of Object.keys(AGENT_TEAMS_EVENT_CONFIG)) {
    activityStats[type] = activityStats[type] ?? 0;
  }

  return { activityStats, timelineEvents };
}

export function buildRuntimeActivityProjection(input: {
  handoffs: Array<Pick<HandoffEntry, 'fromRoleLayer' | 'state' | 'toRoleLayer' | 'updatedAt' | 'startedAt'>>;
  runtimeTasks: SessionTask[];
  sessions: Array<Pick<TeamRuntimeSessionRecord, 'roleLayer' | 'stateStatus'>>;
}): TeamRuntimeActivityProjection {
  const handoffs = input.handoffs;
  const activeHandoffs = handoffs.filter(
    (handoff) => handoff.state === 'running' || handoff.state === 'claimed' || handoff.state === 'pending',
  ).length;
  const completedHandoffs = handoffs.filter((handoff) => handoff.state === 'completed').length;
  const failedHandoffs = handoffs.filter(
    (handoff) => handoff.state === 'failed' || handoff.state === 'cancelled',
  ).length;

  const runtimeTasks = input.runtimeTasks;
  const runningTasks = runtimeTasks.filter((task) => task.status === 'running').length;
  const completedTasks = runtimeTasks.filter((task) => task.status === 'completed').length;
  const failedTasks = runtimeTasks.filter((task) => task.status === 'failed').length;

  const sessions = input.sessions;
  const runningSessions = sessions.filter((session) => session.stateStatus === 'running').length;

  const participatingLayers = new Set<string>();
  for (const handoff of handoffs) {
    if (handoff.toRoleLayer) {
      participatingLayers.add(handoff.toRoleLayer);
    }
    if (handoff.fromRoleLayer) {
      participatingLayers.add(handoff.fromRoleLayer);
    }
  }
  for (const session of sessions) {
    if (session.roleLayer) {
      participatingLayers.add(session.roleLayer);
    }
  }

  const startCandidates: number[] = [];
  for (const handoff of handoffs) {
    const started = handoff.startedAt ?? handoff.updatedAt;
    if (Number.isFinite(started)) {
      startCandidates.push(started);
    }
  }
  for (const task of runtimeTasks) {
    if (task.startedAt != null && Number.isFinite(task.startedAt)) {
      startCandidates.push(task.startedAt);
    }
  }

  return {
    activeHandoffs,
    completedHandoffs,
    completedTasks,
    failedHandoffs,
    failedTasks,
    handoffTotal: handoffs.length,
    participatingLayerCount: participatingLayers.size,
    runningSessions,
    runningTasks,
    runtimeTaskTotal: runtimeTasks.length,
    sessionTotal: sessions.length,
    startCandidates,
  };
}

export function buildOfficeAgentsProjection(input: {
  activeSharedSession: SharedSessionDetailRecord | null;
  collaborationTasks: Array<Pick<TeamTaskRecord, 'status'>>;
  isSelectedTeamPaused: boolean;
  roleBindings: Array<{
    role?: string;
    roleLabel?: string;
    selectedAgent?: { id: string; label: string; canonicalRole?: { coreRole?: string | null } | null } | null;
  }>;
  roleChips: AgentTeamsRoleChip[];
  taskLaneCount: number;
}): AgentTeamsOfficeAgent[] {
  return OFFICE_AGENT_POSITIONS.map((position, index) => {
    const chip = input.roleChips[index]!;
    const binding = input.roleBindings[index] ?? null;
    const boundRole = binding?.role ?? null;
    const boundAgent = binding?.selectedAgent ?? null;
    const effectiveRole = resolveOfficeRole(boundAgent?.canonicalRole?.coreRole ?? boundRole, index);
    const taskNote =
      index === 0
        ? `待处理 ${input.activeSharedSession?.pendingPermissions.length ?? 0} 个审批`
        : index === 1
          ? `推进 ${input.taskLaneCount} 个进行中任务`
          : `待回答 ${input.activeSharedSession?.pendingQuestions.length ?? 0} 个问题`;

    const extraNote =
      index === 2 && input.collaborationTasks.filter((task) => task.status === 'failed').length > 0
        ? `阻塞 ${input.collaborationTasks.filter((task) => task.status === 'failed').length} 项`
        : undefined;

    const agentStatus = input.isSelectedTeamPaused ? 'resting' : mapOfficeStatusFromRole(effectiveRole);

    return {
      accent: chip.accent,
      crown: effectiveRole === 'planner' || chip.leader,
      extraNote,
      id: boundAgent?.id ?? chip.id,
      label:
        effectiveRole === 'planner' ? `[L] ${boundAgent?.label ?? chip.role}` : (boundAgent?.label ?? chip.role),
      note: taskNote,
      status: agentStatus,
      x: position.x,
      y: position.y,
    } satisfies AgentTeamsOfficeAgent;
  });
}

export function buildOverviewCardsProjection(input: {
  activeSharedSession: SharedSessionDetailRecord | null;
  collaborationMemberCount: number;
  collaborationTaskCount: number;
  collaborationTasks: Array<Pick<TeamTaskRecord, 'status' | 'createdAt'>>;
  collaborationWorkingMemberCount: number;
  pendingReviewCount: number;
  runtimeActivity: TeamRuntimeActivityProjection;
  scopedAuditLogs: Array<Pick<TeamAuditLogRecord, 'createdAt'>>;
  scopedMessages: Array<Pick<TeamMessageRecord, 'timestamp'>>;
  scopedSharedSessions: SharedSessionSummaryRecord[];
  selectedRuntimeTaskRecordCount: number;
  selectedSharedSummaryLabel: string | null;
  selectedSessionScope: ReadonlySet<string> | null;
}): AgentTeamsOverviewCard[] {
  const runtimeStartCandidates = [
    ...input.scopedMessages.map((message) => message.timestamp),
    ...input.scopedAuditLogs.map((log) => new Date(log.createdAt).getTime()),
    ...input.scopedSharedSessions.map((session) => new Date(session.shareCreatedAt).getTime()),
    ...(input.selectedSessionScope
      ? []
      : input.collaborationTasks
          .map((task) => task.createdAt)
          .filter((value): value is string => Boolean(value))
          .map((value) => new Date(value).getTime())),
    ...input.runtimeActivity.startCandidates,
  ].filter((value) => Number.isFinite(value));

  const effectiveTaskTotal = input.selectedSessionScope
    ? input.runtimeActivity.runtimeTaskTotal || input.selectedRuntimeTaskRecordCount
    : input.runtimeActivity.runtimeTaskTotal > 0
      ? input.runtimeActivity.runtimeTaskTotal
      : input.collaborationTaskCount || input.selectedRuntimeTaskRecordCount;

  const effectiveActiveRoles = Math.max(
    input.selectedSessionScope
      ? input.runtimeActivity.participatingLayerCount
      : input.collaborationMemberCount,
    input.runtimeActivity.participatingLayerCount,
  );

  return [
    {
      icon: 'members',
      id: 'overview-active-members',
      label: '活跃角色',
      note: input.selectedSessionScope
        ? `参与层级 ${input.runtimeActivity.participatingLayerCount} · 子树会话 ${input.runtimeActivity.sessionTotal} · 运行中 ${input.runtimeActivity.runningSessions}`
        : `参与层级 ${input.runtimeActivity.participatingLayerCount} · 工作中成员 ${input.collaborationWorkingMemberCount} · 总成员 ${input.collaborationMemberCount}`,
      trend: input.selectedSessionScope
        ? input.runtimeActivity.runningSessions > 0
          ? 'up'
          : 'stable'
        : input.runtimeActivity.runningSessions > 0 || input.collaborationWorkingMemberCount > 0
          ? 'up'
          : 'stable',
      value: String(effectiveActiveRoles),
    },
    {
      icon: 'tasks',
      id: 'overview-tasks',
      label: '办公室任务',
      note: `进行中 ${input.runtimeActivity.runningTasks} · 已完成 ${input.runtimeActivity.completedTasks} · 失败 ${input.runtimeActivity.failedTasks}`,
      trend: input.runtimeActivity.runningTasks > 0 ? 'up' : 'stable',
      value: String(effectiveTaskTotal),
    },
    {
      icon: 'overview',
      id: 'overview-shared-runs',
      label: '运行会话',
      note: input.selectedSessionScope
        ? `运行中 ${input.runtimeActivity.runningSessions} · 子树会话 ${input.runtimeActivity.sessionTotal} · 当前范围`
        : `运行中 ${input.runtimeActivity.runningSessions} · 共享 ${input.scopedSharedSessions.length} · 总计 ${input.runtimeActivity.sessionTotal}`,
      trend: input.selectedSessionScope
        ? input.runtimeActivity.runningSessions > 0
          ? 'up'
          : 'stable'
        : input.runtimeActivity.runningSessions > 0 || input.scopedSharedSessions.length > 0
          ? 'up'
          : 'stable',
      value: String(
        input.selectedSessionScope
          ? input.runtimeActivity.sessionTotal
          : input.runtimeActivity.sessionTotal || input.scopedSharedSessions.length,
      ),
    },
    {
      icon: 'sync',
      id: 'overview-handoffs',
      label: '团队交接',
      note: `进行中 ${input.runtimeActivity.activeHandoffs} · 已完成 ${input.runtimeActivity.completedHandoffs} · 失败 ${input.runtimeActivity.failedHandoffs}`,
      trend: input.runtimeActivity.activeHandoffs > 0 ? 'up' : 'stable',
      value: String(input.runtimeActivity.handoffTotal),
    },
    {
      icon: 'review',
      id: 'overview-review',
      label: '评审队列',
      note: `权限 ${input.activeSharedSession?.pendingPermissions.length ?? 0} · 问题 ${input.activeSharedSession?.pendingQuestions.length ?? 0}`,
      trend: input.pendingReviewCount > 0 ? 'up' : 'stable',
      value: String(input.pendingReviewCount),
    },
    {
      icon: 'timer',
      id: 'overview-runtime',
      label: '运行时长',
      note: input.selectedSessionScope
        ? `${input.runtimeActivity.activeHandoffs} 个交接进行中 · 当前会话子树`
        : input.selectedSharedSummaryLabel
          ? `当前会话：${input.selectedSharedSummaryLabel}`
          : input.runtimeActivity.handoffTotal > 0
            ? `${input.runtimeActivity.activeHandoffs} 个交接进行中`
            : '等待接入新的团队运行',
      trend: 'stable',
      value: formatRuntimeDuration(runtimeStartCandidates),
    },
  ];
}
