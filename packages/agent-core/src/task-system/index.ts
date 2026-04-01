import { randomBytes } from 'node:crypto';

import { AgentTaskSchedulerImpl } from './scheduler.js';
import { AgentTaskStoreImpl } from './store.js';
import type {
  AgentTask,
  AgentTaskDraft,
  AgentTaskGraph,
  AgentTaskManager,
  AgentTaskScheduler,
  AgentTaskStore,
} from './types.js';

function createTaskId(): string {
  return `T-${Date.now()}-${randomBytes(3).toString('hex')}`;
}

function touchGraph(graph: AgentTaskGraph): void {
  graph.updatedAt = Date.now();
}

function bumpTaskRevision(task: AgentTask): void {
  task.revision = (task.revision ?? 0) + 1;
}

function normalizeTaskRecord(task: AgentTask): AgentTask {
  return {
    ...task,
    kind: task.kind ?? 'task',
    subject: task.subject ?? task.title,
    blocks: task.blocks ?? [],
    revision: task.revision ?? 0,
  };
}

function getTaskOrThrow(graph: AgentTaskGraph, taskId: string): AgentTask {
  const task = graph.tasks[taskId];
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}

function ensureDependenciesCompleted(graph: AgentTaskGraph, task: AgentTask): void {
  const unmetDependencies = task.blockedBy.filter((dependencyId) => {
    const dependency = graph.tasks[dependencyId];
    return !dependency || dependency.status !== 'completed';
  });

  if (unmetDependencies.length > 0) {
    throw new Error(
      `Task ${task.id} cannot start. Unmet dependencies: ${unmetDependencies.join(', ')}`,
    );
  }
}

function getChildTasks(graph: AgentTaskGraph, parentTaskId: string): AgentTask[] {
  return Object.values(graph.tasks).filter((task) => task.parentTaskId === parentTaskId);
}

function isDescendantTask(
  graph: AgentTaskGraph,
  ancestorTaskId: string,
  descendantTaskId: string,
): boolean {
  const stack = getChildTasks(graph, ancestorTaskId).map((task) => task.id);
  const visited = new Set<string>();

  while (stack.length > 0) {
    const currentTaskId = stack.pop();
    if (!currentTaskId || visited.has(currentTaskId)) {
      continue;
    }
    if (currentTaskId === descendantTaskId) {
      return true;
    }
    visited.add(currentTaskId);
    for (const childTask of getChildTasks(graph, currentTaskId)) {
      stack.push(childTask.id);
    }
  }

  return false;
}

function resolveParentTaskLink(input: {
  graph: AgentTaskGraph;
  taskId?: string;
  parentTaskId?: string;
  sessionId?: string;
}): Pick<AgentTask, 'parentTaskId' | 'sessionId'> {
  const { graph, taskId, parentTaskId, sessionId } = input;
  if (parentTaskId === undefined) {
    return { parentTaskId: undefined, sessionId };
  }

  const parentTask = getTaskOrThrow(graph, parentTaskId);
  if (taskId && parentTask.id === taskId) {
    throw new Error(`Task ${taskId} cannot be its own parent`);
  }

  if (taskId && isDescendantTask(graph, taskId, parentTaskId)) {
    throw new Error(`Task ${taskId} cannot be reparented under descendant ${parentTaskId}`);
  }

  if (
    sessionId !== undefined &&
    parentTask.sessionId !== undefined &&
    parentTask.sessionId !== sessionId
  ) {
    throw new Error(
      `Task ${taskId ?? 'new'} cannot use parent ${parentTaskId} from different session`,
    );
  }

  return {
    parentTaskId,
    sessionId: sessionId ?? parentTask.sessionId,
  };
}

function collectTaskSubtreeIds(graph: AgentTaskGraph, taskId: string): string[] {
  const collectedIds = new Set<string>();
  const stack = [taskId];

  while (stack.length > 0) {
    const currentTaskId = stack.pop();
    if (!currentTaskId || collectedIds.has(currentTaskId)) {
      continue;
    }

    collectedIds.add(currentTaskId);
    for (const childTask of getChildTasks(graph, currentTaskId)) {
      stack.push(childTask.id);
    }
  }

  return [...collectedIds];
}

export class AgentTaskManagerImpl implements AgentTaskManager {
  private readonly store: AgentTaskStore;
  private readonly scheduler: AgentTaskScheduler;

  constructor(options?: { store?: AgentTaskStore; scheduler?: AgentTaskScheduler }) {
    this.store = options?.store ?? new AgentTaskStoreImpl();
    this.scheduler = options?.scheduler ?? new AgentTaskSchedulerImpl();
  }

  async loadOrCreate(projectRoot: string, graphId?: string): Promise<AgentTaskGraph> {
    return this.store.load(projectRoot, graphId);
  }

