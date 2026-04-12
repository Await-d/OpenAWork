import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ToolCallRequest, ToolCallResult, ToolDefinition } from '@openAwork/agent-core';
import type { ZodTypeAny } from 'zod';
import {
  ToolRegistry,
  ToolNotFoundError,
  ToolValidationError,
  ToolTimeoutError,
} from '@openAwork/agent-core';
import { AgentTaskManagerImpl, defaultIgnoreManager } from '@openAwork/agent-core';
import { webSearchTool, lspDiagnosticsTool, lspTouchTool } from '@openAwork/agent-core';
import { WORKSPACE_ROOT, sqliteAll, sqliteGet, sqliteRun } from './db.js';
import { writeAuditLog } from './audit-log.js';
import { lspManager } from './lsp/router.js';
import {
  executeWorkspaceCreateFile,
  executeWorkspaceWriteFile,
  executeWriteTool,
  WORKSPACE_TOOL_NAMES,
  globTool,
  grepTool,
  listTool,
  readTool,
  resolveWorkspaceReviewFilePath,
  workspaceCreateDirectoryTool,
  workspaceCreateFileTool,
  workspaceReadFileTool,
  workspaceReviewRevertTool,
  workspaceReviewDiffTool,
  workspaceReviewStatusTool,
  workspaceSearchTool,
  workspaceTreeTool,
  workspaceWriteFileTool,
  writeTool,
} from './workspace-tools.js';
import { BATCH_TOOL_DISALLOWED, BATCH_TOOL_MAX_CALLS } from './batch-tools.js';
import {
  applyPatchToolDefinition,
  buildApplyPatchPermissionScope,
  executeApplyPatch,
} from './apply-patch-tools.js';
import { bashToolDefinition, buildBashPermissionScope, runBashCommand } from './bash-tools.js';
import { createEditTool } from './edit-tools.js';
import { captureBeforeWriteBackup } from './session-file-backup-store.js';
import { buildQuestionRequestTitle, questionToolDefinition } from './question-tools.js';
import {
  buildExitPlanModeQuestionInput,
  enterPlanModeToolDefinition,
  exitPlanModeToolDefinition,
} from './plan-mode-tools.js';
import { createSkillTool } from './skill-tools.js';
import { taskToolDefinition } from './task-tools.js';
import { buildReadToolOutputResponse, readToolOutputToolDefinition } from './tool-output-tools.js';
import {
  fileReadTool,
  fileWriteTool,
  readFileTool,
  websearchTool,
  writeFileTool,
} from './tool-aliases.js';
import { webfetchTool } from './web-tools.js';
import { resolveDelegatedAgent } from './task-agent-resolution.js';
import {
  backgroundCancelToolDefinition,
  backgroundOutputToolDefinition,
} from './background-task-tools.js';
import { selectDelegatedModelForUser } from './task-model-selection.js';
import {
  runSessionInfoTool,
  runSessionListTool,
  runSessionReadTool,
  runSessionSearchTool,
  sessionInfoToolDefinition,
  sessionListToolDefinition,
  sessionReadToolDefinition,
  sessionSearchToolDefinition,
} from './session-manager-tools.js';
import { astGrepReplaceToolDefinition, astGrepSearchToolDefinition } from './ast-grep-tools.js';
import { interactiveBashToolDefinition } from './interactive-bash-tools.js';
import { CALL_OMO_ALLOWED_AGENTS, callOmoAgentToolDefinition } from './call-omo-agent-tools.js';
import { runSkillMcpTool, skillMcpToolDefinition } from './skill-mcp-tools.js';
import { lookAtToolDefinition, runLookAtTool } from './look-at-tools.js';
import { codesearchToolDefinition } from './codesearch-tools.js';
import { desktopAutomationToolDefinition, runDesktopAutomationTool } from './desktop-automation.js';
import {
  ensureIgnoreRulesLoadedForPath,
  hasWorkspacePermanentPermission,
} from './workspace-safety.js';
import { buildToolResultContent, buildToolResultRunEvent } from './tool-result-contract.js';
import { dispatchClaudeCodeTool } from './claude-code-tool-dispatch.js';
import {
  buildCallOmoAgentBackgroundOutput,
  buildCallOmoAgentSyncOutput,
  buildDelegatedChildClientRequestId,
} from './call-omo-agent-output.js';
import {
  buildBackgroundCancelAllMessage,
  buildBackgroundCancelSingleMessage,
  buildBackgroundTaskResultMessage,
  buildBackgroundTaskStatusMessage,
  buildTaskToolBackgroundMessage,
  buildTaskToolTerminalMessage,
  collectDelegatedSessionText,
  extractLatestDelegatedSessionMessage,
} from './delegated-task-display.js';
import {
  lspFindReferencesToolDefinition,
  lspGotoDefinitionToolDefinition,
  lspGotoImplementationToolDefinition,
  lspHoverToolDefinition,
  lspCallHierarchyToolDefinition,
  lspPrepareRenameToolDefinition,
  lspRenameToolDefinition,
  lspSymbolsToolDefinition,
} from './lsp-tools.js';
import {
  runTaskCreateTool,
  runTaskGetTool,
  runTaskListTool,
  runTaskUpdateTool,
  taskCreateToolDefinition,
  taskGetToolDefinition,
  taskListToolDefinition,
  taskUpdateToolDefinition,
} from './task-crud-tools.js';
import {
  formatSubTodoReadValidationError,
  formatSubTodoWriteValidationError,
  formatTodoReadValidationError,
  formatTodoWriteValidationError,
  runSubTodoReadTool,
  runSubTodoWriteTool,
  subTodoReadInputSchema,
  subTodoReadTool,
  subTodoWriteInputSchema,
  subTodoWriteTool,
  runTodoReadTool,
  runTodoWriteTool,
  todoReadInputSchema,
  todoReadTool,
  todoWriteInputSchema,
  todoWriteTool,
} from './todo-tools.js';
import { createPermissionAskedEvent } from './session-permission-events.js';
import { createQuestionAskedEvent } from './session-question-events.js';
import { deleteSessionRunEventsByRequest, publishSessionRunEvent } from './session-run-events.js';
import { reconcileSessionStateStatus } from './session-runtime-state.js';
import {
  extractToolSurfaceProfile,
  parseSessionMetadataJson,
} from './session-workspace-metadata.js';
import {
  DEFAULT_UPSTREAM_RETRY_MAX_RETRIES,
  normalizeUpstreamRetryMaxRetries,
  UPSTREAM_RETRY_MAX_RETRIES_KEY,
} from './upstream-retry-policy.js';
import {
  isGatewayToolEnabledForSessionMetadata,
  isPlanModeToolEnabledForSessionMetadata,
  shouldAutoApproveToolForSessionMetadata,
} from './session-tool-visibility.js';
import {
  appendSessionMessage,
  deleteSessionMessagesByRequestScope,
  getLatestReferencedToolResult,
  getSessionToolResultByCallId,
  listSessionMessages,
  listSessionMessagesByRequestScope,
} from './session-message-store.js';
import { deleteRequestFileDiffs } from './session-file-diff-store.js';
import { deleteRequestSnapshots } from './session-snapshot-store.js';
import { extractLatestChildSessionSummary } from './task-result-extraction.js';
import {
  clearTaskParentAutoResumeContext,
  consumeTaskParentAutoResumeContext,
  scheduleTaskParentAutoResume,
  upsertTaskParentAutoResumeContext,
} from './task-parent-auto-resume.js';
import { validateWorkspacePath } from './workspace-paths.js';
import {
  callMcpToolForSession,
  getConfiguredMcpServerForSession,
  getConfiguredMcpServersForSession,
  getMcpServerFingerprint,
  listMcpToolsForSession,
} from './mcp-runtime.js';
import { stopAnyInFlightStreamRequestForSession } from './routes/stream-cancellation.js';
import type { RunEvent } from '@openAwork/shared';

const FILE_TOOLS = new Set([
  'file_read',
  'file_write',
  'edit',
  'read',
  'read_file',
  'write',
  'write_file',
  'workspace_read_file',
  'workspace_write_file',
  'workspace_create_file',
  'workspace_review_diff',
  'workspace_review_revert',
]);

const PERMISSION_GATED_TOOLS = new Set([
  'apply_patch',
  'bash',
  'codesearch',
  'interactive_bash',
  'edit',
  'file_write',
  'skill',
  'skill_mcp',
  'mcp_list_tools',
  'write',
  'write_file',
  'workspace_write_file',
  'workspace_create_file',
  'workspace_create_directory',
  'workspace_review_revert',
  'mcp_call',
  'lsp_rename',
  desktopAutomationToolDefinition.name,
]);

const TOOL_WHITELIST = new Set<string>([
  'apply_patch',
  'bash',
  'codesearch',
  'file_read',
  'read_file',
  'file_write',
  'write_file',
  'web_search',
  websearchTool.name,
  webfetchTool.name,
  'question',
  'background_output',
  'background_cancel',
  sessionListToolDefinition.name,
  sessionReadToolDefinition.name,
  sessionSearchToolDefinition.name,
  sessionInfoToolDefinition.name,
  astGrepSearchToolDefinition.name,
  astGrepReplaceToolDefinition.name,
  interactiveBashToolDefinition.name,
  callOmoAgentToolDefinition.name,
  enterPlanModeToolDefinition.name,
  exitPlanModeToolDefinition.name,
  skillMcpToolDefinition.name,
  lookAtToolDefinition.name,
  'read_tool_output',
  'edit',
  'batch',
  'skill',
  'task',
  'lsp_diagnostics',
  'lsp_touch',
  'lsp_goto_definition',
  'lsp_goto_implementation',
  'lsp_find_references',
  'lsp_symbols',
  'lsp_prepare_rename',
  'lsp_rename',
  'lsp_hover',
  'lsp_call_hierarchy',
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  subTodoReadTool.name,
  subTodoWriteTool.name,
  todoReadTool.name,
  todoWriteTool.name,
  'mcp_list_tools',
  'mcp_call',
  desktopAutomationToolDefinition.name,
  ...WORKSPACE_TOOL_NAMES,
]);
const DEFAULT_TOOL_TIMEOUT_MS = 30000;

type PermissionDecision = 'once' | 'session' | 'permanent' | 'reject';

interface SessionOwnerRow {
  user_id: string;
}

interface SessionMetadataRow {
  metadata_json: string;
}

interface PermissionApprovalRow {
  id: string;
  decision: PermissionDecision;
}

interface PermissionPendingRow {
  id: string;
}

interface QuestionPendingRow {
  id: string;
}

interface PermissionRequestContext {
  scope: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  previewAction: string;
}

type PermissionState =
  | { kind: 'approved'; decision: PermissionDecision; requestId: string }
  | { kind: 'pending'; requestId: string; created: boolean }
  | { kind: 'not_needed' };

export interface SandboxExecutionContext {
  clientRequestId?: string;
  nextRound?: number;
  requestData?: Record<string, unknown>;
}

interface PermissionRequestPayload {
  clientRequestId: string;
  nextRound: number;
  requestData: Record<string, unknown>;
  toolCallId: string;
  rawInput: Record<string, unknown>;
  observability?: {
    presentedToolName: string;
    canonicalToolName: string;
    toolSurfaceProfile: 'openawork' | 'claude_code_simple' | 'claude_code_default';
    adapterVersion: string;
  };
}

interface TaskBackgroundRunResult {
  pendingInteraction: boolean;
  reason?: ChildSessionTerminalReason;
  statusCode: number;
  summary: string;
}

interface TaskParentToolReference {
  clientRequestId: string;
  toolCallId: string;
}

const TASK_PARENT_TOOL_CALL_ID_KEY = 'taskParentToolCallId';
const TASK_PARENT_TOOL_REQUEST_ID_KEY = 'taskParentToolRequestId';

type TaskToolOutputStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

interface TaskSessionRow {
  id: string;
  metadata_json: string;
  state_status: string;
}

interface ParsedTaskSessionRow extends TaskSessionRow {
  metadata: Record<string, unknown>;
  parentSessionId: string | null;
}

const MAX_TASK_CHILD_SESSION_DEPTH = 4;
const MAX_TASK_CHILD_SESSION_DESCENDANTS = 24;
const MAX_RUNNING_TASK_CHILD_SESSIONS_PER_ROOT = 4;

/** Terminal reason written to child session metadata and propagated through events. */
export type ChildSessionTerminalReason = 'timeout' | 'cancelled';

const CHILD_SESSION_DEADLINE_KEY = 'deadlineMs';
const CHILD_SESSION_TERMINAL_REASON_KEY = 'terminalReason';
const DEFAULT_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS = 30_000;

/**
 * In-memory timers keyed by childSessionId.
 * Each timer fires `terminateChildSession` with reason='timeout' when the deadline expires.
 */
const childSessionTimeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearChildSessionTimeoutTimer(childSessionId: string): void {
  const timer = childSessionTimeoutTimers.get(childSessionId);
  if (timer) {
    clearTimeout(timer);
    childSessionTimeoutTimers.delete(childSessionId);
  }
}

function readChildSessionTerminalReason(
  metadata: Record<string, unknown>,
): ChildSessionTerminalReason | undefined {
  const value = metadata[CHILD_SESSION_TERMINAL_REASON_KEY];
  return value === 'timeout' || value === 'cancelled' ? value : undefined;
}

function readChildSessionDeadlineMs(metadata: Record<string, unknown>): number | undefined {
  const value = metadata[CHILD_SESSION_DEADLINE_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveTaskChildEffectiveDeadlineMs(input: {
  nowMs: number;
  parentMetadata: Record<string, unknown>;
  requestedTimeoutMs?: number;
}): number | undefined {
  const inheritedDeadlineMs = readChildSessionDeadlineMs(input.parentMetadata);
  const requestedDeadlineMs =
    typeof input.requestedTimeoutMs === 'number' && input.requestedTimeoutMs > 0
      ? input.nowMs + input.requestedTimeoutMs
      : undefined;

  if (inheritedDeadlineMs === undefined) {
    return requestedDeadlineMs;
  }
  if (requestedDeadlineMs === undefined) {
    return inheritedDeadlineMs;
  }
  return Math.min(inheritedDeadlineMs, requestedDeadlineMs);
}

function writeChildSessionTerminalReason(input: {
  childSessionId: string;
  reason: ChildSessionTerminalReason;
  userId: string;
}): void {
  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  const childMetadata = childSession ? parseSessionMetadataJson(childSession.metadata_json) : {};
  childMetadata[CHILD_SESSION_TERMINAL_REASON_KEY] = input.reason;
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(childMetadata), input.childSessionId, input.userId],
  );
}

function getTaskChildFirstResponseTimeoutMs(): number {
  const raw = process.env['OPENAWORK_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS'];
  if (!raw) {
    return DEFAULT_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS;
  }

  return Math.floor(parsed);
}

function getTaskChildFirstResponseRetryMaxRetries(requestData: Record<string, unknown>): number {
  return (
    normalizeUpstreamRetryMaxRetries(requestData[UPSTREAM_RETRY_MAX_RETRIES_KEY]) ??
    DEFAULT_UPSTREAM_RETRY_MAX_RETRIES
  );
}

