import type {
  Session,
  SessionImportInput,
  SessionImportResult,
  SessionTask,
  SharedSessionCommentActionResult,
  SharedSessionPermissionReplyInput,
  SharedSessionDetailActionResult,
  SharedSessionDetailRecord,
  SharedSessionPresenceRecord,
  SharedSessionSummaryRecord,
} from '../session/sessions.js';
import { replySharedSessionPermissionRequest } from '../session/sessions.js';
import type { FixedTeamMemberSlot } from '@openAwork/shared';
import type { TeamInitState, TeamInitStepKey } from '@openAwork/shared';
import type { HandoffRecord } from './team-handoffs.js';
import { HttpError, readJsonErrorData, fetchWithTimeout } from '../gateway/http.js';

export type TeamMemberSlotInput = FixedTeamMemberSlot;

export type TeamWorkspaceVisibility = 'open' | 'closed' | 'private';

export interface TeamWorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: TeamWorkspaceVisibility;
  defaultWorkingRoot: string | null;
  defaultTeamRoster: TeamMemberSlotInput[];
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type TeamWorkspaceDetail = TeamWorkspaceSummary;

export interface CreateTeamWorkspaceInput {
  name: string;
  description?: string | null;
  visibility?: TeamWorkspaceVisibility;
  defaultWorkingRoot?: string | null;
  defaultTeamRoster?: TeamMemberSlotInput[];
}

export interface UpdateTeamWorkspaceInput {
  name?: string;
  description?: string | null;
  visibility?: TeamWorkspaceVisibility;
  defaultWorkingRoot?: string | null;
  defaultTeamRoster?: TeamMemberSlotInput[];
}

export interface CreateTeamThreadInput {
  metadata?: Record<string, unknown>;
  title?: string;
}

export type TeamSessionTemplateSourceKind = 'blank' | 'builtin-template' | 'saved-template';

export interface CreateTeamSessionInput {
  title?: string;
  source?: {
    kind: TeamSessionTemplateSourceKind;
    templateId?: string;
  };
  memberSlots?: TeamMemberSlotInput[];
  optionalAgentIds?: string[];
  defaultProvider?: string | null;
}

export type ImportTeamWorkspaceSessionInput = SessionImportInput;

export interface TeamMemberRecord {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  avatarUrl: string | null;
  status: 'idle' | 'working' | 'done' | 'error';
  createdAt: string;
}

