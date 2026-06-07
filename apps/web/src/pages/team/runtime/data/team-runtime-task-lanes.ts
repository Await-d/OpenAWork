import type {
  SessionTask,
  TeamRuntimeTaskGroupRecord,
  TeamTaskRecord,
} from '@openAwork/web-client';
import type { AgentTeamsTaskLane } from './team-runtime-types.js';

export function mapTaskToLaneId(status: TeamTaskRecord['status']): AgentTeamsTaskLane['id'] {
  if (status === 'in_progress') {
    return 'doing';
  }
  if (status === 'completed' || status === 'failed') {
    return 'review';
  }
  return 'todo';
}

export function sortTeamTaskRecords(tasks: TeamTaskRecord[]): TeamTaskRecord[] {
  const statusRank: Record<TeamTaskRecord['status'], number> = {
    in_progress: 0,
    pending: 1,
    failed: 2,
    completed: 3,
  };

  return [...tasks].sort((left, right) => {
    const rankDelta = statusRank[left.status] - statusRank[right.status];
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return (right.updatedAt ?? right.createdAt ?? '').localeCompare(
      left.updatedAt ?? left.createdAt ?? '',
      'zh-CN',
    );
  });
}

export function mapRuntimeTasksToTeamTaskRecords(tasks: SessionTask[]): TeamTaskRecord[] {
  return tasks
    .filter((task) => task.status !== 'cancelled')
    .map((task) => ({
      id: task.id,
      title: task.title,
      assigneeId: null,
      status:
        task.status === 'running'
          ? 'in_progress'
          : task.status === 'completed'
            ? 'completed'
            : task.status === 'failed'
              ? 'failed'
              : 'pending',
      priority: task.priority,
      result: task.result ?? task.errorMessage ?? null,
      createdAt: new Date(task.createdAt).toISOString(),
      updatedAt: new Date(task.updatedAt).toISOString(),
    }));
}

export function collectRuntimeTasksForSession(
  runtimeTaskGroups: TeamRuntimeTaskGroupRecord[],
  sessionId: string | null,
): SessionTask[] {
  if (!sessionId) {
    return [];
  }

  const deduped = new Map<string, SessionTask>();
  for (const group of runtimeTaskGroups) {
    const groupContainsSession = group.sessionIds.includes(sessionId);
    for (const task of group.tasks) {
      const taskMatchesSession =
        task.sessionId != null ? task.sessionId === sessionId : groupContainsSession;
      if (!taskMatchesSession) {
        continue;
      }

      const current = deduped.get(task.id);
      if (!current || task.updatedAt > current.updatedAt) {
        deduped.set(task.id, task);
      }
    }
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.updatedAt - right.updatedAt;
  });
}

export function resolveTaskRecordsForView(input: {
  selectedSessionId: string | null;
  runtimeTaskGroups: TeamRuntimeTaskGroupRecord[];
  teamTasks: TeamTaskRecord[];
  runtimeTaskRecords: TeamTaskRecord[];
}): TeamTaskRecord[] {
  if (input.selectedSessionId) {
    return sortTeamTaskRecords(
      mapRuntimeTasksToTeamTaskRecords(
        collectRuntimeTasksForSession(input.runtimeTaskGroups, input.selectedSessionId),
      ),
    );
  }

  if (input.teamTasks.length > 0) {
    return input.teamTasks;
  }

  return input.runtimeTaskRecords;
}
