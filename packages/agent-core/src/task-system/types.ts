import { z } from 'zod';

export type AgentTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentTask {
  id: string;
  title: string;
  description?: string;
  status: AgentTaskStatus;
  blockedBy: string[];
  parentTaskId?: string;
  sessionId?: string;
  assignedAgent?: string;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  result?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentTaskGraph {
  projectRoot: string;
  tasks: Record<string, AgentTask>;
  createdAt: number;
  updatedAt: number;
}

const agentTaskStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);

const agentTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  status: agentTaskStatusSchema,
  blockedBy: z.array(z.string()),
  parentTaskId: z.string().optional(),
  sessionId: z.string().optional(),
  assignedAgent: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']),
  tags: z.array(z.string()),
  result: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
});

const agentTaskGraphEnvelopeSchema = z.object({
  projectRoot: z.string().optional(),
  tasks: z.record(z.unknown()).default({}),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

export function normalizePersistedTaskGraph(raw: unknown, projectRoot: string): AgentTaskGraph {
  const now = Date.now();
  const parsedGraph = agentTaskGraphEnvelopeSchema.safeParse(raw);
  if (!parsedGraph.success) {
    return {
      projectRoot,
      tasks: {},
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
        return [parsedTask.data.id, parsedTask.data] as const;
      })
      .filter((entry): entry is readonly [string, AgentTask] => entry !== null),
  );

  return {
    projectRoot,
    tasks,
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
  addTask(
    graph: AgentTaskGraph,
    task: Omit<AgentTask, 'id' | 'createdAt' | 'updatedAt'>,
  ): AgentTask;
  updateTask(graph: AgentTaskGraph, taskId: string, patch: Partial<AgentTask>): void;
  removeTask(graph: AgentTaskGraph, taskId: string): void;
  startTask(graph: AgentTaskGraph, taskId: string): void;
  completeTask(graph: AgentTaskGraph, taskId: string, result?: string): void;
  failTask(graph: AgentTaskGraph, taskId: string, error: string): void;
  cancelTask(graph: AgentTaskGraph, taskId: string): void;
  getReadyTasks(graph: AgentTaskGraph): AgentTask[];
  save(graph: AgentTaskGraph): Promise<void>;
}
