import type { SessionTask, TeamRuntimeSessionRecord } from '@openAwork/web-client';
import type { HandoffEntry } from '../../../../stores/team/team-events.js';
import type { AgentTeamsSidebarTeam } from './team-runtime-types.js';
import {
  collectSessionScope,
  isHandoffInSessionScope,
  isRuntimeTaskInSessionScope,
} from './team-runtime-session-scope.js';

const ACTIVE_HANDOFF_STATES = new Set<HandoffEntry['state']>(['pending', 'claimed', 'running']);

type RuntimeSessionScopeNode = Pick<
  TeamRuntimeSessionRecord,
  'id' | 'parentSessionId' | 'paused' | 'stateStatus'
>;
type RuntimeStatusHandoff = Pick<
  HandoffEntry,
  'fromSessionId' | 'paused' | 'sessionId' | 'state' | 'toSessionId'
>;
type RuntimeStatusTask = Pick<SessionTask, 'sessionId' | 'status'>;

export type TeamRuntimeSemanticStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export function resolveScopedTeamRuntimeStatus(input: {
  paused?: boolean | null;
  stateStatus?: string | null;
  sessionStates?: Iterable<Pick<TeamRuntimeSessionRecord, 'id' | 'paused' | 'stateStatus'>>;
  handoffs?: Iterable<RuntimeStatusHandoff>;
  runtimeTasks?: Iterable<RuntimeStatusTask>;
}): TeamRuntimeSemanticStatus {
  const stateStatus = input.stateStatus?.trim() ?? null;
  let hasActiveHandoff = stateStatus === 'running' && input.paused !== true;
  let hasExplicitPause = input.paused === true || stateStatus === 'paused';
  let hasFailedHandoff = stateStatus === 'failed';
  let hasCompletedHandoff = stateStatus === 'completed';
  const pausedSessionIds = new Set<string>();
  const sessionStates = Array.from(input.sessionStates ?? []);

  for (const sessionState of sessionStates) {
    const candidateState = sessionState.stateStatus?.trim() ?? null;
    const sessionPaused = sessionState.paused === true || candidateState === 'paused';
    if (sessionPaused) {
      hasExplicitPause = true;
      pausedSessionIds.add(sessionState.id);
    }
    if (candidateState === 'running' && !sessionPaused) {
      hasActiveHandoff = true;
    }
    if (candidateState === 'failed') {
      hasFailedHandoff = true;
    }
    if (candidateState === 'completed') {
      hasCompletedHandoff = true;
    }
  }

  for (const handoff of input.handoffs ?? []) {
    if (handoff.paused === true) {
      hasExplicitPause = true;
      if (handoff.sessionId) {
        pausedSessionIds.add(handoff.sessionId);
      }
      if (handoff.toSessionId) {
        pausedSessionIds.add(handoff.toSessionId);
      }
    }
    if (ACTIVE_HANDOFF_STATES.has(handoff.state) && handoff.paused !== true) {
      hasActiveHandoff = true;
    }
    if (handoff.state === 'failed') {
      hasFailedHandoff = true;
    }
    if (handoff.state === 'completed' || handoff.state === 'cancelled') {
      hasCompletedHandoff = true;
    }
  }

  let hasRunningTask = false;
  let hasFailedTask = false;
  let hasCompletedTask = false;

  for (const task of input.runtimeTasks ?? []) {
    const taskBelongsToPausedSession =
      task.sessionId != null && pausedSessionIds.has(task.sessionId);
    if (task.status === 'running' && !taskBelongsToPausedSession) {
      hasRunningTask = true;
    } else if (task.status === 'failed') {
      hasFailedTask = true;
    } else if (task.status === 'completed') {
      hasCompletedTask = true;
    }
  }

  // 实际活跃工作优先级最高，用来压过滞后的 session state / paused 标记。
  if (hasActiveHandoff || hasRunningTask) {
    return 'running';
  }
  if (hasExplicitPause) {
    return 'paused';
  }
  if (hasFailedHandoff || hasFailedTask) {
    return 'failed';
  }
  if (hasCompletedHandoff || hasCompletedTask) {
    return 'completed';
  }
  return 'idle';
}

