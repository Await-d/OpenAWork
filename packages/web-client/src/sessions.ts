import type {
  FileBackupKind,
  FileChangeGuaranteeLevel,
  FileChangeSourceKind,
  FileDiffContent,
  Message,
  RunEvent,
} from '@openAwork/shared';

export type SessionSnapshotScopeKind = 'request' | 'backup' | 'scope' | 'unknown';

export interface SessionFileDiffEntry extends Omit<FileDiffContent, 'before' | 'after'> {
  before?: string;
  after?: string;
}

export interface SessionSnapshotSummary {
  additions: number;
  deletions: number;
  files: number;
  guaranteeLevel?: FileChangeGuaranteeLevel;
  sourceKinds?: FileChangeSourceKind[];
}

export interface SessionFileChangesSummary {
  latestSnapshotAt?: string;
  latestSnapshotRef?: string;
  latestSnapshotScopeKind?: SessionSnapshotScopeKind;
  snapshotCount: number;
  sourceKinds: FileChangeSourceKind[];
  totalAdditions: number;
  totalDeletions: number;
  totalFileDiffs: number;
  weakestGuaranteeLevel?: FileChangeGuaranteeLevel;
}

export interface SessionSnapshot {
  clientRequestId?: string;
  createdAt: string;
  files?: SessionFileDiffEntry[];
  scopeKind: SessionSnapshotScopeKind;
  snapshotRef: string;
  summary: SessionSnapshotSummary;
}

export interface SessionFileChangesProjection {
  fileDiffs: SessionFileDiffEntry[];
  snapshots: SessionSnapshot[];
  summary: SessionFileChangesSummary;
}

export interface SessionSnapshotComparisonEntry {
  after?: string;
  before?: string;
  changed: boolean;
  file: string;
  fromExists: boolean;
  fromStatus?: 'added' | 'deleted' | 'modified';
  toExists: boolean;
  toStatus?: 'added' | 'deleted' | 'modified';
}

export interface SessionSnapshotComparisonResult {
  comparison: SessionSnapshotComparisonEntry[];
  from: SessionSnapshot;
  to: SessionSnapshot;
}

export interface SessionFileBackupTarget {
  backupId: string;
  contentFormat?: string;
  contentHash: string;
  contentTier: string;
  createdAt?: string;
  filePath: string;
  kind: FileBackupKind;
  requestId?: string;
  sourceTool?: string;
  toolCallId?: string;
}

export interface SessionRestoreHashValidation {
  available: boolean;
  lineCount?: number;
  matchesExpectedAfter?: boolean;
  matchesExpectedBefore?: boolean;
}

export interface SessionRestoreWorkspaceConflict {
  change?: unknown;
  filePath: string;
}

export interface SessionRestoreWorkspaceReview {
  available: boolean;
  conflicts: SessionRestoreWorkspaceConflict[];
  dirtyCount: number;
  reason?: string;
  workspaceRoot?: string;
}

export interface SessionRestorePreviewDiff {
  changed: boolean;
  diff: SessionFileDiffEntry;
}

export interface SessionSnapshotRestorePreviewDiff extends SessionRestorePreviewDiff {
  currentExists: boolean;
  hashValidation: SessionRestoreHashValidation;
  validPath: boolean;
}

export interface SessionBackupRestorePreviewResult {
  hashValidation: SessionRestoreHashValidation;
  mode: 'backup';
  preview: SessionRestorePreviewDiff;
  target: SessionFileBackupTarget;
  validateOnly: true;
  validation: {
    backupContentAvailable: boolean;
    canRestore: boolean;
    currentExists: boolean;
    validPath: boolean;
  };
  workspaceReview: SessionRestoreWorkspaceReview;
}

export interface SessionSnapshotRestorePreviewResult {
  mode: 'snapshot';
  preview: SessionSnapshotRestorePreviewDiff[];
  target: SessionSnapshot;
  validateOnly: true;
  validation: {
    canRestore: boolean;
    fileCount: number;
  };
  workspaceReview: SessionRestoreWorkspaceReview;
}

export type SessionRestorePreviewResult =
  | SessionBackupRestorePreviewResult
  | SessionSnapshotRestorePreviewResult;

export interface SessionRestoreApplyResult {
  applied: true;
  clientRequestId: string;
  fileCount: number;
  mode: 'backup' | 'snapshot';
}

