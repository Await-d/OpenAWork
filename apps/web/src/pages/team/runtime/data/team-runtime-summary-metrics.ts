import type { AgentTeamsFooterStat, AgentTeamsMetricCard } from './team-runtime-types.js';

export interface TeamRuntimeSummaryMetricsInput {
  scoped: boolean;
  sharedSelected?: boolean;
  membersCount: number;
  teamCompletedTaskCount: number;
  teamTaskCount: number;
  teamMessageCount: number;
  selectedSessionScopeSize: number;
  participatingLayerCount: number;
  runtimeTaskTotal: number;
  completedRuntimeTasks: number;
  failedRuntimeTasks: number;
  runningRuntimeTasks: number;
  pendingRuntimeTasks: number;
  handoffTotal: number;
  sharedSessionCount: number;
  pendingReviewCount: number;
  sharedCommentCount?: number;
  sharedViewerCount?: number;
  sharedRunning?: boolean;
  sharedFailed?: boolean;
}

function computeScopedTaskTotal(input: TeamRuntimeSummaryMetricsInput): number {
  if (input.runtimeTaskTotal > 0) {
    return input.runtimeTaskTotal;
  }
  return (
    input.pendingRuntimeTasks +
    input.runningRuntimeTasks +
    input.completedRuntimeTasks +
    input.failedRuntimeTasks
  );
}

export function buildMetricCards(input: TeamRuntimeSummaryMetricsInput): AgentTeamsMetricCard[] {
  if (input.scoped) {
    const scopedTaskTotal = computeScopedTaskTotal(input);
    return [
      {
        icon: 'members',
        label: '成员',
        value: String(Math.max(1, input.participatingLayerCount)),
      },
      {
        icon: 'tasks',
        label: '任务',
        value: `${input.completedRuntimeTasks}/${scopedTaskTotal}`,
      },
      {
        icon: 'conversation',
        label: '汇报',
        value: String(input.handoffTotal),
      },
    ];
  }

  if (input.sharedSelected) {
    return [
      {
        icon: 'members',
        label: '在线',
        value: String(input.sharedViewerCount ?? 0),
      },
      {
        icon: 'tasks',
        label: '待办',
        value: String(input.pendingReviewCount),
      },
      {
        icon: 'conversation',
        label: '评论',
        value: String(input.sharedCommentCount ?? 0),
      },
    ];
  }

  return [
    {
      icon: 'members',
      label: '成员',
      value: String(input.membersCount),
    },
    {
      icon: 'tasks',
      label: '任务',
      value: `${input.teamCompletedTaskCount}/${input.teamTaskCount}`,
    },
    {
      icon: 'conversation',
      label: '汇报',
      value: String(input.teamMessageCount),
    },
  ];
}

export function buildFooterStats(input: TeamRuntimeSummaryMetricsInput): AgentTeamsFooterStat[] {
  if (input.scoped) {
    return [
      { label: '总', value: String(input.selectedSessionScopeSize) },
      { label: '运行', value: String(input.runningRuntimeTasks) },
      {
        label: '等待',
        value: String(input.pendingRuntimeTasks + input.pendingReviewCount),
      },
      { label: '异常', value: String(input.failedRuntimeTasks) },
    ];
  }

  if (input.sharedSelected) {
    return [
      { label: '总', value: '1' },
      { label: '运行', value: input.sharedRunning ? '1' : '0' },
      { label: '等待', value: String(input.pendingReviewCount) },
      { label: '异常', value: input.sharedFailed ? '1' : '0' },
    ];
  }

  return [
    { label: '总', value: String(input.sharedSessionCount) },
    { label: '运行', value: String(input.runningRuntimeTasks) },
    {
      label: '等待',
      value: String(input.pendingRuntimeTasks + input.pendingReviewCount),
    },
    { label: '异常', value: String(input.failedRuntimeTasks) },
  ];
}

export function buildFooterLead(input: {
  activeAgentCount: number;
  totalMembers: number;
  scoped: boolean;
  sharedSelected?: boolean;
  sharedCommentCount?: number;
  sharedViewerCount?: number;
  participatingLayerCount: number;
  selectedSessionScopeSize: number;
}): string {
  if (input.scoped) {
    return `子树 ${input.selectedSessionScopeSize} / 层级 ${Math.max(1, input.participatingLayerCount)}`;
  }
  if (input.sharedSelected) {
    return `在线 ${input.sharedViewerCount ?? 0} / 评论 ${input.sharedCommentCount ?? 0}`;
  }
  return `活跃 ${input.activeAgentCount} / 共 ${input.totalMembers}`;
}
