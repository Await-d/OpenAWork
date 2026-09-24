import { createPermissionsClient, createSessionsClient } from '@openAwork/web-client';
import type {
  PendingPermissionRequest,
  Session,
  SessionTask,
  SessionTodo,
  SessionTodoLanes,
} from '@openAwork/web-client';
export { toSessionPendingPermissionState } from '../../../utils/permission/pending-permission-state.js';

type AbortableSessionsClient = ReturnType<typeof createSessionsClient> & {
  getChildren: (
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<Session[]>;
  getTodoLanes: (
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<SessionTodoLanes>;
  getTasks: (
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<SessionTask[]>;
};

type AbortablePermissionsClient = ReturnType<typeof createPermissionsClient> & {
  listPending: (
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<PendingPermissionRequest[]>;
};

export type SessionTodoItem = SessionTodo;
export type SessionStateStatus = Session['state_status'];

export interface SessionRuntimeSnapshot {
  childrenResult: PromiseSettledResult<Session[]>;
  pendingPermissionsResult: PromiseSettledResult<PendingPermissionRequest[]>;
  tasksResult: PromiseSettledResult<SessionTask[]>;
  todoLanesResult: PromiseSettledResult<SessionTodoLanes>;
}

export async function fetchSessionRuntimeSnapshot(options: {
  gatewayUrl: string;
  sessionId: string;
  signal?: AbortSignal;
  token: string;
}): Promise<SessionRuntimeSnapshot> {
  const sessionsClient = createSessionsClient(options.gatewayUrl) as AbortableSessionsClient;
  const permissionsClient = createPermissionsClient(
    options.gatewayUrl,
  ) as AbortablePermissionsClient;
  const [todoLanesResult, childrenResult, tasksResult, currentPendingPermissionsResult] =
    await Promise.allSettled([
      sessionsClient.getTodoLanes(options.token, options.sessionId, { signal: options.signal }),
      sessionsClient.getChildren(options.token, options.sessionId, { signal: options.signal }),
      sessionsClient.getTasks(options.token, options.sessionId, { signal: options.signal }),
      permissionsClient.listPending(options.token, options.sessionId, { signal: options.signal }),
    ]);

  const childPermissionResults =
    childrenResult.status === 'fulfilled'
      ? await Promise.allSettled(
          childrenResult.value.map((childSession) =>
            permissionsClient.listPending(options.token, childSession.id, {
              signal: options.signal,
            }),
          ),
        )
      : [];

  const fulfilledPermissionBuckets = [
    currentPendingPermissionsResult,
    ...childPermissionResults,
  ].flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const pendingPermissionsResult: PromiseSettledResult<PendingPermissionRequest[]> =
    fulfilledPermissionBuckets.length > 0
      ? {
          status: 'fulfilled',
          value: fulfilledPermissionBuckets.flat().sort((left, right) => {
            if (left.status !== right.status) {
              return left.status === 'pending' ? -1 : 1;
            }

            if (left.sessionId !== right.sessionId) {
              return left.sessionId.localeCompare(right.sessionId, 'en-US');
            }

            return left.createdAt.localeCompare(right.createdAt, 'en-US');
          }),
        }
      : currentPendingPermissionsResult;

  return {
    childrenResult,
    pendingPermissionsResult,
    tasksResult,
    todoLanesResult,
  };
}

export function mergeChildSessions(previous: Session[], next: Session[]): Session[] {
  const merged = new Map<string, Session>();
  next.forEach((session) => {
    merged.set(session.id, session);
  });
  previous.forEach((session) => {
    if (!merged.has(session.id)) {
      merged.set(session.id, session);
    }
  });
  return Array.from(merged.values());
}

export function mergeSessionTasks(previous: SessionTask[], next: SessionTask[]): SessionTask[] {
  const statusRank = (status: SessionTask['status']): number => {
    if (status === 'completed') return 5;
    if (status === 'failed') return 4;
    if (status === 'cancelled') return 3;
    if (status === 'running') return 2;
    return 1;
  };

  const merged = new Map<string, SessionTask>();
  next.forEach((task) => {
    merged.set(task.id, task);
  });
  previous.forEach((task) => {
    const current = merged.get(task.id);
    if (!current) {
      merged.set(task.id, task);
      return;
    }

    const shouldKeepPrevious =
      statusRank(task.status) > statusRank(current.status) ||
      (statusRank(task.status) === statusRank(current.status) &&
        task.updatedAt > current.updatedAt);

    if (shouldKeepPrevious) {
      merged.set(task.id, { ...current, ...task });
    }
  });
  return Array.from(merged.values());
}

export function hasActiveSessionTasks(tasks: SessionTask[]): boolean {
  return tasks.some((task) => task.status === 'pending' || task.status === 'running');
}

export function shouldPollSessionRuntime(options: {
  pendingPermissions: PendingPermissionRequest[];
  sessionStateStatus: SessionStateStatus | null;
  sessionTasks: SessionTask[];
  streaming: boolean;
}): boolean {
  return (
    options.streaming ||
    options.sessionStateStatus === 'paused' ||
    options.sessionStateStatus === 'running' ||
    hasActiveSessionTasks(options.sessionTasks) ||
    options.pendingPermissions.some((permission) => permission.status === 'pending')
  );
}

export type SessionStopCapability = 'none' | 'precise' | 'best_effort' | 'observe_only';

/**
 * 主操作按钮的停止能力判定（chat 页的唯一裁决处）。
 *
 * 关键不变量：等待审批 / 等待回答的暂停（`remoteSessionBusyState === 'paused'`）
 * 一律返回 `'none'`——主按钮必须呈现专属等待态（「待处理」+ 时钟图标），不能
 * 退化成停止按钮，否则用户会误以为会话已停止。暂停时若想取消本次运行，走审批卡 /
 * 问题面板的拒绝入口，而不是把停止按钮当作默认动作。
 */
export function resolveSessionStopCapability(input: {
  canStopCurrentSessionStream: boolean;
  currentSessionId: string | null;
  remoteSessionBusyState: 'running' | 'paused' | null;
  sessionStateStatus: SessionStateStatus | null | undefined;
  streaming: boolean;
}): SessionStopCapability {
  if (input.streaming || input.canStopCurrentSessionStream) {
    return 'precise';
  }

  // 待审批 / 待回答优先于 status：`remoteSessionBusyState === 'paused'` 既覆盖
  // 「网关状态 paused」也覆盖「仍有 pending 交互」——后者可能伴随 status 仍是
  // running 的瞬态（如批量审批续跑中）。此时会话的主状态必须与状态条
  // 「等待审批 / 等待回答」保持一致，不能退化成停止按钮。
  if (input.remoteSessionBusyState === 'paused') {
    return 'none';
  }

  if (input.currentSessionId && input.sessionStateStatus === 'running') {
    return 'best_effort';
  }

  if (input.remoteSessionBusyState !== null) {
    return 'observe_only';
  }

  return 'none';
}

export function flattenSessionTodoLanes(todoLanes: SessionTodoLanes): SessionTodoItem[] {
  return [
    ...todoLanes.main.map((todo) => ({ ...todo, lane: 'main' as const })),
    ...todoLanes.temp.map((todo) => ({ ...todo, lane: 'temp' as const })),
  ];
}
