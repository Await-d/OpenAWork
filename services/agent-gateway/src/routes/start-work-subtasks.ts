import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { RunEvent } from '@openAwork/shared';

type WorkflowTask = Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>['tasks'][string];

export type StartWorkVerifierVerdict =
  | 'confirmed'
  | 'needs-fix'
  | 'false-positive'
  | 'needs-human-review';

export interface StartWorkGateState {
  completionBlocked: boolean;
  executorClaimStatus: 'missing' | 'submitted';
  verifierVerdict: 'pending' | StartWorkVerifierVerdict;
  doneClaim?: {
    claimedAt: number;
    summary: string;
  };
  review?: {
    note?: string;
    reviewedAt: number;
    verdict: StartWorkVerifierVerdict;
  };
}

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

function initialStartWorkGateState(): StartWorkGateState {
  return {
    completionBlocked: true,
    executorClaimStatus: 'missing',
    verifierVerdict: 'pending',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeVerifierVerdict(value: unknown): StartWorkGateState['verifierVerdict'] {
  switch (value) {
    case 'confirmed':
    case 'needs-fix':
    case 'false-positive':
    case 'needs-human-review':
    case 'pending':
      return value;
    default:
      return 'pending';
  }
}

function readDoneClaim(value: unknown): StartWorkGateState['doneClaim'] | undefined {
  if (!isRecord(value) || typeof value['claimedAt'] !== 'number') {
    return undefined;
  }
  const summary = typeof value['summary'] === 'string' ? value['summary'] : '';
  return {
    claimedAt: value['claimedAt'],
    summary,
  };
}

function readReview(value: unknown): StartWorkGateState['review'] | undefined {
  if (!isRecord(value) || typeof value['reviewedAt'] !== 'number') {
    return undefined;
  }
  const verdict = normalizeVerifierVerdict(value['verdict']);
  if (verdict === 'pending') {
    return undefined;
  }
  return {
    ...(typeof value['note'] === 'string' ? { note: value['note'] } : {}),
    reviewedAt: value['reviewedAt'],
    verdict,
  };
}

function readStartWorkGateState(value: unknown): StartWorkGateState {
  if (!isRecord(value)) return initialStartWorkGateState();
  const doneClaim = readDoneClaim(value['doneClaim']);
  const review = readReview(value['review']);
  return {
    completionBlocked: value['completionBlocked'] !== false,
    ...(doneClaim ? { doneClaim } : {}),
    executorClaimStatus: value['executorClaimStatus'] === 'submitted' ? 'submitted' : 'missing',
    ...(review ? { review } : {}),
    verifierVerdict: normalizeVerifierVerdict(value['verifierVerdict']),
  };
}

function taskOrThrow(
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>,
  taskId: string,
) {
  const task = graph.tasks[taskId];
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}

function updateGateMetadata(input: {
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  task: WorkflowTask;
  taskManager: AgentTaskManagerImpl;
  gate: StartWorkGateState;
  result?: string;
}): void {
  input.taskManager.updateTask(input.graph, input.task.id, {
    metadata: {
      ...(input.task.metadata ?? {}),
      startWorkGate: input.gate,
    },
    ...(input.result ? { result: input.result } : {}),
  });
}

export function recordStartWorkDoneClaim(input: {
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  summary: string;
  taskId: string;
  taskManager: AgentTaskManagerImpl;
}): StartWorkGateState {
  const task = taskOrThrow(input.graph, input.taskId);
  const current = readStartWorkGateState(task.metadata?.['startWorkGate']);
  const gate: StartWorkGateState = {
    ...current,
    completionBlocked: true,
    doneClaim: {
      claimedAt: Date.now(),
      summary: input.summary,
    },
    executorClaimStatus: 'submitted',
  };
  updateGateMetadata({
    graph: input.graph,
    task,
    taskManager: input.taskManager,
    gate,
    result: input.summary,
  });
  return gate;
}

export function applyStartWorkVerifierVerdict(input: {
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  note?: string;
  taskId: string;
  taskManager: AgentTaskManagerImpl;
  verdict: StartWorkVerifierVerdict;
}): StartWorkGateState {
  const task = taskOrThrow(input.graph, input.taskId);
  const current = readStartWorkGateState(task.metadata?.['startWorkGate']);
  const gate: StartWorkGateState = {
    ...current,
    completionBlocked: input.verdict !== 'confirmed',
    review: {
      ...(input.note ? { note: input.note } : {}),
      reviewedAt: Date.now(),
      verdict: input.verdict,
    },
    verifierVerdict: input.verdict,
  };
  const result = input.note ?? `Verifier verdict: ${input.verdict}`;

  updateGateMetadata({
    graph: input.graph,
    task,
    taskManager: input.taskManager,
    gate,
    result,
  });

  if (input.verdict === 'confirmed' && task.status === 'running') {
    input.taskManager.completeTask(input.graph, input.taskId, result);
  }

  return gate;
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
      metadata: {
        startWorkGate: initialStartWorkGateState(),
      },
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