function getPendingPermissionTimeoutMs(): number | undefined {
  const raw = process.env['OPENAWORK_PERMISSION_REQUEST_TIMEOUT_MS'];
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function getPendingQuestionTimeoutMs(): number | undefined {
  const raw = process.env['OPENAWORK_QUESTION_REQUEST_TIMEOUT_MS'];
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function isChildSessionFirstResponseEvent(
  event: RunEvent,
  timedOut: boolean,
  alreadyReceived: boolean,
): boolean {
  if (timedOut || alreadyReceived) {
    return false;
  }

  return event.type !== 'task_update';
}

function clearTimedOutChildSessionAttemptArtifacts(input: {
  childSessionId: string;
  clientRequestId?: string;
  userId: string;
}): void {
  if (!input.clientRequestId) {
    return;
  }

  deleteSessionMessagesByRequestScope({
    clientRequestId: input.clientRequestId,
    roles: ['assistant', 'tool'],
    sessionId: input.childSessionId,
    userId: input.userId,
  });
  deleteRequestFileDiffs({
    clientRequestId: input.clientRequestId,
    sessionId: input.childSessionId,
    userId: input.userId,
  });
  deleteRequestSnapshots({
    clientRequestId: input.clientRequestId,
    sessionId: input.childSessionId,
    userId: input.userId,
  });
  deleteSessionRunEventsByRequest({
    sessionId: input.childSessionId,
    clientRequestId: input.clientRequestId,
  });
}

/**
 * Unified termination entry point for a child session.
 * Handles: abort stream → mark task failed/cancelled → sync parent tool result → publish event → propagate to parent chain.
 * Uses `failed + terminalReason=timeout` for timeout; `cancelled` for explicit cancel.
 */
export async function terminateChildSession(input: {
  childSessionId: string;
  graphSessionId: string;
  reason: ChildSessionTerminalReason;
  taskId: string;
  userId: string;
}): Promise<{ stopped: boolean; terminated: boolean }> {
  clearChildSessionTimeoutTimer(input.childSessionId);

  const taskManager = new AgentTaskManagerImpl();
  const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, input.graphSessionId);
  const taskEntry = graph.tasks[input.taskId];
  if (!taskEntry) {
    return { stopped: false, terminated: false };
  }

  if (
    taskEntry.status === 'completed' ||
    taskEntry.status === 'failed' ||
    taskEntry.status === 'cancelled'
  ) {
    return { stopped: false, terminated: false };
  }

  const taskStatus = input.reason === 'timeout' ? 'failed' : 'cancelled';
  const terminalErrorMessage =
    input.reason === 'timeout' ? '子代理执行已超时，已被终止。' : '子代理已被取消。';

  graph.tasks[input.taskId] = {
    ...taskEntry,
    status: taskStatus,
    errorMessage: terminalErrorMessage,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };
  await taskManager.save(graph);

  clearTaskParentAutoResumeContext({ childSessionId: input.childSessionId, userId: input.userId });
  sqliteRun(
    "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [input.childSessionId, input.userId],
  );

  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  const childMetadata = childSession ? parseSessionMetadataJson(childSession.metadata_json) : {};
  childMetadata[CHILD_SESSION_TERMINAL_REASON_KEY] = input.reason;
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(childMetadata), input.childSessionId, input.userId],
  );

  const stopped = await stopAnyInFlightStreamRequestForSession({
    sessionId: input.childSessionId,
    userId: input.userId,
  });

  const assignedAgent =
    taskEntry.assignedAgent ??
    (typeof childMetadata['subagentType'] === 'string' ? childMetadata['subagentType'] : 'task');
  const category =
    typeof childMetadata['taskCategory'] === 'string' ? childMetadata['taskCategory'] : undefined;
  const requestedSkills = readTaskRequestedSkills(childMetadata);
  const parentToolReference = readTaskParentToolReference(childMetadata);
  const toolOutputStatus: TaskToolOutputStatus =
    input.reason === 'timeout' ? 'failed' : 'cancelled';

  syncParentTaskToolResult({
    assignedAgent,
    category,
    errorMessage: terminalErrorMessage,
    parentSessionId: input.graphSessionId,
    parentToolReference,
    reason: input.reason,
    requestedSkills,
    sessionId: input.childSessionId,
    status: toolOutputStatus,
    taskId: taskEntry.id,
    userId: input.userId,
  });

  appendParentTaskCompletionReminder({
    assignedAgent,
    childSessionId: input.childSessionId,
    errorMessage: terminalErrorMessage,
    parentSessionId: input.graphSessionId,
    reason: input.reason,
    status: toolOutputStatus,
    taskId: taskEntry.id,
    taskTitle: taskEntry.title,
    taskUpdatedAt: Date.now(),
    userId: input.userId,
  });

  publishSessionRunEvent(
    input.graphSessionId,
    buildTaskUpdateEvent({
      assignedAgent,
      category,
      childSessionId: input.childSessionId,
      errorMessage: terminalErrorMessage,
      parentSessionId: input.graphSessionId,
      reason: input.reason,
      requestedSkills,
      status: input.reason === 'timeout' ? 'failed' : 'cancelled',
      taskId: taskEntry.id,
      taskTitle: taskEntry.title,
    }),
  );

  return { stopped, terminated: true };
}

function scheduleChildSessionTimeout(input: {
  childSessionId: string;
  deadlineMs: number;
  graphSessionId: string;
  taskId: string;
  userId: string;
}): void {
  clearChildSessionTimeoutTimer(input.childSessionId);
  const delayMs = Math.max(0, input.deadlineMs - Date.now());
  const timer = setTimeout(() => {
    childSessionTimeoutTimers.delete(input.childSessionId);
    void terminateChildSession({
      childSessionId: input.childSessionId,
      graphSessionId: input.graphSessionId,
      reason: 'timeout',
      taskId: input.taskId,
      userId: input.userId,
    });
  }, delayMs);
  childSessionTimeoutTimers.set(input.childSessionId, timer);
}

function mapTaskStatusToToolOutputStatus(status: string): TaskToolOutputStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

function mapTaskStatusToUpdateStatus(
  status: string,
): 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled' {
  switch (status) {
    case 'running':
      return 'in_progress';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

function createTaskToolResultClientRequestId(clientRequestId: string, toolCallId: string): string {
  return `${clientRequestId}:tool:${toolCallId}`;
}

function findTaskBySessionId(
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>,
  childSessionId: string,
) {
  return Object.values(graph.tasks).find((task) => task.sessionId === childSessionId) ?? null;
}

function buildTaskToolOutput(input: {
  assignedAgent: string;
  category?: string;
  errorMessage?: string;
  message?: string;
  reason?: string;
  requestedSkills?: string[];
  result?: string;
  sessionId: string;
  status: TaskToolOutputStatus;
  taskId: string;
}) {
  return {
    taskId: input.taskId,
    sessionId: input.sessionId,
    status: input.status,
    assignedAgent: input.assignedAgent,
    ...(input.category ? { category: input.category } : {}),
    ...(input.requestedSkills && input.requestedSkills.length > 0
      ? { requestedSkills: input.requestedSkills }
      : {}),
    ...(input.result ? { result: input.result } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.message ? { message: input.message } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function truncateTaskReminderText(value: string, maxLength = 1200): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildTaskCompletionAssistantEventText(input: {
  assignedAgent: string;
  childSessionId: string;
  errorMessage?: string;
  reason?: string;
  result?: string;
  status: Extract<TaskToolOutputStatus, 'cancelled' | 'done' | 'failed'>;
  taskTitle: string;
}): string {
  const primaryMessage = truncateTaskReminderText(
    input.errorMessage ?? input.result ?? '子代理执行已结束。',
  );
  const titleSuffix = input.reason === 'timeout' ? '（超时）' : '';
  const payload = {
    source: 'openawork_internal',
    type: 'assistant_event',
    payload: {
      kind: 'agent',
      title:
        input.status === 'failed'
          ? `子代理失败${titleSuffix} · ${input.taskTitle}`
          : input.status === 'cancelled'
            ? `子代理已取消 · ${input.taskTitle}`
            : `子代理已完成 · ${input.taskTitle}`,
      message: [
        `代理：${input.assignedAgent}`,
        input.errorMessage ? `错误：${primaryMessage}` : `结果：${primaryMessage}`,
        ...(input.reason ? [`原因：${input.reason}`] : []),
        `会话：${input.childSessionId}`,
      ].join('\n'),
      status:
        input.status === 'failed' ? 'error' : input.status === 'cancelled' ? 'paused' : 'success',
    },
  };

  return JSON.stringify(payload);
}

function createTaskCompletionReminderClientRequestId(input: {
  status: Extract<TaskToolOutputStatus, 'cancelled' | 'done' | 'failed'>;
  taskId: string;
  updatedAt: number;
}): string {
  return `task-reminder:${input.taskId}:${input.status}:${input.updatedAt}`;
}

function appendParentTaskCompletionReminder(input: {
  assignedAgent: string;
  childSessionId: string;
  errorMessage?: string;
  parentSessionId: string;
  reason?: string;
  result?: string;
  status: Extract<TaskToolOutputStatus, 'cancelled' | 'done' | 'failed'>;
  taskId: string;
  taskTitle: string;
  taskUpdatedAt: number;
  userId: string;
}): void {
  appendSessionMessage({
    sessionId: input.parentSessionId,
    userId: input.userId,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: buildTaskCompletionAssistantEventText({
          assignedAgent: input.assignedAgent,
          childSessionId: input.childSessionId,
          errorMessage: input.errorMessage,
          reason: input.reason,
          result: input.result,
          status: input.status,
          taskTitle: input.taskTitle,
        }),
      },
    ],
    clientRequestId: createTaskCompletionReminderClientRequestId({
      status: input.status,
      taskId: input.taskId,
      updatedAt: input.taskUpdatedAt,
    }),
    replaceExisting: true,
  });
}

function isTaskCreatedSessionMetadata(metadata: Record<string, unknown>): boolean {
  return metadata['createdByTool'] === 'task';
}

function listParsedTaskSessionsForUser(userId: string): ParsedTaskSessionRow[] {
  return sqliteAll<TaskSessionRow>(
    'SELECT id, metadata_json, state_status FROM sessions WHERE user_id = ?',
    [userId],
  ).map((row) => {
    const metadata = parseSessionMetadataJson(row.metadata_json);
    const parentSessionId =
      typeof metadata['parentSessionId'] === 'string' ? metadata['parentSessionId'] : null;
    return {
      ...row,
      metadata,
      parentSessionId,
    };
  });
}

function resolveTaskSessionChain(
  sessionsById: ReadonlyMap<string, ParsedTaskSessionRow>,
  sessionId: string,
): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentSessionId: string | null = sessionId;

  while (currentSessionId && !visited.has(currentSessionId)) {
    chain.push(currentSessionId);
    visited.add(currentSessionId);
    currentSessionId = sessionsById.get(currentSessionId)?.parentSessionId ?? null;
  }

  return chain;
}

function resolveTaskRootSessionId(
  sessionsById: ReadonlyMap<string, ParsedTaskSessionRow>,
  sessionId: string,
): string {
  const chain = resolveTaskSessionChain(sessionsById, sessionId);
  return chain[chain.length - 1] ?? sessionId;
}

function countTaskChildSessionsUnderRoot(
  sessionsById: ReadonlyMap<string, ParsedTaskSessionRow>,
  rootSessionId: string,
): number {
  let count = 0;
  for (const session of sessionsById.values()) {
    if (!isTaskCreatedSessionMetadata(session.metadata)) {
      continue;
    }

    if (resolveTaskRootSessionId(sessionsById, session.id) === rootSessionId) {
      count += 1;
    }
  }

  return count;
}

function countRunningTaskChildSessionsUnderRoot(
  sessionsById: ReadonlyMap<string, ParsedTaskSessionRow>,
  rootSessionId: string,
  excludeSessionId?: string,
): number {
  let count = 0;
  for (const session of sessionsById.values()) {
    if (session.id === excludeSessionId || session.state_status !== 'running') {
      continue;
    }

    if (!isTaskCreatedSessionMetadata(session.metadata)) {
      continue;
    }

    if (resolveTaskRootSessionId(sessionsById, session.id) === rootSessionId) {
      count += 1;
    }
  }

  return count;
}

export function getTaskSessionLimitError(input: {
  currentSessionId: string;
  excludeRunningSessionId?: string;
  isNewChildSession: boolean;
  userId: string;
}): string | null {
  const taskSessions = listParsedTaskSessionsForUser(input.userId);
  const sessionsById = new Map(taskSessions.map((session) => [session.id, session]));
  const nextChildDepth = resolveTaskSessionChain(sessionsById, input.currentSessionId).length;
  const rootSessionId = resolveTaskRootSessionId(sessionsById, input.currentSessionId);

  if (input.isNewChildSession && nextChildDepth > MAX_TASK_CHILD_SESSION_DEPTH) {
    return `子代理嵌套深度已达到上限（${MAX_TASK_CHILD_SESSION_DEPTH}），请在当前会话内完成后续工作。`;
  }

  if (
    input.isNewChildSession &&
    countTaskChildSessionsUnderRoot(sessionsById, rootSessionId) >=
      MAX_TASK_CHILD_SESSION_DESCENDANTS
  ) {
    return `当前任务树下的子代理数量已达到上限（${MAX_TASK_CHILD_SESSION_DESCENDANTS}），请先结束部分子任务再继续委派。`;
  }

  if (
    countRunningTaskChildSessionsUnderRoot(
      sessionsById,
      rootSessionId,
      input.excludeRunningSessionId,
    ) >= MAX_RUNNING_TASK_CHILD_SESSIONS_PER_ROOT
  ) {
    return `当前任务树中正在运行的子代理已达到上限（${MAX_RUNNING_TASK_CHILD_SESSIONS_PER_ROOT}），请等待已有子任务完成后再继续。`;
  }

  return null;
}

function buildTaskTags(input: {
  agentId: string;
  category?: string;
  requestedSkills: string[];
}): string[] {
  return [
    'task-tool',
    input.agentId,
    ...(input.category ? [`category:${input.category}`] : []),
    ...input.requestedSkills.map((skill) => `skill:${skill}`),
  ];
}

function buildDelegatedChildRequestData(input: {
  agentId: string;
  childSessionId: string;
  executionContext?: SandboxExecutionContext;
  modelSelection?: {
    modelId: string;
    providerId?: string;
    variant?: string;
  };
  prompt: string;
  systemPrompt?: string;
}): Record<string, unknown> | null {
  if (
    !input.executionContext?.requestData ||
    typeof input.executionContext.requestData !== 'object'
  ) {
    return null;
  }

  return {
    ...input.executionContext.requestData,
    agentId: input.agentId,
    clientRequestId: buildDelegatedChildClientRequestId({
      childSessionId: input.childSessionId,
      parentClientRequestId: input.executionContext.clientRequestId,
    }),
    displayMessage: input.prompt,
    message: input.prompt,
    ...(input.modelSelection?.modelId ? { model: input.modelSelection.modelId } : {}),
    ...(input.modelSelection?.providerId ? { providerId: input.modelSelection.providerId } : {}),
    ...(input.modelSelection?.variant ? { variant: input.modelSelection.variant } : {}),
    ...(input.systemPrompt
      ? { systemPrompt: input.systemPrompt }
      : input.executionContext.requestData['systemPrompt'] !== undefined
        ? { systemPrompt: input.executionContext.requestData['systemPrompt'] }
        : {}),
  };
}

export function readTaskParentToolReference(
  metadata: Record<string, unknown>,
): TaskParentToolReference | undefined {
  const clientRequestId = metadata[TASK_PARENT_TOOL_REQUEST_ID_KEY];
  const toolCallId = metadata[TASK_PARENT_TOOL_CALL_ID_KEY];
  if (typeof clientRequestId !== 'string' || typeof toolCallId !== 'string') {
    return undefined;
  }

  return { clientRequestId, toolCallId };
}

export function clearTaskParentToolReference(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  if (
    !(TASK_PARENT_TOOL_REQUEST_ID_KEY in metadata) &&
    !(TASK_PARENT_TOOL_CALL_ID_KEY in metadata)
  ) {
    return metadata;
  }

  const nextMetadata = { ...metadata };
  delete nextMetadata[TASK_PARENT_TOOL_REQUEST_ID_KEY];
  delete nextMetadata[TASK_PARENT_TOOL_CALL_ID_KEY];
  return nextMetadata;
}

function readTaskRequestedSkills(metadata: Record<string, unknown>): string[] | undefined {
  const candidate = metadata['requestedSkills'];
  if (!Array.isArray(candidate)) {
    return undefined;
  }

  const skills = candidate.filter((value): value is string => typeof value === 'string');
  return skills.length > 0 ? skills : undefined;
}

function readTaskCategory(metadata: Record<string, unknown>): string | undefined {
  return typeof metadata['taskCategory'] === 'string' ? metadata['taskCategory'] : undefined;
}

export async function reconcileResumedTaskChildSession(input: {
  childSessionId: string;
  pendingInteraction: boolean;
  statusCode: number;
  userId: string;
}): Promise<void> {
  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  if (!childSession) {
    return;
  }

  const metadata = parseSessionMetadataJson(childSession.metadata_json);
  if (!isTaskCreatedSessionMetadata(metadata)) {
    return;
  }

  const parentSessionId =
    typeof metadata['parentSessionId'] === 'string' ? metadata['parentSessionId'] : null;
  if (!parentSessionId) {
    return;
  }

  const taskManager = new AgentTaskManagerImpl();
  const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
  const task = findTaskBySessionId(graph, input.childSessionId);
  if (!task) {
    return;
  }

  await finalizeChildTaskRun({
    assignedAgent:
      task.assignedAgent ??
      (typeof metadata['subagentType'] === 'string' ? metadata['subagentType'] : 'task'),
    childSessionId: input.childSessionId,
    childTaskId: task.id,
    parentToolReference: readTaskParentToolReference(metadata),
    parentSessionId,
    requestedSkills: readTaskRequestedSkills(metadata),
    result: {
      pendingInteraction: input.pendingInteraction,
      statusCode: input.statusCode,
      summary: getChildSessionSummary(input.childSessionId, input.userId),
    },
    taskCategory: readTaskCategory(metadata),
    taskManager,
    taskTitle: task.title,
    userId: input.userId,
  });
}

export async function reconcileTimedOutTaskChildSessionIfExpired(input: {
  childSessionId: string;
  nowMs?: number;
  userId: string;
}): Promise<boolean> {
  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  if (!childSession) {
    return false;
  }

  const metadata = parseSessionMetadataJson(childSession.metadata_json);
  if (!isTaskCreatedSessionMetadata(metadata)) {
    return false;
  }

  const effectiveDeadline = readChildSessionDeadlineMs(metadata);
  if (effectiveDeadline === undefined || effectiveDeadline > (input.nowMs ?? Date.now())) {
    return false;
  }

  return terminateTaskChildSessionAsTimeout({
    childSessionId: input.childSessionId,
    userId: input.userId,
  });
}

export async function terminateTaskChildSessionAsTimeout(input: {
  childSessionId: string;
  userId: string;
}): Promise<boolean> {
  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  if (!childSession) {
    return false;
  }

  const metadata = parseSessionMetadataJson(childSession.metadata_json);
  if (!isTaskCreatedSessionMetadata(metadata)) {
    return false;
  }

  const parentSessionId =
    typeof metadata['parentSessionId'] === 'string' ? metadata['parentSessionId'] : null;
  if (!parentSessionId) {
    return false;
  }

  const taskManager = new AgentTaskManagerImpl();
  const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
  const task = findTaskBySessionId(graph, input.childSessionId);
  if (!task) {
    return false;
  }

  const result = await terminateChildSession({
    childSessionId: input.childSessionId,
    graphSessionId: parentSessionId,
    reason: 'timeout',
    taskId: task.id,
    userId: input.userId,
  });
  return result.terminated;
}

export function syncParentTaskToolResult(input: {
  assignedAgent: string;
  category?: string;
  errorMessage?: string;
  parentSessionId: string;
  parentToolReference?: TaskParentToolReference;
  reason?: string;
  requestedSkills?: string[];
  result?: string;
  sessionId: string;
  status: TaskToolOutputStatus;
  taskId: string;
  userId: string;
}): void {
  if (!input.parentToolReference) {
    return;
  }

  const parentSession = sqliteGet<{ id: string }>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.parentSessionId, input.userId],
  );
  if (!parentSession) {
    return;
  }

  const terminalMessage =
    input.status === 'done' || input.status === 'failed' || input.status === 'cancelled'
      ? buildTaskToolTerminalMessage({
          agent: input.assignedAgent,
          category: input.category,
          errorMessage: input.errorMessage,
          resultText: input.result,
          sessionId: input.sessionId,
          status: input.status,
        })
      : undefined;

  const output = buildTaskToolOutput({
    assignedAgent: input.assignedAgent,
    category: input.category,
    errorMessage: input.errorMessage,
    ...(terminalMessage ? { message: terminalMessage } : {}),
    reason: input.reason,
    requestedSkills: input.requestedSkills,
    result: input.result,
    sessionId: input.sessionId,
    status: input.status,
    taskId: input.taskId,
  });
  const parentToolResultClientRequestId = createTaskToolResultClientRequestId(
    input.parentToolReference.clientRequestId,
    input.parentToolReference.toolCallId,
  );
  appendSessionMessage({
    sessionId: input.parentSessionId,
    userId: input.userId,
    role: 'tool',
    content: [
      buildToolResultContent({
        toolCallId: input.parentToolReference.toolCallId,
        toolName: 'task',
        clientRequestId: parentToolResultClientRequestId,
        output,
        isError: input.status === 'failed',
        reason: input.reason,
      }),
    ],
    clientRequestId: parentToolResultClientRequestId,
    replaceExisting: true,
  });

  publishSessionRunEvent(
    input.parentSessionId,
    buildToolResultRunEvent({
      toolCallId: input.parentToolReference.toolCallId,
      toolName: 'task',
      clientRequestId: parentToolResultClientRequestId,
      output,
      isError: input.status === 'failed',
      reason: input.reason,
      eventMeta: {
        eventId: `${input.parentSessionId}:${input.parentToolReference.toolCallId}:tool_result`,
        runId: `task:${input.taskId}`,
        occurredAt: Date.now(),
      },
    }),
    { clientRequestId: parentToolResultClientRequestId },
  );
}