export interface SessionFileChangesQueryOptions {
  includeText?: boolean;
  signal?: AbortSignal;
}

export interface SessionSnapshotQueryOptions {
  includeText?: boolean;
  signal?: AbortSignal;
}

export interface SessionSnapshotCompareOptions {
  from: string;
  includeText?: boolean;
  signal?: AbortSignal;
  to: string;
}

export interface SessionRestorePreviewInput {
  backupId?: string;
  includeText?: boolean;
  snapshotRef?: string;
}

export interface SessionRestoreApplyInput extends SessionRestorePreviewInput {
  forceConflicts?: boolean;
}

export interface SessionTurnDiffFileSummary {
  additions: number;
  deletions: number;
  file: string;
  guaranteeLevel?: 'strong' | 'medium' | 'weak';
  sourceKind?:
    | 'structured_tool_diff'
    | 'session_snapshot'
    | 'restore_replay'
    | 'workspace_reconcile'
    | 'manual_revert';
  status?: 'added' | 'deleted' | 'modified';
}

export interface SessionTurnDiffReadModel {
  debugSurface: {
    requestFileChangesRouteTemplate: string;
    restorePreviewRoute: string;
    sessionFileChangesRoute: string;
    snapshotCompareRoute: string;
    snapshotDetailRouteTemplate: string;
  };
  sessionSummary: {
    latestSnapshotAt?: string;
    latestSnapshotRef?: string;
    latestSnapshotScopeKind?: 'request' | 'backup' | 'scope' | 'unknown';
    snapshotCount: number;
    sourceKinds: Array<
      | 'structured_tool_diff'
      | 'session_snapshot'
      | 'restore_replay'
      | 'workspace_reconcile'
      | 'manual_revert'
    >;
    totalAdditions: number;
    totalDeletions: number;
    totalFileDiffs: number;
    turnCount: number;
    weakestGuaranteeLevel?: 'strong' | 'medium' | 'weak';
  };
  turns: Array<{
    clientRequestId: string;
    createdAt: string;
    files: SessionTurnDiffFileSummary[];
    snapshotRef: string;
    summary: {
      additions: number;
      deletions: number;
      files: number;
      guaranteeLevel?: 'strong' | 'medium' | 'weak';
      scopeKind: 'request' | 'backup' | 'scope' | 'unknown';
      sourceKinds?: Array<
        | 'structured_tool_diff'
        | 'session_snapshot'
        | 'restore_replay'
        | 'workspace_reconcile'
        | 'manual_revert'
      >;
    };
  }>;
}

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
  runEvents?: RunEvent[];
  todos?: SessionTodo[];
  fileChangesSummary?: SessionFileChangesSummary;
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
  getFileChangesReadModel(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionTurnDiffReadModel>;
  getFileChanges(
    token: string,
    sessionId: string,
    options?: SessionFileChangesQueryOptions,
  ): Promise<SessionFileChangesProjection>;
  getRequestFileChanges(
    token: string,
    sessionId: string,
    clientRequestId: string,
    options?: SessionFileChangesQueryOptions,
  ): Promise<{ clientRequestId: string; fileChanges: SessionFileChangesProjection }>;
  listSnapshots(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionSnapshot[]>;
  getSnapshot(
    token: string,
    sessionId: string,
    snapshotRef: string,
    options?: SessionSnapshotQueryOptions,
  ): Promise<SessionSnapshot>;
  compareSnapshots(
    token: string,
    sessionId: string,
    options: SessionSnapshotCompareOptions,
  ): Promise<SessionSnapshotComparisonResult>;
  previewRestore(
    token: string,
    sessionId: string,
    data: SessionRestorePreviewInput,
  ): Promise<SessionRestorePreviewResult>;
  applyRestore(
    token: string,
    sessionId: string,
    data: SessionRestoreApplyInput,
  ): Promise<SessionRestoreApplyResult>;
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
  stopActiveStream(token: string, sessionId: string): Promise<boolean>;
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

async function readJsonErrorData<T>(response: Response): Promise<T | undefined> {
  const data = (await response.json().catch(() => null)) as T | null;
  return data ?? undefined;
}

function appendBooleanQuery(
  params: URLSearchParams,
  key: string,
  value: boolean | undefined,
): void {
  if (value === undefined) {
    return;
  }
  params.set(key, value ? '1' : '0');
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

    async getFileChangesReadModel(token, sessionId, options) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/file-changes/read-model`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!res.ok) {
        throw new HttpError(`Failed to get file changes read model: ${res.status}`, res.status);
      }
      const data = (await res.json()) as { readModel: SessionTurnDiffReadModel };
      return data.readModel;
    },

    async getFileChanges(token, sessionId, options) {
      const params = new URLSearchParams();
      appendBooleanQuery(params, 'includeText', options?.includeText);
      const query = params.size > 0 ? `?${params.toString()}` : '';
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/file-changes${query}`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!res.ok) {
        throw new HttpError(
          `Failed to get session file changes: ${res.status}`,
          res.status,
          await readJsonErrorData(res),
        );
      }
      const data = (await res.json()) as { fileChanges: SessionFileChangesProjection };
      return data.fileChanges;
    },

    async getRequestFileChanges(token, sessionId, clientRequestId, options) {
      const params = new URLSearchParams();
      appendBooleanQuery(params, 'includeText', options?.includeText);
      const query = params.size > 0 ? `?${params.toString()}` : '';
      const res = await fetch(
        `${gatewayUrl}/sessions/${sessionId}/requests/${encodeURIComponent(clientRequestId)}/file-changes${query}`,
        {
          headers: authHeader(token),
          signal: options?.signal,
        },
      );
      if (!res.ok) {
        throw new HttpError(
          `Failed to get request file changes: ${res.status}`,
          res.status,
          await readJsonErrorData(res),
        );
      }
      return (await res.json()) as {
        clientRequestId: string;
        fileChanges: SessionFileChangesProjection;
      };
    },

    async listSnapshots(token, sessionId, options) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/snapshots`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!res.ok) {
        throw new HttpError(
          `Failed to list snapshots: ${res.status}`,
          res.status,
          await readJsonErrorData(res),
        );
      }
      const data = (await res.json()) as { snapshots: SessionSnapshot[] };
      return data.snapshots;
    },

    async getSnapshot(token, sessionId, snapshotRef, options) {
      const params = new URLSearchParams();
      appendBooleanQuery(params, 'includeText', options?.includeText);
      const query = params.size > 0 ? `?${params.toString()}` : '';
      const res = await fetch(
        `${gatewayUrl}/sessions/${sessionId}/snapshots/${encodeURIComponent(snapshotRef)}${query}`,
        {
          headers: authHeader(token),
          signal: options?.signal,
        },
      );
      if (!res.ok) {
        throw new HttpError(
          `Failed to get snapshot: ${res.status}`,
          res.status,
          await readJsonErrorData(res),
        );
      }
      const data = (await res.json()) as { snapshot: SessionSnapshot };
      return data.snapshot;
    },

    async compareSnapshots(token, sessionId, options) {
      const params = new URLSearchParams({ from: options.from, to: options.to });
      appendBooleanQuery(params, 'includeText', options.includeText);
      const res = await fetch(
        `${gatewayUrl}/sessions/${sessionId}/snapshots/compare?${params.toString()}`,
        {
          headers: authHeader(token),
          signal: options.signal,
        },
      );
      if (!res.ok) {
        throw new HttpError(
          `Failed to compare snapshots: ${res.status}`,
          res.status,
          await readJsonErrorData(res),
        );
      }
      return (await res.json()) as SessionSnapshotComparisonResult;
    },

    async previewRestore(token, sessionId, data) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/restore/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        throw new HttpError(
          `Failed to preview restore: ${res.status}`,
          res.status,
          await readJsonErrorData(res),
        );
      }
      return (await res.json()) as SessionRestorePreviewResult;
    },

    async applyRestore(token, sessionId, data) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/restore/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        throw new HttpError(
          `Failed to apply restore: ${res.status}`,
          res.status,
          await readJsonErrorData(res),
        );
      }
      return (await res.json()) as SessionRestoreApplyResult;
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

    async stopActiveStream(token, sessionId) {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/stream/stop-active`, {
        method: 'POST',
        headers: authHeader(token),
      });
      if (!res.ok) {
        throw new HttpError(`Failed to stop active stream: ${res.status}`, res.status);
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
