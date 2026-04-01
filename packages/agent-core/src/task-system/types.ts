import { z } from 'zod';

import type {
  InteractionRecord,
  SessionContextRecord,
  TaskEntityRecord,
  TaskOwnership,
  TaskRunRecord,
} from '@openAwork/shared';

export type AgentTaskStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentTask extends Omit<
  TaskEntityRecord,
  'kind' | 'subject' | 'status' | 'blocks' | 'metadata' | 'revision'
> {
  id: string;
  kind?: string;
  title: string;
  subject?: string;
  description?: string;
  status: AgentTaskStatus;
  blockedBy: string[];
  blocks?: string[];
  parentTaskId?: string;
  sessionId?: string;
  assignedAgent?: string;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  ownership?: TaskOwnership;
  createdBy?: TaskOwnership;
  assignedBy?: TaskOwnership;
  executor?: TaskOwnership;
  revision?: number;
  idempotencyKey?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
  result?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentTaskDraft {
  title: string;
  subject?: string;
  kind?: string;
  description?: string;
  status: AgentTaskStatus;
  blockedBy: string[];
  blocks?: string[];
  parentTaskId?: string;
  sessionId?: string;
  assignedAgent?: string;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  ownership?: TaskOwnership;
  createdBy?: TaskOwnership;
  assignedBy?: TaskOwnership;
  executor?: TaskOwnership;
  revision?: number;
  idempotencyKey?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
  result?: string;
  errorMessage?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentTaskRun extends TaskRunRecord {
  runId: string;
}

export interface AgentTaskInteraction extends InteractionRecord {
  interactionId: string;
}

export interface AgentTaskSessionContext extends SessionContextRecord {
  sessionId: string;
}

export interface AgentTaskGraph {
  projectRoot: string;
  tasks: Record<string, AgentTask>;
  runs: Record<string, AgentTaskRun>;
  interactions: Record<string, AgentTaskInteraction>;
  sessionContexts: Record<string, AgentTaskSessionContext>;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
}

const taskOwnershipSchema = z.object({
  principalKind: z.enum(['user', 'agent', 'system', 'service', 'session', 'tool']),
  principalId: z.string().min(1),
  scope: z.string().optional(),
});

const agentTaskStatusSchema = z.enum([
  'pending',
  'running',
  'blocked',
  'completed',
  'failed',
  'cancelled',
]);

const agentTaskSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1).default('task'),
  title: z.string().min(1),
  subject: z.string().min(1).optional(),
  description: z.string().optional(),
  status: agentTaskStatusSchema,
  blockedBy: z.array(z.string()),
  blocks: z.array(z.string()).default([]),
  parentTaskId: z.string().optional(),
  sessionId: z.string().optional(),
  assignedAgent: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']),
  tags: z.array(z.string()),
  ownership: taskOwnershipSchema.optional(),
  createdBy: taskOwnershipSchema.optional(),
  assignedBy: taskOwnershipSchema.optional(),
  executor: taskOwnershipSchema.optional(),
  revision: z.number().int().nonnegative().default(0),
  idempotencyKey: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  result: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
});

const agentTaskRunStatusSchema = z.enum([
  'pending',
  'running',
  'waiting',
  'cancel_requested',
  'completed',
  'failed',
  'cancelled',
]);

const agentTaskRunSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  mode: z.enum(['sync', 'async', 'background', 'remote', 'worktree']),
  presentationMode: z.enum(['foreground', 'background']),
  executorType: z.enum(['subagent', 'shell', 'remote', 'teammate']),
  sessionRef: z.string().min(1),
  status: agentTaskRunStatusSchema,
  deliveryState: z.enum(['pending_delivery', 'delivered', 'suppressed']),
  outputRef: z.string().optional(),
  outputOffset: z.number().int().nonnegative().default(0),
  revision: z.number().int().nonnegative().default(0),
  idempotencyKey: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  bindTaskPolicy: z.enum(['bind-immediately', 'bind-later', 'ephemeral-only']).optional(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
});

const agentTaskInteractionSchema = z.object({
  interactionId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  runId: z.string().min(1),
  type: z.enum(['question', 'permission', 'approval', 'rejection', 'clarification']),
  toolCallRef: z.string().optional(),
  channel: z.enum(['local', 'mailbox', 'leader-relay', 'api']),
  payload: z.record(z.string(), z.unknown()).optional(),
  feedback: z.string().optional(),
  approvalId: z.string().optional(),
  approver: taskOwnershipSchema.optional(),
  decision: z.enum(['approved', 'rejected', 'dismissed', 'expired']).optional(),
  planVersion: z.string().optional(),
  planHash: z.string().optional(),
  causationId: z.string().optional(),
  status: z.enum(['pending', 'answered', 'rejected', 'expired', 'dismissed']),
  answeredAt: z.number().optional(),
});

