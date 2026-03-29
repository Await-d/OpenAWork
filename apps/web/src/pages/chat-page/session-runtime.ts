import { createPermissionsClient, createSessionsClient } from '@openAwork/web-client';
import type {
  PendingPermissionRequest,
  Session,
  SessionTask,
  SessionTodo,
  SessionTodoLanes,
} from '@openAwork/web-client';
import type { SessionPendingPermissionState } from '../../utils/session-list-events.js';

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

export function toSessionPendingPermissionState(
  pendingPermissions: PendingPermissionRequest[],
): SessionPendingPermissionState | null {
  const next = pendingPermissions.find((permission) => permission.status === 'pending');
  if (!next) {
    return null;
  }

  return {
    previewAction: next.previewAction,
    reason: next.reason,
    requestId: next.requestId,
    riskLevel: next.riskLevel,
    scope: next.scope,
    targetSessionId: next.sessionId,
    toolName: next.toolName,
  };
}

export function flattenSessionTodoLanes(todoLanes: SessionTodoLanes): SessionTodoItem[] {
  return [
    ...todoLanes.main.map((todo) => ({ ...todo, lane: 'main' as const })),
    ...todoLanes.temp.map((todo) => ({ ...todo, lane: 'temp' as const })),
  ];
}