  addTask(graph: AgentTaskGraph, task: AgentTaskDraft): AgentTask {
    const now = Date.now();
    const relation = resolveParentTaskLink({
      graph,
      parentTaskId: task.parentTaskId,
      sessionId: task.sessionId,
    });
    const newTask: AgentTask = {
      ...task,
      kind: task.kind ?? 'task',
      subject: task.subject ?? task.title,
      parentTaskId: relation.parentTaskId,
      sessionId: relation.sessionId,
      blocks: task.blocks ?? [],
      revision: task.revision ?? 0,
      id: createTaskId(),
      createdAt: now,
      updatedAt: now,
    };
    graph.tasks[newTask.id] = normalizeTaskRecord(newTask);
    touchGraph(graph);
    return graph.tasks[newTask.id]!;
  }

  updateTask(graph: AgentTaskGraph, taskId: string, patch: Partial<AgentTask>): void {
    const task = getTaskOrThrow(graph, taskId);
    const { id: _id, createdAt: _createdAt, ...restPatch } = patch;
    const hasParentPatch = Object.prototype.hasOwnProperty.call(restPatch, 'parentTaskId');
    const hasSessionPatch = Object.prototype.hasOwnProperty.call(restPatch, 'sessionId');
    const relation = resolveParentTaskLink({
      graph,
      taskId,
      parentTaskId: hasParentPatch ? restPatch.parentTaskId : task.parentTaskId,
      sessionId: hasSessionPatch ? restPatch.sessionId : task.sessionId,
    });
    Object.assign(task, restPatch, relation, {
      kind: restPatch.kind ?? task.kind ?? 'task',
      subject: restPatch.subject ?? restPatch.title ?? task.subject ?? task.title,
      blocks: restPatch.blocks ?? task.blocks ?? [],
      updatedAt: Date.now(),
    });
    bumpTaskRevision(task);
    touchGraph(graph);
  }

  removeTask(graph: AgentTaskGraph, taskId: string): void {
    getTaskOrThrow(graph, taskId);
    const removedTaskIds = new Set(collectTaskSubtreeIds(graph, taskId));

    for (const removedTaskId of removedTaskIds) {
      delete graph.tasks[removedTaskId];
    }

    for (const task of Object.values(graph.tasks)) {
      const nextBlockedBy = task.blockedBy.filter(
        (dependencyId) => !removedTaskIds.has(dependencyId),
      );
      if (nextBlockedBy.length !== task.blockedBy.length) {
        task.blockedBy = nextBlockedBy;
        task.updatedAt = Date.now();
        bumpTaskRevision(task);
      }
    }

    touchGraph(graph);
  }

  startTask(graph: AgentTaskGraph, taskId: string): void {
    const task = getTaskOrThrow(graph, taskId);
    if (task.status !== 'pending') {
      throw new Error(`Task ${taskId} cannot start from status ${task.status}`);
    }
    ensureDependenciesCompleted(graph, task);
    const now = Date.now();
    task.status = 'running';
    task.startedAt = now;
    task.updatedAt = now;
    bumpTaskRevision(task);
    touchGraph(graph);
  }

  completeTask(graph: AgentTaskGraph, taskId: string, result?: string): void {
    const task = getTaskOrThrow(graph, taskId);
    if (task.status !== 'running') {
      throw new Error(`Task ${taskId} cannot complete from status ${task.status}`);
    }
    const now = Date.now();
    task.status = 'completed';
    task.result = result;
    task.errorMessage = undefined;
    task.completedAt = now;
    task.updatedAt = now;
    bumpTaskRevision(task);
    touchGraph(graph);
  }

  failTask(graph: AgentTaskGraph, taskId: string, error: string): void {
    const task = getTaskOrThrow(graph, taskId);
    if (task.status !== 'running') {
      throw new Error(`Task ${taskId} cannot fail from status ${task.status}`);
    }
    const now = Date.now();
    task.status = 'failed';
    task.errorMessage = error;
    task.updatedAt = now;
    bumpTaskRevision(task);
    touchGraph(graph);
  }

  cancelTask(graph: AgentTaskGraph, taskId: string): void {
    const task = getTaskOrThrow(graph, taskId);
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(`Task ${taskId} cannot cancel from status ${task.status}`);
    }
    const now = Date.now();
    task.status = 'cancelled';
    task.updatedAt = now;
    bumpTaskRevision(task);
    touchGraph(graph);
  }

  getReadyTasks(graph: AgentTaskGraph): AgentTask[] {
    return this.scheduler.getReadyTasks(graph);
  }

  async save(graph: AgentTaskGraph): Promise<void> {
    touchGraph(graph);
    await this.store.save(graph);
  }
}

export * from './types.js';
export { AgentTaskStoreImpl } from './store.js';
export { AgentTaskSchedulerImpl } from './scheduler.js';
