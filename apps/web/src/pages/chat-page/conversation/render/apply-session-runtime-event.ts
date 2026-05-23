import type { TaskTimeoutSource } from '@openAwork/shared';
import type { Session, SessionTask } from '@openAwork/web-client';

export interface SessionChildRuntimeEventLike {
  sessionId: string;
  title?: string;
}

export interface TaskUpdateRuntimeEventLike {
  assignedAgent?: string;
  errorMessage?: string;
  label: string;
  occurredAt?: number;
  parentTaskId?: string;
  reason?: string;
  result?: string;
  sessionId?: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  taskId: string;
  timeoutSource?: TaskTimeoutSource;
}

export function applySessionChildRuntimeEvent(
  previous: Session[],
  event: SessionChildRuntimeEventLike,
): Session[] {
  if (previous.some((session) => session.id === event.sessionId)) {
    return previous.map((session) =>
      session.id === event.sessionId
        ? { ...session, title: event.title ?? session.title }
        : session,
    );
  }

  return [
    {
      id: event.sessionId,
      title: event.title,
    },
    ...previous,
  ];
}

export function applyTaskUpdateRuntimeEvent(
  previous: SessionTask[],
  event: TaskUpdateRuntimeEventLike,
): SessionTask[] {
  const existingTask = previous.find((task) => task.id === event.taskId);
  const nextTask: SessionTask = {
    assignedAgent: event.assignedAgent ?? existingTask?.assignedAgent,
    blockedBy: existingTask?.blockedBy ?? [],
    completedSubtaskCount: existingTask?.completedSubtaskCount ?? 0,
    createdAt: existingTask?.createdAt ?? event.occurredAt ?? Date.now(),
    depth: event.parentTaskId ? 1 : (existingTask?.depth ?? 0),
    errorMessage: event.errorMessage ?? existingTask?.errorMessage,
    id: event.taskId,
    parentTaskId: event.parentTaskId,
    priority: existingTask?.priority ?? 'medium',
    readySubtaskCount: existingTask?.readySubtaskCount ?? 0,
    result: event.result ?? existingTask?.result,
    sessionId: event.sessionId ?? existingTask?.sessionId,
    status:
      event.status === 'in_progress'
        ? 'running'
        : event.status === 'done'
          ? 'completed'
          : event.status,
    subtaskCount: existingTask?.subtaskCount ?? 0,
    tags: existingTask?.tags ?? [],
    terminalReason: event.reason ?? existingTask?.terminalReason,
    timeoutSource: event.timeoutSource ?? existingTask?.timeoutSource,
    title: event.label,
    unmetDependencyCount: existingTask?.unmetDependencyCount ?? 0,
    updatedAt: event.occurredAt ?? Date.now(),
  };

  const existingIndex = previous.findIndex((task) => task.id === event.taskId);
  if (existingIndex === -1) {
    return [nextTask, ...previous];
  }

  return previous.map((task, index) => (index === existingIndex ? { ...task, ...nextTask } : task));
}