export interface TeamTaskRecord {
  id: string;
  title: string;
  assigneeId: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high';
  result: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TeamMessageRecord {
  id: string;
  memberId: string;
  content: string;
  type: 'update' | 'question' | 'result' | 'error';
  timestamp: number;
}

export interface CreateTeamMemberInput {
  name: string;
  email: string;
  role?: 'owner' | 'admin' | 'member';
  avatarUrl?: string;
}

export interface CreateTeamTaskInput {
  title: string;
  assigneeId?: string;
  status?: 'pending' | 'in_progress' | 'done';
  priority?: 'low' | 'medium' | 'high';
}

export interface UpdateTeamTaskInput {
  assigneeId?: string | null;
  status?: 'pending' | 'in_progress' | 'done' | 'failed';
  result?: string | null;
}

export interface CreateTeamMessageInput {
  senderId?: string;
  content: string;
  type?: 'update' | 'question' | 'result' | 'error';
}

export interface TeamSessionShareRecord {
  id: string;
  sessionId: string;
  sessionLabel: string;
  workspacePath: string | null;
  memberId: string;
  memberName: string;
  memberEmail: string;
  permission: 'view' | 'comment' | 'operate';
  createdAt: string;
  updatedAt: string;
}

export interface TeamAuditLogRecord {
  id: string;
  action:
    | 'share_created'
    | 'share_deleted'
    | 'share_permission_updated'
    | 'shared_comment_created'
    | 'shared_permission_replied'
    | 'shared_question_replied'
    | 'runtime_incident'
    | 'runtime_alert_control'
    | 'runtime_remediation'
    | 'handoff_control'
    | 'escape_hatch_used'
    | 'route_decision'
    | 'task_created';
  actorEmail: string | null;
  actorUserId: string | null;
  entityType:
    | 'session_share'
    | 'shared_session_comment'
    | 'permission_request'
    | 'question_request'
    | 'team_task'
    | 'session_inbound_message'
    | 'handoff'
    | 'runtime_incident'
    | 'runtime_alert'
    | 'session';
  entityId: string;
  summary: string;
  detail: string | null;
  createdAt: string;
}

export interface CreateTeamSessionShareInput {
  sessionId: string;
  memberId: string;
  permission?: 'view' | 'comment' | 'operate';
}

export interface TeamRuntimeSessionRecord {
  id: string;
  metadataJson: string;
  parentSessionId: string | null;
  roleLayer: string | null;
  stateStatus: string;
  title: string | null;
  updatedAt: string;
  workspacePath: string | null;
}

export interface TeamRuntimeTaskGroupRecord {
  sessionIds: string[];
  tasks: SessionTask[];
  updatedAt: number;
  workspacePath: string | null;
}

export interface TeamRuntimeClarificationRecord {
  answer?: string;
  answeredAt?: number;
  context: string;
  fromSessionId: string;
  id: string;
  sessionId: string;
  status: 'answered' | 'dismissed' | 'pending';
  createdAt: number;
  question: string;
}

export interface TeamRuntimeNotificationRecord {
  layer?: string;
  payload: Record<string, unknown>;
  sessionId?: string;
  taskId?: string;
  timestamp: number;
  type: string;
}

/**
 * 团队执行用量聚合记录（持久化）。按 (session, layer, provider, model) 聚合，
 * 让"度量"tab 在刷新 / 重连后仍能还原历史 token / 费用 / 工具调用，不再只依赖
 * 实时 WS 事件窗口。
 */
export interface TeamUsageRecord {
  sessionId: string;
  layer: string | null;
  agentId: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  callCount: number;
  totalDurationMs: number;
  toolCallCount: number;
  toolErrorCount: number;
  updatedAt: string;
}

export interface TeamRuntimePauseAllResult {
  handoffIds: string[];
  pausedHandoffCount: number;
  pausedSessionCount: number;
  sessionId: string;
  sessionIds: string[];
}

export interface TeamRuntimeResumeAllResult {
  handoffIds: string[];
  resumedHandoffCount: number;
  resumedSessionCount: number;
  sessionId: string;
  sessionIds: string[];
  staleSessionCount: number;
}

export interface TeamRuntimeLatencyStats {
  avgMs: number;
  count: number;
  maxMs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  thresholdMs: number;
  violationCount: number;
}

export interface TeamRuntimeDiagnostics {
  activeAlerts: Array<{
    code:
      | 'architecture-review-blocked'
      | 'handoff-failure'
      | 'latency-violation'
      | 'pending-decisions'
      | 'quality-review-pending'
      | 'quality-review-escalate-to-user'
      | 'quality-review-redispatch'
      | 'quality-review-return-to-c'
      | 'stale-decisions'
      | 'stale-runtime-threads'
      | 'team-events-connection'
      | 'telemetry-disabled';
    firstDetectedAt: number;
    lastDetectedAt: number;
    message: string;
    occurrenceCount: number;
    remediable?: boolean;
    resolvedAt: number | null;
    severity: 'critical' | 'warning' | 'info';
    status: 'acknowledged' | 'ongoing' | 'open' | 'reopened' | 'resolved' | 'suppressed';
    suggestedAction: string;
    note?: string | null;
    suppressedUntilMs?: number | null;
    controlUpdatedAt?: string;
  }>;
  alerts: Array<{
    code:
      | 'architecture-review-blocked'
      | 'handoff-failure'
      | 'latency-violation'
      | 'pending-decisions'
      | 'quality-review-pending'
      | 'quality-review-escalate-to-user'
      | 'quality-review-redispatch'
      | 'quality-review-return-to-c'
      | 'stale-decisions'
      | 'stale-runtime-threads'
      | 'team-events-connection'
      | 'telemetry-disabled';
    message: string;
    remediable?: boolean;
    severity: 'critical' | 'warning' | 'info';
    suggestedAction: string;
  }>;
  capturedAt: string;
  incidentSummary: {
    architecture_review: number;
    handoff_failure: number;
    latency_violation: number;
    team_events_connection: number;
    team_events_listener: number;
  };
  incidents: Array<{
    category:
      | 'architecture_review'
      | 'handoff_failure'
      | 'latency_violation'
      | 'team_events_connection'
      | 'team_events_listener';
    code: string;
    context: Record<string, boolean | number | string | null>;
    message: string;
    severity: 'error' | 'warning';
    timestamp: number;
  }>;
  health: {
    reasons: string[];
    status: 'critical' | 'degraded' | 'healthy';
  };
  qualityReview: {
    escalateToUserCount: number;
    pendingCount: number;
    pendingHandoffs: Array<{
      handoffId: string;
      lastError: string | null;
      lastAttemptAtMs: number | null;
      nextAttemptAtMs: number | null;
      readyNow: boolean;
      sessionId: string | null;
    }>;
    redispatchCount: number;
    retryableErrorCount: number;
    returnToCCount: number;
  };
  telemetry: {
    enabled: boolean;
  };
  latency: {
    a_to_b_ack: TeamRuntimeLatencyStats;
    a_to_b_direct: TeamRuntimeLatencyStats;
    progress_interval: TeamRuntimeLatencyStats;
    substate_push: TeamRuntimeLatencyStats;
  };
  pendingInteractions: {
    affectedSessionCount: number;
    decidingPermissionCount: number;
    decidingQuestionCount: number;
    pendingPermissionCount: number;
    pendingQuestionCount: number;
    staleDecidingPermissionCount: number;
    staleDecidingQuestionCount: number;
    staleDecidingSessionCount: number;
  };
  runtimeThreads: {
    activeCount: number;
    heartbeatIntervalMs: number;
    totalCount: number;
    staleAfterMs: number;
    staleCount: number;
  };
  recentResolvedAlerts: Array<{
    code:
      | 'architecture-review-blocked'
      | 'handoff-failure'
      | 'latency-violation'
      | 'pending-decisions'
      | 'quality-review-pending'
      | 'quality-review-escalate-to-user'
      | 'quality-review-redispatch'
      | 'quality-review-return-to-c'
      | 'stale-decisions'
      | 'stale-runtime-threads'
      | 'team-events-connection'
      | 'telemetry-disabled';
    firstDetectedAt: number;
    lastDetectedAt: number;
    message: string;
    occurrenceCount: number;
    remediable?: boolean;
    resolvedAt: number | null;
    severity: 'critical' | 'warning' | 'info';
    status: 'acknowledged' | 'ongoing' | 'open' | 'reopened' | 'resolved' | 'suppressed';
    suggestedAction: string;
    note?: string | null;
    suppressedUntilMs?: number | null;
    controlUpdatedAt?: string;
  }>;
  teamEvents: {
    listenerCount: number;
    listenerErrorCount: number;
    publishedByType: Partial<
      Record<
        | 'artifact.constitution-conflict'
        | 'artifact.needs-clarification'
        | 'handoff.cancelled'
        | 'handoff.claimed'
        | 'handoff.completed'
        | 'handoff.created'
        | 'handoff.failed'
        | 'handoff.reclaimed'
        | 'handoff.started'
        | 'scheduler.all-paused'
        | 'scheduler.all-resumed'
        | 'scheduler.task-paused'
        | 'scheduler.task-resumed'
        | 'session.heartbeat'
        | 'session.inbound.submitted'
        | 'session.substate.changed',
        number
      >
    >;
    publishedCount: number;
  };
}

export interface TeamWorkspaceSnapshot {
  workspace: TeamWorkspaceDetail;
  sessions: TeamRuntimeSessionRecord[];
  sharedSessions: SharedSessionSummaryRecord[];
  sessionShares: TeamSessionShareRecord[];
  runtimeTaskGroups: TeamRuntimeTaskGroupRecord[];
}

export interface TeamRuntimeReadModel {
  auditLogs: TeamAuditLogRecord[];
  clarifications: TeamRuntimeClarificationRecord[];
  diagnostics?: TeamRuntimeDiagnostics;
  handoffs: HandoffRecord[];
  members: TeamMemberRecord[];
  messages: TeamMessageRecord[];
  notifications: TeamRuntimeNotificationRecord[];
  runtimeTaskGroups: TeamRuntimeTaskGroupRecord[];
  sessionShares: TeamSessionShareRecord[];
  sessions: TeamRuntimeSessionRecord[];
  sharedSessions: SharedSessionSummaryRecord[];
  tasks: TeamTaskRecord[];
  /** 持久化的团队执行用量聚合（可选，旧后端可能不返回）。 */
  usageRecords?: TeamUsageRecord[];
}

export interface TeamRuntimeLoadResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  runtime?: TeamRuntimeReadModel;
  status?: number;
}

export interface TeamWorkspaceListLoadResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
  workspaces?: TeamWorkspaceSummary[];
}

export interface TeamWorkspaceDetailLoadResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
  workspace?: TeamWorkspaceDetail;
}

export interface TeamWorkspaceSnapshotLoadResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  snapshot?: TeamWorkspaceSnapshot;
  status?: number;
}

export interface SharedSessionDetailLoadResult {
  detail?: SharedSessionDetailRecord;
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
}

export interface SharedSessionPresenceLoadResult {
  errorMessage?: string;
  ok: boolean;
  presence?: SharedSessionPresenceRecord[];
  retryable: boolean;
  status?: number;
}

export interface TeamRuntimeAlertControlRecord {
  alertCode:
    | 'architecture-review-blocked'
    | 'handoff-failure'
    | 'latency-violation'
    | 'pending-decisions'
    | 'quality-review-pending'
    | 'quality-review-escalate-to-user'
    | 'quality-review-redispatch'
    | 'quality-review-return-to-c'
    | 'stale-decisions'
    | 'stale-runtime-threads'
    | 'team-events-connection'
    | 'telemetry-disabled';
  note: string | null;
  state: 'acknowledged' | 'suppressed';
  suppressedUntilMs: number | null;
  updatedAt: string;
}

export interface TeamRuntimeAlertControlActionResult {
  cleared?: boolean;
  control?: TeamRuntimeAlertControlRecord;
  runtime?: {
    diagnostics: TeamRuntimeDiagnostics;
    sessionCount: number;
    teamWorkspaceId: string | null;
  };
}

export interface TeamRuntimeReconcileStaleThreadsResult {
  completedCount?: number;
  failedSessionIds: string[];
  noopCount?: number;
  pausedCount: number;
  reclaimedCount?: number;
  resetCount: number;
  retryableErrorCount?: number;
  runtime?: {
    diagnostics: TeamRuntimeDiagnostics;
    sessionCount: number;
    teamWorkspaceId: string | null;
  };
  staleCandidateCount: number;
}

export interface TeamInitActionResult {
  errorMessage?: string;
  ok: boolean;
  teamInit?: TeamInitState | null;
  status?: number;
}

