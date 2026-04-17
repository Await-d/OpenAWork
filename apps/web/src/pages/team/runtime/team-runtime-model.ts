import type {
  SessionFileChangesSummary,
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  TeamAuditLogRecord,
  TeamMessageRecord,
  TeamSessionShareRecord,
  TeamTaskRecord,
} from '@openAwork/web-client';
import type { InteractionAgentRewriteArtifact } from './interaction-agent-flow.js';

export const ALL_WORKSPACES_KEY = '__all_workspaces__';
const UNBOUND_WORKSPACE_KEY = '__unbound_workspace__';

export interface TeamWorkspaceCardSummary {
  description: string;
  key: string;
  label: string;
  pausedCount: number;
  runningCount: number;
  sessionCount: number;
  sharedSessionCount: number;
  shareRecordCount: number;
}

export interface TeamRuntimeMetric {
  hint: string;
  label: string;
  value: number | string;
}

export interface TeamWorkspaceContextMetric {
  hint: string;
  label: string;
  value: number | string;
}

export interface TeamWorkspaceOutputCard {
  helperText: string;
  id: string;
  latestOutput: string | null;
  pendingApprovalCount: number;
  pendingQuestionCount: number;
  sharedByEmail: string;
  stateLabel: string;
  title: string;
  workspaceLabel: string;
}

export interface TeamWorkspaceChangeMetric {
  hint: string;
  label: string;
  value: number | string;
}

export function resolveWorkspaceKey(workspacePath: string | null | undefined): string {
  const trimmed = workspacePath?.trim();
  return trimmed ? trimmed : UNBOUND_WORKSPACE_KEY;
}

export function formatWorkspaceLabel(workspacePath: string | null | undefined): string {
  const trimmed = workspacePath?.trim();
  return trimmed ? trimmed : '未绑定工作区';
}

function buildWorkspaceDescription(input: {
  pausedCount: number;
  runningCount: number;
  sessionCount: number;
  sharedSessionCount: number;
  shareRecordCount: number;
}): string {
  const parts = [
    `${input.sessionCount} 个会话`,
    `${input.sharedSessionCount} 个共享运行`,
    `${input.shareRecordCount} 条共享记录`,
  ];

  if (input.runningCount > 0) {
    parts.push(`${input.runningCount} 个运行中`);
  }

  if (input.pausedCount > 0) {
    parts.push(`${input.pausedCount} 个待处理`);
  }

  return parts.join(' · ');
}

function createWorkspaceSummary(input: {
  key: string;
  label: string;
  pausedCount: number;
  runningCount: number;
  sessionCount: number;
  sharedSessionCount: number;
  shareRecordCount: number;
}): TeamWorkspaceCardSummary {
  return {
    ...input,
    description: buildWorkspaceDescription(input),
  };
}

export function buildWorkspaceSummaries(input: {
  sessionShares: TeamSessionShareRecord[];
  sessions: Array<{ id: string; title: string | null; workspacePath: string | null }>;
  sharedSessions: SharedSessionSummaryRecord[];
}): TeamWorkspaceCardSummary[] {
  const keys = new Set<string>();

  for (const session of input.sessions) {
    keys.add(resolveWorkspaceKey(session.workspacePath));
  }

  for (const share of input.sessionShares) {
    keys.add(resolveWorkspaceKey(share.workspacePath));
  }

  for (const sharedSession of input.sharedSessions) {
    keys.add(resolveWorkspaceKey(sharedSession.workspacePath));
  }

  const workspaceSummaries = [...keys]
    .sort((left, right) => {
      if (left === UNBOUND_WORKSPACE_KEY) {
        return 1;
      }
      if (right === UNBOUND_WORKSPACE_KEY) {
        return -1;
      }
      return left.localeCompare(right, 'zh-CN');
    })
    .map((key) => {
      const sessions = input.sessions.filter(
        (session) => resolveWorkspaceKey(session.workspacePath) === key,
      );
      const sessionShares = input.sessionShares.filter(
        (share) => resolveWorkspaceKey(share.workspacePath) === key,
      );
      const sharedSessions = input.sharedSessions.filter(
        (sharedSession) => resolveWorkspaceKey(sharedSession.workspacePath) === key,
      );

      return createWorkspaceSummary({
        key,
        label: key === UNBOUND_WORKSPACE_KEY ? '未绑定工作区' : key,
        pausedCount: sharedSessions.filter(
          (sharedSession) => sharedSession.stateStatus === 'paused',
        ).length,
        runningCount: sharedSessions.filter(
          (sharedSession) => sharedSession.stateStatus === 'running',
        ).length,
        sessionCount: sessions.length,
        sharedSessionCount: sharedSessions.length,
        shareRecordCount: sessionShares.length,
      });
    });

  return [
    createWorkspaceSummary({
      key: ALL_WORKSPACES_KEY,
      label: '全部工作区',
      pausedCount: input.sharedSessions.filter(
        (sharedSession) => sharedSession.stateStatus === 'paused',
      ).length,
      runningCount: input.sharedSessions.filter(
        (sharedSession) => sharedSession.stateStatus === 'running',
      ).length,
      sessionCount: input.sessions.length,
      sharedSessionCount: input.sharedSessions.length,
      shareRecordCount: input.sessionShares.length,
    }),
    ...workspaceSummaries,
  ];
}