const agentTaskSessionContextSchema = z.object({
  sessionId: z.string().min(1),
  parentSessionId: z.string().optional(),
  rootSessionId: z.string().optional(),
  status: z.enum(['idle', 'busy', 'retry', 'paused']),
  currentRunId: z.string().optional(),
  planRef: z.string().optional(),
  clientSurface: z.string().optional(),
  revision: z.number().int().nonnegative().default(0),
  updatedAt: z.number(),
});

const agentTaskGraphEnvelopeSchema = z.object({
  projectRoot: z.string().optional(),
  tasks: z.record(z.unknown()).default({}),
  runs: z.record(z.unknown()).default({}),
  interactions: z.record(z.unknown()).default({}),
  sessionContexts: z.record(z.unknown()).default({}),
  schemaVersion: z.number().int().positive().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

function normalizeTaskSubject(task: AgentTask): AgentTask {
  return {
    ...task,
    kind: task.kind ?? 'task',
    subject: task.subject ?? task.title,
  };
}

export function normalizePersistedTaskGraph(raw: unknown, projectRoot: string): AgentTaskGraph {
  const now = Date.now();
  const parsedGraph = agentTaskGraphEnvelopeSchema.safeParse(raw);
  if (!parsedGraph.success) {
    return {
      projectRoot,
      tasks: {},
      runs: {},
      interactions: {},
      sessionContexts: {},
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now,
    };
  }

  const tasks = Object.fromEntries(
    Object.entries(parsedGraph.data.tasks)
      .map(([, taskValue]) => {
        const parsedTask = agentTaskSchema.safeParse(taskValue);
        if (!parsedTask.success) {
          return null;
        }
        return [parsedTask.data.id, normalizeTaskSubject(parsedTask.data)] as const;
      })
      .filter((entry): entry is readonly [string, AgentTask] => entry !== null),
  );

  const runs: Record<string, AgentTaskRun> = {};
  for (const [, runValue] of Object.entries(parsedGraph.data.runs)) {
    const parsedRun = agentTaskRunSchema.safeParse(runValue);
    if (!parsedRun.success) {
      continue;
    }
    runs[parsedRun.data.runId] = parsedRun.data;
  }

  const interactions: Record<string, AgentTaskInteraction> = {};
  for (const [, interactionValue] of Object.entries(parsedGraph.data.interactions)) {
    const parsedInteraction = agentTaskInteractionSchema.safeParse(interactionValue);
    if (!parsedInteraction.success) {
      continue;
    }
    interactions[parsedInteraction.data.interactionId] = parsedInteraction.data;
  }

  const sessionContexts: Record<string, AgentTaskSessionContext> = {};
  for (const [, contextValue] of Object.entries(parsedGraph.data.sessionContexts)) {
    const parsedContext = agentTaskSessionContextSchema.safeParse(contextValue);
    if (!parsedContext.success) {
      continue;
    }
    sessionContexts[parsedContext.data.sessionId] = parsedContext.data;
  }

  return {
    projectRoot,
    tasks,
    runs,
    interactions,
    sessionContexts,
    schemaVersion: parsedGraph.data.schemaVersion ?? 2,
    createdAt: parsedGraph.data.createdAt ?? now,
    updatedAt: parsedGraph.data.updatedAt ?? now,
  };
}

export interface AgentTaskStore {
  load(projectRoot: string, graphId?: string): Promise<AgentTaskGraph>;
  save(graph: AgentTaskGraph): Promise<void>;
  listGraphs(projectRoot: string): Promise<string[]>;
  deleteGraph(projectRoot: string, graphId: string): Promise<void>;
}

export interface AgentTaskScheduler {
  getReadyTasks(graph: AgentTaskGraph): AgentTask[];
  getBlockedTasks(graph: AgentTaskGraph): AgentTask[];
  hasCycle(graph: AgentTaskGraph): boolean;
  topologicalSort(graph: AgentTaskGraph): AgentTask[];
}

export interface AgentTaskManager {
  loadOrCreate(projectRoot: string, graphId?: string): Promise<AgentTaskGraph>;
  addTask(graph: AgentTaskGraph, task: AgentTaskDraft): AgentTask;
  updateTask(graph: AgentTaskGraph, taskId: string, patch: Partial<AgentTask>): void;
  removeTask(graph: AgentTaskGraph, taskId: string): void;
  startTask(graph: AgentTaskGraph, taskId: string): void;
  completeTask(graph: AgentTaskGraph, taskId: string, result?: string): void;
  failTask(graph: AgentTaskGraph, taskId: string, error: string): void;
  cancelTask(graph: AgentTaskGraph, taskId: string): void;
  getReadyTasks(graph: AgentTaskGraph): AgentTask[];
  save(graph: AgentTaskGraph): Promise<void>;
}
