import type { Message } from '@openAwork/shared';

export interface SessionTodo {
  content: string;
  lane?: 'main' | 'temp';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

export interface SessionTodoLanes {
  main: SessionTodo[];
  temp: SessionTodo[];
}

export interface Session {
  id: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  state_status?: 'idle' | 'running' | 'paused';
  messages?: Message[];
  metadata_json?: string;
  todos?: SessionTodo[];
}

export interface SessionTask {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  blockedBy: string[];
  completedSubtaskCount: number;
  parentTaskId?: string;
  readySubtaskCount: number;
  sessionId?: string;
  assignedAgent?: string;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  depth: number;
  subtaskCount: number;
  unmetDependencyCount: number;
  result?: string;
  errorMessage?: string;
}

export interface DeleteSessionResult {
  deletedSessionIds: string[];
}

export type DeleteSessionBlockReason = 'pendingInteraction' | 'runtimeThread' | 'state' | 'stream';

export interface DeleteSessionErrorData {
  blockReason?: DeleteSessionBlockReason;
  error?: string;
  sessionId?: string;
  state_status?: string;
}

export interface SessionsClient {
  list(token: string): Promise<Session[]>;
  create(
    token: string,
    opts?: { title?: string; metadata?: Record<string, unknown> },
  ): Promise<Session>;
  get(token: string, sessionId: string): Promise<Session>;
  getChildren(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<Session[]>;
  getTasks(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionTask[]>;
  getTodos(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionTodo[]>;
  getTodoLanes(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionTodoLanes>;
  delete(token: string, sessionId: string): Promise<DeleteSessionResult>;
  rename(token: string, sessionId: string, title: string): Promise<void>;
  updateMetadata(
    token: string,
    sessionId: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;
  truncateMessages(
    token: string,
    sessionId: string,
    messageId: string,
    options?: { inclusive?: boolean },
  ): Promise<Message[]>;
  cancelTask(
    token: string,
    sessionId: string,
    taskId: string,
  ): Promise<{ cancelled: boolean; stopped: boolean }>;
  stopStream(token: string, sessionId: string, clientRequestId: string): Promise<boolean>;
  importSession(token: string, data: unknown): Promise<{ sessionId: string }>;
}

export class HttpError<T = unknown> extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data?: T,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export function createSessionsClient(gatewayUrl: string): SessionsClient {
  return {
    async list(token) {
      const res = await fetch(`${gatewayUrl}/sessions?limit=100`, {
        headers: authHeader(token),
      });
      if (!res.ok) throw new HttpError(`Failed to list sessions: ${res.status}`, res.status);
      const data = (await res.json()) as { sessions?: Session[] };
      return data.sessions ?? [];
    },

    async create(token, opts = {}) {
      const res = await fetch(`${gatewayUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify(opts),
      });
      if (!res.ok) throw new HttpError(`Failed to create session: ${res.status}`, res.status);
      const data = (await res.json()) as { session?: Session; sessionId?: string };
      return data.session ?? { id: data.sessionId ?? '' };
    },

    async get(token, sessionId) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}`, {
        headers: authHeader(token),
      });
      if (!res.ok) throw new HttpError(`Failed to get session: ${res.status}`, res.status);
      const data = (await res.json()) as { session: Session };
      return data.session;
    },

    async getChildren(token, sessionId, options) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/children`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!res.ok) {
        throw new HttpError(`Failed to get child sessions: ${res.status}`, res.status);
      }
      const data = (await res.json()) as { sessions?: Session[] };
      return data.sessions ?? [];
    },

    async getTasks(token, sessionId, options) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/tasks`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!res.ok) {
        throw new HttpError(`Failed to get session tasks: ${res.status}`, res.status);
      }
      const data = (await res.json()) as { tasks?: SessionTask[] };
      return data.tasks ?? [];
    },

    async getTodos(token, sessionId, options) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/todos`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!res.ok) {
        throw new HttpError(`Failed to get session todos: ${res.status}`, res.status);
      }
      const data = (await res.json()) as { todos?: SessionTodo[] };
      return data.todos ?? [];
    },

    async getTodoLanes(token, sessionId, options) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/todo-lanes`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!res.ok) {
        throw new HttpError(`Failed to get session todo lanes: ${res.status}`, res.status);
      }
      const data = (await res.json()) as Partial<SessionTodoLanes>;
      return {
        main: data.main ?? [],
        temp: data.temp ?? [],
      };
    },

    async delete(token, sessionId) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      if (!res.ok) {
        const errorData = (await res.json().catch(() => null)) as DeleteSessionErrorData | null;
        throw new HttpError<DeleteSessionErrorData>(
          `Failed to delete session: ${res.status}`,
          res.status,
          errorData ?? undefined,
        );
      }
      const data = (await res.json().catch(() => null)) as Partial<DeleteSessionResult> | null;
      return {
        deletedSessionIds: Array.isArray(data?.deletedSessionIds)
          ? data.deletedSessionIds.filter(
              (deletedSessionId): deletedSessionId is string =>
                typeof deletedSessionId === 'string' && deletedSessionId.length > 0,
            )
          : [],
      };
    },

    async rename(token, sessionId, title) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new HttpError(`Failed to rename session: ${res.status}`, res.status);
    },

    async updateMetadata(token, sessionId, metadata) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify({ metadata }),
      });
      if (!res.ok) {
        throw new HttpError(`Failed to update session metadata: ${res.status}`, res.status);
      }
    },

    async truncateMessages(token, sessionId, messageId, options = {}) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/messages/truncate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify({ messageId, inclusive: options.inclusive ?? true }),
      });
      if (!res.ok) {
        throw new HttpError(`Failed to truncate session messages: ${res.status}`, res.status);
      }
      const data = (await res.json()) as { messages?: Message[] };
      return data.messages ?? [];
    },

    async stopStream(token, sessionId, clientRequestId) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/stream/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify({ clientRequestId }),
      });
      if (!res.ok) {
        throw new HttpError(`Failed to stop stream: ${res.status}`, res.status);
      }
      const data = (await res.json()) as { stopped?: boolean };
      return data.stopped === true;
    },

    async cancelTask(token, sessionId, taskId) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/tasks/${taskId}/cancel`, {
        method: 'POST',
        headers: authHeader(token),
      });
      if (!res.ok) {
        throw new HttpError(`Failed to cancel task: ${res.status}`, res.status);
      }
      const data = (await res.json()) as { cancelled?: boolean; stopped?: boolean };
      return { cancelled: data.cancelled === true, stopped: data.stopped === true };
    },

    async importSession(token, data) {
      const res = await fetch(`${gatewayUrl}/sessions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new HttpError(`Failed to import session: ${res.status}`, res.status);
      return res.json() as Promise<{ sessionId: string }>;
    },
  };
}