const gatewayLspDiagnosticsTool: ToolDefinition<
  typeof lspDiagnosticsTool.inputSchema,
  typeof lspDiagnosticsTool.outputSchema
> = {
  ...lspDiagnosticsTool,
  execute: async (input) => {
    const diagnostics = (await lspManager.diagnostics()) as Record<string, unknown[]>;
    const requestedFilePath = input.filePath;

    if (typeof requestedFilePath === 'string' && requestedFilePath.length > 0) {
      const filePath = requestedFilePath ?? '';
      const key = Object.keys(diagnostics).find((entry) => entry.endsWith(filePath));
      return key ? { [key]: diagnostics[key]! } : {};
    }

    return diagnostics;
  },
};

const gatewayLspTouchTool: ToolDefinition<
  typeof lspTouchTool.inputSchema,
  typeof lspTouchTool.outputSchema
> = {
  ...lspTouchTool,
  execute: async (input) => {
    await lspManager.touchFile(input.path, input.waitForDiagnostics);
    return { ok: true };
  },
};

function buildPermissionRequestContext(
  sessionId: string,
  request: ToolCallRequest,
): PermissionRequestContext | null {
  const rawInput = request.rawInput as Record<string, unknown>;
  const pathValue =
    typeof rawInput['path'] === 'string'
      ? rawInput['path']
      : typeof rawInput['filePath'] === 'string'
        ? rawInput['filePath']
        : null;

  switch (request.toolName) {
    case 'workspace_write_file':
    case 'file_write':
    case 'write_file': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      if (!safePath) return null;
      return {
        scope: safePath,
        reason: '需要覆盖写入工作区文件',
        riskLevel: 'medium',
        previewAction: `覆盖写入 ${safePath}`,
      };
    }
    case 'write': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      if (!safePath) return null;
      return {
        scope: safePath,
        reason: '需要写入工作区文件',
        riskLevel: 'medium',
        previewAction: `写入 ${safePath}`,
      };
    }
    case 'edit': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      if (!safePath) return null;
      return {
        scope: safePath,
        reason: '需要编辑工作区文件',
        riskLevel: 'medium',
        previewAction: `编辑 ${safePath}`,
      };
    }
    case 'skill': {
      const name = typeof rawInput['name'] === 'string' ? rawInput['name'].trim() : '';
      if (!name) return null;
      return {
        scope: `skill:${name}`,
        reason: '需要加载技能内容并注入会话上下文',
        riskLevel: 'medium',
        previewAction: `加载技能 ${name}`,
      };
    }
    case 'skill_mcp': {
      const mcpName = typeof rawInput['mcp_name'] === 'string' ? rawInput['mcp_name'].trim() : '';
      const operation =
        typeof rawInput['tool_name'] === 'string'
          ? rawInput['tool_name'].trim()
          : typeof rawInput['resource_name'] === 'string'
            ? rawInput['resource_name'].trim()
            : typeof rawInput['prompt_name'] === 'string'
              ? rawInput['prompt_name'].trim()
              : '';
      if (!mcpName || !operation) return null;
      return {
        scope: `skill_mcp:${mcpName}:${operation}`,
        reason: '需要调用技能内嵌的 MCP 能力',
        riskLevel: 'high',
        previewAction: `调用 skill MCP ${mcpName}/${operation}`,
      };
    }
    case 'codesearch': {
      const query = typeof rawInput['query'] === 'string' ? rawInput['query'].trim() : '';
      if (!query) return null;
      return {
        scope: `codesearch:${query}`,
        reason: '需要联网搜索真实代码上下文',
        riskLevel: 'medium',
        previewAction: `代码搜索: ${query}`,
      };
    }
    case 'bash': {
      const command = typeof rawInput['command'] === 'string' ? rawInput['command'].trim() : '';
      const workdirValue =
        typeof rawInput['workdir'] === 'string' ? rawInput['workdir'] : WORKSPACE_ROOT;
      const safeWorkdir = validateWorkspacePath(workdirValue);
      if (!command || !safeWorkdir) return null;
      return {
        scope: buildBashPermissionScope(command, safeWorkdir),
        reason: '需要执行工作区命令',
        riskLevel: 'high',
        previewAction: `执行命令: ${command}`,
      };
    }
    case 'interactive_bash': {
      const tmuxCommand =
        typeof rawInput['tmux_command'] === 'string' ? rawInput['tmux_command'].trim() : '';
      if (!tmuxCommand) return null;
      return {
        scope: `interactive_bash:${tmuxCommand}`,
        reason: '需要执行 tmux 交互式命令',
        riskLevel: 'high',
        previewAction: `执行 tmux 命令: ${tmuxCommand}`,
      };
    }
    case 'apply_patch': {
      const patchText = typeof rawInput['patchText'] === 'string' ? rawInput['patchText'] : '';
      if (!patchText.trim()) return null;
      return {
        scope: buildApplyPatchPermissionScope(patchText),
        reason: '需要批量修改工作区文件',
        riskLevel: 'high',
        previewAction: '应用结构化补丁到工作区文件',
      };
    }
    case 'task': {
      const description =
        typeof rawInput['description'] === 'string' ? rawInput['description'].trim() : '';
      if (!description) return null;
      return {
        scope: `task:${description}`,
        reason: '需要创建子任务和子会话',
        riskLevel: 'high',
        previewAction: `创建子任务 ${description}`,
      };
    }
    case 'workspace_create_file': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      if (!safePath) return null;
      return {
        scope: safePath,
        reason: '需要在工作区中新建文件',
        riskLevel: 'medium',
        previewAction: `创建文件 ${safePath}`,
      };
    }
    case 'workspace_create_directory': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      if (!safePath) return null;
      return {
        scope: safePath,
        reason: '需要在工作区中新建目录',
        riskLevel: 'medium',
        previewAction: `创建目录 ${safePath}`,
      };
    }
    case 'workspace_review_revert': {
      const safeWorkspacePath = pathValue ? validateWorkspacePath(pathValue) : null;
      const filePath = typeof rawInput['filePath'] === 'string' ? rawInput['filePath'] : null;
      if (!safeWorkspacePath || !filePath) return null;
      const relativeFilePath = resolveWorkspaceReviewFilePath(safeWorkspacePath, filePath);
      const absoluteFilePath = join(safeWorkspacePath, relativeFilePath);
      return {
        scope: absoluteFilePath,
        reason: '需要回滚工作区文件改动',
        riskLevel: 'high',
        previewAction: `回滚 ${absoluteFilePath}`,
      };
    }
    case 'mcp_call': {
      const serverId = typeof rawInput['serverId'] === 'string' ? rawInput['serverId'].trim() : '';
      const toolName = typeof rawInput['toolName'] === 'string' ? rawInput['toolName'].trim() : '';
      const argumentsValue = rawInput['arguments'];
      if (!serverId || !toolName || !argumentsValue || typeof argumentsValue !== 'object') {
        return null;
      }
      const server = getConfiguredMcpServerForSession(sessionId, serverId);
      const serverFingerprint = getMcpServerFingerprint(server);
      const previewArguments = JSON.stringify(argumentsValue).slice(0, 240);
      return {
        scope: `mcp:${serverId}:${toolName}:${serverFingerprint}`,
        reason: '需要调用 MCP 工具',
        riskLevel: 'high',
        previewAction: `调用 ${serverId}/${toolName} ${previewArguments}`,
      };
    }
    case 'mcp_list_tools': {
      const serverId = typeof rawInput['serverId'] === 'string' ? rawInput['serverId'].trim() : '';
      const selectedServers = serverId
        ? [getConfiguredMcpServerForSession(sessionId, serverId)]
        : getConfiguredMcpServersForSession(sessionId).filter((server) => server.enabled);
      if (selectedServers.length === 0) {
        return null;
      }
      const fingerprint = selectedServers
        .map((server) => `${server.id}:${getMcpServerFingerprint(server)}`)
        .sort((left, right) => left.localeCompare(right))
        .join('|');
      return {
        scope: `mcp-list:${fingerprint}`,
        reason: '需要连接 MCP 服务器并列出可用工具',
        riskLevel: 'high',
        previewAction: `列出 MCP 工具：${selectedServers.map((server) => server.id).join(', ')}`,
      };
    }
    case 'desktop_automation': {
      const action =
        typeof rawInput['action'] === 'string' ? rawInput['action'].trim().toLowerCase() : '';
      if (!action) {
        return null;
      }
      const target =
        typeof rawInput['url'] === 'string'
          ? rawInput['url'].trim()
          : typeof rawInput['selector'] === 'string'
            ? rawInput['selector'].trim()
            : '';
      return {
        scope: target ? `desktop_automation:${action}:${target}` : `desktop_automation:${action}`,
        reason: '需要操作桌面 sidecar 的浏览器自动化能力',
        riskLevel: 'high',
        previewAction: target ? `桌面自动化 ${action}: ${target}` : `桌面自动化 ${action}`,
      };
    }
    case 'lsp_rename': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      const newName = typeof rawInput['newName'] === 'string' ? rawInput['newName'].trim() : '';
      if (!safePath || !newName) return null;
      return {
        scope: `lsp_rename:${safePath}:${newName}`,
        reason: '需要通过 LSP 跨文件重命名符号',
        riskLevel: 'high',
        previewAction: `LSP 重命名 ${safePath} → ${newName}`,
      };
    }
    default:
      return null;
  }
}

