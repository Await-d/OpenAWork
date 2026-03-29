import type { Session, SessionTask } from '@openAwork/web-client';

export type TaskToolRuntimeStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface TaskToolRuntimeSnapshot {
  assignedAgent?: string;
  errorMessage?: string;
  result?: string;
  sessionId?: string;
  status: TaskToolRuntimeStatus;
  taskId: string;
  title: string;
  updatedAt: number;
}

export interface TaskToolRuntimeLookup {
  bySessionId: Map<string, TaskToolRuntimeSnapshot>;
  byTaskId: Map<string, TaskToolRuntimeSnapshot>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function mapTaskStatusToRuntimeStatus(
  taskStatus: SessionTask['status'],
  sessionStateStatus: Session['state_status'] | undefined,
): TaskToolRuntimeStatus {
  if (taskStatus === 'completed') {
    return 'done';
  }

  if (taskStatus === 'failed') {
    return 'failed';
  }

  if (taskStatus === 'cancelled') {
    return 'cancelled';
  }

  if (sessionStateStatus === 'paused') {
    return 'paused';
  }

  if (taskStatus === 'running') {
    return 'running';
  }

  return 'pending';
}

export function buildTaskToolRuntimeLookup(
  childSessions: Session[],
  sessionTasks: SessionTask[],
): TaskToolRuntimeLookup {
  const childSessionsById = new Map(childSessions.map((session) => [session.id, session]));
  const byTaskId = new Map<string, TaskToolRuntimeSnapshot>();
  const bySessionId = new Map<string, TaskToolRuntimeSnapshot>();

  for (const task of sessionTasks) {
    const childSession = task.sessionId ? childSessionsById.get(task.sessionId) : undefined;
    const snapshot: TaskToolRuntimeSnapshot = {
      assignedAgent: task.assignedAgent,
      errorMessage: task.errorMessage,
      result: task.result,
      sessionId: task.sessionId,
      status: mapTaskStatusToRuntimeStatus(task.status, childSession?.state_status),
      taskId: task.id,
      title: task.title,
      updatedAt: task.updatedAt,
    };

    byTaskId.set(task.id, snapshot);
    if (task.sessionId) {
      bySessionId.set(task.sessionId, snapshot);
    }
  }

  return { bySessionId, byTaskId };
}

export function resolveTaskToolRuntimeSnapshot(
  input: Record<string, unknown>,
  output: unknown,
  lookup: TaskToolRuntimeLookup | undefined,
): TaskToolRuntimeSnapshot | undefined {
  if (!lookup) {
    return undefined;
  }

  const outputRecord = asRecord(output);
  const candidateTaskIds = [
    readString(input['task_id']),
    readString(outputRecord?.['taskId']),
  ].filter((value): value is string => Boolean(value));

  for (const candidateTaskId of candidateTaskIds) {
    const snapshot = lookup.byTaskId.get(candidateTaskId);
    if (snapshot) {
      return snapshot;
    }
  }

  const candidateSessionId = readString(outputRecord?.['sessionId']);
  if (!candidateSessionId) {
    return undefined;
  }

  return lookup.bySessionId.get(candidateSessionId);
}

export function buildTerminalTaskSyncMarker(sessionTasks: SessionTask[]): string {
  return sessionTasks
    .filter(
      (task) =>
        task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled',
    )
    .sort((left, right) => left.id.localeCompare(right.id, 'en-US'))
    .map((task) =>
      [task.id, task.status, task.updatedAt, task.result ?? '', task.errorMessage ?? ''].join(':'),
    )
    .join('|');
}
