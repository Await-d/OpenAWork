import type {
  FileBackupKind,
  FileChangeGuaranteeLevel,
  FileChangeSourceKind,
  FileDiffContent,
  Message,
  RunEvent,
  TaskTimeoutSource,
} from '@openAwork/shared';
import type { PendingPermissionRequest, PermissionDecision } from './permissions.js';
import type { PendingQuestionRequest } from './questions.js';
import { fetchWithTimeout } from '../gateway/http.js';

export type SessionSnapshotScopeKind = 'request' | 'backup' | 'scope' | 'unknown';

export interface SharedSessionPermissionReplyInput {
  alwaysOverride?: string[];
  decision: PermissionDecision;
  requestId: string;
}

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
  parentSessionId?: string | null;
  team_parent_session_id?: string | null;
  state_status?: 'idle' | 'running' | 'paused';
  role_layer?: string | null;
  substate?: string | null;
  messages?: Message[];
  metadata_json?: string;
  runEvents?: RunEvent[];
  todos?: SessionTodo[];
  fileChangesSummary?: SessionFileChangesSummary;
}

export interface SharedSessionCommentRecord {
  authorEmail: string;
  content: string;
  createdAt: string;
  id: string;
  sessionId: string;
}

export interface SharedSessionPresenceRecord {
  active: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  viewerEmail: string;
  viewerUserId: string;
}

export type SharedSessionPermission = 'view' | 'comment' | 'operate';

export interface SharedSessionSummaryRecord {
  sessionId: string;
  title: string | null;
  stateStatus: string;
  workspacePath: string | null;
  sharedByEmail: string;
  permission: SharedSessionPermission;
  createdAt: string;
  updatedAt: string;
  shareCreatedAt: string;
  shareUpdatedAt: string;
}

export interface SharedSessionDetailRecord {
  comments: SharedSessionCommentRecord[];
  pendingPermissions: PendingPermissionRequest[];
  pendingQuestions: PendingQuestionRequest[];
  presence: SharedSessionPresenceRecord[];
  share: SharedSessionSummaryRecord;
  session: Session;
}

export interface SharedSessionCommentActionResult {
  comment: SharedSessionCommentRecord;
  detail?: SharedSessionDetailRecord;
}

export interface SharedSessionDetailActionResult {
  detail?: SharedSessionDetailRecord;
  ok: true;
}

export interface SessionImportInput {
  exportedAt?: string;
  id?: string;
  messages?: unknown[];
}

export interface SessionImportResult {
  sessionId: string;
}

export interface SessionSearchResult {
  createdAtMs: number;
  messageId: string;
  role: string;
  sessionId: string;
  snippet: string;
  title: string | null;
  updatedAt: string;
}

export type SessionMessageRatingValue = 'up' | 'down';

export interface SessionMessageRatingRecord {
  messageId: string;
  notes: string | null;
  rating: SessionMessageRatingValue;
  reason: string | null;
  updatedAt: string;
}

export interface SessionActiveStream {
  clientRequestId: string;
  heartbeatAtMs: number;
  lastSeq: number;
  sessionId: string;
  startedAtMs: number;
}

export interface SessionRecoveryReadModel {
  activeStream: SessionActiveStream | null;
  children: Session[];
  pendingPermissions: PendingPermissionRequest[];
  pendingQuestions: PendingQuestionRequest[];
  ratings: SessionMessageRatingRecord[];
  session: Session;
  tasks: SessionTask[];
  todoLanes: SessionTodoLanes;
  totalMessageCount?: number;
  totalTurnCount?: number | null;
}

export interface SessionRecoveryLoadResult {
  errorMessage?: string;
  ok: boolean;
  recovery?: SessionRecoveryReadModel;
  retryable: boolean;
  status?: number;
}

export interface SessionLoadResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  session?: Session;
  status?: number;
}