async function executeGatewayManagedTool(
  sandbox: ToolSandbox,
  sessionId: string,
  request: ToolCallRequest,
  signal: AbortSignal,
  observability: PermissionRequestPayload['observability'] | undefined,
  executionContext?: SandboxExecutionContext,
): Promise<ToolCallResult | null> {
  const rawInput = request.rawInput as Record<string, unknown>;

  try {
    if (request.toolName === todoWriteTool.name) {
      const parsed = todoWriteInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatTodoWriteValidationError(rawInput),
          isError: true,
          durationMs: 0,
        };
      }

      const output = runTodoWriteTool(sessionId, parsed.data);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === todoReadTool.name) {
      const parsed = todoReadInputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatTodoReadValidationError(rawInput ?? {}),
          isError: true,
          durationMs: 0,
        };
      }

      const output = runTodoReadTool(sessionId);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === subTodoWriteTool.name) {
      const parsed = subTodoWriteInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatSubTodoWriteValidationError(rawInput),
          isError: true,
          durationMs: 0,
        };
      }

      const output = runSubTodoWriteTool(sessionId, parsed.data);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === subTodoReadTool.name) {
      const parsed = subTodoReadInputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatSubTodoReadValidationError(rawInput ?? {}),
          isError: true,
          durationMs: 0,
        };
      }

      const output = runSubTodoReadTool(sessionId);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === 'mcp_list_tools') {
      const serverId = typeof rawInput['serverId'] === 'string' ? rawInput['serverId'] : undefined;
      const output = await listMcpToolsForSession(sessionId, { serverId });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === desktopAutomationToolDefinition.name) {
      const parsed = desktopAutomationToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: await runDesktopAutomationTool(parsed.data),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === sessionListToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }
      const parsed = sessionListToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: await runSessionListTool(userId, parsed.data),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === sessionReadToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }
      const parsed = sessionReadToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: runSessionReadTool(userId, parsed.data),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === sessionSearchToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }
      const parsed = sessionSearchToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: runSessionSearchTool(userId, parsed.data),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === sessionInfoToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }
      const parsed = sessionInfoToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: await runSessionInfoTool(userId, parsed.data),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === taskCreateToolDefinition.name) {
      const parsed = taskCreateToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: await runTaskCreateTool(sessionId, parsed.data),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === taskGetToolDefinition.name) {
      const parsed = taskGetToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: await runTaskGetTool(sessionId, parsed.data),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === taskListToolDefinition.name) {
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: await runTaskListTool(sessionId),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === taskUpdateToolDefinition.name) {
      const parsed = taskUpdateToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: await runTaskUpdateTool(sessionId, parsed.data),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === skillMcpToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }
      const parsed = skillMcpToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }
      try {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: await runSkillMcpTool(userId, parsed.data),
          isError: false,
          durationMs: 0,
        };
      } catch (error) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Error: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
          durationMs: 0,
        };
      }
    }

    if (request.toolName === lookAtToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }
      const parsed = lookAtToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }
      try {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: await runLookAtTool({
            filePath: parsed.data.file_path,
            goal: parsed.data.goal,
            imageData: parsed.data.image_data,
            parentSessionId: sessionId,
            userId,
          }),
          isError: false,
          durationMs: 0,
        };
      } catch (error) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Error: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
          durationMs: 0,
        };
      }
    }

    if (request.toolName === callOmoAgentToolDefinition.name) {
      const parsed = callOmoAgentToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const normalizedAgent = parsed.data.subagent_type.trim().toLowerCase();
      if (
        !CALL_OMO_ALLOWED_AGENTS.includes(
          normalizedAgent as (typeof CALL_OMO_ALLOWED_AGENTS)[number],
        )
      ) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Error: Invalid agent type "${parsed.data.subagent_type}". Only ${CALL_OMO_ALLOWED_AGENTS.join(', ')} are allowed.`,
          isError: true,
          durationMs: 0,
        };
      }

      if (parsed.data.run_in_background && parsed.data.session_id) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output:
            'Error: session_id is not supported in background mode. Use run_in_background=false to continue an existing session.',
          isError: true,
          durationMs: 0,
        };
      }

      const delegatedRequest: ToolCallRequest = {
        ...request,
        toolName: taskToolDefinition.name,
        rawInput: {
          description: parsed.data.description,
          prompt: parsed.data.prompt,
          subagent_type: normalizedAgent,
          load_skills: [],
          run_in_background: parsed.data.run_in_background,
          ...(parsed.data.session_id ? { session_id: parsed.data.session_id } : {}),
        },
      };
      const taskResult = await executeGatewayManagedTool(
        sandbox,
        sessionId,
        delegatedRequest,
        signal,
        observability,
        executionContext,
      );
      if (!taskResult) {
        return null;
      }
      if (
        taskResult.output &&
        typeof taskResult.output === 'object' &&
        !Array.isArray(taskResult.output) &&
        'sessionId' in taskResult.output &&
        'taskId' in taskResult.output
      ) {
        const taskOutput = taskResult.output as {
          errorMessage?: string;
          sessionId: string;
          taskId: string;
          status?: string;
          result?: string;
        };
        const childUserId = getSessionOwnerUserId(taskOutput.sessionId);
        const childClientRequestId = buildDelegatedChildClientRequestId({
          childSessionId: taskOutput.sessionId,
          parentClientRequestId: executionContext?.clientRequestId,
        });
        const childMessages =
          childUserId && executionContext?.clientRequestId
            ? listSessionMessagesByRequestScope({
                clientRequestId: childClientRequestId,
                sessionId: taskOutput.sessionId,
                userId: childUserId,
              })
            : childUserId
              ? listSessionMessages({
                  sessionId: taskOutput.sessionId,
                  userId: childUserId,
                })
              : [];
        const output = parsed.data.run_in_background
          ? buildCallOmoAgentBackgroundOutput({
              agent: normalizedAgent,
              description: parsed.data.description,
              sessionId: taskOutput.sessionId,
              status: taskOutput.status ?? 'pending',
              taskId: taskOutput.taskId,
            })
          : buildCallOmoAgentSyncOutput({
              fallbackText:
                taskOutput.errorMessage ??
                taskOutput.result ??
                `Completed ${normalizedAgent} session ${taskOutput.sessionId}.`,
              isError: taskResult.isError,
              messages: childMessages,
              sessionId: taskOutput.sessionId,
            });
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output,
          isError: taskResult.isError,
          durationMs: taskResult.durationMs,
        };
      }
      return {
        ...taskResult,
        toolName: request.toolName,
      };
    }

    if (request.toolName === readToolOutputToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }

      const parsed = readToolOutputToolDefinition.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const resolvedStored = parsed.data.toolCallId
        ? getSessionToolResultByCallId({
            sessionId,
            userId,
            toolCallId: parsed.data.toolCallId,
          })
        : parsed.data.useLatestReferenced
          ? getLatestReferencedToolResult({ sessionId, userId })
          : null;
      if (!resolvedStored) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.data.toolCallId
            ? `Tool result ${parsed.data.toolCallId} was not found in the current session`
            : 'No large referenced tool result was found in the current session',
          isError: true,
          durationMs: 0,
        };
      }

      const serializedOutput = (() => {
        if (typeof resolvedStored.output === 'string') {
          return resolvedStored.output;
        }
        try {
          return JSON.stringify(resolvedStored.output);
        } catch {
          return String(resolvedStored.output);
        }
      })();

      const sizeBytes = Buffer.byteLength(serializedOutput, 'utf8');
      const response = buildReadToolOutputResponse({
        toolCallId: resolvedStored.toolCallId,
        output: resolvedStored.output,
        isError: resolvedStored.isError,
        request: parsed.data,
        sizeBytes,
      });
      const latestReferenceNote =
        !parsed.data.toolCallId && parsed.data.useLatestReferenced
          ? `已自动解析为最近一个被引用的大输出：${resolvedStored.toolCallId}。${response.note ? ` ${response.note}` : ''}`
          : response.note;
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: {
          ...response,
          note: latestReferenceNote,
        },
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === 'mcp_call') {
      const serverId = typeof rawInput['serverId'] === 'string' ? rawInput['serverId'] : '';
      const toolName = typeof rawInput['toolName'] === 'string' ? rawInput['toolName'] : '';
      const argumentsValue = rawInput['arguments'];
      if (!serverId || !toolName || !argumentsValue || typeof argumentsValue !== 'object') {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: 'mcp_call requires serverId, toolName, and an object-shaped arguments field',
          isError: true,
          durationMs: 0,
        };
      }

      const output = await callMcpToolForSession(sessionId, {
        serverId,
        toolName,
        arguments: argumentsValue as Record<string, unknown>,
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: output.isError === true,
        durationMs: 0,
      };
    }

    if (request.toolName === 'edit') {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }
      const editTool = createEditTool(
        sessionId,
        userId,
        executionContext?.clientRequestId ?? request.toolCallId,
        request.toolCallId,
      );
      const parsed = editTool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await editTool.execute(parsed.data, signal);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (
      request.toolName === workspaceWriteFileTool.name ||
      request.toolName === writeTool.name ||
      request.toolName === fileWriteTool.name ||
      request.toolName === writeFileTool.name
    ) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }

      const toolDefinition =
        request.toolName === workspaceWriteFileTool.name
          ? workspaceWriteFileTool
          : request.toolName === writeTool.name
            ? writeTool
            : request.toolName === fileWriteTool.name
              ? fileWriteTool
              : writeFileTool;
      const parsed = toolDefinition.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const output =
        request.toolName === workspaceWriteFileTool.name
          ? await executeWorkspaceWriteFile(parsed.data, {
              beforeWriteBackup: async ({ content, filePath }) =>
                captureBeforeWriteBackup({
                  sessionId,
                  userId,
                  requestId: executionContext?.clientRequestId,
                  toolCallId: request.toolCallId,
                  toolName: request.toolName,
                  filePath,
                  content,
                  kind: 'before_write',
                }),
            })
          : await executeWriteTool(
              'filePath' in parsed.data
                ? { path: parsed.data.filePath, content: parsed.data.content }
                : parsed.data,
              signal,
              {
                beforeWriteBackup: async ({ content, filePath }) =>
                  captureBeforeWriteBackup({
                    sessionId,
                    userId,
                    requestId: executionContext?.clientRequestId,
                    toolCallId: request.toolCallId,
                    toolName: request.toolName,
                    filePath,
                    content,
                    kind: 'before_write',
                  }),
              },
            );

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === workspaceCreateFileTool.name) {
      const parsed = workspaceCreateFileTool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await executeWorkspaceCreateFile(parsed.data);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === applyPatchToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }
      const parsed = applyPatchToolDefinition.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await executeApplyPatch(parsed.data, {
        beforeWriteBackup: async ({ content, filePath }) =>
          captureBeforeWriteBackup({
            sessionId,
            userId,
            requestId: executionContext?.clientRequestId,
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            filePath,
            content,
            kind: 'before_write',
          }),
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === 'batch') {
      const toolCallsValue = rawInput['tool_calls'];
      if (!Array.isArray(toolCallsValue) || toolCallsValue.length === 0) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: 'batch requires a non-empty tool_calls array',
          isError: true,
          durationMs: 0,
        };
      }

      const selectedToolCalls = toolCallsValue.slice(0, BATCH_TOOL_MAX_CALLS);
      const droppedToolCalls = toolCallsValue.slice(BATCH_TOOL_MAX_CALLS);

      let pendingRequestId: string | undefined;
      const results = await Promise.all(
        selectedToolCalls.map(async (entry, index) => {
          if (!entry || typeof entry !== 'object') {
            return {
              tool: 'unknown',
              isError: true,
              output: `Invalid batch tool call at index ${index}`,
            };
          }

          const tool = typeof entry['tool'] === 'string' ? entry['tool'] : '';
          const parameters =
            entry['parameters'] && typeof entry['parameters'] === 'object'
              ? entry['parameters']
              : null;
          if (!tool || !parameters) {
            return {
              tool: tool || 'unknown',
              isError: true,
              output: `Batch entry ${index} requires tool and object-shaped parameters`,
            };
          }

          if (BATCH_TOOL_DISALLOWED.has(tool)) {
            return {
              tool,
              isError: true,
              output: `Tool "${tool}" cannot be called from batch`,
            };
          }

          const subRequest: ToolCallRequest = {
            toolCallId: `${request.toolCallId}:${index}`,
            toolName: tool,
            rawInput: parameters,
          };
          const subResult = await sandbox.execute(subRequest, signal, sessionId, executionContext);
          if (!pendingRequestId && subResult.pendingPermissionRequestId) {
            pendingRequestId = subResult.pendingPermissionRequestId;
          }
          return {
            tool,
            isError: subResult.isError,
            output: subResult.output,
          };
        }),
      );

      for (const [index, droppedEntry] of droppedToolCalls.entries()) {
        const tool =
          droppedEntry &&
          typeof droppedEntry === 'object' &&
          typeof droppedEntry['tool'] === 'string'
            ? droppedEntry['tool']
            : 'unknown';
        results.push({
          tool,
          isError: true,
          output: `Batch accepts at most ${BATCH_TOOL_MAX_CALLS} tool calls; entry ${BATCH_TOOL_MAX_CALLS + index} was ignored`,
        });
      }

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: { results, total: results.length },
        isError: results.some((result) => result.isError),
        durationMs: 0,
        ...(pendingRequestId ? { pendingPermissionRequestId: pendingRequestId } : {}),
      };
    }

    if (request.toolName === 'skill') {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }

      const skillTool = createSkillTool(sessionId, userId);
      const parsed = skillTool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await skillTool.execute(parsed.data, signal);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === 'question') {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }

      const parsed = questionToolDefinition.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const payload =
        executionContext?.clientRequestId &&
        executionContext.requestData &&
        typeof executionContext.nextRound === 'number'
          ? {
              clientRequestId: executionContext.clientRequestId,
              nextRound: executionContext.nextRound,
              requestData: executionContext.requestData,
              toolCallId: request.toolCallId,
              rawInput,
              ...(observability ? { observability } : {}),
            }
          : undefined;
      const title = buildQuestionRequestTitle(parsed.data);
      const existingPending = findPendingQuestionRequest(sessionId, title);
      const requestId = existingPending
        ? existingPending
        : createPendingQuestionRequest({
            sessionId,
            userId,
            title,
            questionsJson: JSON.stringify(parsed.data.questions),
            payload,
          });
      if (existingPending && payload) {
        updatePendingQuestionPayload(existingPending, payload);
      }

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: existingPending
          ? `Question request ${requestId} is still pending. Ask the user to answer it, then resume the session.`
          : `Question request ${requestId} has been created. Ask the user to answer it, then resume the session.`,
        isError: true,
        durationMs: 0,
        pendingPermissionRequestId: requestId,
      };
    }

    if (request.toolName === enterPlanModeToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }

      const parsed = enterPlanModeToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const metadata = getSessionMetadata(sessionId);
      if (!isPlanModeToolEnabledForSessionMetadata(metadata)) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: 'EnterPlanMode is not available in this session context.',
          isError: true,
          durationMs: 0,
        };
      }
      if (isPlanModeEnabled(metadata)) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output:
            'Plan mode is already active. Continue refining the plan until you are ready to request approval.',
          isError: false,
          durationMs: 0,
        };
      }

      updateSessionMetadata(sessionId, { ...metadata, planMode: true });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output:
          'Entered plan mode. Stay in read-first planning until the user approves leaving plan mode.',
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === exitPlanModeToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }

      const parsed = exitPlanModeToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const metadata = getSessionMetadata(sessionId);
      if (!isPlanModeToolEnabledForSessionMetadata(metadata)) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: 'ExitPlanMode is not available in this session context.',
          isError: true,
          durationMs: 0,
        };
      }
      if (!isPlanModeEnabled(metadata)) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: 'You are not in plan mode. Call EnterPlanMode before requesting plan approval.',
          isError: true,
          durationMs: 0,
        };
      }

      const payload =
        executionContext?.clientRequestId &&
        executionContext.requestData &&
        typeof executionContext.nextRound === 'number'
          ? {
              clientRequestId: executionContext.clientRequestId,
              nextRound: executionContext.nextRound,
              requestData: executionContext.requestData,
              toolCallId: request.toolCallId,
              rawInput,
              ...(observability ? { observability } : {}),
            }
          : undefined;

      const questionInput = buildExitPlanModeQuestionInput(parsed.data);
      const title = 'Exit plan mode';
      const existingPending = findPendingQuestionRequest(sessionId, title);
      const requestId = existingPending
        ? existingPending
        : createPendingQuestionRequest({
            sessionId,
            userId,
            toolName: exitPlanModeToolDefinition.name,
            title,
            questionsJson: JSON.stringify(questionInput.questions),
            payload,
          });
      if (existingPending && payload) {
        updatePendingQuestionPayload(existingPending, payload);
      }

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: existingPending
          ? `Plan approval request ${requestId} is still pending. Ask the user to answer it, then resume the session.`
          : `Plan approval request ${requestId} has been created. Ask the user to answer it, then resume the session.`,
        isError: true,
        durationMs: 0,
        pendingPermissionRequestId: requestId,
      };
    }

    if (request.toolName === 'task') {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }

      const parsed = taskToolDefinition.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.error.issues.map((issue) => issue.message).join(', '),
          isError: true,
          durationMs: 0,
        };
      }

      const taskManager = new AgentTaskManagerImpl();
      const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
      const resolvedAgent = resolveDelegatedAgent(userId, parsed.data);
      const selectedDelegatedModel = selectDelegatedModelForUser(
        userId,
        resolvedAgent.modelEntries,
      );
      const delegatedModel = selectedDelegatedModel
        ? {
            ...selectedDelegatedModel,
            ...(resolvedAgent.modelVariant ? { variant: resolvedAgent.modelVariant } : {}),
          }
        : undefined;
      const requestedSkills = resolvedAgent.requestedSkills;
      const category = parsed.data.category?.trim();
      const taskTags = buildTaskTags({
        agentId: resolvedAgent.agentId,
        category,
        requestedSkills,
      });
      const requestedTaskId = parsed.data.task_id;
      const requestedSessionId = parsed.data.session_id;
      const existingTask = requestedTaskId ? graph.tasks[requestedTaskId] : null;
      const existingTaskBySession =
        existingTask?.sessionId || !requestedSessionId
          ? null
          : findTaskBySessionId(graph, requestedSessionId);
      const resumableTask = existingTask?.sessionId
        ? existingTask
        : existingTaskBySession?.sessionId
          ? existingTaskBySession
          : null;
      const childSessionId = resumableTask?.sessionId ?? requestedSessionId ?? randomUUID();
      const childSessionTitle = `${parsed.data.description} (@${resolvedAgent.agentId})`;
      const childRequestData = buildDelegatedChildRequestData({
        agentId: resolvedAgent.agentId,
        childSessionId,
        executionContext,
        modelSelection: delegatedModel,
        prompt: parsed.data.prompt,
        systemPrompt: resolvedAgent.systemPrompt,
      });
      const parentSessionRow = sqliteGet<{ metadata_json: string }>(
        'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, userId],
      );
      const parentSessionMetadata = parentSessionRow
        ? parseSessionMetadataJson(parentSessionRow.metadata_json)
        : {};
      const canExecuteImmediately = childRequestData !== null;
      const shouldRunInBackground = canExecuteImmediately && parsed.data.run_in_background === true;
      const parentToolReference =
        executionContext?.clientRequestId !== undefined
          ? {
              clientRequestId: executionContext.clientRequestId,
              toolCallId: request.toolCallId,
            }
          : undefined;
      const autoResumeRequestData = executionContext?.requestData;
      const canAutoResumeParentSession =
        shouldRunInBackground &&
        parentToolReference !== undefined &&
        autoResumeRequestData !== undefined;
      const childSessionMetadata: Record<string, unknown> = {
        parentSessionId: sessionId,
        subagentType: resolvedAgent.agentId,
        createdByTool: 'task',
        delegatedPromptVersion: 'v2',
        delegatedSystemPrompt: resolvedAgent.systemPrompt,
        delegatedModelCandidates: resolvedAgent.modelCandidates,
        requestedSkills,
      };
      if (delegatedModel?.modelId) {
        childSessionMetadata['modelId'] = delegatedModel.modelId;
      }
      if (delegatedModel?.providerId) {
        childSessionMetadata['providerId'] = delegatedModel.providerId;
      }
      if (delegatedModel?.variant) {
        childSessionMetadata['variant'] = delegatedModel.variant;
      }
      if (parentToolReference) {
        childSessionMetadata[TASK_PARENT_TOOL_REQUEST_ID_KEY] = parentToolReference.clientRequestId;
        childSessionMetadata[TASK_PARENT_TOOL_CALL_ID_KEY] = parentToolReference.toolCallId;
      }
      if (category) {
        childSessionMetadata['taskCategory'] = category;
      }
      const taskTimeoutMs = parsed.data.timeout_ms;
      const effectiveTaskDeadlineMs = resolveTaskChildEffectiveDeadlineMs({
        nowMs: Date.now(),
        parentMetadata: parentSessionMetadata,
        requestedTimeoutMs: taskTimeoutMs,
      });
      if (typeof effectiveTaskDeadlineMs === 'number') {
        childSessionMetadata[CHILD_SESSION_DEADLINE_KEY] = effectiveTaskDeadlineMs;
      }
      const inheritedWorkingDirectory = parentSessionMetadata['workingDirectory'];
      if (typeof inheritedWorkingDirectory === 'string') {
        childSessionMetadata['workingDirectory'] = inheritedWorkingDirectory;
      }
      const inheritedDialogueMode = parentSessionMetadata['dialogueMode'];
      if (typeof inheritedDialogueMode === 'string') {
        childSessionMetadata['dialogueMode'] = inheritedDialogueMode;
      }
      const inheritedUpstreamRetryMaxRetries =
        normalizeUpstreamRetryMaxRetries(childRequestData?.[UPSTREAM_RETRY_MAX_RETRIES_KEY]) ??
        normalizeUpstreamRetryMaxRetries(parentSessionMetadata[UPSTREAM_RETRY_MAX_RETRIES_KEY]);
      if (inheritedUpstreamRetryMaxRetries !== undefined) {
        childSessionMetadata[UPSTREAM_RETRY_MAX_RETRIES_KEY] = inheritedUpstreamRetryMaxRetries;
      }
      const existingChildSession = sqliteGet<{ id: string; metadata_json: string }>(
        'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [childSessionId, userId],
      );
      if (resumableTask?.sessionId && !existingChildSession) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Existing child session ${childSessionId} was not found for task ${resumableTask.id}`,
          isError: true,
          durationMs: 0,
        };
      }

      const taskSessionLimitError = getTaskSessionLimitError({
        currentSessionId: sessionId,
        excludeRunningSessionId: resumableTask?.sessionId,
        isNewChildSession: resumableTask === null,
        userId,
      });
      if (taskSessionLimitError) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: taskSessionLimitError,
          isError: true,
          durationMs: 0,
        };
      }

      if (existingChildSession) {
        let mergedMetadata = childSessionMetadata;
        try {
          const parsedExistingMetadata = JSON.parse(existingChildSession.metadata_json) as Record<
            string,
            unknown
          >;
          mergedMetadata = { ...parsedExistingMetadata, ...childSessionMetadata };
        } catch {
          mergedMetadata = childSessionMetadata;
        }
        if (effectiveTaskDeadlineMs === undefined) {
          delete mergedMetadata[CHILD_SESSION_DEADLINE_KEY];
        }
        sqliteRun(
          "UPDATE sessions SET metadata_json = ?, title = COALESCE(title, ?), updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          [JSON.stringify(mergedMetadata), childSessionTitle, childSessionId, userId],
        );
      } else {
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, title) VALUES (?, ?, '[]', ?, ?)`,
          [childSessionId, userId, JSON.stringify(childSessionMetadata), childSessionTitle],
        );
      }

      const buildCurrentTaskOutput = (taskState: {
        assignedAgent?: string;
        errorMessage?: string;
        message?: string;
        result?: string;
        status: string;
        taskId: string;
      }) =>
        buildTaskToolOutput({
          assignedAgent: taskState.assignedAgent ?? resolvedAgent.agentId,
          category,
          errorMessage: taskState.errorMessage,
          message: taskState.message,
          requestedSkills,
          result: taskState.result,
          sessionId: childSessionId,
          status: mapTaskStatusToToolOutputStatus(taskState.status),
          taskId: taskState.taskId,
        });

      if (resumableTask?.sessionId) {
        const existingChildSessionState = sqliteGet<{ state_status: string }>(
          'SELECT state_status FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [childSessionId, userId],
        );
        const isAlreadyRunning =
          resumableTask.status === 'running' ||
          existingChildSessionState?.state_status === 'running';

        if (isAlreadyRunning) {
          return {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output: buildCurrentTaskOutput({
              assignedAgent: resumableTask.assignedAgent,
              errorMessage: resumableTask.errorMessage,
              message: buildTaskToolBackgroundMessage({
                agent: resumableTask.assignedAgent ?? resolvedAgent.agentId,
                category,
                description: parsed.data.description,
                sessionId: childSessionId,
                status: mapTaskStatusToToolOutputStatus(resumableTask.status),
                taskId: resumableTask.id,
              }),
              result: resumableTask.result,
              status: resumableTask.status,
              taskId: resumableTask.id,
            }),
            isError: false,
            durationMs: 0,
          };
        }

        sqliteRun(
          "UPDATE sessions SET state_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          [canExecuteImmediately ? 'running' : 'idle', childSessionId, userId],
        );
        if (!childRequestData) {
          appendSessionMessage({
            sessionId: childSessionId,
            userId,
            role: 'user',
            content: [{ type: 'text', text: parsed.data.prompt }],
            clientRequestId: `task:${request.toolCallId}`,
          });
        }

        taskManager.updateTask(graph, resumableTask.id, {
          assignedAgent: resolvedAgent.agentId,
          completedAt: undefined,
          description: parsed.data.prompt,
          errorMessage: undefined,
          result: undefined,
          startedAt: canExecuteImmediately ? Date.now() : resumableTask.startedAt,
          status: canExecuteImmediately ? 'running' : 'pending',
          tags: taskTags,
          title: parsed.data.description,
        });
        await taskManager.save(graph);
        if (canAutoResumeParentSession && autoResumeRequestData) {
          upsertTaskParentAutoResumeContext({
            childSessionId,
            parentSessionId: sessionId,
            requestData: autoResumeRequestData,
            taskId: resumableTask.id,
            userId,
          });
        } else {
          clearTaskParentAutoResumeContext({ childSessionId, userId });
        }

        publishSessionRunEvent(sessionId, {
          type: 'task_update',
          taskId: resumableTask.id,
          label: parsed.data.description,
          status: shouldRunInBackground || canExecuteImmediately ? 'in_progress' : 'pending',
          assignedAgent: resolvedAgent.agentId,
          ...(category ? { category } : {}),
          ...(requestedSkills.length > 0 ? { requestedSkills } : {}),
          ...(typeof effectiveTaskDeadlineMs === 'number'
            ? { effectiveDeadline: effectiveTaskDeadlineMs }
            : {}),
          sessionId: childSessionId,
          parentSessionId: sessionId,
        });

        if (shouldRunInBackground && childRequestData) {
          if (typeof effectiveTaskDeadlineMs === 'number') {
            scheduleChildSessionTimeout({
              childSessionId,
              deadlineMs: effectiveTaskDeadlineMs,
              graphSessionId: sessionId,
              taskId: resumableTask.id,
              userId,
            });
          }
          setTimeout(() => {
            void runChildTaskSessionInBackground({
              assignedAgent: resolvedAgent.agentId,
              childSessionId,
              childTaskId: resumableTask.id,
              parentToolReference,
              parentSessionId: sessionId,
              requestData: childRequestData,
              requestedSkills,
              taskCategory: category,
              taskTitle: parsed.data.description,
              userId,
            });
          }, 0);
        }

        if (!shouldRunInBackground && childRequestData) {
          if (typeof effectiveTaskDeadlineMs === 'number') {
            scheduleChildSessionTimeout({
              childSessionId,
              deadlineMs: effectiveTaskDeadlineMs,
              graphSessionId: sessionId,
              taskId: resumableTask.id,
              userId,
            });
          }
          await runChildTaskSessionInBackground({
            assignedAgent: resolvedAgent.agentId,
            childSessionId,
            childTaskId: resumableTask.id,
            parentToolReference,
            parentSessionId: sessionId,
            requestData: childRequestData,
            requestedSkills,
            taskCategory: category,
            taskTitle: parsed.data.description,
            userId,
          });
          const refreshedGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
          const refreshedTask = refreshedGraph.tasks[resumableTask.id] ?? resumableTask;
          return {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output: buildCurrentTaskOutput({
              assignedAgent: refreshedTask.assignedAgent,
              errorMessage: refreshedTask.errorMessage,
              message: buildTaskToolTerminalMessage({
                agent: refreshedTask.assignedAgent ?? resolvedAgent.agentId,
                category,
                completedAt: refreshedTask.completedAt,
                errorMessage: refreshedTask.errorMessage,
                resultText:
                  collectDelegatedSessionText(
                    listSessionMessages({ sessionId: childSessionId, userId }),
                  ) || refreshedTask.result,
                sessionId: childSessionId,
                startedAt: refreshedTask.startedAt,
                status:
                  refreshedTask.status === 'failed'
                    ? 'failed'
                    : refreshedTask.status === 'cancelled'
                      ? 'cancelled'
                      : 'done',
              }),
              result: refreshedTask.result,
              status: refreshedTask.status,
              taskId: refreshedTask.id,
            }),
            isError: refreshedTask.status === 'failed',
            durationMs: 0,
          };
        }

        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: buildCurrentTaskOutput({
            assignedAgent: resolvedAgent.agentId,
            message: buildTaskToolBackgroundMessage({
              agent: resolvedAgent.agentId,
              category,
              description: parsed.data.description,
              sessionId: childSessionId,
              status: shouldRunInBackground || canExecuteImmediately ? 'running' : 'pending',
              taskId: resumableTask.id,
            }),
            status: shouldRunInBackground || canExecuteImmediately ? 'running' : 'pending',
            taskId: resumableTask.id,
          }),
          isError: false,
          durationMs: 0,
        };
      }

      sqliteRun(
        "UPDATE sessions SET state_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [canExecuteImmediately ? 'running' : 'idle', childSessionId, userId],
      );
      if (!childRequestData) {
        appendSessionMessage({
          sessionId: childSessionId,
          userId,
          role: 'user',
          content: [{ type: 'text', text: parsed.data.prompt }],
          clientRequestId: `task:${request.toolCallId}`,
        });
      }

      const childTask = taskManager.addTask(graph, {
        title: parsed.data.description,
        description: parsed.data.prompt,
        status: 'pending',
        blockedBy: [],
        sessionId: childSessionId,
        assignedAgent: resolvedAgent.agentId,
        priority: 'medium',
        tags: taskTags,
      });
      if (canExecuteImmediately) {
        taskManager.startTask(graph, childTask.id);
      }
      await taskManager.save(graph);
      if (canAutoResumeParentSession && autoResumeRequestData) {
        upsertTaskParentAutoResumeContext({
          childSessionId,
          parentSessionId: sessionId,
          requestData: autoResumeRequestData,
          taskId: childTask.id,
          userId,
        });
      } else {
        clearTaskParentAutoResumeContext({ childSessionId, userId });
      }

      publishSessionRunEvent(sessionId, {
        type: 'session_child',
        sessionId: childSessionId,
        parentSessionId: sessionId,
        title: childSessionTitle,
      });
      publishSessionRunEvent(sessionId, {
        type: 'task_update',
        taskId: childTask.id,
        label: parsed.data.description,
        status: shouldRunInBackground ? 'in_progress' : 'pending',
        assignedAgent: resolvedAgent.agentId,
        ...(category ? { category } : {}),
        ...(requestedSkills.length > 0 ? { requestedSkills } : {}),
        ...(typeof effectiveTaskDeadlineMs === 'number'
          ? { effectiveDeadline: effectiveTaskDeadlineMs }
          : {}),
        sessionId: childSessionId,
        parentSessionId: sessionId,
      });

      if (shouldRunInBackground && childRequestData) {
        if (typeof effectiveTaskDeadlineMs === 'number') {
          scheduleChildSessionTimeout({
            childSessionId,
            deadlineMs: effectiveTaskDeadlineMs,
            graphSessionId: sessionId,
            taskId: childTask.id,
            userId,
          });
        }
        setTimeout(() => {
          void runChildTaskSessionInBackground({
            assignedAgent: resolvedAgent.agentId,
            childSessionId,
            childTaskId: childTask.id,
            parentToolReference,
            parentSessionId: sessionId,
            requestData: childRequestData,
            requestedSkills,
            taskCategory: category,
            taskTitle: parsed.data.description,
            userId,
          });
        }, 0);
      }

      if (!shouldRunInBackground && childRequestData) {
        if (typeof effectiveTaskDeadlineMs === 'number') {
          scheduleChildSessionTimeout({
            childSessionId,
            deadlineMs: effectiveTaskDeadlineMs,
            graphSessionId: sessionId,
            taskId: childTask.id,
            userId,
          });
        }
        await runChildTaskSessionInBackground({
          assignedAgent: resolvedAgent.agentId,
          childSessionId,
          childTaskId: childTask.id,
          parentToolReference,
          parentSessionId: sessionId,
          requestData: childRequestData,
          requestedSkills,
          taskCategory: category,
          taskTitle: parsed.data.description,
          userId,
        });
        const refreshedGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
        const refreshedTask = refreshedGraph.tasks[childTask.id] ?? childTask;
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: buildTaskToolOutput({
            assignedAgent: refreshedTask.assignedAgent ?? resolvedAgent.agentId,
            category,
            errorMessage: refreshedTask.errorMessage,
            message: buildTaskToolTerminalMessage({
              agent: refreshedTask.assignedAgent ?? resolvedAgent.agentId,
              category,
              completedAt: refreshedTask.completedAt,
              errorMessage: refreshedTask.errorMessage,
              resultText:
                collectDelegatedSessionText(
                  listSessionMessages({ sessionId: childSessionId, userId }),
                ) || refreshedTask.result,
              sessionId: childSessionId,
              startedAt: refreshedTask.startedAt,
              status:
                refreshedTask.status === 'failed'
                  ? 'failed'
                  : refreshedTask.status === 'cancelled'
                    ? 'cancelled'
                    : 'done',
            }),
            requestedSkills,
            result: refreshedTask.result,
            sessionId: childSessionId,
            status: mapTaskStatusToToolOutputStatus(refreshedTask.status),
            taskId: refreshedTask.id,
          }),
          isError: refreshedTask.status === 'failed',
          durationMs: 0,
        };
      }

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: buildTaskToolOutput({
          assignedAgent: resolvedAgent.agentId,
          category,
          message: buildTaskToolBackgroundMessage({
            agent: resolvedAgent.agentId,
            category,
            description: parsed.data.description,
            sessionId: childSessionId,
            status: shouldRunInBackground ? 'running' : 'pending',
            taskId: childTask.id,
          }),
          requestedSkills,
          sessionId: childSessionId,
          status: shouldRunInBackground ? 'running' : 'pending',
          taskId: childTask.id,
        }),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === 'background_output') {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }

      const parsed = backgroundOutputToolDefinition.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatValidationIssues(parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const taskManager = new AgentTaskManagerImpl();
      let graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
      let task = graph.tasks[parsed.data.task_id];
      if (!task) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Background task ${parsed.data.task_id} was not found in session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }

      let waitTimedOut = false;
      if (parsed.data.block) {
        const waitResult = await waitForTaskTerminalState({
          sessionId,
          taskId: parsed.data.task_id,
          timeoutMs: parsed.data.timeout,
          signal,
        });
        task = waitResult.task;
        waitTimedOut = waitResult.timedOut;
        graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
      }

      if (!task) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Background task ${parsed.data.task_id} no longer exists`,
          isError: true,
          durationMs: 0,
        };
      }

      const childSessionId = task.sessionId;
      if (!childSessionId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Background task ${parsed.data.task_id} has no child session`,
          isError: true,
          durationMs: 0,
        };
      }

      const runtimeReconciliation = reconcileSessionStateStatus({
        sessionId: childSessionId,
        userId,
      });
      if (runtimeReconciliation.wasReset) {
        await reconcileResumedTaskChildSession({
          childSessionId,
          pendingInteraction: false,
          statusCode: 500,
          userId,
        });
        graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
        task = graph.tasks[parsed.data.task_id];
        if (!task) {
          return {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output: `Background task ${parsed.data.task_id} no longer exists`,
            isError: true,
            durationMs: 0,
          };
        }
      }

      const childMessages = listSessionMessages({ sessionId: childSessionId, userId });
      const childDisplayText = collectDelegatedSessionText(childMessages);
      const latestChildMessage = extractLatestDelegatedSessionMessage(childMessages);
      const taskMessage =
        task.status === 'completed'
          ? buildBackgroundTaskResultMessage({
              agent: task.assignedAgent ?? 'task',
              completedAt: task.completedAt,
              description: task.title ?? task.id,
              resultText:
                childDisplayText || task.result || getChildSessionSummary(childSessionId, userId),
              sessionId: childSessionId,
              startedAt: task.startedAt,
              taskId: task.id,
            })
          : buildBackgroundTaskStatusMessage({
              agent: task.assignedAgent ?? 'task',
              description: task.title ?? task.id,
              lastMessage: latestChildMessage?.text,
              lastMessageAt: latestChildMessage?.createdAt,
              prompt: task.description ?? '',
              queuedAt: task.createdAt,
              sessionId: childSessionId,
              startedAt: task.startedAt,
              status: task.status,
              taskId: task.id,
            });
      const baseOutput = buildTaskToolOutput({
        assignedAgent: task.assignedAgent ?? 'task',
        errorMessage: task.errorMessage,
        message: taskMessage,
        result: childDisplayText || task.result || getChildSessionSummary(childSessionId, userId),
        sessionId: childSessionId,
        status: mapTaskStatusToToolOutputStatus(task.status),
        taskId: task.id,
      });
      const output = parsed.data.full_session
        ? {
            ...baseOutput,
            ...(waitTimedOut ? { timedOut: true } : {}),
            messages: formatBackgroundOutputMessages({
              includeThinking: parsed.data.include_thinking,
              includeToolResults: parsed.data.include_tool_results,
              limit: parsed.data.message_limit,
              sinceMessageId: parsed.data.since_message_id,
              thinkingMaxChars: parsed.data.thinking_max_chars,
              userId,
              sessionId: childSessionId,
            }),
          }
        : waitTimedOut
          ? `Timeout exceeded (${parsed.data.timeout}ms). Task still ${task.status}.\n\n${taskMessage}`
          : taskMessage;

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === 'background_cancel') {
      const userId = getSessionOwnerUserId(sessionId);
      if (!userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Session owner not found for session ${sessionId}`,
          isError: true,
          durationMs: 0,
        };
      }

      const parsed = backgroundCancelToolDefinition.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatValidationIssues(parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const taskManager = new AgentTaskManagerImpl();
      const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
      const targetTaskIds = parsed.data.all
        ? Object.values(graph.tasks)
            .filter(
              (task) => task.sessionId && (task.status === 'pending' || task.status === 'running'),
            )
            .map((task) => task.id)
        : parsed.data.taskId
          ? [parsed.data.taskId]
          : [];

      if (targetTaskIds.length === 0) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.data.all
            ? 'No running or pending background tasks to cancel.'
            : `[ERROR] Task not found: ${parsed.data.taskId}`,
          isError: parsed.data.all !== true,
          durationMs: 0,
        };
      }

      const cancelled = [] as Array<{
        agent: string;
        description: string;
        previousStatus: string;
        requestedSkills: string[];
        taskId: string;
        sessionId?: string;
        status: string;
        stopped: boolean;
      }>;
      for (const taskId of targetTaskIds) {
        const result = await cancelBackgroundTaskEntry({
          graph,
          graphSessionId: sessionId,
          taskId,
          userId,
        });
        if (result) {
          cancelled.push(result);
        }
      }
      await taskManager.save(graph);

      if (!parsed.data.all) {
        const target = cancelled[0];
        if (!target) {
          return {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output: `[ERROR] Task not found: ${parsed.data.taskId}`,
            isError: true,
            durationMs: 0,
          };
        }

        if (target.previousStatus !== 'pending' && target.previousStatus !== 'running') {
          return {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output: `[ERROR] Cannot cancel task: current status is "${target.previousStatus}".\nOnly running or pending tasks can be cancelled.`,
            isError: true,
            durationMs: 0,
          };
        }

        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: buildBackgroundCancelSingleMessage({
            description: target.description,
            sessionId: target.sessionId,
            status: target.status,
            taskId: target.taskId,
          }),
          isError: false,
          durationMs: 0,
        };
      }

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: buildBackgroundCancelAllMessage({
          tasks: cancelled.map((task) => ({
            agent: task.agent,
            description: task.description,
            requestedSkills: task.requestedSkills,
            sessionId: task.sessionId,
            status: task.previousStatus,
            taskId: task.taskId,
          })),
        }),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === 'bash') {
      const parsed = bashToolDefinition.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatValidationIssues(parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await runBashCommand(parsed.data);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: output.exitCode !== 0,
        durationMs: 0,
      };
    }

    return null;
  } catch (error) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: error instanceof Error ? error.message : String(error),
      isError: true,
      durationMs: 0,
    };
  }
}

