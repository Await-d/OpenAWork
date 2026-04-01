import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { WORKSPACE_ROOT } from './db.js';

const taskOwnershipSchema = z.object({
  principalKind: z.enum(['user', 'agent', 'system', 'service', 'session', 'tool']),
  principalId: z.string().min(1),
  scope: z.string().optional(),
});

const taskCreateInputSchema = z
  .object({
    title: z.string().min(1).optional(),
    subject: z.string().min(1).optional(),
    kind: z.string().min(1).optional().default('task'),
    description: z.string().optional(),
    blockedBy: z.array(z.string()).optional().default([]),
    blocks: z.array(z.string()).optional().default([]),
    parentTaskId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    parentID: z.string().optional(),
    assignedAgent: z.string().optional(),
    owner: z.string().optional(),
    ownership: taskOwnershipSchema.optional(),
    createdBy: taskOwnershipSchema.optional(),
    assignedBy: taskOwnershipSchema.optional(),
    executor: taskOwnershipSchema.optional(),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    tags: z.array(z.string()).optional().default([]),
    idempotencyKey: z.string().min(1).optional(),
    causationId: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (!value.title && !value.subject) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'title or subject is required',
        path: ['title'],
      });
    }
  });

const taskGetInputSchema = z.object({
  id: z.string().min(1),
});

const taskListInputSchema = z.object({});

const taskUpdateInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  subject: z.string().optional(),
  kind: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z
    .enum([
      'pending',
      'running',
      'blocked',
      'completed',
      'failed',
      'cancelled',
      'in_progress',
      'deleted',
    ])
    .optional(),
  parentTaskId: z.string().optional(),
  parentID: z.string().optional(),
  addBlocks: z.array(z.string()).optional(),
  addBlockedBy: z.array(z.string()).optional(),
  assignedAgent: z.string().optional(),
  owner: z.string().optional(),
  ownership: taskOwnershipSchema.optional(),
  createdBy: taskOwnershipSchema.optional(),
  assignedBy: taskOwnershipSchema.optional(),
  executor: taskOwnershipSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  conflictPolicy: z.enum(['reject', 'merge', 'overwrite']).optional().default('reject'),
  idempotencyKey: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
});

function normalizeTaskResponse(task: Awaited<ReturnType<typeof loadGraph>>['tasks'][string]) {
  return {
    id: task.id,
    kind: task.kind ?? 'task',
    title: task.title,
    subject: task.subject ?? task.title,
    description: task.description,
    status: task.status,
    blockedBy: task.blockedBy,
    blocks: task.blocks,
    parentTaskId: task.parentTaskId,
    sessionId: task.sessionId,
    assignedAgent: task.assignedAgent,
    ownership: task.ownership,
    createdBy: task.createdBy,
    assignedBy: task.assignedBy,
    executor: task.executor,
    priority: task.priority,
    tags: task.tags,
    revision: task.revision,
    idempotencyKey: task.idempotencyKey,
    causationId: task.causationId,
    result: task.result,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  };
}

export const taskCreateToolDefinition: ToolDefinition<typeof taskCreateInputSchema, z.ZodString> = {
  name: 'task_create',
  description: 'Create a new task with auto-generated ID and pending status.',
  inputSchema: taskCreateInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('task_create must execute through the gateway-managed sandbox path');
  },
};

export const taskGetToolDefinition: ToolDefinition<typeof taskGetInputSchema, z.ZodString> = {
  name: 'task_get',
  description: 'Retrieve a task by ID.',
  inputSchema: taskGetInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('task_get must execute through the gateway-managed sandbox path');
  },
};

export const taskListToolDefinition: ToolDefinition<typeof taskListInputSchema, z.ZodString> = {
  name: 'task_list',
  description: 'List all active tasks with summary information.',
  inputSchema: taskListInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('task_list must execute through the gateway-managed sandbox path');
  },
};

export const taskUpdateToolDefinition: ToolDefinition<typeof taskUpdateInputSchema, z.ZodString> = {
  name: 'task_update',
  description: 'Update an existing task with new values.',
  inputSchema: taskUpdateInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('task_update must execute through the gateway-managed sandbox path');
  },
};

async function loadGraph(sessionId: string) {
  return new AgentTaskManagerImpl().loadOrCreate(WORKSPACE_ROOT, sessionId);
}

