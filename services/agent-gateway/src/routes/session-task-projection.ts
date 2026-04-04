import type { AgentTask, AgentTaskGraph } from '@openAwork/agent-core';

export type SessionTaskResponse = AgentTask & {
  completedSubtaskCount: number;
  depth: number;
  effectiveDeadline?: number;
  readySubtaskCount: number;
  subtaskCount: number;
  terminalReason?: string;
  unmetDependencyCount: number;
};

function normalizeProjectedTask(task: AgentTask): AgentTask {
  return {
    ...task,
    kind: task.kind ?? 'task',
    subject: task.subject ?? task.title,
    blocks: task.blocks ?? [],
    revision: task.revision ?? 0,
  };
}

export function buildSessionTaskProjection(
  graph: AgentTaskGraph,
  sessionId: string,
  includeSessionIds: ReadonlySet<string> = new Set([sessionId]),
): SessionTaskResponse[] {
  const sessionTasks = Object.values(graph.tasks).filter(
    (task) => task.sessionId === undefined || includeSessionIds.has(task.sessionId),
  );
  const taskById = new Map(sessionTasks.map((task) => [task.id, task]));
  const childrenByParent = new Map<string, AgentTask[]>();

  for (const task of sessionTasks) {
    const parentTaskId = task.parentTaskId;
    if (!parentTaskId || !taskById.has(parentTaskId)) {
      continue;
    }
    const existingChildren = childrenByParent.get(parentTaskId) ?? [];
    existingChildren.push(task);
    childrenByParent.set(parentTaskId, existingChildren);
  }

  const sortTasks = (tasks: AgentTask[]): AgentTask[] =>
    [...tasks].sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }
      return left.updatedAt - right.updatedAt;
    });

  const orderedTasks: SessionTaskResponse[] = [];
  const visitedTaskIds = new Set<string>();
  const visitTask = (task: AgentTask, depth: number) => {
    if (visitedTaskIds.has(task.id)) {
      return;
    }

    visitedTaskIds.add(task.id);
    const childTasks = sortTasks(childrenByParent.get(task.id) ?? []);
    const unmetDependencyCount = task.blockedBy.filter((dependencyId) => {
      const dependency = graph.tasks[dependencyId];
      return !dependency || dependency.status !== 'completed';
    }).length;
    const readySubtaskCount = childTasks.filter((childTask) => {
      if (childTask.status !== 'pending') {
        return false;
      }
      return childTask.blockedBy.every((dependencyId) => {
        const dependency = graph.tasks[dependencyId];
        return dependency?.status === 'completed';
      });
    }).length;
    orderedTasks.push({
      ...normalizeProjectedTask(task),
      completedSubtaskCount: childTasks.filter((childTask) => childTask.status === 'completed')
        .length,
      depth,
      readySubtaskCount,
      subtaskCount: childTasks.length,
      unmetDependencyCount,
    });

    for (const childTask of childTasks) {
      visitTask(childTask, depth + 1);
    }
  };

  const rootTasks = sortTasks(
    sessionTasks.filter((task) => !task.parentTaskId || !taskById.has(task.parentTaskId)),
  );
  for (const rootTask of rootTasks) {
    visitTask(rootTask, 0);
  }

  const unvisitedTasks = sortTasks(sessionTasks.filter((task) => !visitedTaskIds.has(task.id)));
  for (const task of unvisitedTasks) {
    visitTask(task, 0);
  }

  return orderedTasks;
}
