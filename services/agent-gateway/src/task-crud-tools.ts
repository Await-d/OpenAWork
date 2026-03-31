import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { WORKSPACE_ROOT } from './db.js';

const taskCreateInputSchema = z.object({
  subject: z.string().min(1),
  description: z.string().optional(),
  blockedBy: z.array(z.string()).optional().default([]),
  blocks: z.array(z.string()).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  parentID: z.string().optional(),
});

const taskGetInputSchema = z.object({
  id: z.string().min(1),
});

const taskListInputSchema = z.object({});

const taskUpdateInputSchema = z.object({
  id: z.string().min(1),
  subject: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']).optional(),
  addBlocks: z.array(z.string()).optional(),
  addBlockedBy: z.array(z.string()).optional(),
  owner: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

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
  const task = taskManager.addTask(graph, {
    title: input.subject,
    description: input.description,
    status: 'pending',
    blockedBy: input.blockedBy,
    parentTaskId: input.parentID,
    sessionId,
    priority: 'medium',
    tags: input.metadata ? Object.keys(input.metadata).map((key) => `meta:${key}`) : [],
  });
  await taskManager.save(graph);
  return JSON.stringify({ task: { id: task.id, subject: task.title } });
}

export async function runTaskGetTool(sessionId: string, input: z.infer<typeof taskGetInputSchema>) {
  const graph = await loadGraph(sessionId);
  const task = graph.tasks[input.id] ?? null;
  return JSON.stringify({ task });
}

export async function runTaskListTool(sessionId: string) {
  const graph = await loadGraph(sessionId);
  const tasks = Object.values(graph.tasks)
    .filter((task) => task.status !== 'completed' && task.status !== 'cancelled')
    .map((task) => ({
      id: task.id,
      subject: task.title,
      status: task.status,
      blockedBy: task.blockedBy,
    }));
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
  const statusMap = {
    pending: 'pending',
    in_progress: 'running',
    completed: 'completed',
    deleted: 'cancelled',
  } as const;
  taskManager.updateTask(graph, input.id, {
    ...(input.subject !== undefined ? { title: input.subject } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.status ? { status: statusMap[input.status] } : {}),
    ...(input.addBlockedBy
      ? { blockedBy: [...new Set([...task.blockedBy, ...input.addBlockedBy])] }
      : {}),
  });
  await taskManager.save(graph);
  return JSON.stringify({ task: graph.tasks[input.id] });
}