export interface TeamClient {
  listWorkspaces(token: string): Promise<TeamWorkspaceSummary[]>;
  listWorkspacesResult(token: string): Promise<TeamWorkspaceListLoadResult>;
  getWorkspaceResult(
    token: string,
    teamWorkspaceId: string,
  ): Promise<TeamWorkspaceDetailLoadResult>;
  getWorkspace(token: string, teamWorkspaceId: string): Promise<TeamWorkspaceDetail>;
  createWorkspace(token: string, input: CreateTeamWorkspaceInput): Promise<TeamWorkspaceDetail>;
  updateWorkspace(
    token: string,
    teamWorkspaceId: string,
    input: UpdateTeamWorkspaceInput,
  ): Promise<TeamWorkspaceDetail>;
  deleteWorkspace(token: string, teamWorkspaceId: string): Promise<void>;
  createThread(
    token: string,
    teamWorkspaceId: string,
    input?: CreateTeamThreadInput,
  ): Promise<Session>;
  createSession(
    token: string,
    teamWorkspaceId: string,
    input: CreateTeamSessionInput,
  ): Promise<Session>;
  importIntoWorkspace(
    token: string,
    teamWorkspaceId: string,
    input: ImportTeamWorkspaceSessionInput,
  ): Promise<SessionImportResult>;
  getSharedSessionDetailResult(
    token: string,
    sessionId: string,
  ): Promise<SharedSessionDetailLoadResult>;
  getSharedSessionDetail(token: string, sessionId: string): Promise<SharedSessionDetailRecord>;
  createSharedSessionComment(
    token: string,
    sessionId: string,
    input: { content: string },
  ): Promise<SharedSessionCommentActionResult>;
  touchSharedSessionPresenceResult(
    token: string,
    sessionId: string,
  ): Promise<SharedSessionPresenceLoadResult>;
  touchSharedSessionPresence(
    token: string,
    sessionId: string,
  ): Promise<SharedSessionPresenceRecord[]>;
  replySharedSessionPermission(
    token: string,
    sessionId: string,
    input: SharedSessionPermissionReplyInput,
  ): Promise<SharedSessionDetailActionResult>;
  replySharedSessionQuestion(
    token: string,
    sessionId: string,
    input: { answers?: string[][]; requestId: string; status: 'answered' | 'dismissed' },
  ): Promise<SharedSessionDetailActionResult>;
  getWorkspaceSnapshotResult(
    token: string,
    teamWorkspaceId: string,
  ): Promise<TeamWorkspaceSnapshotLoadResult>;
  getWorkspaceSnapshot(token: string, teamWorkspaceId: string): Promise<TeamWorkspaceSnapshot>;
  getSessionInit(token: string, sessionId: string): Promise<TeamInitActionResult>;
  confirmSessionInitStep(
    token: string,
    sessionId: string,
    stepKey: TeamInitStepKey,
  ): Promise<TeamInitActionResult>;
  skipSessionInitStep(
    token: string,
    sessionId: string,
    stepKey: TeamInitStepKey,
  ): Promise<TeamInitActionResult>;
  skipSessionInit(token: string, sessionId: string): Promise<TeamInitActionResult>;
  getRuntimeResult(
    token: string,
    options?: { teamWorkspaceId?: string },
  ): Promise<TeamRuntimeLoadResult>;
  getRuntime(token: string, options?: { teamWorkspaceId?: string }): Promise<TeamRuntimeReadModel>;
  acknowledgeRuntimeAlert(
    token: string,
    alertCode: TeamRuntimeAlertControlRecord['alertCode'],
    input?: { note?: string; teamWorkspaceId?: string },
  ): Promise<TeamRuntimeAlertControlActionResult>;
  suppressRuntimeAlert(
    token: string,
    alertCode: TeamRuntimeAlertControlRecord['alertCode'],
    input?: { minutes?: number; note?: string; teamWorkspaceId?: string },
  ): Promise<TeamRuntimeAlertControlActionResult>;
  clearRuntimeAlertControl(
    token: string,
    alertCode: TeamRuntimeAlertControlRecord['alertCode'],
    options?: { teamWorkspaceId?: string },
  ): Promise<TeamRuntimeAlertControlActionResult>;
  pauseAllRuntimeSessions(
    token: string,
    sessionId: string,
    input?: { reason?: string },
  ): Promise<TeamRuntimePauseAllResult>;
  resumeAllRuntimeSessions(token: string, sessionId: string): Promise<TeamRuntimeResumeAllResult>;
  reconcileStaleRuntimeThreads(
    token: string,
    options?: { teamWorkspaceId?: string },
  ): Promise<TeamRuntimeReconcileStaleThreadsResult>;
  reconcileStaleDecisions(
    token: string,
    options?: { teamWorkspaceId?: string },
  ): Promise<TeamRuntimeReconcileStaleThreadsResult>;
  runRuntimeAlertRemediation(
    token: string,
    alertCode: TeamRuntimeAlertControlRecord['alertCode'],
    options?: { force?: boolean; handoffId?: string; teamWorkspaceId?: string },
  ): Promise<TeamRuntimeReconcileStaleThreadsResult>;
  listMembers(token: string): Promise<TeamMemberRecord[]>;
  createMember(token: string, input: CreateTeamMemberInput): Promise<TeamMemberRecord>;
  listAuditLogs(token: string, options?: { limit?: number }): Promise<TeamAuditLogRecord[]>;
  listTasks(token: string): Promise<TeamTaskRecord[]>;
  createTask(token: string, input: CreateTeamTaskInput): Promise<TeamTaskRecord>;
  updateTask(token: string, taskId: string, input: UpdateTeamTaskInput): Promise<void>;
  listMessages(token: string): Promise<TeamMessageRecord[]>;
  createMessage(token: string, input: CreateTeamMessageInput): Promise<TeamMessageRecord>;
  listSessionShares(token: string): Promise<TeamSessionShareRecord[]>;
  createSessionShare(
    token: string,
    input: CreateTeamSessionShareInput,
  ): Promise<TeamSessionShareRecord>;
  updateSessionShare(
    token: string,
    shareId: string,
    input: { permission: TeamSessionShareRecord['permission'] },
  ): Promise<TeamSessionShareRecord>;
  deleteSessionShare(token: string, shareId: string): Promise<void>;
  updateSessionState(
    token: string,
    sessionId: string,
    input: { stateStatus: 'idle' | 'running' | 'paused'; title?: string },
  ): Promise<void>;
  deleteSession(token: string, sessionId: string): Promise<string[]>;
}

function buildAuthHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

/**
 * 团队初始化阶段（teamInit）端点的统一请求封装。
 * 成功 / 失败都从响应体提取 teamInit（失败步骤的响应体也带 teamInit 让 UI 展示错误态）。
 */
async function performTeamInitRequest(
  baseUrl: string,
  token: string,
  pathSuffix: string,
  method: 'GET' | 'POST',
): Promise<TeamInitActionResult> {
  try {
    const response = await fetchWithTimeout(`${baseUrl}${pathSuffix}`, {
      method,
      headers: buildAuthHeaders(token),
    });
    let body: { teamInit?: TeamInitState | null; error?: string } | null = null;
    try {
      body = (await response.json()) as { teamInit?: TeamInitState | null; error?: string };
    } catch {
      body = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        errorMessage: body?.error ?? '初始化操作失败。',
        teamInit: body?.teamInit ?? null,
      };
    }
    return { ok: true, status: response.status, teamInit: body?.teamInit ?? null };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : '初始化操作失败。',
    };
  }
}

function isRetryableTeamRuntimeStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableTeamWorkspaceStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableSharedSessionDetailStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableSharedSessionPresenceStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

interface TeamErrorData {
  code?: string;
  data?: {
    message?: string;
  };
  error?: string;
  message?: string;
  name?: string;
}

function extractTeamErrorMessage(data: TeamErrorData | undefined): string | null {
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

function buildTeamRuntimeErrorMessage(status: number, data: TeamErrorData | undefined): string {
  const extracted = extractTeamErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权访问团队运行时数据。';
  }
  if (status === 404) {
    return '目标团队工作区不存在，无法读取运行时快照。';
  }
  return `加载团队运行时快照失败（HTTP ${status}）。`;
}

function buildTeamWorkspaceListErrorMessage(
  status: number,
  data: TeamErrorData | undefined,
): string {
  const extracted = extractTeamErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取团队工作区列表。';
  }
  if (status === 404) {
    return '团队工作区列表不存在或当前环境尚未初始化。';
  }
  return `加载团队工作区列表失败（HTTP ${status}）。`;
}