export function buildTaskUpdateEvent(input: {
  assignedAgent: string;
  category?: string;
  childSessionId: string;
  effectiveDeadline?: number;
  errorMessage?: string;
  parentSessionId: string;
  reason?: string;
  requestedSkills?: string[];
  result?: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  taskId: string;
  taskTitle: string;
}): Extract<RunEvent, { type: 'task_update' }> {
  return {
    type: 'task_update',
    taskId: input.taskId,
    label: input.taskTitle,
    status: input.status,
    assignedAgent: input.assignedAgent,
    ...(input.category ? { category: input.category } : {}),
    ...(input.requestedSkills && input.requestedSkills.length > 0
      ? { requestedSkills: input.requestedSkills }
      : {}),
    ...(input.result ? { result: input.result } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(typeof input.effectiveDeadline === 'number'
      ? { effectiveDeadline: input.effectiveDeadline }
      : {}),
    sessionId: input.childSessionId,
    parentSessionId: input.parentSessionId,
    eventId: `${input.parentSessionId}:${input.taskId}:${input.status}`,
    runId: `task:${input.taskId}`,
    occurredAt: Date.now(),
  };
}

function formatValidationIssues(
  issues: Array<{
    message: string;
    path: PropertyKey[];
  }>,
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : null;
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join(', ');
}

function getChildSessionSummary(sessionId: string, userId: string): string {
  return extractLatestChildSessionSummary(listSessionMessages({ sessionId, userId }));
}

function stripThinkingBlocks(value: string): string {
  return value.replace(/`{3,}thinking\n[\s\S]*?`{3,}\n*/g, '').trim();
}

function formatBackgroundOutputMessages(input: {
  includeThinking: boolean;
  includeToolResults: boolean;
  limit: number;
  sinceMessageId?: string;
  thinkingMaxChars: number;
  userId: string;
  sessionId: string;
}) {
  const messages = listSessionMessages({ sessionId: input.sessionId, userId: input.userId });
  const startIndex = input.sinceMessageId
    ? messages.findIndex((message) => message.id === input.sinceMessageId)
    : -1;
  const sliced = startIndex >= 0 ? messages.slice(startIndex + 1) : messages;
  const filtered = sliced.filter((message) => input.includeToolResults || message.role !== 'tool');
  return filtered.slice(-input.limit).map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    content: message.content.map((part) => {
      if (part.type !== 'text' || input.includeThinking) {
        return part;
      }
      const stripped = stripThinkingBlocks(part.text);
      return {
        ...part,
        text:
          stripped.length > input.thinkingMaxChars
            ? stripped.slice(0, input.thinkingMaxChars)
            : stripped,
      };
    }),
  }));
}