export async function runTaskCreateTool(
  sessionId: string,
  input: z.infer<typeof taskCreateInputSchema>,
) {
  const taskManager = new AgentTaskManagerImpl();
  const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
  const normalizedSubject = input.title ?? input.subject;
  if (!normalizedSubject) {
    return JSON.stringify({ error: 'task_title_required' });
  }
  const normalizedParentTaskId = input.parentTaskId ?? input.parentID;
  const normalizedAssignedAgent = input.assignedAgent ?? input.owner;
  const existingTask = input.idempotencyKey
    ? Object.values(graph.tasks).find((task) => task.idempotencyKey === input.idempotencyKey)
    : undefined;
  if (existingTask) {
    return JSON.stringify({ task: normalizeTaskResponse(existingTask), reused: true });
  }
  const task = taskManager.addTask(graph, {
    kind: input.kind,
    title: normalizedSubject,
    subject: normalizedSubject,
    description: input.description,
    status: 'pending',
    blockedBy: input.blockedBy,
    blocks: input.blocks,
    parentTaskId: normalizedParentTaskId,
    sessionId,
    assignedAgent: normalizedAssignedAgent,
    ownership: input.ownership,
    createdBy: input.createdBy,
    assignedBy: input.assignedBy,
    executor: input.executor,
    priority: input.priority,
    tags: [
      ...input.tags,
      ...(input.metadata ? Object.keys(input.metadata).map((key) => `meta:${key}`) : []),
    ],
    revision: 0,
    idempotencyKey: input.idempotencyKey,
    causationId: input.causationId,
    metadata: input.metadata,
  });
  await taskManager.save(graph);
  return JSON.stringify({ task: normalizeTaskResponse(task), reused: false });
}

export async function runTaskGetTool(sessionId: string, input: z.infer<typeof taskGetInputSchema>) {
  const graph = await loadGraph(sessionId);
  const task = graph.tasks[input.id] ?? null;
  return JSON.stringify({ task: task ? normalizeTaskResponse(task) : null });
}

export async function runTaskListTool(sessionId: string) {
  const graph = await loadGraph(sessionId);
  const tasks = Object.values(graph.tasks)
    .filter((task) => task.status !== 'completed' && task.status !== 'cancelled')
    .map((task) => normalizeTaskResponse(task));
  return JSON.stringify({
    tasks,
    reminder:
      '1 task = 1 task. Maximize parallel execution by running independent tasks concurrently.',
  });
}

export async function runTaskUpdateTool(
  sessionId: string,
  input: z.infer<typeof taskUpdateInputSchema>,
) {
  const taskManager = new AgentTaskManagerImpl();
  const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
  const task = graph.tasks[input.id];
  if (!task) {
    return JSON.stringify({ error: 'task_not_found' });
  }
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== task.revision &&
    input.conflictPolicy !== 'merge' &&
    input.conflictPolicy !== 'overwrite'
  ) {
    return JSON.stringify({
      error: 'revision_conflict',
      currentRevision: task.revision,
      task: normalizeTaskResponse(task),
    });
  }
  const statusMap = {
    pending: 'pending',
    running: 'running',
    blocked: 'blocked',
    in_progress: 'running',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
    deleted: 'cancelled',
  } as const;
  taskManager.updateTask(graph, input.id, {
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.title !== undefined ? { title: input.title, subject: input.title } : {}),
    ...(input.subject !== undefined ? { title: input.subject, subject: input.subject } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.status ? { status: statusMap[input.status] } : {}),
    ...(input.parentTaskId !== undefined || input.parentID !== undefined
      ? { parentTaskId: input.parentTaskId ?? input.parentID }
      : {}),
    ...(input.assignedAgent !== undefined || input.owner !== undefined
      ? { assignedAgent: input.assignedAgent ?? input.owner }
      : {}),
    ...(input.ownership !== undefined ? { ownership: input.ownership } : {}),
    ...(input.createdBy !== undefined ? { createdBy: input.createdBy } : {}),
    ...(input.assignedBy !== undefined ? { assignedBy: input.assignedBy } : {}),
    ...(input.executor !== undefined ? { executor: input.executor } : {}),
    ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.addBlockedBy
      ? { blockedBy: [...new Set([...task.blockedBy, ...input.addBlockedBy])] }
      : {}),
    ...(input.addBlocks
      ? { blocks: [...new Set([...(task.blocks ?? []), ...input.addBlocks])] }
      : {}),
  });
  await taskManager.save(graph);
  return JSON.stringify({ task: normalizeTaskResponse(graph.tasks[input.id]!) });
}