export interface SessionStatusReadModel {
  activeStream: SessionActiveStream | null;
  children: Session[];
  pendingPermissions: PendingPermissionRequest[];
  pendingQuestions: PendingQuestionRequest[];
  tasks: SessionTask[];
  todoLanes: SessionTodoLanes;
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
  taskThreadId?: string;
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
  terminalReason?: string;
  timeoutSource?: TaskTimeoutSource;
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

/**
 * Optional filters that the gateway `/sessions` route honours
 * (P3-PATH, opencode #24849 parity). Older gateway versions ignore
 * unknown query params, so omitting these is safe.
 */
export interface SessionsListOptions {
  /** Absolute filesystem path to scope the list to. */
  path?: string;
  /**
   * When `path` is set, controls whether descendants of that path
   * also match. Defaults to `true` server-side.
   */
  includeDescendants?: boolean;
  /**
   * When `true`, excludes team sessions (identified by `role_layer` column
   * or `teamWorkspaceId` in `metadata_json`) from the result set.
   * Used by the chat sidebar to avoid showing team conversations.
   */
  excludeTeam?: boolean;
}

export interface SessionsClient {
  list(token: string, options?: SessionsListOptions): Promise<Session[]>;
  listSharedWithMe(
    token: string,
    options?: { limit?: number; offset?: number; signal?: AbortSignal },
  ): Promise<SharedSessionSummaryRecord[]>;
  create(
    token: string,
    opts?: { title?: string; metadata?: Record<string, unknown> },
  ): Promise<Session>;
  getResult(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionLoadResult>;
  get(token: string, sessionId: string): Promise<Session>;
  getSharedWithMe(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SharedSessionDetailRecord>;
  createSharedComment(
    token: string,
    sessionId: string,
    input: { content: string },
  ): Promise<SharedSessionCommentActionResult>;
  touchSharedPresence(token: string, sessionId: string): Promise<SharedSessionPresenceRecord[]>;
  replySharedSessionPermission(
    token: string,
    sessionId: string,
    input: SharedSessionPermissionReplyInput,
  ): Promise<SharedSessionDetailActionResult>;
  replySharedQuestion(
    token: string,
    sessionId: string,
    input: { answers?: string[][]; requestId: string; status: 'answered' | 'dismissed' },
  ): Promise<SharedSessionDetailActionResult>;
  getRecovery(
    token: string,
    sessionId: string,
    options?: { messageLimit?: number; signal?: AbortSignal; since?: number },
  ): Promise<SessionRecoveryReadModel>;
  getRecoveryResult(
    token: string,
    sessionId: string,
    options?: { messageLimit?: number; signal?: AbortSignal; since?: number },
  ): Promise<SessionRecoveryLoadResult>;
  getStatus(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionStatusReadModel>;
  getActiveStream(token: string, sessionId: string): Promise<SessionActiveStream | null>;
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
  search(
    token: string,
    query: string,
    options?: { limit?: number; signal?: AbortSignal },
  ): Promise<SessionSearchResult[]>;
  listMessageRatings(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionMessageRatingRecord[]>;
  setMessageRating(
    token: string,
    sessionId: string,
    messageId: string,
    input: { rating: SessionMessageRatingValue; reason?: string; notes?: string },
  ): Promise<SessionMessageRatingRecord>;
  deleteMessageRating(token: string, sessionId: string, messageId: string): Promise<void>;
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
    options?: { inclusive?: boolean; messageText?: string },
  ): Promise<Message[]>;
  cancelTask(
    token: string,
    sessionId: string,
    taskId: string,
  ): Promise<{ cancelled: boolean; stopped: boolean }>;
  stopActiveStream(token: string, sessionId: string): Promise<boolean>;
  stopStream(token: string, sessionId: string, clientRequestId: string): Promise<boolean>;
  importSession(token: string, data: SessionImportInput): Promise<SessionImportResult>;
  /**
   * P3-WARP stage 0 (workflow 260509): rebind a session's
   * `workingDirectory`. Without `force`, the gateway preserves the
   * legacy "first workspace wins" lock and returns a 409 if the
   * session is already bound to a different path. `force: true` is
   * the user-explicit warp opt-in — the gateway records a
   * `workspaceWarpHistory` entry alongside the rebind so audits can
   * reconstruct the move later.
   */
  warpWorkspace(
    token: string,
    sessionId: string,
    input: { workingDirectory: string | null; force?: boolean },
  ): Promise<{ ok: true; workingDirectory: string | null; warped?: boolean }>;
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

interface SessionErrorData {
  data?: {
    message?: string;
  };
  error?: string;
  message?: string;
  name?: string;
}

function extractSessionErrorMessage(data: SessionErrorData | undefined): string | null {
  if (typeof data?.error === 'string' && data.error.length > 0) {
    return data.error;
  }
  if (typeof data?.message === 'string' && data.message.length > 0) {
    return data.message;
  }
  if (typeof data?.data?.message === 'string' && data.data.message.length > 0) {
    return data.data.message;
  }
  return null;
}

function isRetryableSessionRecoveryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableSessionStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildSessionErrorMessage(status: number, data: SessionErrorData | undefined): string {
  const extracted = extractSessionErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取该会话。';
  }
  if (status === 404) {
    return '目标会话不存在。';
  }
  return `加载会话失败（HTTP ${status}）。`;
}

function buildSessionRecoveryErrorMessage(
  status: number,
  data: SessionErrorData | undefined,
): string {
  const extracted = extractSessionErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取会话快照。';
  }
  if (status === 404) {
    return '目标会话不存在，无法读取会话快照。';
  }
  return `加载会话快照失败（HTTP ${status}）。`;
}

function buildSessionActionErrorMessage(
  actionLabel: string,
  status: number,
  data: SessionErrorData | undefined,
): string {
  const extracted = extractSessionErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标会话资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericSessionNetworkErrorMessage(message: string): boolean {
  return (
    message === 'Failed to fetch' ||
    message === 'Load failed' ||
    message === 'fetch failed' ||
    message === 'Network request failed' ||
    message === 'NetworkError when attempting to fetch resource.'
  );
}

function normalizeSessionActionError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractSessionErrorMessage(
      (error.data ?? undefined) as SessionErrorData | undefined,
    );
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericSessionNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performSessionRequest<
  T,
  TError extends { error?: string } = { error?: string },
>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const res = await input.request();
    if (!res.ok) {
      const data = await readJsonErrorData<TError>(res);
      throw new HttpError(
        buildSessionActionErrorMessage(
          input.actionLabel,
          res.status,
          data as SessionErrorData | undefined,
        ),
        res.status,
        data,
      );
    }
    if (input.parseJson === false || res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  } catch (error) {
    throw normalizeSessionActionError(input.actionLabel, error);
  }
}

export async function replySharedSessionPermissionRequest(input: {
  gatewayUrl: string;
  payload: SharedSessionPermissionReplyInput;
  sessionId: string;
  token: string;
}): Promise<SharedSessionDetailActionResult> {
  return performSessionRequest<SharedSessionDetailActionResult>({
    actionLabel: '回复共享权限请求',
    request: () =>
      fetchWithTimeout(
        `${input.gatewayUrl}/sessions/shared-with-me/${input.sessionId}/permissions/reply`,
        {
          method: 'POST',
          headers: {
            ...authHeader(input.token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input.payload),
        },
      ),
  });
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
  const getResult = async (
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<SessionLoadResult> => {
    try {
      const res = await fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!res.ok) {
        return {
          ok: false,
          retryable: isRetryableSessionStatus(res.status),
          errorMessage: buildSessionErrorMessage(
            res.status,
            await readJsonErrorData<SessionErrorData>(res),
          ),
          status: res.status,
        };
      }
      const data = (await res.json()) as { session: Session };
      return {
        ok: true,
        retryable: false,
        session: data.session,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeSessionActionError('加载会话', error).message,
      };
    }
  };

  const getRecoveryResult = async (
    token: string,
    sessionId: string,
    options?: { messageLimit?: number; signal?: AbortSignal; since?: number },
  ): Promise<SessionRecoveryLoadResult> => {
    const params = new URLSearchParams();
    if (typeof options?.messageLimit === 'number') {
      params.set('messageLimit', String(options.messageLimit));
    }
    if (typeof options?.since === 'number') {
      params.set('since', String(options.since));
    }
    const qs = params.toString();
    try {
      const res = await fetchWithTimeout(
        `${gatewayUrl}/sessions/${sessionId}/recovery${qs ? `?${qs}` : ''}`,
        {
          headers: authHeader(token),
          signal: options?.signal,
        },
      );
      if (!res.ok) {
        return {
          ok: false,
          retryable: isRetryableSessionRecoveryStatus(res.status),
          errorMessage: buildSessionRecoveryErrorMessage(
            res.status,
            await readJsonErrorData<SessionErrorData>(res),
          ),
          status: res.status,
        };
      }
      const data = (await res.json()) as { recovery: SessionRecoveryReadModel };
      return {
        ok: true,
        retryable: false,
        recovery: data.recovery,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeSessionActionError('加载会话快照', error).message,
      };
    }
  };

  return {
    async list(token, options) {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (options?.path && options.path.trim().length > 0) {
        params.set('path', options.path.trim());
        if (options.includeDescendants === false) {
          params.set('includeDescendants', '0');
        }
      }
      if (options?.excludeTeam) {
        params.set('excludeTeam', 'true');
      }
      const data = await performSessionRequest<{ sessions?: Session[] }>({
        actionLabel: '读取会话列表',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions?${params.toString()}`, {
            headers: authHeader(token),
          }),
      });
      return data.sessions ?? [];
    },

    async listSharedWithMe(token, options) {
      const params = new URLSearchParams();
      if (typeof options?.limit === 'number') {
        params.set('limit', String(options.limit));
      }
      if (typeof options?.offset === 'number') {
        params.set('offset', String(options.offset));
      }
      const suffix = params.toString();
      const data = await performSessionRequest<{ sessions?: SharedSessionSummaryRecord[] }>({
        actionLabel: '读取共享会话列表',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/shared-with-me${suffix ? `?${suffix}` : ''}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.sessions ?? [];
    },

    async create(token, opts = {}) {
      const data = await performSessionRequest<{ session?: Session; sessionId?: string }>({
        actionLabel: '创建会话',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify(opts),
          }),
      });
      return data.session ?? { id: data.sessionId ?? '' };
    },

    getResult,

    async get(token, sessionId) {
      const result = await getResult(token, sessionId);
      if (!result.ok || !result.session) {
        throw new HttpError(result.errorMessage ?? '加载会话失败', result.status ?? 500);
      }
      return result.session;
    },

    async getSharedWithMe(token, sessionId, options) {
      return performSessionRequest<SharedSessionDetailRecord>({
        actionLabel: '读取共享会话详情',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/shared-with-me/${sessionId}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async createSharedComment(token, sessionId, input) {
      return performSessionRequest<SharedSessionCommentActionResult>({
        actionLabel: '发送共享评论',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/shared-with-me/${sessionId}/comments`, {
            method: 'POST',
            headers: {
              ...authHeader(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      });
    },

    async touchSharedPresence(token, sessionId) {
      const data = await performSessionRequest<{ presence?: SharedSessionPresenceRecord[] }>({
        actionLabel: '刷新共享会话在线状态',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/shared-with-me/${sessionId}/presence`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
      return data.presence ?? [];
    },

    async replySharedSessionPermission(token, sessionId, input) {
      return replySharedSessionPermissionRequest({
        gatewayUrl,
        payload: input,
        sessionId,
        token,
      });
    },

    async replySharedQuestion(token, sessionId, input) {
      return performSessionRequest<SharedSessionDetailActionResult>({
        actionLabel: '回复共享提问',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/shared-with-me/${sessionId}/questions/reply`, {
            method: 'POST',
            headers: {
              ...authHeader(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      });
    },

    async getRecovery(token, sessionId, options) {
      const result = await getRecoveryResult(token, sessionId, options);
      if (!result.ok || !result.recovery) {
        throw new HttpError(result.errorMessage ?? '加载会话快照失败', result.status ?? 500);
      }
      return result.recovery;
    },

    getRecoveryResult,

    async getStatus(token, sessionId, options) {
      const data = await performSessionRequest<{ status: SessionStatusReadModel }>({
        actionLabel: '读取会话状态',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/status`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.status;
    },

    async search(token, query, options) {
      const params = new URLSearchParams({ q: query });
      if (typeof options?.limit === 'number') {
        params.set('limit', String(options.limit));
      }
      const data = await performSessionRequest<{ results?: SessionSearchResult[] }>({
        actionLabel: '搜索会话',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/search?${params.toString()}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.results ?? [];
    },

    async listMessageRatings(token, sessionId, options) {
      const data = await performSessionRequest<{ ratings?: SessionMessageRatingRecord[] }>({
        actionLabel: '读取消息评分',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/message-ratings`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.ratings ?? [];
    },

    async setMessageRating(token, sessionId, messageId, input) {
      const data = await performSessionRequest<{ rating?: SessionMessageRatingRecord }>({
        actionLabel: '保存消息评分',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/messages/${messageId}/rating`, {
            method: 'PUT',
            headers: {
              ...authHeader(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      });
      if (!data.rating) {
        throw new Error('评分响应缺少 rating 数据。');
      }
      return data.rating;
    },

    async deleteMessageRating(token, sessionId, messageId) {
      await performSessionRequest({
        actionLabel: '删除消息评分',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/messages/${messageId}/rating`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async getActiveStream(token, sessionId) {
      const data = await performSessionRequest<{ active?: SessionActiveStream | null }>({
        actionLabel: '读取活跃流状态',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/stream/active`, {
            headers: authHeader(token),
          }),
      });
      return data.active ?? null;
    },

    async getFileChangesReadModel(token, sessionId, options) {
      const data = await performSessionRequest<{ readModel: SessionTurnDiffReadModel }>({
        actionLabel: '读取文件变更读模型',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/file-changes/read-model`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.readModel;
    },

    async getFileChanges(token, sessionId, options) {
      const params = new URLSearchParams();
      appendBooleanQuery(params, 'includeText', options?.includeText);
      const query = params.size > 0 ? `?${params.toString()}` : '';
      const data = await performSessionRequest<{ fileChanges: SessionFileChangesProjection }>({
        actionLabel: '读取会话文件变更',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/file-changes${query}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.fileChanges;
    },

    async getRequestFileChanges(token, sessionId, clientRequestId, options) {
      const params = new URLSearchParams();
      appendBooleanQuery(params, 'includeText', options?.includeText);
      const query = params.size > 0 ? `?${params.toString()}` : '';
      return (await performSessionRequest<{
        clientRequestId: string;
        fileChanges: SessionFileChangesProjection;
      }>({
        actionLabel: '读取请求级文件变更',
        request: () =>
          fetchWithTimeout(
            `${gatewayUrl}/sessions/${sessionId}/requests/${encodeURIComponent(clientRequestId)}/file-changes${query}`,
            {
              headers: authHeader(token),
              signal: options?.signal,
            },
          ),
      })) as {
        clientRequestId: string;
        fileChanges: SessionFileChangesProjection;
      };
    },

    async listSnapshots(token, sessionId, options) {
      const data = await performSessionRequest<{ snapshots: SessionSnapshot[] }>({
        actionLabel: '读取会话快照列表',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/snapshots`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.snapshots;
    },

    async getSnapshot(token, sessionId, snapshotRef, options) {
      const params = new URLSearchParams();
      appendBooleanQuery(params, 'includeText', options?.includeText);
      const query = params.size > 0 ? `?${params.toString()}` : '';
      const data = await performSessionRequest<{ snapshot: SessionSnapshot }>({
        actionLabel: '读取会话快照',
        request: () =>
          fetchWithTimeout(
            `${gatewayUrl}/sessions/${sessionId}/snapshots/${encodeURIComponent(snapshotRef)}${query}`,
            {
              headers: authHeader(token),
              signal: options?.signal,
            },
          ),
      });
      return data.snapshot;
    },

    async compareSnapshots(token, sessionId, options) {
      const params = new URLSearchParams({ from: options.from, to: options.to });
      appendBooleanQuery(params, 'includeText', options.includeText);
      return performSessionRequest<SessionSnapshotComparisonResult>({
        actionLabel: '比较会话快照',
        request: () =>
          fetchWithTimeout(
            `${gatewayUrl}/sessions/${sessionId}/snapshots/compare?${params.toString()}`,
            {
              headers: authHeader(token),
              signal: options.signal,
            },
          ),
      });
    },

    async previewRestore(token, sessionId, data) {
      return performSessionRequest<SessionRestorePreviewResult>({
        actionLabel: '预览会话恢复',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/restore/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify(data),
          }),
      });
    },

    async applyRestore(token, sessionId, data) {
      return performSessionRequest<SessionRestoreApplyResult>({
        actionLabel: '应用会话恢复',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/restore/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify(data),
          }),
      });
    },

    async getChildren(token, sessionId, options) {
      const data = await performSessionRequest<{ sessions?: Session[] }>({
        actionLabel: '读取子会话列表',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/children`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.sessions ?? [];
    },

    async getTasks(token, sessionId, options) {
      const data = await performSessionRequest<{ tasks?: SessionTask[] }>({
        actionLabel: '读取会话任务',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/tasks`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.tasks ?? [];
    },

    async getTodos(token, sessionId, options) {
      const data = await performSessionRequest<{ todos?: SessionTodo[] }>({
        actionLabel: '读取会话待办',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/todos`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.todos ?? [];
    },

    async getTodoLanes(token, sessionId, options) {
      const data = await performSessionRequest<Partial<SessionTodoLanes>>({
        actionLabel: '读取会话待办泳道',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/todo-lanes`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return {
        main: data.main ?? [],
        temp: data.temp ?? [],
      };
    },

    async delete(token, sessionId) {
      const data = await performSessionRequest<
        Partial<DeleteSessionResult>,
        DeleteSessionErrorData
      >({
        actionLabel: '删除会话',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
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
      await performSessionRequest({
        actionLabel: '重命名会话',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify({ title }),
          }),
      });
    },

    async updateMetadata(token, sessionId, metadata) {
      await performSessionRequest({
        actionLabel: '更新会话元数据',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify({ metadata }),
          }),
      });
    },

    async truncateMessages(token, sessionId, messageId, options = {}) {
      const data = await performSessionRequest<{ messages?: Message[] }>({
        actionLabel: '截断会话消息',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/messages/truncate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify({
              messageId,
              inclusive: options.inclusive ?? true,
              ...(options.messageText !== undefined ? { messageText: options.messageText } : {}),
            }),
          }),
      });
      return data.messages ?? [];
    },

    async stopStream(token, sessionId, clientRequestId) {
      const data = await performSessionRequest<{ stopped?: boolean }>({
        actionLabel: '停止流式输出',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/stream/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify({ clientRequestId }),
          }),
      });
      return data.stopped === true;
    },

    async stopActiveStream(token, sessionId) {
      const data = await performSessionRequest<{ stopped?: boolean }>({
        actionLabel: '停止当前活跃流',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/stream/stop-active`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
      return data.stopped === true;
    },

    async cancelTask(token, sessionId, taskId) {
      const data = await performSessionRequest<{ cancelled?: boolean; stopped?: boolean }>({
        actionLabel: '取消会话任务',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${sessionId}/tasks/${taskId}/cancel`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
      return { cancelled: data.cancelled === true, stopped: data.stopped === true };
    },

    async importSession(token, data) {
      return performSessionRequest<SessionImportResult>({
        actionLabel: '导入会话',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify(data),
          }),
      });
    },

    async warpWorkspace(token, sessionId, input) {
      return performSessionRequest<
        {
          ok: true;
          workingDirectory: string | null;
          warped?: boolean;
        },
        { error?: string }
      >({
        actionLabel: '切换会话工作区',
        request: () =>
          fetchWithTimeout(`${gatewayUrl}/sessions/${encodeURIComponent(sessionId)}/workspace`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify({
              workingDirectory: input.workingDirectory,
              ...(input.force ? { force: true } : {}),
            }),
          }),
      }) as Promise<{
        ok: true;
        workingDirectory: string | null;
        warped?: boolean;
      }>;
    },
  };
}

// ─── Multi-Attach SSE ─────────────────────────────────────────────────────

/**
 * Callbacks for the multi-attach SSE stream.
 * Unlike the single attach, this does NOT require a clientRequestId — the
 * server auto-discovers the session's active thread and streams all events.
 */
export interface MultiAttachCallbacks {
  onEvent: (event: RunEvent, meta: { rowId: number; clientRequestId?: string }) => void;
  onStatus: (status: {
    type: 'multi-attach:status';
    sessionId: string;
    activeClientRequestId: string | null;
  }) => void;
  onNoActiveStream: (info: { type: 'multi-attach:no-active-stream'; sessionId: string }) => void;
  onError: (code: string, message?: string) => void;
  onDone: () => void;
}

/**
 * Create an EventSource connection to the multi-attach SSE endpoint.
 * Returns the EventSource and a cleanup function.
 *
 * The caller is responsible for closing the EventSource when done.
 */
export function createMultiAttachStream(input: {
  gatewayUrl: string;
  sessionId: string;
  token: string;
  afterSeq?: number;
  callbacks: MultiAttachCallbacks;
}): { eventSource: EventSource; close: () => void } {
  const params = new URLSearchParams({
    token: input.token,
    afterSeq: String(input.afterSeq ?? 0),
  });
  const url = `${input.gatewayUrl}/sessions/${input.sessionId}/stream/multi-attach?${params.toString()}`;
  const eventSource = new EventSource(url);
  let settled = false;

  const close = () => {
    if (settled) return;
    settled = true;
    eventSource.close();
  };

  eventSource.onmessage = (event) => {
    if (settled) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      input.callbacks.onError('MULTI_ATTACH_INVALID_PAYLOAD', '多路流数据解析失败。');
      return;
    }

    const type = parsed['type'] as string | undefined;

    // Control events
    if (type === 'multi-attach:status') {
      input.callbacks.onStatus({
        type: 'multi-attach:status',
        sessionId: (parsed['sessionId'] as string) ?? input.sessionId,
        activeClientRequestId: (parsed['activeClientRequestId'] as string | null) ?? null,
      });
      return;
    }
    if (type === 'multi-attach:no-active-stream') {
      input.callbacks.onNoActiveStream({
        type: 'multi-attach:no-active-stream',
        sessionId: (parsed['sessionId'] as string) ?? input.sessionId,
      });
      settled = true;
      eventSource.close();
      input.callbacks.onDone();
      return;
    }

    // RunEventEnvelope: extract the RunEvent from payload.event
    const payload = parsed['payload'];
    if (payload && typeof payload === 'object' && 'event' in payload) {
      const envelopePayload = payload as Record<string, unknown>;
      const runEvent = envelopePayload['event'] as RunEvent;
      const cursor = envelopePayload['cursor'] as { seq?: number; clientRequestId?: string } | undefined;
      const rowId = cursor?.seq ?? (parsed['seq'] as number | undefined) ?? 0;
      const clientRequestId = cursor?.clientRequestId;

      // P1-1 fix: Do NOT close on terminal events (done/error). The session
      // may start a new round. The connection stays open until the client
      // explicitly closes it (when the session leaves 'running' state) or
      // the server sends 'multi-attach:no-active-stream'.
      input.callbacks.onEvent(runEvent, { rowId, clientRequestId });
      return;
    }

    // Direct RunEvent (without envelope wrapper)
    if (type && typeof type === 'string') {
      const runEvent = parsed as unknown as RunEvent;
      input.callbacks.onEvent(runEvent, { rowId: 0 });
    }
  };

  eventSource.onerror = () => {
    if (settled) return;
    settled = true;
    eventSource.close();
    // Only call onError — do NOT also call onDone.
    // The caller's onError handles reconnection; calling onDone too would
    // cause double-reconnect timers (both onError and onDone schedule
    // reconnects, leading to race conditions).
    input.callbacks.onError('MULTI_ATTACH_DISCONNECTED', '多路流连接已断开。');
  };

  return { eventSource, close };
}