async function waitForTaskTerminalState(input: {
  sessionId: string;
  taskId: string;
  timeoutMs: number;
  signal: AbortSignal;
}) {
  const taskManager = new AgentTaskManagerImpl();
  const deadline = Date.now() + input.timeoutMs;
  while (true) {
    if (input.signal.aborted) {
      throw new Error('Background task wait aborted');
    }
    const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, input.sessionId);
    const task = graph.tasks[input.taskId];
    if (!task || (task.status !== 'running' && task.status !== 'pending')) {
      return { task, timedOut: false };
    }
    if (Date.now() >= deadline) {
      return { task, timedOut: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function cancelBackgroundTaskEntry(input: {
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>;
  graphSessionId: string;
  reason?: ChildSessionTerminalReason;
  taskId: string;
  userId: string;
}): Promise<{
  agent: string;
  description: string;
  previousStatus: string;
  requestedSkills: string[];
  taskId: string;
  sessionId?: string;
  status: string;
  stopped: boolean;
} | null> {
  const taskEntry = input.graph.tasks[input.taskId];
  if (!taskEntry) {
    return null;
  }

  if (
    taskEntry.status === 'completed' ||
    taskEntry.status === 'failed' ||
    taskEntry.status === 'cancelled'
  ) {
    return {
      agent: taskEntry.assignedAgent ?? 'task',
      description: taskEntry.title ?? taskEntry.id,
      previousStatus: taskEntry.status,
      requestedSkills: [],
      taskId: taskEntry.id,
      sessionId: taskEntry.sessionId,
      status: taskEntry.status,
      stopped: false,
    };
  }

  const reason = input.reason ?? 'cancelled';
  const previousStatus = taskEntry.status;

  input.graph.tasks[input.taskId] = {
    ...taskEntry,
    status: 'cancelled',
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };

  const childSessionId = taskEntry.sessionId;
  if (!childSessionId) {
    return {
      agent: taskEntry.assignedAgent ?? 'task',
      description: taskEntry.title ?? taskEntry.id,
      previousStatus,
      requestedSkills: [],
      taskId: taskEntry.id,
      sessionId: undefined,
      status: 'cancelled',
      stopped: false,
    };
  }

  clearChildSessionTimeoutTimer(childSessionId);
  clearTaskParentAutoResumeContext({ childSessionId, userId: input.userId });
  sqliteRun(
    "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [childSessionId, input.userId],
  );
  const stopped = await stopAnyInFlightStreamRequestForSession({
    sessionId: childSessionId,
    userId: input.userId,
  });
  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [childSessionId, input.userId],
  );
  const childMetadata = childSession ? parseSessionMetadataJson(childSession.metadata_json) : {};
  const assignedAgent =
    taskEntry.assignedAgent ??
    (typeof childMetadata['subagentType'] === 'string' ? childMetadata['subagentType'] : 'task');
  const category =
    typeof childMetadata['taskCategory'] === 'string' ? childMetadata['taskCategory'] : undefined;
  const requestedSkills = readTaskRequestedSkills(childMetadata) ?? [];
  syncParentTaskToolResult({
    assignedAgent,
    category,
    parentSessionId: input.graphSessionId,
    parentToolReference: readTaskParentToolReference(childMetadata),
    reason,
    requestedSkills,
    sessionId: childSessionId,
    status: 'cancelled',
    taskId: taskEntry.id,
    userId: input.userId,
  });
  publishSessionRunEvent(
    input.graphSessionId,
    buildTaskUpdateEvent({
      assignedAgent,
      category,
      childSessionId,
      parentSessionId: input.graphSessionId,
      reason,
      requestedSkills,
      status: 'cancelled',
      taskId: taskEntry.id,
      taskTitle: taskEntry.title ?? taskEntry.id,
    }),
  );

  return {
    agent: assignedAgent,
    description: taskEntry.title ?? taskEntry.id,
    previousStatus,
    requestedSkills,
    taskId: taskEntry.id,
    sessionId: childSessionId,
    status: 'cancelled',
    stopped,
  };
}

async function runChildTaskSessionInBackground(input: {
  assignedAgent: string;
  childSessionId: string;
  childTaskId: string;
  parentToolReference?: TaskParentToolReference;
  parentSessionId: string;
  requestData: Record<string, unknown>;
  requestedSkills?: string[];
  taskCategory?: string;
  taskTitle: string;
  userId: string;
}): Promise<void> {
  const taskManager = new AgentTaskManagerImpl();
  const requestClientRequestId =
    typeof input.requestData['clientRequestId'] === 'string'
      ? input.requestData['clientRequestId']
      : undefined;
  const firstResponseTimeoutMs = getTaskChildFirstResponseTimeoutMs();
  const firstResponseRetryMaxRetries = getTaskChildFirstResponseRetryMaxRetries(input.requestData);

  try {
    const { runSessionInBackground } = await import('./routes/stream-runtime.js');
    let finalResult: TaskBackgroundRunResult | null = null;

    for (let attempt = 0; attempt <= firstResponseRetryMaxRetries; attempt += 1) {
      let pendingInteraction = false;
      let firstResponseReceived = false;
      let firstResponseTimedOut = false;
      const firstResponseTimer = setTimeout(() => {
        firstResponseTimedOut = true;
        void stopAnyInFlightStreamRequestForSession({
          sessionId: input.childSessionId,
          userId: input.userId,
        });
      }, firstResponseTimeoutMs);

      try {
        const result = await runSessionInBackground({
          requestData: input.requestData,
          sessionId: input.childSessionId,
          userId: input.userId,
          writeChunk: (chunk: RunEvent) => {
            if (
              isChildSessionFirstResponseEvent(chunk, firstResponseTimedOut, firstResponseReceived)
            ) {
              firstResponseReceived = true;
              clearTimeout(firstResponseTimer);
            }

            if (chunk.type === 'permission_asked') {
              pendingInteraction = true;
              return;
            }

            if (
              chunk.type === 'tool_result' &&
              typeof chunk.pendingPermissionRequestId === 'string'
            ) {
              pendingInteraction = true;
            }
          },
        });

        clearTimeout(firstResponseTimer);

        if (firstResponseTimedOut && !firstResponseReceived) {
          clearTimedOutChildSessionAttemptArtifacts({
            childSessionId: input.childSessionId,
            clientRequestId: requestClientRequestId,
            userId: input.userId,
          });

          if (attempt < firstResponseRetryMaxRetries) {
            continue;
          }

          writeChildSessionTerminalReason({
            childSessionId: input.childSessionId,
            reason: 'timeout',
            userId: input.userId,
          });
          finalResult = {
            pendingInteraction: false,
            reason: 'timeout',
            statusCode: 504,
            summary: `子代理首条响应在 ${firstResponseTimeoutMs}ms 内未返回，已重试 ${attempt} 次后停止。`,
          };
          break;
        }

        finalResult = {
          pendingInteraction,
          statusCode: result.statusCode,
          summary: getChildSessionSummary(input.childSessionId, input.userId),
        };
        break;
      } catch (error) {
        clearTimeout(firstResponseTimer);

        if (firstResponseTimedOut && !firstResponseReceived) {
          clearTimedOutChildSessionAttemptArtifacts({
            childSessionId: input.childSessionId,
            clientRequestId: requestClientRequestId,
            userId: input.userId,
          });

          if (attempt < firstResponseRetryMaxRetries) {
            continue;
          }

          writeChildSessionTerminalReason({
            childSessionId: input.childSessionId,
            reason: 'timeout',
            userId: input.userId,
          });
          finalResult = {
            pendingInteraction: false,
            reason: 'timeout',
            statusCode: 504,
            summary: `子代理首条响应在 ${firstResponseTimeoutMs}ms 内未返回，已重试 ${attempt} 次后停止。`,
          };
          break;
        }

        finalResult = {
          pendingInteraction: false,
          statusCode: 500,
          summary: error instanceof Error ? error.message : String(error),
        };
        break;
      }
    }

    await finalizeChildTaskRun({
      childSessionId: input.childSessionId,
      childTaskId: input.childTaskId,
      assignedAgent: input.assignedAgent,
      parentToolReference: input.parentToolReference,
      parentSessionId: input.parentSessionId,
      requestedSkills: input.requestedSkills,
      result: finalResult ?? {
        pendingInteraction: false,
        statusCode: 500,
        summary: '子代理执行失败：未产生可用结果。',
      },
      taskCategory: input.taskCategory,
      taskManager,
      taskTitle: input.taskTitle,
      userId: input.userId,
    });
  } catch (error) {
    await finalizeChildTaskRun({
      childSessionId: input.childSessionId,
      childTaskId: input.childTaskId,
      assignedAgent: input.assignedAgent,
      parentToolReference: input.parentToolReference,
      parentSessionId: input.parentSessionId,
      requestedSkills: input.requestedSkills,
      result: {
        pendingInteraction: false,
        statusCode: 500,
        summary: error instanceof Error ? error.message : String(error),
      },
      taskCategory: input.taskCategory,
      taskManager,
      taskTitle: input.taskTitle,
      userId: input.userId,
    });
  }
}

async function finalizeChildTaskRun(input: {
  assignedAgent: string;
  childSessionId: string;
  childTaskId: string;
  parentToolReference?: TaskParentToolReference;
  parentSessionId: string;
  requestedSkills?: string[];
  result: TaskBackgroundRunResult;
  taskCategory?: string;
  taskManager: AgentTaskManagerImpl;
  taskTitle: string;
  userId: string;
}): Promise<void> {
  clearChildSessionTimeoutTimer(input.childSessionId);
  if (input.result.reason) {
    writeChildSessionTerminalReason({
      childSessionId: input.childSessionId,
      reason: input.result.reason,
      userId: input.userId,
    });
  }
  const summary = input.result.summary || '子代理执行已结束。';
  sqliteRun(
    "UPDATE sessions SET state_status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [input.result.pendingInteraction ? 'paused' : 'idle', input.childSessionId, input.userId],
  );

  if (getSessionOwnerUserId(input.parentSessionId) !== input.userId) {
    return;
  }

  const graph = await input.taskManager.loadOrCreate(WORKSPACE_ROOT, input.parentSessionId);
  const task = graph.tasks[input.childTaskId];
  if (!task) {
    return;
  }

  if (task.status === 'cancelled' || task.status === 'failed' || task.status === 'completed') {
    await input.taskManager.save(graph);
    clearTaskParentAutoResumeContext({
      childSessionId: input.childSessionId,
      userId: input.userId,
    });
    const assignedAgent = task.assignedAgent ?? input.assignedAgent;
    const terminalOutputStatus = mapTaskStatusToToolOutputStatus(task.status);
    const terminalUpdateStatus = mapTaskStatusToUpdateStatus(task.status);
    const childMetadata = getSessionMetadata(input.childSessionId);
    const terminalReason = input.result.reason ?? readChildSessionTerminalReason(childMetadata);
    const effectiveDeadline = readChildSessionDeadlineMs(childMetadata);
    syncParentTaskToolResult({
      assignedAgent,
      category: input.taskCategory,
      errorMessage: task.errorMessage,
      parentSessionId: input.parentSessionId,
      parentToolReference: input.parentToolReference,
      reason: terminalReason,
      requestedSkills: input.requestedSkills,
      result: task.result,
      sessionId: input.childSessionId,
      status: terminalOutputStatus,
      taskId: task.id,
      userId: input.userId,
    });
    if (
      terminalOutputStatus === 'cancelled' ||
      terminalOutputStatus === 'failed' ||
      terminalOutputStatus === 'done'
    ) {
      appendParentTaskCompletionReminder({
        assignedAgent,
        childSessionId: input.childSessionId,
        errorMessage: task.errorMessage,
        parentSessionId: input.parentSessionId,
        reason: terminalReason,
        result: task.result,
        status: terminalOutputStatus,
        taskId: task.id,
        taskTitle: input.taskTitle,
        taskUpdatedAt: task.updatedAt,
        userId: input.userId,
      });
    }
    publishSessionRunEvent(
      input.parentSessionId,
      buildTaskUpdateEvent({
        assignedAgent,
        category: input.taskCategory,
        childSessionId: input.childSessionId,
        effectiveDeadline,
        errorMessage: task.errorMessage,
        parentSessionId: input.parentSessionId,
        reason: terminalReason,
        requestedSkills: input.requestedSkills,
        result: task.result,
        status: terminalUpdateStatus,
        taskId: task.id,
        taskTitle: input.taskTitle,
      }),
    );
    return;
  }

  if (input.result.pendingInteraction) {
    input.taskManager.updateTask(graph, task.id, {
      result: summary,
    });
    await input.taskManager.save(graph);
    const nextTask = graph.tasks[input.childTaskId] ?? task;
    const effectiveDeadline = readChildSessionDeadlineMs(getSessionMetadata(input.childSessionId));
    syncParentTaskToolResult({
      assignedAgent: nextTask.assignedAgent ?? input.assignedAgent,
      category: input.taskCategory,
      parentSessionId: input.parentSessionId,
      parentToolReference: input.parentToolReference,
      requestedSkills: input.requestedSkills,
      result: nextTask.result,
      sessionId: input.childSessionId,
      status: mapTaskStatusToToolOutputStatus(nextTask.status),
      taskId: task.id,
      userId: input.userId,
    });
    publishSessionRunEvent(
      input.parentSessionId,
      buildTaskUpdateEvent({
        assignedAgent: nextTask.assignedAgent ?? input.assignedAgent,
        category: input.taskCategory,
        childSessionId: input.childSessionId,
        effectiveDeadline,
        parentSessionId: input.parentSessionId,
        requestedSkills: input.requestedSkills,
        result: nextTask.result,
        status: mapTaskStatusToUpdateStatus(nextTask.status),
        taskId: task.id,
        taskTitle: input.taskTitle,
      }),
    );
    return;
  }

  if (task.status === 'running') {
    if (input.result.statusCode >= 400) {
      input.taskManager.failTask(graph, task.id, summary);
    } else {
      input.taskManager.completeTask(graph, task.id, summary);
    }
  } else {
    input.taskManager.updateTask(graph, task.id, {
      errorMessage: input.result.statusCode >= 400 ? summary : undefined,
      result: input.result.statusCode >= 400 ? task.result : summary,
    });
  }

  await input.taskManager.save(graph);
  const nextTask = graph.tasks[input.childTaskId];
  const effectiveDeadline = readChildSessionDeadlineMs(getSessionMetadata(input.childSessionId));
  const eventStatus = mapTaskStatusToUpdateStatus(nextTask?.status ?? task.status);
  const nextAssignedAgent = nextTask?.assignedAgent ?? input.assignedAgent;
  const terminalToolOutputStatus = mapTaskStatusToToolOutputStatus(nextTask?.status ?? task.status);
  const autoResumeContext =
    terminalToolOutputStatus === 'done' || terminalToolOutputStatus === 'failed'
      ? consumeTaskParentAutoResumeContext({
          childSessionId: input.childSessionId,
          parentSessionId: input.parentSessionId,
          userId: input.userId,
        })
      : (clearTaskParentAutoResumeContext({
          childSessionId: input.childSessionId,
          userId: input.userId,
        }),
        null);
  syncParentTaskToolResult({
    assignedAgent: nextAssignedAgent,
    category: input.taskCategory,
    errorMessage: nextTask?.errorMessage,
    parentSessionId: input.parentSessionId,
    parentToolReference: input.parentToolReference,
    reason: input.result.reason,
    requestedSkills: input.requestedSkills,
    result: nextTask?.result,
    sessionId: input.childSessionId,
    status: terminalToolOutputStatus,
    taskId: task.id,
    userId: input.userId,
  });
  if (
    terminalToolOutputStatus === 'done' ||
    terminalToolOutputStatus === 'failed' ||
    terminalToolOutputStatus === 'cancelled'
  ) {
    appendParentTaskCompletionReminder({
      assignedAgent: nextAssignedAgent,
      childSessionId: input.childSessionId,
      errorMessage: nextTask?.errorMessage,
      parentSessionId: input.parentSessionId,
      reason: input.result.reason,
      result: nextTask?.result,
      status: terminalToolOutputStatus,
      taskId: task.id,
      taskTitle: input.taskTitle,
      taskUpdatedAt: nextTask?.updatedAt ?? task.updatedAt,
      userId: input.userId,
    });
  }
  if (
    autoResumeContext &&
    (terminalToolOutputStatus === 'done' || terminalToolOutputStatus === 'failed')
  ) {
    scheduleTaskParentAutoResume({
      assignedAgent: nextAssignedAgent,
      childSessionId: input.childSessionId,
      errorMessage: nextTask?.errorMessage,
      parentSessionId: input.parentSessionId,
      requestData: autoResumeContext.requestData,
      result: nextTask?.result,
      status: terminalToolOutputStatus,
      taskId: nextTask?.id ?? task.id,
      taskTitle: input.taskTitle,
      userId: input.userId,
    });
  }
  publishSessionRunEvent(
    input.parentSessionId,
    buildTaskUpdateEvent({
      assignedAgent: nextAssignedAgent,
      category: input.taskCategory,
      childSessionId: input.childSessionId,
      effectiveDeadline,
      errorMessage: nextTask?.errorMessage,
      parentSessionId: input.parentSessionId,
      reason: input.result.reason,
      requestedSkills: input.requestedSkills,
      result: nextTask?.result,
      status: eventStatus,
      taskId: task.id,
      taskTitle: input.taskTitle,
    }),
  );
}

function getSessionOwnerUserId(sessionId: string): string | null {
  const session = sqliteGet<SessionOwnerRow>('SELECT user_id FROM sessions WHERE id = ? LIMIT 1', [
    sessionId,
  ]);
  return session?.user_id ?? null;
}

function getSessionMetadata(sessionId: string): Record<string, unknown> {
  const row = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  return parseSessionMetadataJson(row?.metadata_json ?? '{}');
}

function updateSessionMetadata(sessionId: string, metadata: Record<string, unknown>): void {
  sqliteRun("UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify(metadata),
    sessionId,
  ]);
}

function isPlanModeEnabled(metadata: Record<string, unknown>): boolean {
  return metadata['planMode'] === true;
}

function buildToolObservability(input: {
  canonicalToolName: string;
  metadata: Record<string, unknown>;
  presentedToolName: string;
}): NonNullable<PermissionRequestPayload['observability']> {
  return {
    presentedToolName: input.presentedToolName,
    canonicalToolName: input.canonicalToolName,
    toolSurfaceProfile: extractToolSurfaceProfile(input.metadata),
    adapterVersion: '1.0.0',
  };
}

function findApprovedPermission(
  sessionId: string,
  toolName: string,
  scope: string,
): PermissionApprovalRow | null {
  const userId = getSessionOwnerUserId(sessionId);
  return (
    sqliteGet<PermissionApprovalRow>(
      `SELECT pr.id, pr.decision
       FROM permission_requests pr
       JOIN sessions s ON s.id = pr.session_id
       WHERE pr.tool_name = ?
         AND pr.scope = ?
         AND pr.status = 'approved'
         AND (
           (pr.session_id = ? AND pr.decision IN ('once', 'session'))
           OR (s.user_id = ? AND pr.decision = 'permanent')
         )
       ORDER BY pr.updated_at DESC, pr.created_at DESC
       LIMIT 1`,
      [toolName, scope, sessionId, userId],
    ) ?? null
  );
}

function findPendingPermission(sessionId: string, toolName: string, scope: string): string | null {
  const pending = sqliteGet<PermissionPendingRow>(
    `SELECT id
     FROM permission_requests
     WHERE session_id = ? AND tool_name = ? AND scope = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId, toolName, scope],
  );
  return pending?.id ?? null;
}

function updatePendingPermissionPayload(
  requestId: string,
  payload: PermissionRequestPayload,
): void {
  sqliteRun(
    `UPDATE permission_requests
     SET request_payload_json = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'pending'`,
    [JSON.stringify(payload), requestId],
  );
}

function createPendingPermissionRequest(
  sessionId: string,
  toolName: string,
  context: PermissionRequestContext,
  payload?: PermissionRequestPayload,
): string {
  const requestId = randomUUID();
  const expiresAt = (() => {
    const timeoutMs = getPendingPermissionTimeoutMs();
    return typeof timeoutMs === 'number' ? Date.now() + timeoutMs : null;
  })();
  sqliteRun(
    `INSERT INTO permission_requests
     (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      requestId,
      sessionId,
      toolName,
      context.scope,
      context.reason,
      context.riskLevel,
      context.previewAction,
      payload ? JSON.stringify(payload) : null,
      expiresAt,
    ],
  );
  publishSessionRunEvent(
    sessionId,
    createPermissionAskedEvent({
      requestId,
      toolName,
      scope: context.scope,
      reason: context.reason,
      riskLevel: context.riskLevel,
      previewAction: context.previewAction,
    }),
    payload ? { clientRequestId: payload.clientRequestId } : undefined,
  );
  return requestId;
}

function findPendingQuestionRequest(sessionId: string, title: string): string | null {
  const pending = sqliteGet<QuestionPendingRow>(
    `SELECT id
     FROM question_requests
     WHERE session_id = ? AND title = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId, title],
  );
  return pending?.id ?? null;
}

function updatePendingQuestionPayload(requestId: string, payload: PermissionRequestPayload): void {
  sqliteRun(
    `UPDATE question_requests
     SET request_payload_json = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'pending'`,
    [JSON.stringify(payload), requestId],
  );
}

function createPendingQuestionRequest(input: {
  sessionId: string;
  userId: string;
  toolName?: string;
  title: string;
  questionsJson: string;
  payload?: PermissionRequestPayload;
}): string {
  const requestId = randomUUID();
  const toolName = input.toolName ?? 'question';
  const expiresAt = (() => {
    const timeoutMs = getPendingQuestionTimeoutMs();
    return typeof timeoutMs === 'number' ? Date.now() + timeoutMs : null;
  })();
  sqliteRun(
    `INSERT INTO question_requests
      (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      requestId,
      input.sessionId,
      input.userId,
      toolName,
      input.title,
      input.questionsJson,
      input.payload ? JSON.stringify(input.payload) : null,
      expiresAt,
    ],
  );
  publishSessionRunEvent(
    input.sessionId,
    createQuestionAskedEvent({
      requestId,
      title: input.title,
      toolName,
    }),
    input.payload ? { clientRequestId: input.payload.clientRequestId } : undefined,
  );
  return requestId;
}

function consumeOncePermission(requestId: string): void {
  sqliteRun(
    `UPDATE permission_requests
     SET status = 'consumed', updated_at = datetime('now')
     WHERE id = ? AND status = 'approved' AND decision = 'once'`,
    [requestId],
  );
}

function ensurePermissionForTool(
  sessionId: string,
  request: ToolCallRequest,
  observability: PermissionRequestPayload['observability'] | undefined,
  executionContext?: SandboxExecutionContext,
): PermissionState {
  if (!PERMISSION_GATED_TOOLS.has(request.toolName)) {
    return { kind: 'not_needed' };
  }

  const context = buildPermissionRequestContext(sessionId, request);
  if (!context) {
    return { kind: 'not_needed' };
  }

  const sessionMetadata = getSessionMetadata(sessionId);
  if (shouldAutoApproveToolForSessionMetadata(request.toolName, sessionMetadata)) {
    return { kind: 'approved', requestId: 'channel-policy', decision: 'session' };
  }

  if (hasWorkspacePermanentPermission(sessionId, request.toolName, context.scope)) {
    return { kind: 'approved', requestId: 'workspace-policy', decision: 'permanent' };
  }

  const requestPayload =
    executionContext?.clientRequestId &&
    executionContext.requestData &&
    typeof executionContext.nextRound === 'number'
      ? {
          clientRequestId: executionContext.clientRequestId,
          nextRound: executionContext.nextRound,
          requestData: executionContext.requestData,
          toolCallId: request.toolCallId,
          rawInput: request.rawInput as Record<string, unknown>,
          ...(observability ? { observability } : {}),
        }
      : undefined;

  const approved = findApprovedPermission(sessionId, request.toolName, context.scope);
  if (approved) {
    return { kind: 'approved', requestId: approved.id, decision: approved.decision };
  }

  const pendingRequestId = findPendingPermission(sessionId, request.toolName, context.scope);
  if (pendingRequestId) {
    if (requestPayload) {
      updatePendingPermissionPayload(pendingRequestId, requestPayload);
    }
    return { kind: 'pending', requestId: pendingRequestId, created: false };
  }

  return {
    kind: 'pending',
    requestId: createPendingPermissionRequest(sessionId, request.toolName, context, requestPayload),
    created: true,
  };
}

export interface SandboxConfig {
  allowedTools?: string[];
  defaultTimeoutMs?: number;
}

export class ToolSandbox {
  private readonly registry: ToolRegistry;
  private readonly whitelist: Set<string>;
  private readonly defaultTimeout: number;

  constructor(config: SandboxConfig = {}) {
    this.registry = new ToolRegistry();
    this.whitelist = config.allowedTools ? new Set(config.allowedTools) : TOOL_WHITELIST;
    this.defaultTimeout = config.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  }

  register<TInput extends ZodTypeAny, TOutput extends ZodTypeAny>(
    tool: ToolDefinition<TInput, TOutput>,
  ): void {
    this.registry.register(tool as unknown as ToolDefinition);
    this.whitelist.add(tool.name);
  }

  async execute(
    request: ToolCallRequest,
    signal: AbortSignal,
    sessionId: string,
    executionContext?: SandboxExecutionContext,
  ): Promise<ToolCallResult> {
    const dispatchedRequest = dispatchClaudeCodeTool(
      request.toolName,
      (request.rawInput && typeof request.rawInput === 'object' && !Array.isArray(request.rawInput)
        ? request.rawInput
        : {}) as Record<string, unknown>,
    );
    if (dispatchedRequest.kind === 'unsupported') {
      const result: ToolCallResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: dispatchedRequest.result.hint ?? dispatchedRequest.result.message,
        isError: true,
        durationMs: 0,
      };
      writeAuditLog({
        sessionId,
        category: 'tool',
        sourceName: request.toolName,
        requestId: request.toolCallId,
        input: request.rawInput,
        output: result.output,
        isError: result.isError ?? false,
        durationMs: result.durationMs ?? null,
      });
      return result;
    }

    const normalizedRequest: ToolCallRequest = {
      ...request,
      toolName: dispatchedRequest.normalized.canonicalName,
      rawInput: dispatchedRequest.normalized.normalizedFields,
    };

    if (!this.whitelist.has(normalizedRequest.toolName)) {
      const result: ToolCallResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: `Tool "${request.toolName}" is not allowed`,
        isError: true,
        durationMs: 0,
      };
      writeAuditLog({
        sessionId,
        category: 'tool',
        sourceName: request.toolName,
        requestId: request.toolCallId,
        input: request.rawInput,
        output: result.output,
        isError: result.isError ?? false,
        durationMs: result.durationMs ?? null,
      });
      return result;
    }

    const sessionMetadata = getSessionMetadata(sessionId);
    const toolObservability = buildToolObservability({
      canonicalToolName: normalizedRequest.toolName,
      metadata: sessionMetadata,
      presentedToolName: request.toolName,
    });
    if (!isGatewayToolEnabledForSessionMetadata(normalizedRequest.toolName, sessionMetadata)) {
      const result: ToolCallResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: `Tool "${request.toolName}" is not enabled for this session`,
        isError: true,
        durationMs: 0,
      };
      writeAuditLog({
        sessionId,
        category: 'tool',
        sourceName: request.toolName,
        requestId: request.toolCallId,
        input: request.rawInput,
        output: result.output,
        isError: result.isError ?? false,
        durationMs: result.durationMs ?? null,
      });
      return result;
    }

    if (FILE_TOOLS.has(normalizedRequest.toolName)) {
      const rawInput = normalizedRequest.rawInput as Record<string, unknown>;
      const filePath =
        (typeof rawInput['path'] === 'string' ? rawInput['path'] : undefined) ??
        (typeof rawInput['filePath'] === 'string' ? rawInput['filePath'] : undefined);
      if (filePath) {
        await ensureIgnoreRulesLoadedForPath(filePath);
      }
      if (filePath && defaultIgnoreManager.shouldIgnore(filePath)) {
        const result: ToolCallResult = {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Access denied: file "${filePath}" is protected by agentignore rules`,
          isError: true,
          durationMs: 0,
        };
        writeAuditLog({
          sessionId,
          category: 'tool',
          sourceName: request.toolName,
          requestId: request.toolCallId,
          input: request.rawInput,
          output: result.output,
          isError: result.isError ?? false,
          durationMs: result.durationMs ?? null,
        });
        return result;
      }
    }

    const permissionState = ensurePermissionForTool(
      sessionId,
      normalizedRequest,
      toolObservability,
      executionContext,
    );
    if (permissionState.kind === 'pending') {
      const result: ToolCallResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: permissionState.created
          ? `Tool "${request.toolName}" requires approval before it can modify the workspace. Permission request ${permissionState.requestId} has been created. Ask the user to approve it, then retry.`
          : `Tool "${request.toolName}" is waiting for approval. Permission request ${permissionState.requestId} is still pending. Ask the user to approve it, then retry.`,
        isError: true,
        durationMs: 0,
        pendingPermissionRequestId: permissionState.requestId,
      };
      writeAuditLog({
        sessionId,
        category: 'tool',
        sourceName: request.toolName,
        requestId: request.toolCallId,
        input: request.rawInput,
        output: result.output,
        isError: result.isError ?? false,
        durationMs: result.durationMs ?? null,
      });
      return result;
    }

    const gatewayManagedResult = await executeGatewayManagedTool(
      this,
      sessionId,
      normalizedRequest,
      signal,
      toolObservability,
      executionContext,
    );
    if (gatewayManagedResult) {
      gatewayManagedResult.toolName = request.toolName;
      writeAuditLog({
        sessionId,
        category: 'tool',
        sourceName: request.toolName,
        requestId: request.toolCallId,
        input: request.rawInput,
        output: gatewayManagedResult.output,
        isError: gatewayManagedResult.isError ?? false,
        durationMs: gatewayManagedResult.durationMs ?? null,
      });
      if (permissionState.kind === 'approved' && permissionState.decision === 'once') {
        consumeOncePermission(permissionState.requestId);
      }
      return gatewayManagedResult;
    }

    const tool = this.registry.get(normalizedRequest.toolName);
    if (tool && !tool.timeout) {
      const withTimeout = { ...tool, timeout: this.defaultTimeout };
      this.registry.register(withTimeout);
    }

    const startAt = Date.now();
    let result: ToolCallResult;
    try {
      result = await this.registry.execute(normalizedRequest, signal);
      result.toolName = request.toolName;
    } catch (error) {
      const durationMs = Date.now() - startAt;
      if (error instanceof ToolNotFoundError) {
        result = {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: error.message,
          isError: true,
          durationMs,
        };
      } else if (error instanceof ToolValidationError) {
        result = {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: error.message,
          isError: true,
          durationMs,
        };
      } else if (error instanceof ToolTimeoutError) {
        result = {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Tool timed out after ${error.timeoutMs}ms`,
          isError: true,
          durationMs,
        };
      } else {
        result = {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: String(error),
          isError: true,
          durationMs,
        };
      }
    }

    writeAuditLog({
      sessionId,
      category: 'tool',
      sourceName: request.toolName,
      requestId: request.toolCallId,
      input: request.rawInput,
      output: result.output,
      isError: result.isError ?? false,
      durationMs: result.durationMs ?? null,
    });
    if (permissionState.kind === 'approved' && permissionState.decision === 'once') {
      consumeOncePermission(permissionState.requestId);
    }
    return result;
  }
}

