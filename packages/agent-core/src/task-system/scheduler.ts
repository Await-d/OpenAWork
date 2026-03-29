import type { AgentTask, AgentTaskGraph, AgentTaskScheduler, AgentTaskStatus } from './types.js';

const BLOCKING_STATUSES: ReadonlySet<AgentTaskStatus> = new Set(['pending', 'running', 'failed']);

function sortTasks(tasks: AgentTask[]): AgentTask[] {
  return [...tasks].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    return a.id.localeCompare(b.id);
  });
}

export class AgentTaskSchedulerImpl implements AgentTaskScheduler {
  getReadyTasks(graph: AgentTaskGraph): AgentTask[] {
    const tasks = Object.values(graph.tasks);
    const ready = tasks.filter((task) => {
      if (task.status !== 'pending') {
        return false;
      }
      return task.blockedBy.every(
        (dependencyId) => graph.tasks[dependencyId]?.status === 'completed',
      );
    });
    return sortTasks(ready);
  }

  getBlockedTasks(graph: AgentTaskGraph): AgentTask[] {
    const tasks = Object.values(graph.tasks);
    const blocked = tasks.filter((task) =>
      task.blockedBy.some((dependencyId) => {
        const dependency = graph.tasks[dependencyId];
        if (!dependency) {
          return true;
        }
        return BLOCKING_STATUSES.has(dependency.status);
      }),
    );
    return sortTasks(blocked);
  }

  hasCycle(graph: AgentTaskGraph): boolean {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (taskId: string): boolean => {
      if (visited.has(taskId)) {
        return false;
      }
      if (visiting.has(taskId)) {
        return true;
      }

      const task = graph.tasks[taskId];
      if (!task) {
        return false;
      }

      visiting.add(taskId);
      for (const dependencyId of task.blockedBy) {
        if (graph.tasks[dependencyId] && visit(dependencyId)) {
          return true;
        }
      }
      visiting.delete(taskId);
      visited.add(taskId);
      return false;
    };

    return Object.keys(graph.tasks).some((taskId) => visit(taskId));
  }

  topologicalSort(graph: AgentTaskGraph): AgentTask[] {
    const tasks = Object.values(graph.tasks);
    const taskIds = new Set(tasks.map((task) => task.id));
    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const task of tasks) {
      indegree.set(task.id, 0);
      dependents.set(task.id, []);
    }

    for (const task of tasks) {
      for (const dependencyId of task.blockedBy) {
        if (!taskIds.has(dependencyId)) {
          continue;
        }
        indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
        dependents.get(dependencyId)?.push(task.id);
      }
    }

    const queue = sortTasks(tasks.filter((task) => (indegree.get(task.id) ?? 0) === 0));
    const result: AgentTask[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      result.push(current);
      const currentDependents = dependents.get(current.id) ?? [];
      for (const dependentId of currentDependents) {
        const nextIndegree = (indegree.get(dependentId) ?? 0) - 1;
        indegree.set(dependentId, nextIndegree);
        if (nextIndegree === 0) {
          const dependentTask = graph.tasks[dependentId];
          if (dependentTask) {
            queue.push(dependentTask);
            queue.sort((a, b) => {
              if (a.createdAt !== b.createdAt) {
                return a.createdAt - b.createdAt;
              }
              return a.id.localeCompare(b.id);
            });
          }
        }
      }
    }

    if (result.length !== tasks.length) {
      const included = new Set(result.map((task) => task.id));
      const remainder = sortTasks(tasks.filter((task) => !included.has(task.id)));
      result.push(...remainder);
    }

    return result;
  }
}