function buildTeamWorkspaceDetailErrorMessage(
  status: number,
  data: TeamErrorData | undefined,
): string {
  const extracted = extractTeamErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权访问该团队工作区。';
  }
  if (status === 404) {
    return '目标团队工作区不存在。';
  }
  return `加载团队工作区详情失败（HTTP ${status}）。`;
}

function buildTeamWorkspaceSnapshotErrorMessage(
  status: number,
  data: TeamErrorData | undefined,
): string {
  const extracted = extractTeamErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取团队工作区快照。';
  }
  if (status === 404) {
    return '目标团队工作区不存在，无法读取工作区快照。';
  }
  return `加载团队工作区快照失败（HTTP ${status}）。`;
}

function buildSharedSessionDetailErrorMessage(
  status: number,
  data: TeamErrorData | undefined,
): string {
  const extracted = extractTeamErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权访问该共享会话。';
  }
  if (status === 404) {
    return '共享会话不存在或已被取消共享。';
  }
  return `加载共享会话详情失败（HTTP ${status}）。`;
}

function buildSharedSessionPresenceErrorMessage(
  status: number,
  data: TeamErrorData | undefined,
): string {
  const extracted = extractTeamErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取共享会话在线状态。';
  }
  if (status === 404) {
    return '共享会话不存在或已被取消共享。';
  }
  return `刷新共享会话在线状态失败（HTTP ${status}）。`;
}

function buildTeamActionErrorMessage(
  actionLabel: string,
  status: number,
  data: TeamErrorData | undefined,
): string {
  const extracted = extractTeamErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericNetworkErrorMessage(message: string): boolean {
  return (
    message === 'Failed to fetch' ||
    message === 'Load failed' ||
    message === 'fetch failed' ||
    message === 'Network request failed' ||
    message === 'NetworkError when attempting to fetch resource.'
  );
}

function normalizeTeamActionError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractTeamErrorMessage(
      (error.data ?? undefined) as TeamErrorData | undefined,
    );
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericNetworkErrorMessage(message)) {
      return error;
    }
  }

  return new Error(`网络异常，${actionLabel}失败。`);
}

function normalizeTeamResultErrorMessage(actionLabel: string, error: unknown): string {
  const normalized = normalizeTeamActionError(actionLabel, error);
  return normalized.message;
}

async function performTeamRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T | void> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<TeamErrorData>(response);
      throw new HttpError(
        buildTeamActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeTeamActionError(input.actionLabel, error);
  }
}