export function createDefaultSandbox(allowedTools: string[] = []): ToolSandbox {
  const editTool = createEditTool('__sandbox__', '__sandbox__', '__sandbox__');
  const sandbox = new ToolSandbox({
    allowedTools: [...allowedTools, ...TOOL_WHITELIST],
    defaultTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  });
  sandbox.register<typeof webSearchTool.inputSchema, typeof webSearchTool.outputSchema>(
    webSearchTool,
  );
  sandbox.register<typeof websearchTool.inputSchema, typeof websearchTool.outputSchema>(
    websearchTool,
  );
  sandbox.register<
    typeof codesearchToolDefinition.inputSchema,
    typeof codesearchToolDefinition.outputSchema
  >(codesearchToolDefinition);
  sandbox.register<typeof webfetchTool.inputSchema, typeof webfetchTool.outputSchema>(webfetchTool);
  sandbox.register<
    typeof applyPatchToolDefinition.inputSchema,
    typeof applyPatchToolDefinition.outputSchema
  >(applyPatchToolDefinition);
  sandbox.register<typeof editTool.inputSchema, typeof editTool.outputSchema>(editTool);
  sandbox.register<
    typeof gatewayLspDiagnosticsTool.inputSchema,
    typeof gatewayLspDiagnosticsTool.outputSchema
  >(gatewayLspDiagnosticsTool);
  sandbox.register<typeof gatewayLspTouchTool.inputSchema, typeof gatewayLspTouchTool.outputSchema>(
    gatewayLspTouchTool,
  );
  sandbox.register<
    typeof lspGotoDefinitionToolDefinition.inputSchema,
    typeof lspGotoDefinitionToolDefinition.outputSchema
  >(lspGotoDefinitionToolDefinition);
  sandbox.register<
    typeof lspGotoImplementationToolDefinition.inputSchema,
    typeof lspGotoImplementationToolDefinition.outputSchema
  >(lspGotoImplementationToolDefinition);
  sandbox.register<
    typeof lspFindReferencesToolDefinition.inputSchema,
    typeof lspFindReferencesToolDefinition.outputSchema
  >(lspFindReferencesToolDefinition);
  sandbox.register<
    typeof lspSymbolsToolDefinition.inputSchema,
    typeof lspSymbolsToolDefinition.outputSchema
  >(lspSymbolsToolDefinition);
  sandbox.register<
    typeof lspPrepareRenameToolDefinition.inputSchema,
    typeof lspPrepareRenameToolDefinition.outputSchema
  >(lspPrepareRenameToolDefinition);
  sandbox.register<
    typeof lspRenameToolDefinition.inputSchema,
    typeof lspRenameToolDefinition.outputSchema
  >(lspRenameToolDefinition);
  sandbox.register<
    typeof lspHoverToolDefinition.inputSchema,
    typeof lspHoverToolDefinition.outputSchema
  >(lspHoverToolDefinition);
  sandbox.register<
    typeof lspCallHierarchyToolDefinition.inputSchema,
    typeof lspCallHierarchyToolDefinition.outputSchema
  >(lspCallHierarchyToolDefinition);
  sandbox.register<typeof workspaceTreeTool.inputSchema, typeof workspaceTreeTool.outputSchema>(
    workspaceTreeTool,
  );
  sandbox.register<typeof listTool.inputSchema, typeof listTool.outputSchema>(listTool);
  sandbox.register<
    typeof workspaceReadFileTool.inputSchema,
    typeof workspaceReadFileTool.outputSchema
  >(workspaceReadFileTool);
  sandbox.register<typeof readTool.inputSchema, typeof readTool.outputSchema>(readTool);
  sandbox.register<typeof fileReadTool.inputSchema, typeof fileReadTool.outputSchema>(fileReadTool);
  sandbox.register<typeof readFileTool.inputSchema, typeof readFileTool.outputSchema>(readFileTool);
  sandbox.register<typeof globTool.inputSchema, typeof globTool.outputSchema>(globTool);
  sandbox.register<typeof workspaceSearchTool.inputSchema, typeof workspaceSearchTool.outputSchema>(
    workspaceSearchTool,
  );
  sandbox.register<typeof grepTool.inputSchema, typeof grepTool.outputSchema>(grepTool);
  sandbox.register<
    typeof astGrepSearchToolDefinition.inputSchema,
    typeof astGrepSearchToolDefinition.outputSchema
  >(astGrepSearchToolDefinition);
  sandbox.register<
    typeof astGrepReplaceToolDefinition.inputSchema,
    typeof astGrepReplaceToolDefinition.outputSchema
  >(astGrepReplaceToolDefinition);
  sandbox.register<
    typeof workspaceReviewStatusTool.inputSchema,
    typeof workspaceReviewStatusTool.outputSchema
  >(workspaceReviewStatusTool);
  sandbox.register<
    typeof workspaceReviewDiffTool.inputSchema,
    typeof workspaceReviewDiffTool.outputSchema
  >(workspaceReviewDiffTool);
  sandbox.register<
    typeof workspaceWriteFileTool.inputSchema,
    typeof workspaceWriteFileTool.outputSchema
  >(workspaceWriteFileTool);
  sandbox.register<typeof writeTool.inputSchema, typeof writeTool.outputSchema>(writeTool);
  sandbox.register<typeof fileWriteTool.inputSchema, typeof fileWriteTool.outputSchema>(
    fileWriteTool,
  );
  sandbox.register<typeof writeFileTool.inputSchema, typeof writeFileTool.outputSchema>(
    writeFileTool,
  );
  sandbox.register<
    typeof workspaceCreateFileTool.inputSchema,
    typeof workspaceCreateFileTool.outputSchema
  >(workspaceCreateFileTool);
  sandbox.register<
    typeof workspaceCreateDirectoryTool.inputSchema,
    typeof workspaceCreateDirectoryTool.outputSchema
  >(workspaceCreateDirectoryTool);
  sandbox.register<
    typeof workspaceReviewRevertTool.inputSchema,
    typeof workspaceReviewRevertTool.outputSchema
  >(workspaceReviewRevertTool);
  sandbox.register<
    typeof interactiveBashToolDefinition.inputSchema,
    typeof interactiveBashToolDefinition.outputSchema
  >(interactiveBashToolDefinition);
  return sandbox;
}
