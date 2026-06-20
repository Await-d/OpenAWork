import type { SessionTask, TeamRuntimeSessionRecord } from '@openAwork/web-client';
import type { HandoffEntry } from '../../../../stores/team/team-events.js';
import type { AgentTeamsSidebarTeam } from './team-runtime-types.js';
import {
  collectSessionScope,
  isHandoffInSessionScope,
  isRuntimeTaskInSessionScope,
} from './team-runtime-session-scope.js';

const ACTIVE_HANDOFF_STATES = new Set<HandoffEntry['state']>(['pending', 'claimed', 'running']);

type RuntimeSessionScopeNode = Pick<TeamRuntimeSessionRecord, 'id' | 'parentSessionId'>;
type RuntimeStatusHandoff = Pick<
  HandoffEntry,
  'fromSessionId' | 'paused' | 'sessionId' | 'state' | 'toSessionId'
>;
type RuntimeStatusTask = Pick<SessionTask, 'sessionId' | 'status'>;

export type TeamRuntimeSemanticStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

export function resolveScopedTeamRuntimeStatus(input: {
  paused?: boolean | null;
  stateStatus?: string | null;
  handoffs?: Iterable<RuntimeStatusHandoff>;
  runtimeTasks?: Iterable<RuntimeStatusTask>;
}): TeamRuntimeSemanticStatus {
  const stateStatus = input.stateStatus?.trim() ?? null;
  let hasActiveHandoff = stateStatus === 'running';
  let hasExplicitPause = input.paused === true || stateStatus === 'paused';
  let hasFailedHandoff = stateStatus === 'failed';
  let hasCompletedHandoff = stateStatus === 'completed';

  for (const handoff of input.handoffs ?? []) {
    if (ACTIVE_HANDOFF_STATES.has(handoff.state)) {
      hasActiveHandoff = true;
    }
    if (handoff.paused === true) {
      hasExplicitPause = true;
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
    if (task.status === 'running') {
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
  const sessionScope = collectSessionScope(input.rootSessionId, input.sessions);
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

  return resolveScopedTeamRuntimeStatus({
    paused: input.paused,
    stateStatus: input.stateStatus,
    handoffs: scopedHandoffs,
    runtimeTasks: scopedRuntimeTasks,
  });
}

export function mapSemanticStatusToSidebarStatus(
  status: TeamRuntimeSemanticStatus,
): AgentTeamsSidebarTeam['status'] {
  if (status === 'idle') {
    return 'completed';
  }
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