export function createTeamClient(baseUrl: string): TeamClient {
  const listWorkspacesResult = async (token: string): Promise<TeamWorkspaceListLoadResult> => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/team/workspaces`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        const data = await readJsonErrorData<TeamErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamWorkspaceStatus(response.status),
          errorMessage: buildTeamWorkspaceListErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        ok: true,
        retryable: false,
        workspaces: (await response.json()) as TeamWorkspaceSummary[],
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamResultErrorMessage('加载团队工作区列表', error),
      };
    }
  };

  const getWorkspaceResult = async (
    token: string,
    teamWorkspaceId: string,
  ): Promise<TeamWorkspaceDetailLoadResult> => {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      if (!response.ok) {
        const data = await readJsonErrorData<TeamErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamWorkspaceStatus(response.status),
          errorMessage: buildTeamWorkspaceDetailErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        ok: true,
        retryable: false,
        workspace: (await response.json()) as TeamWorkspaceDetail,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamResultErrorMessage('加载团队工作区详情', error),
      };
    }
  };

  const getSharedSessionDetailResult = async (
    token: string,
    sessionId: string,
  ): Promise<SharedSessionDetailLoadResult> => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/sessions/shared-with-me/${sessionId}`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        const data = await readJsonErrorData<TeamErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableSharedSessionDetailStatus(response.status),
          errorMessage: buildSharedSessionDetailErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        ok: true,
        retryable: false,
        detail: (await response.json()) as SharedSessionDetailRecord,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamResultErrorMessage('加载共享会话详情', error),
      };
    }
  };

  const touchSharedSessionPresenceResult = async (
    token: string,
    sessionId: string,
  ): Promise<SharedSessionPresenceLoadResult> => {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/sessions/shared-with-me/${sessionId}/presence`,
        {
          method: 'POST',
          headers: buildAuthHeaders(token),
        },
      );
      if (!response.ok) {
        const data = await readJsonErrorData<TeamErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableSharedSessionPresenceStatus(response.status),
          errorMessage: buildSharedSessionPresenceErrorMessage(response.status, data),
          status: response.status,
        };
      }
      const data = (await response.json()) as { presence?: SharedSessionPresenceRecord[] };
      return {
        ok: true,
        retryable: false,
        presence: data.presence ?? [],
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamResultErrorMessage('刷新共享会话在线状态', error),
      };
    }
  };

  const getRuntimeResult = async (
    token: string,
    options?: { teamWorkspaceId?: string },
  ): Promise<TeamRuntimeLoadResult> => {
    const params = new URLSearchParams();
    if (options?.teamWorkspaceId) {
      params.set('teamWorkspaceId', options.teamWorkspaceId);
    }
    const suffix = params.toString();
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/team/runtime${suffix ? `?${suffix}` : ''}`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      if (!response.ok) {
        const data = await readJsonErrorData<TeamErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamRuntimeStatus(response.status),
          errorMessage: buildTeamRuntimeErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        ok: true,
        retryable: false,
        runtime: (await response.json()) as TeamRuntimeReadModel,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamResultErrorMessage('加载团队运行时快照', error),
      };
    }
  };

  const getWorkspaceSnapshotResult = async (
    token: string,
    teamWorkspaceId: string,
  ): Promise<TeamWorkspaceSnapshotLoadResult> => {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/runtime`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      if (!response.ok) {
        const data = await readJsonErrorData<TeamErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamWorkspaceStatus(response.status),
          errorMessage: buildTeamWorkspaceSnapshotErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        ok: true,
        retryable: false,
        snapshot: (await response.json()) as TeamWorkspaceSnapshot,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamResultErrorMessage('加载团队工作区快照', error),
      };
    }
  };

  return {
    async listWorkspaces(token: string): Promise<TeamWorkspaceSummary[]> {
      const result = await listWorkspacesResult(token);
      if (!result.ok || !result.workspaces) {
        throw new Error(result.errorMessage ?? '加载团队工作区列表失败');
      }
      return result.workspaces;
    },

    listWorkspacesResult,

    getWorkspaceResult,

    async getWorkspace(token: string, teamWorkspaceId: string): Promise<TeamWorkspaceDetail> {
      const result = await getWorkspaceResult(token, teamWorkspaceId);
      if (!result.ok || !result.workspace) {
        throw new Error(result.errorMessage ?? '加载团队工作区详情失败');
      }
      return result.workspace;
    },

    async createWorkspace(
      token: string,
      input: CreateTeamWorkspaceInput,
    ): Promise<TeamWorkspaceDetail> {
      return (await performTeamRequest<TeamWorkspaceDetail>({
        actionLabel: '创建团队工作区',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/workspaces`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      })) as TeamWorkspaceDetail;
    },

    async updateWorkspace(
      token: string,
      teamWorkspaceId: string,
      input: UpdateTeamWorkspaceInput,
    ): Promise<TeamWorkspaceDetail> {
      return (await performTeamRequest<TeamWorkspaceDetail>({
        actionLabel: '更新团队工作区',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}`, {
            method: 'PATCH',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      })) as TeamWorkspaceDetail;
    },

    async deleteWorkspace(token: string, teamWorkspaceId: string): Promise<void> {
      await performTeamRequest({
        actionLabel: '删除团队工作区',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}`, {
            method: 'DELETE',
            headers: buildAuthHeaders(token),
          }),
      });
    },

    async createThread(
      token: string,
      teamWorkspaceId: string,
      input: CreateTeamThreadInput = {},
    ): Promise<Session> {
      return (await performTeamRequest<Session>({
        actionLabel: '创建团队线程',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/threads`,
            {
              method: 'POST',
              headers: {
                ...buildAuthHeaders(token),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(input),
            },
          ),
      })) as Session;
    },

    async createSession(
      token: string,
      teamWorkspaceId: string,
      input: CreateTeamSessionInput,
    ): Promise<Session> {
      return (await performTeamRequest<Session>({
        actionLabel: '创建团队会话',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/sessions`,
            {
              method: 'POST',
              headers: {
                ...buildAuthHeaders(token),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(input),
            },
          ),
      })) as Session;
    },

    async importIntoWorkspace(
      token: string,
      teamWorkspaceId: string,
      input: ImportTeamWorkspaceSessionInput,
    ): Promise<SessionImportResult> {
      return (await performTeamRequest<SessionImportResult>({
        actionLabel: '导入会话到团队工作区',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/imports`,
            {
              method: 'POST',
              headers: {
                ...buildAuthHeaders(token),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(input),
            },
          ),
      })) as SessionImportResult;
    },

    async getSharedSessionDetail(
      token: string,
      sessionId: string,
    ): Promise<SharedSessionDetailRecord> {
      const result = await getSharedSessionDetailResult(token, sessionId);
      if (!result.ok || !result.detail) {
        throw new Error(result.errorMessage ?? '加载共享会话详情失败');
      }
      return result.detail;
    },

    getSharedSessionDetailResult,

    async createSharedSessionComment(
      token: string,
      sessionId: string,
      input: { content: string },
    ): Promise<SharedSessionCommentActionResult> {
      return (await performTeamRequest<SharedSessionCommentActionResult>({
        actionLabel: '发送共享会话评论',
        request: () =>
          fetchWithTimeout(`${baseUrl}/sessions/shared-with-me/${sessionId}/comments`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      })) as SharedSessionCommentActionResult;
    },

    async touchSharedSessionPresence(
      token: string,
      sessionId: string,
    ): Promise<SharedSessionPresenceRecord[]> {
      const result = await touchSharedSessionPresenceResult(token, sessionId);
      if (!result.ok || !result.presence) {
        throw new Error(result.errorMessage ?? '刷新共享会话在线状态失败');
      }
      return result.presence;
    },

    touchSharedSessionPresenceResult,

    async replySharedSessionPermission(
      token: string,
      sessionId: string,
      input: SharedSessionPermissionReplyInput,
    ): Promise<SharedSessionDetailActionResult> {
      try {
        return await replySharedSessionPermissionRequest({
          gatewayUrl: baseUrl,
          payload: input,
          sessionId,
          token,
        });
      } catch (error) {
        throw normalizeTeamActionError('处理共享权限请求', error);
      }
    },

    async replySharedSessionQuestion(
      token: string,
      sessionId: string,
      input: { answers?: string[][]; requestId: string; status: 'answered' | 'dismissed' },
    ): Promise<SharedSessionDetailActionResult> {
      return (await performTeamRequest<SharedSessionDetailActionResult>({
        actionLabel: '处理共享提问',
        request: () =>
          fetchWithTimeout(`${baseUrl}/sessions/shared-with-me/${sessionId}/questions/reply`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      })) as SharedSessionDetailActionResult;
    },

    getWorkspaceSnapshotResult,

    async getWorkspaceSnapshot(
      token: string,
      teamWorkspaceId: string,
    ): Promise<TeamWorkspaceSnapshot> {
      const result = await getWorkspaceSnapshotResult(token, teamWorkspaceId);
      if (!result.ok || !result.snapshot) {
        throw new Error(result.errorMessage ?? '加载团队工作区快照失败');
      }
      return result.snapshot;
    },

    async getSessionInit(token: string, sessionId: string): Promise<TeamInitActionResult> {
      return performTeamInitRequest(
        baseUrl,
        token,
        `/team/sessions/${encodeURIComponent(sessionId)}/init`,
        'GET',
      );
    },

    async confirmSessionInitStep(
      token: string,
      sessionId: string,
      stepKey: TeamInitStepKey,
    ): Promise<TeamInitActionResult> {
      return performTeamInitRequest(
        baseUrl,
        token,
        `/team/sessions/${encodeURIComponent(sessionId)}/init/steps/${encodeURIComponent(stepKey)}/confirm`,
        'POST',
      );
    },

    async skipSessionInitStep(
      token: string,
      sessionId: string,
      stepKey: TeamInitStepKey,
    ): Promise<TeamInitActionResult> {
      return performTeamInitRequest(
        baseUrl,
        token,
        `/team/sessions/${encodeURIComponent(sessionId)}/init/steps/${encodeURIComponent(stepKey)}/skip`,
        'POST',
      );
    },

    async skipSessionInit(token: string, sessionId: string): Promise<TeamInitActionResult> {
      return performTeamInitRequest(
        baseUrl,
        token,
        `/team/sessions/${encodeURIComponent(sessionId)}/init/skip`,
        'POST',
      );
    },

    getRuntimeResult,

    async getRuntime(
      token: string,
      options?: { teamWorkspaceId?: string },
    ): Promise<TeamRuntimeReadModel> {
      const result = await getRuntimeResult(token, options);
      if (!result.ok || !result.runtime) {
        throw new Error(result.errorMessage ?? '加载团队运行时快照失败');
      }
      return result.runtime;
    },

    async acknowledgeRuntimeAlert(
      token: string,
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      input?: { note?: string; teamWorkspaceId?: string },
    ): Promise<TeamRuntimeAlertControlActionResult> {
      const params = new URLSearchParams();
      if (input?.teamWorkspaceId) {
        params.set('teamWorkspaceId', input.teamWorkspaceId);
      }
      const suffix = params.toString();
      return (await performTeamRequest<TeamRuntimeAlertControlActionResult>({
        actionLabel: '确认团队运行时告警',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/runtime/alerts/${encodeURIComponent(alertCode)}/acknowledge${suffix ? `?${suffix}` : ''}`,
            {
              method: 'POST',
              headers: {
                ...buildAuthHeaders(token),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(input?.note ? { note: input.note } : {}),
            },
          ),
      })) as TeamRuntimeAlertControlActionResult;
    },

    async suppressRuntimeAlert(
      token: string,
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      input?: { minutes?: number; note?: string; teamWorkspaceId?: string },
    ): Promise<TeamRuntimeAlertControlActionResult> {
      const params = new URLSearchParams();
      if (input?.teamWorkspaceId) {
        params.set('teamWorkspaceId', input.teamWorkspaceId);
      }
      const suffix = params.toString();
      return (await performTeamRequest<TeamRuntimeAlertControlActionResult>({
        actionLabel: '抑制团队运行时告警',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/runtime/alerts/${encodeURIComponent(alertCode)}/suppress${suffix ? `?${suffix}` : ''}`,
            {
              method: 'POST',
              headers: {
                ...buildAuthHeaders(token),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                ...(typeof input?.minutes === 'number' ? { minutes: input.minutes } : {}),
                ...(input?.note ? { note: input.note } : {}),
              }),
            },
          ),
      })) as TeamRuntimeAlertControlActionResult;
    },

    async clearRuntimeAlertControl(
      token: string,
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      options?: { teamWorkspaceId?: string },
    ): Promise<TeamRuntimeAlertControlActionResult> {
      const params = new URLSearchParams();
      if (options?.teamWorkspaceId) {
        params.set('teamWorkspaceId', options.teamWorkspaceId);
      }
      const suffix = params.toString();
      return (await performTeamRequest<TeamRuntimeAlertControlActionResult>({
        actionLabel: '清除团队运行时告警控制',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/runtime/alerts/${encodeURIComponent(alertCode)}/clear${suffix ? `?${suffix}` : ''}`,
            {
              method: 'POST',
              headers: buildAuthHeaders(token),
            },
          ),
      })) as TeamRuntimeAlertControlActionResult;
    },

    async pauseAllRuntimeSessions(
      token: string,
      sessionId: string,
      input?: { reason?: string },
    ): Promise<TeamRuntimePauseAllResult> {
      return (await performTeamRequest<TeamRuntimePauseAllResult>({
        actionLabel: '暂停团队运行时子树',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/sessions/${encodeURIComponent(sessionId)}/pause-all`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input ?? {}),
          }),
      })) as TeamRuntimePauseAllResult;
    },

    async resumeAllRuntimeSessions(
      token: string,
      sessionId: string,
    ): Promise<TeamRuntimeResumeAllResult> {
      return (await performTeamRequest<TeamRuntimeResumeAllResult>({
        actionLabel: '恢复团队运行时子树',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/sessions/${encodeURIComponent(sessionId)}/resume-all`, {
            method: 'POST',
            headers: buildAuthHeaders(token),
          }),
      })) as TeamRuntimeResumeAllResult;
    },

    async reconcileStaleRuntimeThreads(
      token: string,
      options?: { teamWorkspaceId?: string },
    ): Promise<TeamRuntimeReconcileStaleThreadsResult> {
      const params = new URLSearchParams();
      if (options?.teamWorkspaceId) {
        params.set('teamWorkspaceId', options.teamWorkspaceId);
      }
      const suffix = params.toString();
      return (await performTeamRequest<TeamRuntimeReconcileStaleThreadsResult>({
        actionLabel: '协调陈旧运行线程',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/runtime/remediations/reconcile-stale-threads${suffix ? `?${suffix}` : ''}`,
            {
              method: 'POST',
              headers: buildAuthHeaders(token),
            },
          ),
      })) as TeamRuntimeReconcileStaleThreadsResult;
    },

    async reconcileStaleDecisions(
      token: string,
      options?: { teamWorkspaceId?: string },
    ): Promise<TeamRuntimeReconcileStaleThreadsResult> {
      const params = new URLSearchParams();
      if (options?.teamWorkspaceId) {
        params.set('teamWorkspaceId', options.teamWorkspaceId);
      }
      const suffix = params.toString();
      return (await performTeamRequest<TeamRuntimeReconcileStaleThreadsResult>({
        actionLabel: '释放陈旧决策',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/runtime/remediations/release-stale-decisions${suffix ? `?${suffix}` : ''}`,
            {
              method: 'POST',
              headers: buildAuthHeaders(token),
            },
          ),
      })) as TeamRuntimeReconcileStaleThreadsResult;
    },

    async runRuntimeAlertRemediation(
      token: string,
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      options?: { force?: boolean; handoffId?: string; teamWorkspaceId?: string },
    ): Promise<TeamRuntimeReconcileStaleThreadsResult> {
      const params = new URLSearchParams();
      if (options?.force) {
        params.set('force', 'true');
      }
      if (options?.handoffId) {
        params.set('handoffId', options.handoffId);
      }
      if (options?.teamWorkspaceId) {
        params.set('teamWorkspaceId', options.teamWorkspaceId);
      }
      const suffix = params.toString();
      return (await performTeamRequest<TeamRuntimeReconcileStaleThreadsResult>({
        actionLabel: '执行团队运行时告警修复',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/runtime/alerts/${encodeURIComponent(alertCode)}/remediate${suffix ? `?${suffix}` : ''}`,
            {
              method: 'POST',
              headers: buildAuthHeaders(token),
            },
          ),
      })) as TeamRuntimeReconcileStaleThreadsResult;
    },

    async listAuditLogs(
      token: string,
      options?: { limit?: number },
    ): Promise<TeamAuditLogRecord[]> {
      const params = new URLSearchParams();
      if (typeof options?.limit === 'number') {
        params.set('limit', String(options.limit));
      }
      const suffix = params.toString();
      return (await performTeamRequest<TeamAuditLogRecord[]>({
        actionLabel: '读取团队审计日志',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/audit-logs${suffix ? `?${suffix}` : ''}`, {
            headers: buildAuthHeaders(token),
          }),
      })) as TeamAuditLogRecord[];
    },

    async listMembers(token: string): Promise<TeamMemberRecord[]> {
      return (await performTeamRequest<TeamMemberRecord[]>({
        actionLabel: '读取团队成员',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/members`, {
            headers: buildAuthHeaders(token),
          }),
      })) as TeamMemberRecord[];
    },

    async createMember(token: string, input: CreateTeamMemberInput): Promise<TeamMemberRecord> {
      return (await performTeamRequest<TeamMemberRecord>({
        actionLabel: '创建团队成员',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/members`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      })) as TeamMemberRecord;
    },

    async listTasks(token: string): Promise<TeamTaskRecord[]> {
      return (await performTeamRequest<TeamTaskRecord[]>({
        actionLabel: '读取团队任务',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/tasks`, {
            headers: buildAuthHeaders(token),
          }),
      })) as TeamTaskRecord[];
    },

    async createTask(token: string, input: CreateTeamTaskInput): Promise<TeamTaskRecord> {
      return (await performTeamRequest<TeamTaskRecord>({
        actionLabel: '创建团队任务',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/tasks`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      })) as TeamTaskRecord;
    },

    async updateTask(token: string, taskId: string, input: UpdateTeamTaskInput): Promise<void> {
      await performTeamRequest({
        actionLabel: '更新团队任务',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/tasks/${encodeURIComponent(taskId)}`, {
            method: 'PATCH',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      });
    },

    async listMessages(token: string): Promise<TeamMessageRecord[]> {
      return (await performTeamRequest<TeamMessageRecord[]>({
        actionLabel: '读取团队消息',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/messages`, {
            headers: buildAuthHeaders(token),
          }),
      })) as TeamMessageRecord[];
    },

    async createMessage(token: string, input: CreateTeamMessageInput): Promise<TeamMessageRecord> {
      return (await performTeamRequest<TeamMessageRecord>({
        actionLabel: '创建团队消息',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/messages`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      })) as TeamMessageRecord;
    },

    async listSessionShares(token: string): Promise<TeamSessionShareRecord[]> {
      return (await performTeamRequest<TeamSessionShareRecord[]>({
        actionLabel: '读取会话共享列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/session-shares`, {
            headers: buildAuthHeaders(token),
          }),
      })) as TeamSessionShareRecord[];
    },

    async createSessionShare(
      token: string,
      input: CreateTeamSessionShareInput,
    ): Promise<TeamSessionShareRecord> {
      return (await performTeamRequest<TeamSessionShareRecord>({
        actionLabel: '创建会话共享',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/session-shares`, {
            method: 'POST',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      })) as TeamSessionShareRecord;
    },

    async deleteSessionShare(token: string, shareId: string): Promise<void> {
      await performTeamRequest({
        actionLabel: '删除会话共享',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/session-shares/${encodeURIComponent(shareId)}`, {
            method: 'DELETE',
            headers: buildAuthHeaders(token),
          }),
      });
    },

    async updateSessionShare(
      token: string,
      shareId: string,
      input: { permission: TeamSessionShareRecord['permission'] },
    ): Promise<TeamSessionShareRecord> {
      return (await performTeamRequest<TeamSessionShareRecord>({
        actionLabel: '更新会话共享权限',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/session-shares/${encodeURIComponent(shareId)}`, {
            method: 'PATCH',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      })) as TeamSessionShareRecord;
    },

    async updateSessionState(
      token: string,
      sessionId: string,
      input: { stateStatus: 'idle' | 'running' | 'paused'; title?: string },
    ): Promise<void> {
      await performTeamRequest({
        actionLabel: '更新会话状态',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            headers: {
              ...buildAuthHeaders(token),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              state_status: input.stateStatus,
              ...(input.title != null ? { title: input.title } : {}),
            }),
          }),
      });
    },

    async deleteSession(token: string, sessionId: string): Promise<string[]> {
      const data = (await performTeamRequest<{ deletedSessionIds: string[]; ok: boolean }>({
        actionLabel: '删除会话',
        request: () =>
          fetchWithTimeout(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
            headers: buildAuthHeaders(token),
          }),
      })) as { deletedSessionIds?: string[]; ok: boolean };
      return data.deletedSessionIds ?? [];
    },
  };
}