export function resolveSessionTreeTeamRuntimeStatus(input: {
  rootSessionId: string | null;
  paused?: boolean | null;
  stateStatus?: string | null;
  sessions: Iterable<RuntimeSessionScopeNode>;
  handoffs?: Iterable<RuntimeStatusHandoff>;
  runtimeTasks?: Iterable<RuntimeStatusTask>;
}): TeamRuntimeSemanticStatus {
  const sessionList = Array.from(input.sessions);
  const sessionScope = collectSessionScope(input.rootSessionId, sessionList);
  const scopedHandoffs: RuntimeStatusHandoff[] = [];
  for (const handoff of input.handoffs ?? []) {
    if (isHandoffInSessionScope(handoff, sessionScope)) {
      scopedHandoffs.push(handoff);
    }
  }

  const scopedRuntimeTasks: RuntimeStatusTask[] = [];
  for (const task of input.runtimeTasks ?? []) {
    if (isRuntimeTaskInSessionScope(task, sessionScope)) {
      scopedRuntimeTasks.push(task);
    }
  }

  const scopedSessionStates = sessionList.filter((session) => sessionScope.has(session.id));

  return resolveScopedTeamRuntimeStatus({
    paused: input.paused,
    stateStatus: input.stateStatus,
    sessionStates: scopedSessionStates,
    handoffs: scopedHandoffs,
    runtimeTasks: scopedRuntimeTasks,
  });
}

export function mapSemanticStatusToSidebarStatus(
  status: TeamRuntimeSemanticStatus,
): AgentTeamsSidebarTeam['status'] {
  return status;
}

export function formatTeamRuntimeSemanticStatus(status: TeamRuntimeSemanticStatus): string {
  if (status === 'running') {
    return '运行中';
  }
  if (status === 'paused') {
    return '已暂停';
  }
  if (status === 'failed') {
    return '失败';
  }
  if (status === 'completed') {
    return '已完成';
  }
  return '已空闲';
}

export function formatSidebarTeamStatus(status: AgentTeamsSidebarTeam['status']): string {
  if (status === 'running') {
    return '运行中';
  }
  if (status === 'paused') {
    return '已暂停';
  }
  if (status === 'failed') {
    return '失败';
  }
  if (status === 'completed') {
    return '已完成';
  }
  return '已空闲';
}

/**
 * 细分失败状态：根据任务完成率、失败数等上下文，
 * 将笼统的 "失败" 细化为更精确、更具可操作性的状态标签。
 *
 * - 'partial_blocked'：部分阻塞（仍有任务在运行，但部分已失败）
 * - 'awaiting_confirmation'：等待人工确认（有 pending review 且无运行中任务）
 * - 'system_error'：系统异常（全部任务失败或无运行中任务）
 * - 'failed'：兜底
 */
export type RefinedFailedStatus =
  | 'partial_blocked'
  | 'awaiting_confirmation'
  | 'system_error'
  | 'failed';

export function refineFailedStatus(input: {
  status: AgentTeamsSidebarTeam['status'];
  taskTotal?: number;
  taskCompleted?: number;
  taskFailed?: number;
  taskRunning?: number;
  pendingReviewCount?: number;
}): RefinedFailedStatus | null {
  if (input.status !== 'failed') return null;

  const taskRunning = input.taskRunning ?? 0;
  const taskFailed = input.taskFailed ?? 0;
  const taskTotal = input.taskTotal ?? 0;
  const taskCompleted = input.taskCompleted ?? 0;
  const pendingReview = input.pendingReviewCount ?? 0;

  // 仍有任务在运行但部分失败 → 部分阻塞
  if (taskRunning > 0 && taskFailed > 0) {
    return 'partial_blocked';
  }

  // 没有运行中任务但有待审核 → 等待人工确认
  if (taskRunning === 0 && pendingReview > 0) {
    return 'awaiting_confirmation';
  }

  // 全部任务失败或大部分失败且无运行中 → 系统异常
  if (taskTotal > 0 && taskFailed >= taskTotal - taskCompleted && taskRunning === 0) {
    return 'system_error';
  }

  return 'failed';
}

export function formatRefinedFailedStatus(refined: RefinedFailedStatus): string {
  switch (refined) {
    case 'partial_blocked':
      return '部分阻塞';
    case 'awaiting_confirmation':
      return '等待确认';
    case 'system_error':
      return '系统异常';
    case 'failed':
      return '失败';
  }
}

export function refinedFailedStatusColor(refined: RefinedFailedStatus): string {
  switch (refined) {
    case 'partial_blocked':
      return 'var(--contrast)';
    case 'awaiting_confirmation':
      return 'var(--warning)';
    case 'system_error':
      return 'var(--complement)';
    case 'failed':
      return 'var(--complement)';
  }
}

export function resolveSidebarTeamSubtitle(
  status: AgentTeamsSidebarTeam['status'],
  subtitle: string | null | undefined,
): string | null {
  const normalized = subtitle?.trim() ?? '';
  if (!normalized) {
    return null;
  }
  return normalized === formatSidebarTeamStatus(status) ? null : normalized;
}