export function filterByWorkspace<T extends { workspacePath: string | null }>(
  items: T[],
  workspaceKey: string,
): T[] {
  if (workspaceKey === ALL_WORKSPACES_KEY) {
    return items;
  }

  return items.filter((item) => resolveWorkspaceKey(item.workspacePath) === workspaceKey);
}

export function buildRuntimeMetrics(input: {
  auditLogs: TeamAuditLogRecord[];
  selectedSharedSession: SharedSessionDetailRecord | null;
  sharedSessions: SharedSessionSummaryRecord[];
  tasks: TeamTaskRecord[];
  workspaceSummary: TeamWorkspaceCardSummary | null;
}): TeamRuntimeMetric[] {
  const pendingPermissionCount = input.selectedSharedSession?.pendingPermissions.length ?? 0;
  const pendingQuestionCount = input.selectedSharedSession?.pendingQuestions.length ?? 0;
  const blockedTaskCount = input.tasks.filter((task) => task.status === 'failed').length;

  return [
    {
      label: '工作区会话',
      value: input.workspaceSummary?.sessionCount ?? 0,
      hint: '当前工作区可追踪的原始会话数',
    },
    {
      label: '共享运行',
      value: input.workspaceSummary?.sharedSessionCount ?? 0,
      hint: '已投影到团队工作台的共享会话',
    },
    {
      label: '运行中',
      value: input.workspaceSummary?.runningCount ?? 0,
      hint: '共享会话当前处于 running 的数量',
    },
    {
      label: '待审批',
      value: pendingPermissionCount,
      hint: '当前选中共享会话里待处理的权限请求',
    },
    {
      label: '待回答',
      value: pendingQuestionCount,
      hint: '当前选中共享会话里待回复的问题请求',
    },
    {
      label: '阻塞任务',
      value: blockedTaskCount,
      hint: '团队任务里已标记为受阻的事项',
    },
    {
      label: '协作审计',
      value: input.auditLogs.length,
      hint: '最近一次共享权限与协作动作轨迹',
    },
    {
      label: '总共享数',
      value: input.sharedSessions.length,
      hint: '当前团队协作页已可读取的共享会话总量',
    },
  ];
}

export function buildWorkspaceOverviewLines(input: {
  interactionRewriteArtifact: InteractionAgentRewriteArtifact | null;
  messages: TeamMessageRecord[];
  selectedSharedSession: SharedSessionDetailRecord | null;
  tasks: TeamTaskRecord[];
  workspaceSummary: TeamWorkspaceCardSummary | null;
}): string[] {
  const lines = [
    input.workspaceSummary?.description ?? '当前还没有接入任何工作区会话。',
    `团队任务 ${input.tasks.length} 条，消息同步 ${input.messages.length} 条。`,
  ];

  if (input.interactionRewriteArtifact) {
    lines.push(
      `interaction-agent 最新改写：${input.interactionRewriteArtifact.rewrittenIntent}。` +
        '当前已可把这条结果继续落到 Team 任务或共享运行。',
    );
  }

  if (input.selectedSharedSession) {
    lines.push(
      `当前聚焦共享会话“${input.selectedSharedSession.share.title ?? input.selectedSharedSession.share.sessionId}”，` +
        `待审批 ${input.selectedSharedSession.pendingPermissions.length} 项，待回答 ${input.selectedSharedSession.pendingQuestions.length} 项。`,
    );
  }

  return lines;
}

export function findLatestAssistantMessage(
  detail: SharedSessionDetailRecord | null,
): string | null {
  const message = [...(detail?.session.messages ?? [])]
    .reverse()
    .find((entry) => entry.role === 'assistant' && typeof entry.content === 'string');

  return typeof message?.content === 'string' ? message.content : null;
}

export function getSharedSessionStateLabel(stateStatus: string): string {
  if (stateStatus === 'running') {
    return '运行中';
  }
  if (stateStatus === 'paused') {
    return '待处理';
  }
  return '已空闲';
}

export function buildWorkspaceContextMetrics(input: {
  selectedSharedSession: SharedSessionDetailRecord | null;
  sessions: Array<{ id: string; title: string | null; workspacePath: string | null }>;
  sessionShares: TeamSessionShareRecord[];
  sharedSessions: SharedSessionSummaryRecord[];
}): TeamWorkspaceContextMetric[] {
  const operateShareCount = input.sessionShares.filter(
    (share) => share.permission === 'operate',
  ).length;
  const commentShareCount = input.sessionShares.filter(
    (share) => share.permission === 'comment',
  ).length;
  const selectedPresenceCount =
    input.selectedSharedSession?.presence.filter((entry) => entry.active).length ?? 0;

  return [
    {
      label: '工作区会话',
      value: input.sessions.length,
      hint: '当前工作区可供协作的基础会话数',
    },
    {
      label: '共享记录',
      value: input.sessionShares.length,
      hint: '已向团队成员显式共享的会话记录',
    },
    {
      label: 'Operate 权限',
      value: operateShareCount,
      hint: '拥有操作权限的共享会话条目',
    },
    {
      label: 'Comment 权限',
      value: commentShareCount,
      hint: '可评论但不可操作的共享会话条目',
    },
    {
      label: '共享运行',
      value: input.sharedSessions.length,
      hint: '当前工作区已投影到运行控制台的共享会话',
    },
    {
      label: '在线查看者',
      value: selectedPresenceCount,
      hint: '当前选中共享会话里的在线查看人数',
    },
  ];
}

