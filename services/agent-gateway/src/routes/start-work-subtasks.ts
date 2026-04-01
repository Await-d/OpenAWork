import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { RunEvent } from '@openAwork/shared';

export interface WorkflowPlanChecklistSummary {
  pendingItems: string[];
  relativePath: string;
}

export interface WorkflowPlanIdentity {
  relativePath: string;
  title: string;
}

export function buildWorkflowPlanTag(workflowPlan: WorkflowPlanIdentity): string {
  return `workflow-plan:${workflowPlan.relativePath}`;
}

export function buildStartWorkTaskTags(workflowPlan: WorkflowPlanIdentity | null): string[] {
  if (!workflowPlan) {
    return ['start-work', 'workflow'];
  }

  return ['start-work', 'workflow', 'plan', buildWorkflowPlanTag(workflowPlan)];
}

export function buildWorkflowPlanSubtaskIdempotencyKey(input: {
  parentTaskId: string;
  relativePath: string;
  title: string;
}): string {
  return `start-work:${input.parentTaskId}:${input.relativePath}:${input.title.trim()}`;
}

export function findReusableStartWorkTask(input: {
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  sessionId: string;
  workflowPlan: WorkflowPlanIdentity | null;
}) {
  if (!input.workflowPlan) {
    return null;
  }

  const planTag = buildWorkflowPlanTag(input.workflowPlan);
  return (
    Object.values(input.graph.tasks)
      .filter(
        (task) =>
          task.sessionId === input.sessionId &&
          !task.parentTaskId &&
          task.tags.includes('start-work') &&
          task.tags.includes('plan') &&
          task.status !== 'completed' &&
          task.status !== 'failed' &&
          task.status !== 'cancelled' &&
          task.tags.includes(planTag),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  );
}

export function listWorkflowPlanSubtasks(input: {
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  parentTaskId: string;
  sessionId: string;
  workflowPlan?: WorkflowPlanChecklistSummary;
}): Array<Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>['tasks'][string]> {
  const subtasks = Object.values(input.graph.tasks).filter(
    (task) => task.parentTaskId === input.parentTaskId && task.sessionId === input.sessionId,
  );
  const orderByTitle = new Map(
    (input.workflowPlan?.pendingItems ?? []).map((item, index) => [item.trim(), index] as const),
  );

  return [...subtasks].sort((left, right) => {
    const leftIndex = orderByTitle.get(left.title.trim());
    const rightIndex = orderByTitle.get(right.title.trim());
    if (leftIndex !== undefined && rightIndex !== undefined && leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    if (leftIndex !== undefined && rightIndex === undefined) {
      return -1;
    }
    if (leftIndex === undefined && rightIndex !== undefined) {
      return 1;
    }
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.updatedAt - right.updatedAt;
  });
}

export function createWorkflowPlanSubtasks(input: {
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  parentTaskId: string;
  sessionId: string;
  taskManager: AgentTaskManagerImpl;
  workflowPlan: WorkflowPlanChecklistSummary;
}): Array<Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>['tasks'][string]> {
  const existingSubtasks = Object.values(input.graph.tasks).filter(
    (task) => task.parentTaskId === input.parentTaskId && task.sessionId === input.sessionId,
  );
  const existingSubtaskByTitle = new Map(
    existingSubtasks.map((task) => [task.title.trim(), task] as const),
  );

  const normalizedItems = [
    ...new Set(input.workflowPlan.pendingItems.map((item) => item.trim())),
  ].filter((item) => item.length > 0);

  const subtasks: Array<
    Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>['tasks'][string]
  > = [];
  let previousTaskId: string | undefined;
  for (const item of normalizedItems) {
    const existingTask = existingSubtaskByTitle.get(item);
    const blockedBy = previousTaskId ? [previousTaskId] : [];
    if (existingTask) {
      if (
        existingTask.status === 'pending' &&
        !areTaskDependenciesEqual(existingTask.blockedBy, blockedBy)
      ) {
        input.taskManager.updateTask(input.graph, existingTask.id, { blockedBy });
      }
      previousTaskId = existingTask.id;
      continue;
    }

    const createdTask = input.taskManager.addTask(input.graph, {
      kind: 'workflow_step',
      title: item,
      subject: item,
      description: `来自工作计划 ${input.workflowPlan.relativePath}`,
      status: 'pending',
      blockedBy,
      blocks: [],
      parentTaskId: input.parentTaskId,
      sessionId: input.sessionId,
      priority: previousTaskId ? 'medium' : 'high',
      tags: ['start-work', 'workflow', 'subtask'],
      idempotencyKey: buildWorkflowPlanSubtaskIdempotencyKey({
        parentTaskId: input.parentTaskId,
        relativePath: input.workflowPlan.relativePath,
        title: item,
      }),
    });
    subtasks.push(createdTask);
    previousTaskId = createdTask.id;
  }

  return subtasks;
}

function areTaskDependenciesEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function createTaskUpdateEvent(input: {
  commandId: string;
  eventIdSuffix?: string;
  sessionId: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  task: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>['tasks'][string];
}): Extract<RunEvent, { type: 'task_update' }> {
  return {
    type: 'task_update',
    taskId: input.task.id,
    label: input.task.subject ?? input.task.title,
    status: input.status,
    assignedAgent: input.task.assignedAgent,
    result: input.task.result,
    errorMessage: input.task.errorMessage,
    sessionId: input.sessionId,
    parentTaskId: input.task.parentTaskId,
    eventId: `${input.sessionId}:${input.task.id}:${input.eventIdSuffix ?? 'task'}`,
    runId: `command:${input.sessionId}:${input.commandId}`,
    occurredAt: Date.now(),
  };
}

export function toTaskUpdateStatus(
  status: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>['tasks'][string]['status'],
): 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled' {
  if (status === 'running') {
    return 'in_progress';
  }
  if (status === 'blocked') {
    return 'pending';
  }
  if (status === 'completed') {
    return 'done';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  return 'pending';
}
