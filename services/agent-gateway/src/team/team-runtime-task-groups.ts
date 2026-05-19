interface RuntimeTask {
  createdAt: number;
  depth: number;
  id: string;
  updatedAt: number;
}

export interface RuntimeTaskGroupInput<Task extends RuntimeTask> {
  sessionIds: string[];
  tasks: Task[];
  updatedAt: number;
  workspacePath: string | null;
}

function sortRuntimeTasks<Task extends RuntimeTask>(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }
    return left.updatedAt - right.updatedAt;
  });
}

export function mergeRuntimeTaskGroups<Task extends RuntimeTask>(
  groups: RuntimeTaskGroupInput<Task>[],
): Array<{
  sessionIds: string[];
  tasks: Task[];
  updatedAt: number;
  workspacePath: string | null;
}> {
  const grouped = new Map<
    string,
    {
      sessionIds: Set<string>;
      tasksById: Map<string, Task>;
      updatedAt: number;
      workspacePath: string | null;
    }
  >();

  for (const group of groups) {
    const groupKey = group.workspacePath ?? '__unbound_workspace__';
    const existing = grouped.get(groupKey) ?? {
      sessionIds: new Set<string>(),
      tasksById: new Map<string, Task>(),
      updatedAt: 0,
      workspacePath: group.workspacePath,
    };

    group.sessionIds.forEach((sessionId) => {
      existing.sessionIds.add(sessionId);
    });
    existing.updatedAt = Math.max(existing.updatedAt, group.updatedAt);

    for (const task of group.tasks) {
      const current = existing.tasksById.get(task.id);
      if (!current || task.updatedAt > current.updatedAt) {
        existing.tasksById.set(task.id, task);
      }
    }

    grouped.set(groupKey, existing);
  }

  return Array.from(grouped.values()).map((group) => ({
    sessionIds: [...group.sessionIds],
    tasks: sortRuntimeTasks(Array.from(group.tasksById.values())),
    updatedAt: group.updatedAt,
    workspacePath: group.workspacePath,
  }));
}