export function buildWorkspaceOutputCards(input: {
  interactionRewriteArtifact: InteractionAgentRewriteArtifact | null;
  selectedSharedSession: SharedSessionDetailRecord | null;
  sharedSessions: SharedSessionSummaryRecord[];
}): TeamWorkspaceOutputCard[] {
  const selectedSessionId = input.selectedSharedSession?.share.sessionId ?? null;

  const rewriteCard = input.interactionRewriteArtifact
    ? [
        {
          id: '__interaction_agent_rewrite__',
          title: 'interaction-agent 改写结果',
          stateLabel: '已完成',
          sharedByEmail: 'interaction-agent',
          workspaceLabel: '当前 Team Runtime',
          latestOutput: input.interactionRewriteArtifact.rewrittenIntent,
          pendingApprovalCount: 0,
          pendingQuestionCount: 0,
          helperText:
            `原始意图：${input.interactionRewriteArtifact.sourceIntent}。` +
            input.interactionRewriteArtifact.recommendedNextStep,
        },
      ]
    : [];

  const sortedSharedSessions = selectedSessionId
    ? [...input.sharedSessions].sort((left, right) => {
        if (left.sessionId === selectedSessionId) return -1;
        if (right.sessionId === selectedSessionId) return 1;
        return 0;
      })
    : input.sharedSessions;

  return [
    ...rewriteCard,
    ...sortedSharedSessions.map((sharedSession) => {
      const selected =
        sharedSession.sessionId === selectedSessionId ? input.selectedSharedSession : null;

      return {
        id: sharedSession.sessionId,
        title: sharedSession.title ?? sharedSession.sessionId,
        stateLabel: getSharedSessionStateLabel(sharedSession.stateStatus),
        sharedByEmail: sharedSession.sharedByEmail,
        workspaceLabel: formatWorkspaceLabel(sharedSession.workspacePath),
        latestOutput: selected ? findLatestAssistantMessage(selected) : null,
        pendingApprovalCount: selected?.pendingPermissions.length ?? 0,
        pendingQuestionCount: selected?.pendingQuestions.length ?? 0,
        helperText: selected
          ? '当前卡片已接入所选共享会话详情，可直接查看最新助手输出与待处理项。'
          : '当前只展示工作区级输出摘要；选中该共享会话后可查看更细的运行内容。',
      };
    }),
  ];
}

export function formatChangeSourceKind(sourceKind: string): string {
  if (sourceKind === 'structured_tool_diff') {
    return '工具';
  }
  if (sourceKind === 'session_snapshot') {
    return '快照';
  }
  if (sourceKind === 'restore_replay') {
    return '恢复回放';
  }
  if (sourceKind === 'workspace_reconcile') {
    return '工作区对账';
  }
  if (sourceKind === 'manual_revert') {
    return '手动回退';
  }
  return sourceKind;
}

export function formatSnapshotScopeKind(scopeKind: string | undefined): string {
  if (scopeKind === 'request') {
    return '请求快照';
  }
  if (scopeKind === 'backup') {
    return '备份快照';
  }
  if (scopeKind === 'scope') {
    return '范围快照';
  }
  return '未知快照';
}

export function buildWorkspaceChangeMetrics(input: {
  fileChangesSummary: SessionFileChangesSummary | undefined;
  sessions: Array<{ id: string; title: string | null; workspacePath: string | null }>;
  sharedSessions: SharedSessionSummaryRecord[];
}): TeamWorkspaceChangeMetric[] {
  return [
    {
      label: '工作区会话',
      value: input.sessions.length,
      hint: '当前工作区可追踪的会话数量',
    },
    {
      label: '共享运行',
      value: input.sharedSessions.length,
      hint: '当前工作区可映射到 Team Runtime 的共享运行数量',
    },
    {
      label: '变更文件',
      value: input.fileChangesSummary?.totalFileDiffs ?? 0,
      hint: '当前选中共享运行的文件变更数',
    },
    {
      label: '快照数',
      value: input.fileChangesSummary?.snapshotCount ?? 0,
      hint: '当前选中共享运行已生成的快照数量',
    },
    {
      label: '来源类型',
      value: input.fileChangesSummary?.sourceKinds.length ?? 0,
      hint: '当前选中共享运行的变更来源种类数',
    },
    {
      label: '最近快照',
      value: input.fileChangesSummary?.latestSnapshotAt
        ? new Date(input.fileChangesSummary.latestSnapshotAt).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '未生成',
      hint: '当前选中共享运行最近一次快照时间',
    },
  ];
}
