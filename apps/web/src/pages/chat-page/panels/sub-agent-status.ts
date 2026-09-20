import type { Session, SessionTask } from '@openAwork/web-client';

export type SubAgentRunStatus =
  'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'ended';

export interface SubAgentTaskEvidence {
  readonly status: SessionTask['status'];
  readonly updatedAt: number;
}

export interface ResolveSubAgentRunStatusInput {
  /** 父侧派发给该子代理的任务（已按 sessionId 聚合；无则 null） */
  readonly task?: SubAgentTaskEvidence | null;
  /** 子会话快照 state_status（recovery.children / useSubSessionDetail）；undefined = 无证据 */
  readonly childStateStatus?: Session['state_status'] | null;
  /** 子代理自身内部任务（面板用）；可选 */
  readonly internalTasks?: readonly SubAgentTaskEvidence[] | null;
  /** 便于测试注入；默认 Date.now() */
  readonly nowMs?: number;
}

const TASK_STARTUP_GRACE_MS = 6000;

function isTerminalTaskStatus(status: SessionTask['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/** 同一子代理可能有多条任务：按 updatedAt 取最新；updatedAt 相同则终态优先。 */
export function aggregateSubAgentTask<T extends SubAgentTaskEvidence>(
  tasks: readonly T[],
): T | null {
  let latest: T | null = null;

  for (const task of tasks) {
    if (latest === null || task.updatedAt > latest.updatedAt) {
      latest = task;
      continue;
    }

    if (
      task.updatedAt === latest.updatedAt &&
      !isTerminalTaskStatus(latest.status) &&
      isTerminalTaskStatus(task.status)
    ) {
      latest = task;
    }
  }

  return latest;
}

export function resolveSubAgentRunStatus(input: ResolveSubAgentRunStatusInput): SubAgentRunStatus {
  const childStateStatus = input.childStateStatus ?? null;
  const task = input.task ?? null;
  const nowMs = input.nowMs ?? Date.now();
  const aggregatedInternalTask = aggregateSubAgentTask(input.internalTasks ?? []);

  // 子会话快照由网关 reconcile 过（无在途流且无新鲜 runtime thread 时 stale running 会被重置为
  // idle；有 pending 权限/提问时为 paused），是新鲜事实，优先于父侧任务记录——否则迟到的
  // 任务终态会把仍在运行的子代理误判成已结束。
  if (childStateStatus === 'paused') {
    return 'paused';
  }

  if (childStateStatus === 'running') {
    return 'running';
  }

  if (task !== null && isTerminalTaskStatus(task.status)) {
    return task.status;
  }

  if (aggregatedInternalTask !== null && isTerminalTaskStatus(aggregatedInternalTask.status)) {
    return aggregatedInternalTask.status;
  }

  if (childStateStatus === 'idle') {
    // 子会话已知不在运行：父侧 running 只可能是刚派发、子会话尚未真正起跑的宽限窗口；
    // 超窗后必须落定为 ended，避免「已结束仍显示运行中」。
    if (task?.status === 'running' && nowMs - task.updatedAt < TASK_STARTUP_GRACE_MS) {
      return 'running';
    }

    if (task?.status === 'pending') {
      return 'pending';
    }

    return 'ended';
  }

  // 无子会话快照（live session_child 事件只带 { sessionId, title }）：退回任务记录本身。
  if (task?.status === 'running') {
    return 'running';
  }

  if (task?.status === 'pending') {
    return 'pending';
  }

  if (aggregatedInternalTask?.status === 'running') {
    return 'running';
  }

  if (aggregatedInternalTask?.status === 'pending') {
    return 'pending';
  }

  return 'pending';
}
