import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ToolCallRequest, ToolCallResult, ToolDefinition } from '@openAwork/agent-core';
import {
  AgentTaskManagerImpl,
  defaultIgnoreManager,
  lspDiagnosticsTool,
  lspTouchTool,
  PERMISSION_CATEGORIES,
  resolvePermissionCategory,
  ToolNotFoundError,
  ToolRegistry,
  ToolTimeoutError,
  ToolValidationError,
} from '@openAwork/agent-core';
import type { BatchSubToolProgress, RunEvent } from '@openAwork/shared';
import type { ZodTypeAny } from 'zod';
import {
  applyPatchToolDefinition,
  buildApplyPatchPermissionScope,
  executeApplyPatch,
} from './apply-patch-tools.js';
import { astGrepReplaceToolDefinition, astGrepSearchToolDefinition } from './ast-grep-tools.js';
import { writeAuditLog } from '../infra/audit-log.js';
import {
  backgroundCancelToolDefinition,
  backgroundOutputToolDefinition,
} from './background-task-tools.js';
import { bashToolDefinition, deriveBashDescription, runBashCommand } from './bash-tools.js';
import { bashCommandScope, tokenizeCommand } from './bash-arity.js';
import {
  bashKillToolDefinition,
  bashOutputToolDefinition,
  dispatchBashKill,
  dispatchBashOutput,
  dispatchRunBashInBackground,
  runBashInBackgroundToolDefinition,
} from './run-background-bash-tools.js';
import { BATCH_TOOL_DISALLOWED, BATCH_TOOL_MAX_CALLS } from './batch-tools.js';
import {
  buildCallOmoAgentBackgroundOutput,
  buildCallOmoAgentSyncOutput,
  buildDelegatedChildClientRequestId,
} from './call-omo-agent-output.js';
import { CALL_OMO_ALLOWED_AGENTS, callOmoAgentToolDefinition } from './call-omo-agent-tools.js';
import { dispatchClaudeCodeTool } from '../claude-code/claude-code-tool-dispatch.js';
import { codesearchToolDefinition } from './codesearch-tools.js';
import { sqliteAll, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import {
  buildBackgroundCancelAllMessage,
  buildBackgroundCancelSingleMessage,
  buildBackgroundTaskResultMessage,
  buildBackgroundTaskStatusMessage,
  buildTaskToolBackgroundMessage,
  buildTaskToolTerminalMessage,
  collectDelegatedSessionText,
  extractLatestDelegatedSessionMessage,
} from '../task/delegated-task-display.js';
import { desktopAutomationToolDefinition, runDesktopAutomationTool } from './desktop-automation.js';
import type { DynamicToolEntry } from './dynamic-tool-loader.js';
import { dynamicEntryToToolDefinition } from './dynamic-tool-loader.js';
import { createEditTool } from './edit-tools.js';
import { executeGenerateImageTool, generateImageToolDefinition } from './image-generation-tool.js';
import {
  interactiveBashToolDefinition,
  runInteractiveBashCommand,
} from './interactive-bash-tools.js';
import { lookAtToolDefinition, runLookAtTool } from './look-at-tools.js';
import { repoCloneToolDefinition } from './repo-clone-tools.js';
import { repoOverviewToolDefinition } from './repo-overview-tools.js';
import { lspManager } from '../lsp/router.js';
import {
  lspCallHierarchyToolDefinition,
  lspFindReferencesToolDefinition,
  lspGotoDefinitionToolDefinition,
  lspGotoImplementationToolDefinition,
  lspHoverToolDefinition,
  lspPrepareRenameToolDefinition,
  lspRenameToolDefinition,
  lspSymbolsToolDefinition,
} from './lsp-tools.js';
import { parseFlatMcpToolName } from '../mcp/mcp-tool-naming.js';
import { dispatchToolExecuteAfter, dispatchToolExecuteBefore } from '../runtime/plugin-host.js';
import {
  callMcpToolForSession,
  getConfiguredMcpServerForSession,
  getMcpServerFingerprint,
  listMcpToolsForSession,
} from '../mcp/mcp-runtime.js';
import { parseMcpCallRawInput, parseMcpListToolsRawInput } from '../mcp/mcp-tool-input.js';
import { transitionToolToRunning } from '../message/message-store-v2.js';
import {
  appendSessionMessageV2 as appendSessionMessage,
  deleteSessionMessagesByRequestScope,
  getLatestReferencedToolResult,
  getSessionToolResultByCallId,
  listSessionMessagesV2 as listSessionMessages,
  listSessionMessagesByRequestScope,
} from '../message/message-v2-adapter.js';
import { createMultiEditTool } from './multi-edit-tool.js';
import {
  approvalCoversScope,
  type PermissionApprovalCandidateRow,
} from '../permission/permission-approval-match.js';
import {
  type PermissionDecision,
  type PermissionRiskLevel,
  resolvePermissionRequestTimeoutMs,
} from '../permission/permission-contract.js';
import {
  evaluatePermissionRules,
  loadWorkspacePermissionRules,
  type PermissionAction,
  type PermissionRule,
} from '../permission/permission-rules.js';
import {
  buildExitPlanModeQuestionInput,
  enterPlanModeToolDefinition,
  exitPlanModeToolDefinition,
} from './plan-mode-tools.js';
import { resolveStoredDefaultThinkingMode } from '../provider/provider-config.js';
import { buildQuestionRequestTitle, questionToolDefinition } from './question-tools.js';
import { stopAnyInFlightStreamRequestForSession } from '../routes/stream-cancellation.js';
import { captureBeforeWriteBackup } from '../session/session-file-backup-store.js';
import { deleteRequestFileDiffs } from '../session/session-file-diff-store.js';
import {
  runSessionInfoTool,
  runSessionListTool,
  runSessionReadTool,
  runSessionSearchTool,
  sessionInfoToolDefinition,
  sessionListToolDefinition,
  sessionReadToolDefinition,
  sessionSearchToolDefinition,
} from '../session/session-manager-tools.js';
import { createPermissionAskedEvent } from '../session/session-permission-events.js';
import { createQuestionAskedEvent } from '../session/session-question-events.js';
import {
  deleteSessionRunEventsByRequest,
  publishSessionRunEvent,
} from '../session/session-run-events.js';
import { reconcileSessionStateStatus } from '../session/session-runtime-state.js';
import { deleteRequestSnapshots } from '../session/session-snapshot-store.js';
import {
  isGatewayToolEnabledForSessionMetadata,
  isPlanModeToolEnabledForSessionMetadata,
  shouldAutoApproveToolForSessionMetadata,
} from '../session/session-tool-visibility.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import {
  isSkillMcpAllowedByEffective,
  runSkillMcpTool,
  skillMcpToolDefinition,
} from '../skill/skill-mcp-tools.js';
import { getEffectiveSkillsForSession } from '../skill/skill-selection-context.js';
import { createSkillTool } from '../skill/skill-tools.js';
import { resolveDelegatedAgent } from '../task/task-agent-resolution.js';
import {
  runTaskCreateTool,
  runTaskGetTool,
  runTaskListTool,
  runTaskUpdateTool,
  taskCreateToolDefinition,
  taskGetToolDefinition,
  taskListToolDefinition,
  taskUpdateToolDefinition,
} from '../task/task-crud-tools.js';
import { selectDelegatedModelForUser } from '../task/task-model-selection.js';
import {
  clearTaskParentAutoResumeContext,
  consumeTaskParentAutoResumeContext,
  scheduleTaskParentAutoResume,
  upsertTaskParentAutoResumeContext,
} from '../task/task-parent-auto-resume.js';
import { tryResolveTaskPendingInteractionWithParent } from '../task/task-parent-auto-decision.js';
import { extractLatestChildSessionSummary } from '../task/task-result-extraction.js';
import { taskToolDefinition } from '../task/task-tools.js';
import {
  formatSubTodoReadValidationError,
  formatSubTodoWriteValidationError,
  formatTodoReadValidationError,
  formatTodoWriteValidationError,
  runSubTodoReadTool,
  runSubTodoWriteTool,
  runTodoReadTool,
  runTodoWriteTool,
  subTodoReadInputSchema,
  subTodoReadTool,
  subTodoWriteInputSchema,
  subTodoWriteTool,
  todoReadInputSchema,
  todoReadTool,
  todoWriteInputSchema,
  todoWriteTool,
} from './todo-tools.js';
import { createWebsearchTool, websearchTool } from './tool-aliases.js';
import { readWebsearchPolicy, WEBSEARCH_POLICY_KEY } from '../provider/websearch-policy.js';
import { buildReadToolOutputResponse, readToolOutputToolDefinition } from './tool-output-tools.js';
import { buildToolResultContent, buildToolResultRunEvent } from './tool-result-contract.js';
import {
  DEFAULT_UPSTREAM_RETRY_MAX_RETRIES,
  normalizeUpstreamRetryMaxRetries,
  UPSTREAM_RETRY_MAX_RETRIES_KEY,
} from '../provider/upstream-retry-policy.js';
import { webfetchTool } from './web-tools.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import {
  ensureIgnoreRulesLoadedForPath,
  getSessionWorkspaceRoot,
  hasWorkspacePermanentPermission,
} from '../workspace/workspace-safety.js';
import {
  executeWriteTool,
  globTool,
  grepTool,
  listTool,
  readTool,
  resolveWorkspaceReviewFilePath,
  WORKSPACE_TOOL_NAMES,
  workspaceCreateDirectoryTool,
  workspaceReviewDiffTool,
  workspaceReviewRevertTool,
  workspaceReviewStatusTool,
  writeTool,
} from './workspace-tools.js';
import { rewriteLegacyToolRequest } from './legacy-tool-name-rewrite.js';

function formatToolInputValidationOutput(
  toolName: string,
  issues: ReadonlyArray<{ path: (string | number)[]; message: string }>,
): string {
  const details = issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : null;
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
  return `工具 "${toolName}" 参数校验失败：${details}`;
}

const FILE_TOOLS = new Set([
  'edit',
  'read',
  'write',
  'workspace_review_diff',
  'workspace_review_revert',
]);

// Default permission rules: auto-generated from PERMISSION_CATEGORIES metadata.
// Each category declares its built-in default action (allow/ask/deny).
// Users override via .openawork.permissions.json (last-match-wins).
// Rules use category IDs (not raw tool names); resolvePermissionCategory maps
// tool names → category IDs at evaluation time.
const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  { permission: '*', pattern: '*', action: 'allow' },
  ...PERMISSION_CATEGORIES.filter((cat) => cat.defaultAction !== 'allow').map((cat) => ({
    permission: cat.id,
    pattern: '*',
    action: cat.defaultAction,
  })),
];

const TOOL_WHITELIST = new Set<string>([
  'apply_patch',
  'bash',
  runBashInBackgroundToolDefinition.name,
  bashOutputToolDefinition.name,
  bashKillToolDefinition.name,
  'codesearch',
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
  'generate_image',
  repoCloneToolDefinition.name,
  repoOverviewToolDefinition.name,
  ...WORKSPACE_TOOL_NAMES,
]);
const DEFAULT_TOOL_TIMEOUT_MS = 30000;

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
  riskLevel: PermissionRiskLevel;
  previewAction: string;
  /** Patterns to auto-approve when user selects "always" (matches opencode ctx.ask always). */
  always: string[];
}

type PermissionState =
  | { kind: 'approved'; decision: PermissionDecision; requestId: string }
  | { kind: 'denied'; reason: string }
  | { kind: 'pending'; requestId: string; created: boolean }
  | { kind: 'not_needed' };

export type BatchProgressCallback = (
  subTools: BatchSubToolProgress[],
  completedCount: number,
  totalCount: number,
) => void;

export interface SandboxExecutionContext {
  clientRequestId?: string;
  nextRound?: number;
  requestData?: Record<string, unknown>;
  onBatchProgress?: BatchProgressCallback;
  /**
   * Optional partial-output callback that streaming-capable tool dispatchers
   * (currently bash) may invoke as the underlying process emits stdout/stderr.
   * The batch executor injects a per-sub-call wrapper that writes the chunk
   * into `subToolStates[index].partialOutput` and triggers `onBatchProgress`,
   * so the UI can render live terminal output for an in-flight sub-tool
   * without waiting for the whole batch to finish.
   */
  onPartialOutput?: (text: string) => void;
  /**
   * Owning user id, threaded down so terminal-tracked tool dispatchers
   * (bash / run_bash_in_background) can register session_terminals rows
   * with the right user. Falls back to `getSessionOwnerUserId(sessionId)`
   * when not provided.
   */
  userId?: string;
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
    adapterVersion: string;
  };
}

interface TaskBackgroundRunResult {
  pendingInteraction: boolean;
  reason?: ChildSessionTerminalReason;
  errorSummary?: string;
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

/** The only timeout source still emitted automatically by the current runtime. */
export type ChildSessionTimeoutSource = 'first_response';

const CHILD_SESSION_TERMINAL_REASON_KEY = 'terminalReason';
const CHILD_SESSION_TIMEOUT_SOURCE_KEY = 'timeoutSource';
const DEFAULT_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS = 30_000;

function readChildSessionTerminalReason(
  metadata: Record<string, unknown>,
): ChildSessionTerminalReason | undefined {
  const value = metadata[CHILD_SESSION_TERMINAL_REASON_KEY];
  return value === 'timeout' || value === 'cancelled' ? value : undefined;
}

function readChildSessionTimeoutSource(
  metadata: Record<string, unknown>,
): ChildSessionTimeoutSource | undefined {
  const value = metadata[CHILD_SESSION_TIMEOUT_SOURCE_KEY];
  return value === 'first_response' ? value : undefined;
}

function writeChildSessionTerminalReason(input: {
  childSessionId: string;
  reason: ChildSessionTerminalReason;
  timeoutSource?: ChildSessionTimeoutSource;
  userId: string;
}): void {
  const childSession = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.childSessionId, input.userId],
  );
  const childMetadata = childSession ? parseSessionMetadataJson(childSession.metadata_json) : {};
  childMetadata[CHILD_SESSION_TERMINAL_REASON_KEY] = input.reason;
  if (input.reason === 'timeout') {
    if (input.timeoutSource) {
      childMetadata[CHILD_SESSION_TIMEOUT_SOURCE_KEY] = input.timeoutSource;
    }
  } else {
    delete childMetadata[CHILD_SESSION_TIMEOUT_SOURCE_KEY];
  }
  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(childMetadata), input.childSessionId, input.userId],
  );
}

function getTaskChildFirstResponseTimeoutMs(): number {
  const raw = process.env.OPENAWORK_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS;
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

function isChildSessionFirstResponseEvent(
  _event: RunEvent,
  timedOut: boolean,
  alreadyReceived: boolean,
): boolean {
  if (timedOut || alreadyReceived) {
    return false;
  }

  // task_update may be the first visible sign that a delegated child is actively
  // progressing through nested work. Treat it as first activity so nested task
  // execution does not trip the child first-response timeout prematurely.
  return true;
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
  timeoutSource?: ChildSessionTimeoutSource;
  userId: string;
}): Promise<{ stopped: boolean; terminated: boolean }> {
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

  clearTaskParentAutoResumeContext({
    childSessionId: input.childSessionId,
    userId: input.userId,
  });
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
  if (input.reason === 'timeout') {
    if (input.timeoutSource) {
      childMetadata[CHILD_SESSION_TIMEOUT_SOURCE_KEY] = input.timeoutSource;
    }
  } else {
    delete childMetadata[CHILD_SESSION_TIMEOUT_SOURCE_KEY];
  }
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
    (typeof childMetadata.subagentType === 'string' ? childMetadata.subagentType : 'task');
  const category =
    typeof childMetadata.taskCategory === 'string' ? childMetadata.taskCategory : undefined;
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
    timeoutSource: input.timeoutSource,
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
      timeoutSource: input.timeoutSource,
    }),
  );

  return { stopped, terminated: true };
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
  timeoutSource?: ChildSessionTimeoutSource;
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
    ...(input.timeoutSource ? { timeoutSource: input.timeoutSource } : {}),
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
  return metadata.createdByTool === 'task';
}

function listParsedTaskSessionsForUser(userId: string): ParsedTaskSessionRow[] {
  return sqliteAll<TaskSessionRow>(
    'SELECT id, metadata_json, state_status FROM sessions WHERE user_id = ?',
    [userId],
  ).map((row) => {
    const metadata = parseSessionMetadataJson(row.metadata_json);
    const parentSessionId =
      typeof metadata.parentSessionId === 'string' ? metadata.parentSessionId : null;
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

interface TeamRoleBindingEntry {
  agentId: string;
  modelId?: string;
  providerId?: string;
  variant?: string;
}

function findTeamRoleBindingForAgent(
  sessionMetadata: Record<string, unknown>,
  agentId: string,
): TeamRoleBindingEntry | undefined {
  const teamDefinition = sessionMetadata.teamDefinition;
  if (typeof teamDefinition !== 'object' || teamDefinition === null) return undefined;
  const requiredRoleBindings = (teamDefinition as Record<string, unknown>).requiredRoleBindings;
  if (!Array.isArray(requiredRoleBindings)) return undefined;
  return requiredRoleBindings.find(
    (binding: unknown) =>
      typeof binding === 'object' &&
      binding !== null &&
      (binding as { agentId: string }).agentId === agentId,
  ) as TeamRoleBindingEntry | undefined;
}

function parseStoredSettingJson(value: string | undefined): unknown {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function resolveDelegatedChildThinkingDefaults(userId: string): {
  enabled: boolean;
  effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
} {
  const row = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'default_thinking'`,
    [userId],
  );

  // Delegated child sessions behave like fast-path helper runs when the parent
  // request omitted an explicit thinking configuration.
  return resolveStoredDefaultThinkingMode(parseStoredSettingJson(row?.value), 'fast');
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
  userId: string;
}): Record<string, unknown> | null {
  const baseRequestData =
    input.executionContext?.requestData && typeof input.executionContext.requestData === 'object'
      ? input.executionContext.requestData
      : {};

  const nextRequestData: Record<string, unknown> = {
    ...baseRequestData,
  };

  const hasExplicitThinkingEnabled = Object.hasOwn(baseRequestData, 'thinkingEnabled');
  const hasExplicitReasoningEffort = Object.hasOwn(baseRequestData, 'reasoningEffort');

  if (!hasExplicitThinkingEnabled || !hasExplicitReasoningEffort) {
    const defaultThinking = resolveDelegatedChildThinkingDefaults(input.userId);
    if (!hasExplicitThinkingEnabled) {
      nextRequestData.thinkingEnabled = defaultThinking.enabled;
    }
    if (!hasExplicitReasoningEffort) {
      nextRequestData.reasoningEffort = defaultThinking.effort;
    }
  }

  return {
    ...nextRequestData,
    agentId: input.agentId,
    clientRequestId: buildDelegatedChildClientRequestId({
      childSessionId: input.childSessionId,
      parentClientRequestId: input.executionContext?.clientRequestId,
    }),
    displayMessage: input.prompt,
    message: input.prompt,
    ...(input.modelSelection?.modelId ? { model: input.modelSelection.modelId } : {}),
    ...(input.modelSelection?.providerId ? { providerId: input.modelSelection.providerId } : {}),
    ...(input.modelSelection?.variant ? { variant: input.modelSelection.variant } : {}),
    ...(input.systemPrompt
      ? { systemPrompt: input.systemPrompt }
      : baseRequestData.systemPrompt !== undefined
        ? { systemPrompt: baseRequestData.systemPrompt }
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
  const candidate = metadata.requestedSkills;
  if (!Array.isArray(candidate)) {
    return undefined;
  }

  const skills = candidate.filter((value): value is string => typeof value === 'string');
  return skills.length > 0 ? skills : undefined;
}

/**
 * 读取某 session 的模板初始 MCP 白名单（metadata.requestedMcpServers）。
 * 用于 mcp_list_tools 包装工具路径的按需过滤（flat 模式下该包装通常隐藏，
 * 但 flat 关闭时仍需尊重白名单）。
 */
function readSessionRequestedMcpServers(sessionId: string): string[] {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return [];
  const metadata = parseSessionMetadataJson(row.metadata_json ?? '{}');
  const candidate = metadata['requestedMcpServers'];
  return Array.isArray(candidate)
    ? candidate.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
}

function readTaskCategory(metadata: Record<string, unknown>): string | undefined {
  return typeof metadata.taskCategory === 'string' ? metadata.taskCategory : undefined;
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
    typeof metadata.parentSessionId === 'string' ? metadata.parentSessionId : null;
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
      (typeof metadata.subagentType === 'string' ? metadata.subagentType : 'task'),
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
  timeoutSource?: ChildSessionTimeoutSource;
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
    timeoutSource: input.timeoutSource,
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

/**
 * Convert an absolute workspace path to a relative scope string.
 * Matches opencode's `path.relative(worktree, filePath)` pattern so that
 * permission rules are portable and don't depend on the host's absolute path.
 */
function toRelativeScope(absolutePath: string): string {
  if (absolutePath.startsWith(WORKSPACE_ROOT)) {
    const rel = absolutePath.slice(WORKSPACE_ROOT.length).replace(/^\//, '');
    return rel || '.';
  }
  return absolutePath;
}

function buildBashApprovalPatterns(command: string): string[] {
  const tokens = tokenizeCommand(command.trim());
  const patterns = new Set<string>();
  if (tokens.length > 2) {
    patterns.add(`${tokens.slice(0, -1).join(' ')} *`);
  }
  const arityPattern = bashCommandScope(command);
  if (arityPattern.trim() !== '*') {
    patterns.add(arityPattern);
  }
  const firstToken = tokens[0];
  if (firstToken) {
    patterns.add(`${firstToken} *`);
  }
  patterns.delete(command.trim());
  return [...patterns];
}

function buildPermissionRequestContext(
  sessionId: string,
  request: ToolCallRequest,
): PermissionRequestContext | null {
  const rawInput = request.rawInput as Record<string, unknown>;
  const pathValue =
    typeof rawInput.path === 'string'
      ? rawInput.path
      : typeof rawInput.filePath === 'string'
        ? rawInput.filePath
        : null;

  // Flat MCP tools (PR-C): `mcp__<serverId>__<toolName>` is dynamic and
  // cannot be matched by the static `switch` below, so we intercept it
  // up front. The permission scope mirrors the legacy `mcp_call` path
  // (`serverId:toolName:fingerprint`) so users who already granted
  // "always allow serverId:*" in the legacy UI don't see a second
  // prompt after the flattening rollout.
  const flatMcp = parseFlatMcpToolName(request.toolName);
  if (flatMcp) {
    try {
      const server = getConfiguredMcpServerForSession(sessionId, flatMcp.serverId);
      const serverFingerprint = getMcpServerFingerprint(server);
      const previewArguments = JSON.stringify(rawInput).slice(0, 240);
      return {
        scope: `${flatMcp.serverId}:${flatMcp.toolName}:${serverFingerprint}`,
        reason: '需要调用 MCP 工具',
        riskLevel: 'high',
        previewAction: `调用 ${flatMcp.serverId}/${flatMcp.toolName} ${previewArguments}`,
        always: [`${flatMcp.serverId}:*`],
      };
    } catch {
      // If the server is no longer configured (user removed it mid-turn),
      // fall through to the generic permission prompt so the LLM gets a
      // deterministic error rather than a silent null.
      return null;
    }
  }

  switch (request.toolName) {
    case 'write': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      if (!safePath) return null;
      const rel = toRelativeScope(safePath);
      return {
        scope: rel,
        reason: '需要写入工作区文件',
        riskLevel: 'medium',
        previewAction: `写入 ${safePath}`,
        always: ['*'],
      };
    }
    case 'edit': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      if (!safePath) return null;
      const rel = toRelativeScope(safePath);
      return {
        scope: rel,
        reason: '需要编辑工作区文件',
        riskLevel: 'medium',
        previewAction: `编辑 ${safePath}`,
        always: ['*'],
      };
    }
    case 'multi_edit': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      if (!safePath) return null;
      const rel = toRelativeScope(safePath);
      return {
        scope: rel,
        reason: '需要批量编辑工作区文件',
        riskLevel: 'medium',
        previewAction: `批量编辑 ${safePath}`,
        always: ['*'],
      };
    }
    case 'task_create': {
      const subject = typeof rawInput.subject === 'string' ? rawInput.subject.trim() : '';
      return {
        scope: subject ? `task:${subject}` : 'task:*',
        reason: '需要创建子任务',
        riskLevel: 'medium',
        previewAction: subject ? `创建子任务: ${subject}` : '创建子任务',
        always: ['*'],
      };
    }
    case 'task_update': {
      const id = typeof rawInput.id === 'string' ? rawInput.id.trim() : '';
      return {
        scope: id ? `task:${id}` : 'task:*',
        reason: '需要更新子任务',
        riskLevel: 'low',
        previewAction: id ? `更新子任务 ${id}` : '更新子任务',
        always: ['*'],
      };
    }
    case 'call_omo_agent': {
      const agentDesc = typeof rawInput.description === 'string' ? rawInput.description.trim() : '';
      return {
        scope: agentDesc ? `agent:${agentDesc}` : 'agent:*',
        reason: '需要调用子 Agent',
        riskLevel: 'high',
        previewAction: agentDesc ? `调用子 Agent: ${agentDesc}` : '调用子 Agent',
        always: ['*'],
      };
    }
    case 'skill': {
      const name = typeof rawInput.name === 'string' ? rawInput.name.trim() : '';
      if (!name) return null;
      return {
        scope: name,
        reason: '需要加载技能内容并注入会话上下文',
        riskLevel: 'medium',
        previewAction: `加载技能 ${name}`,
        always: [name],
      };
    }
    case 'skill_mcp': {
      const mcpName = typeof rawInput.mcp_name === 'string' ? rawInput.mcp_name.trim() : '';
      const operation =
        typeof rawInput.tool_name === 'string'
          ? rawInput.tool_name.trim()
          : typeof rawInput.resource_name === 'string'
            ? rawInput.resource_name.trim()
            : typeof rawInput.prompt_name === 'string'
              ? rawInput.prompt_name.trim()
              : '';
      if (!mcpName || !operation) return null;
      return {
        scope: `${mcpName}:${operation}`,
        reason: '需要调用技能内嵌的 MCP 能力',
        riskLevel: 'high',
        previewAction: `调用 skill MCP ${mcpName}/${operation}`,
        always: ['*'],
      };
    }
    case 'bash': {
      const command = typeof rawInput.command === 'string' ? rawInput.command.trim() : '';
      const workdirValue = typeof rawInput.workdir === 'string' ? rawInput.workdir : WORKSPACE_ROOT;
      const safeWorkdir = validateWorkspacePath(workdirValue);
      if (!command || !safeWorkdir) return null;
      return {
        scope: command,
        reason: '需要执行工作区命令',
        riskLevel: 'high',
        previewAction: `执行命令: ${command}`,
        always: buildBashApprovalPatterns(command),
      };
    }
    case 'interactive_bash': {
      const tmuxCommand =
        typeof rawInput.tmux_command === 'string' ? rawInput.tmux_command.trim() : '';
      if (!tmuxCommand) return null;
      return {
        scope: tmuxCommand,
        reason: '需要执行 tmux 交互式命令',
        riskLevel: 'high',
        previewAction: `执行 tmux 命令: ${tmuxCommand}`,
        always: buildBashApprovalPatterns(tmuxCommand),
      };
    }
    case 'ast_grep_replace': {
      const pattern = typeof rawInput.pattern === 'string' ? rawInput.pattern.trim() : '';
      const lang = typeof rawInput.lang === 'string' ? rawInput.lang.trim() : '';
      if (!pattern) return null;
      return {
        scope: `ast:${lang}:${pattern}`.slice(0, 200),
        reason: '需要执行 AST 级代码重写',
        riskLevel: 'high',
        previewAction: `AST 替换 ${lang} "${pattern}"`,
        always: ['*'],
      };
    }
    case 'apply_patch': {
      const patchText = typeof rawInput.patchText === 'string' ? rawInput.patchText : '';
      if (!patchText.trim()) return null;
      return {
        scope: buildApplyPatchPermissionScope(patchText),
        reason: '需要批量修改工作区文件',
        riskLevel: 'high',
        previewAction: '应用结构化补丁到工作区文件',
        always: ['*'],
      };
    }
    case 'task': {
      const description =
        typeof rawInput.description === 'string' ? rawInput.description.trim() : '';
      if (!description) return null;
      return {
        scope: `task:${description}`,
        reason: '需要创建子任务和子会话',
        riskLevel: 'high',
        previewAction: `创建子任务 ${description}`,
        always: ['*'],
      };
    }
    case 'workspace_create_directory': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      if (!safePath) return null;
      const rel = toRelativeScope(safePath);
      return {
        scope: rel,
        reason: '需要在工作区中新建目录',
        riskLevel: 'medium',
        previewAction: `创建目录 ${safePath}`,
        always: ['*'],
      };
    }
    case 'workspace_review_revert': {
      const safeWorkspacePath = pathValue ? validateWorkspacePath(pathValue) : null;
      const filePath = typeof rawInput.filePath === 'string' ? rawInput.filePath : null;
      if (!safeWorkspacePath || !filePath) return null;
      const relativeFilePath = resolveWorkspaceReviewFilePath(safeWorkspacePath, filePath);
      const absoluteFilePath = join(safeWorkspacePath, relativeFilePath);
      return {
        scope: toRelativeScope(absoluteFilePath),
        reason: '需要回滚工作区文件改动',
        riskLevel: 'high',
        previewAction: `回滚 ${absoluteFilePath}`,
        always: ['*'],
      };
    }
    case 'mcp_call': {
      const parsed = parseMcpCallRawInput(rawInput);
      if (!parsed.ok) {
        return null;
      }
      const server = getConfiguredMcpServerForSession(sessionId, parsed.serverId);
      const serverFingerprint = getMcpServerFingerprint(server);
      const previewArguments = JSON.stringify(parsed.arguments).slice(0, 240);
      return {
        scope: `${parsed.serverId}:${parsed.toolName}:${serverFingerprint}`,
        reason: '需要调用 MCP 工具',
        riskLevel: 'high',
        previewAction: `调用 ${parsed.serverId}/${parsed.toolName} ${previewArguments}`,
        always: [`${parsed.serverId}:*`],
      };
    }
    case 'desktop_automation': {
      const action =
        typeof rawInput.action === 'string' ? rawInput.action.trim().toLowerCase() : '';
      if (!action) {
        return null;
      }
      const target =
        typeof rawInput.url === 'string'
          ? rawInput.url.trim()
          : typeof rawInput.selector === 'string'
            ? rawInput.selector.trim()
            : '';
      return {
        scope: target ? `${action}:${target}` : action,
        reason: '需要操作桌面 sidecar 的浏览器自动化能力',
        riskLevel: 'high',
        previewAction: target ? `桌面自动化 ${action}: ${target}` : `桌面自动化 ${action}`,
        always: ['*'],
      };
    }
    case 'lsp_rename': {
      const safePath = pathValue ? validateWorkspacePath(pathValue) : null;
      const newName = typeof rawInput.newName === 'string' ? rawInput.newName.trim() : '';
      if (!safePath || !newName) return null;
      return {
        scope: `${toRelativeScope(safePath)}:${newName}`,
        reason: '需要通过 LSP 跨文件重命名符号',
        riskLevel: 'high',
        previewAction: `LSP 重命名 ${safePath} → ${newName}`,
        always: ['*'],
      };
    }
    default: {
      // Generic fallback: tools without explicit context builders can still
      // request permission when configured via workspace rules.
      const genericScope = `${request.toolName}:${JSON.stringify(rawInput).slice(0, 200)}`;
      return {
        scope: genericScope,
        reason: `需要执行工具 "${request.toolName}"`,
        riskLevel: 'medium',
        previewAction: `执行 ${request.toolName}`,
        always: ['*'],
      };
    }
  }
}

/**
 * PR-D-Plugin entry wrapper: runs `tool.execute.before` to let
 * plugins rewrite the rawInput, calls the original implementation,
 * then runs `tool.execute.after` to let plugins rewrite the output.
 *
 * The hook contracts mirror opencode
 * (`@/temp/opencode/packages/plugin/src/index.ts:170-200`):
 *   - `output.args` is mutated in place by the before hook; we
 *     replace `request.rawInput` with the (possibly rewritten)
 *     value before dispatching the actual tool execution.
 *   - `output.output` / `output.metadata.isError` are mutated by the
 *     after hook; we propagate both back into the `ToolCallResult`.
 *
 * Hook errors are isolated inside the dispatcher (see
 * `plugin-host.ts`); a misbehaving plugin can't crash a tool call.
 */
async function executeGatewayManagedTool(
  sandbox: ToolSandbox,
  sessionId: string,
  request: ToolCallRequest,
  signal: AbortSignal,
  observability: PermissionRequestPayload['observability'] | undefined,
  executionContext?: SandboxExecutionContext,
): Promise<ToolCallResult | null> {
  const beforeOutput = {
    args: request.rawInput,
  };
  await dispatchToolExecuteBefore(
    {
      tool: request.toolName,
      sessionID: sessionId,
      callID: request.toolCallId,
    },
    beforeOutput,
  );
  // The hook mutates `args` in place; capture the post-mutation value
  // for both downstream execution AND the `args` field of the after
  // hook (so plugins see what actually ran, not the pre-mutation value).
  const effectiveRequest: ToolCallRequest =
    beforeOutput.args === request.rawInput
      ? request
      : {
          ...request,
          rawInput: beforeOutput.args as Record<string, unknown>,
        };

  const result = await executeGatewayManagedToolImpl(
    sandbox,
    sessionId,
    effectiveRequest,
    signal,
    observability,
    executionContext,
  );

  if (!result) return null;

  const afterOutput = {
    output: result.output,
    metadata: { isError: result.isError ?? false } as Record<string, unknown>,
  };
  await dispatchToolExecuteAfter(
    {
      tool: request.toolName,
      sessionID: sessionId,
      callID: request.toolCallId,
      args: effectiveRequest.rawInput,
    },
    afterOutput,
  );

  return {
    ...result,
    output: afterOutput.output,
    isError: afterOutput.metadata['isError'] === true,
  };
}

async function executeGatewayManagedToolImpl(
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
      const { serverId } = parseMcpListToolsRawInput(rawInput);
      const allowedServerIds = readSessionRequestedMcpServers(sessionId);
      const output = await listMcpToolsForSession(sessionId, {
        ...(serverId ? { serverId } : {}),
        ...(allowedServerIds.length > 0 ? { allowedServerIds } : {}),
      });
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }
      // Apply workspace skill selection filter: skill_mcp resolves an MCP
      // server embedded in an installed skill. If that skill is not in the
      // session's effective set, refuse the call so the model cannot bypass
      // the selection by guessing an mcp_name.
      const skillMcpEffective = getEffectiveSkillsForSession(sessionId);
      if (!isSkillMcpAllowedByEffective(skillMcpEffective, parsed.data.mcp_name)) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Skill MCP server "${parsed.data.mcp_name}" is not allowed in current workspace/session.`,
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
            goal: parsed.data.goal ?? '提取并描述文件内容',
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

    if (request.toolName === generateImageToolDefinition.name) {
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
      const parsed = generateImageToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }
      const startAt = Date.now();
      const result = await executeGenerateImageTool({
        signal,
        sessionId,
        userId,
        toolCallId: request.toolCallId,
        toolInput: parsed.data,
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: result.output,
        isError: result.isError,
        durationMs: Date.now() - startAt,
      };
    }

    if (request.toolName === callOmoAgentToolDefinition.name) {
      const parsed = callOmoAgentToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          description: parsed.data.description ?? parsed.data.prompt.slice(0, 40),
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
              description: parsed.data.description ?? parsed.data.prompt.slice(0, 40),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
            : [
                'No large referenced tool result was found in the current session.',
                'If the current session history already contains a toolCallId, call read_tool_output with that toolCallId instead of useLatestReferenced=true.',
              ].join(' '),
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

    // Flat MCP tools (PR-C): each MCP tool exposed as
    // `mcp__<serverId>__<toolName>` routes here. The arguments come
    // through `rawInput` directly — no `arguments` envelope unlike
    // `mcp_call`, since the LLM treats the flat tool exactly like
    // any other top-level function. Permission gating already ran
    // upstream via `buildPermissionRequestContext`.
    {
      const flatMcp = parseFlatMcpToolName(request.toolName);
      if (flatMcp) {
        try {
          const output = await callMcpToolForSession(sessionId, {
            serverId: flatMcp.serverId,
            toolName: flatMcp.toolName,
            arguments: rawInput,
          });
          return {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output,
            isError: output.isError === true,
            durationMs: 0,
          };
        } catch (err) {
          // Server outages / config drift / disabled-mid-turn —
          // surface as a tool-call error so the LLM can recover
          // rather than the request itself failing.
          return {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output: err instanceof Error ? err.message : String(err),
            isError: true,
            durationMs: 0,
          };
        }
      }
    }

    if (request.toolName === 'mcp_call') {
      const parsed = parseMcpCallRawInput(rawInput);
      if (!parsed.ok) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: parsed.reason,
          isError: true,
          durationMs: 0,
        };
      }

      const output = await callMcpToolForSession(sessionId, {
        serverId: parsed.serverId,
        toolName: parsed.toolName,
        arguments: parsed.arguments,
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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

    if (request.toolName === 'multi_edit') {
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
      const multiEditToolInstance = createMultiEditTool(
        sessionId,
        userId,
        executionContext?.clientRequestId ?? request.toolCallId,
        request.toolCallId,
      );
      const parsed = multiEditToolInstance.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await multiEditToolInstance.execute(parsed.data, signal);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === writeTool.name) {
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

      const parsed = writeTool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await executeWriteTool(parsed.data, signal, {
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
      const toolCallsValue = rawInput.tool_calls;
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
      const onProgress = executionContext?.onBatchProgress;
      const totalCount = selectedToolCalls.length;

      // Build initial sub-tool status array for progress reporting.
      const subToolStates: BatchSubToolProgress[] = selectedToolCalls.map((entry, index) => {
        const tool =
          entry && typeof entry === 'object' && typeof entry.tool === 'string'
            ? entry.tool
            : 'unknown';
        return { index, tool, status: 'running' };
      });

      // Emit initial "all running" snapshot.
      if (onProgress) {
        onProgress([...subToolStates], 0, totalCount);
      }

      const results = await Promise.all(
        selectedToolCalls.map(async (entry, index) => {
          if (!entry || typeof entry !== 'object') {
            const progress: BatchSubToolProgress = {
              index,
              tool: 'unknown',
              status: 'error',
              output: `Invalid batch tool call at index ${index}`,
              isError: true,
            };
            subToolStates[index] = progress;
            if (onProgress) {
              const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
              onProgress([...subToolStates], completedCount, totalCount);
            }
            return {
              tool: 'unknown',
              isError: true,
              output: `Invalid batch tool call at index ${index}`,
            };
          }

          const tool = typeof entry.tool === 'string' ? entry.tool : '';
          const parameters =
            entry.parameters && typeof entry.parameters === 'object' ? entry.parameters : null;
          if (!tool || !parameters) {
            const progress: BatchSubToolProgress = {
              index,
              tool: tool || 'unknown',
              status: 'error',
              output: `Batch entry ${index} requires tool and object-shaped parameters`,
              isError: true,
            };
            subToolStates[index] = progress;
            if (onProgress) {
              const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
              onProgress([...subToolStates], completedCount, totalCount);
            }
            return {
              tool: tool || 'unknown',
              isError: true,
              output: `Batch entry ${index} requires tool and object-shaped parameters`,
            };
          }

          if (BATCH_TOOL_DISALLOWED.has(tool)) {
            const progress: BatchSubToolProgress = {
              index,
              tool,
              status: 'skipped',
              output: `Tool "${tool}" cannot be called from batch`,
              isError: true,
            };
            subToolStates[index] = progress;
            if (onProgress) {
              const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
              onProgress([...subToolStates], completedCount, totalCount);
            }
            return {
              tool,
              isError: true,
              output: `Tool "${tool}" cannot be called from batch`,
            };
          }

          const subStartAt = Date.now();
          const subRequest: ToolCallRequest = {
            toolCallId: `${request.toolCallId}:${index}`,
            toolName: tool,
            rawInput: parameters,
          };
          // Per-sub-call execution context that injects a partial-output
          // wrapper. When a streaming-capable dispatcher (bash) calls
          // onPartialOutput with the rolling stdout snapshot, we stitch
          // that into subToolStates[index].partialOutput and fan out via
          // onProgress so the SSE channel (and ultimately the UI) sees
          // live terminal output for in-flight sub-tools.
          const subExecutionContext: SandboxExecutionContext = {
            ...(executionContext ?? {}),
            onPartialOutput: (text: string) => {
              const current = subToolStates[index];
              // Only patch if the sub-tool is still in `running` state —
              // a late chunk arriving after we've already written the
              // final progress entry must not clobber the completed
              // result.
              if (!current || current.status !== 'running') return;
              subToolStates[index] = { ...current, partialOutput: text };
              if (onProgress) {
                const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
                onProgress([...subToolStates], completedCount, totalCount);
              }
            },
          };
          // Per-sub-call resilience: `sandbox.execute` is a large recursive
          // dispatcher and not every branch normalizes a failure into
          // `{ isError: true }` — some throw (validation, provider, fs, mcp).
          // This runs inside `Promise.all(...)`, so a single throwing sub-tool
          // would reject the whole batch and discard every sibling's result,
          // defeating the batch tool's purpose. Catch per sub-call and degrade
          // to an error result so the rest of the batch still completes.
          let subResult: ToolCallResult;
          try {
            subResult = await sandbox.execute(subRequest, signal, sessionId, subExecutionContext);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(
              `[batch] 子工具 ${tool}（#${index}）执行抛错，已降级为错误结果：${message}`,
            );
            const failProgress: BatchSubToolProgress = {
              index,
              tool,
              status: 'error',
              output: `Batch sub-tool "${tool}" threw: ${message}`,
              isError: true,
              durationMs: Date.now() - subStartAt,
            };
            subToolStates[index] = failProgress;
            if (onProgress) {
              const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
              onProgress([...subToolStates], completedCount, totalCount);
            }
            return {
              tool,
              isError: true,
              output: `Batch sub-tool "${tool}" threw: ${message}`,
            };
          }
          if (!pendingRequestId && subResult.pendingPermissionRequestId) {
            pendingRequestId = subResult.pendingPermissionRequestId;
          }

          const progress: BatchSubToolProgress = {
            index,
            tool,
            status: subResult.isError ? 'error' : 'completed',
            output: subResult.output,
            // partialOutput intentionally omitted — the final `output`
            // supersedes it and the UI should switch to the real card.
            isError: subResult.isError,
            durationMs: Date.now() - subStartAt,
          };
          subToolStates[index] = progress;
          if (onProgress) {
            const completedCount = subToolStates.filter((s) => s.status !== 'running').length;
            onProgress([...subToolStates], completedCount, totalCount);
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
          droppedEntry && typeof droppedEntry === 'object' && typeof droppedEntry.tool === 'string'
            ? droppedEntry.tool
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

      const effective = getEffectiveSkillsForSession(sessionId) ?? undefined;
      const skillTool = createSkillTool(sessionId, userId, { effective });
      const parsed = skillTool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
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
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      // `description` is now optional in the schema — models commonly
      // omit it since `prompt` already carries the full intent. We
      // derive a short fallback from the prompt's first 40 chars so
      // downstream consumers (task graph, session title, display
      // messages) always have a non-empty label.
      const effectiveTaskDescription = parsed.data.description ?? parsed.data.prompt.slice(0, 40);

      const taskManager = new AgentTaskManagerImpl();
      const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, sessionId);
      const parentEffective = getEffectiveSkillsForSession(sessionId) ?? undefined;
      const resolvedAgent = resolveDelegatedAgent(userId, parsed.data, {
        parentEffective,
      });
      if (resolvedAgent.droppedSkills.length > 0) {
        // Audit only — do not block delegation. Spec calls for a single-line
        // visibility log so observability can spot mis-configured filters.
        console.warn(
          `[task-delegate] dropped skills outside effective set: parentSession=${sessionId} dropped=${resolvedAgent.droppedSkills.join(',')}`,
        );
      }
      const selectedDelegatedModel = selectDelegatedModelForUser(
        userId,
        resolvedAgent.modelEntries,
      );
      const parentSessionRow = sqliteGet<{ metadata_json: string }>(
        'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, userId],
      );
      const parentSessionMetadata = parentSessionRow
        ? parseSessionMetadataJson(parentSessionRow.metadata_json)
        : {};
      const teamRoleBinding = findTeamRoleBindingForAgent(
        parentSessionMetadata,
        resolvedAgent.agentId,
      );
      const delegatedModel = teamRoleBinding
        ? {
            modelId:
              teamRoleBinding.modelId ??
              selectedDelegatedModel?.modelId ??
              resolvedAgent.modelEntries[0]?.modelId ??
              teamRoleBinding.agentId,
            ...(teamRoleBinding.providerId
              ? { providerId: teamRoleBinding.providerId }
              : selectedDelegatedModel?.providerId
                ? { providerId: selectedDelegatedModel.providerId }
                : {}),
            ...(teamRoleBinding.variant
              ? { variant: teamRoleBinding.variant }
              : resolvedAgent.modelVariant
                ? { variant: resolvedAgent.modelVariant }
                : selectedDelegatedModel?.variant
                  ? { variant: selectedDelegatedModel.variant }
                  : {}),
          }
        : selectedDelegatedModel
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
      const childSessionTitle = `${effectiveTaskDescription} (@${resolvedAgent.agentId})`;
      const childRequestData = buildDelegatedChildRequestData({
        agentId: resolvedAgent.agentId,
        childSessionId,
        executionContext,
        modelSelection: delegatedModel,
        prompt: parsed.data.prompt,
        systemPrompt: resolvedAgent.systemPrompt,
        userId,
      });
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
        childSessionMetadata.modelId = delegatedModel.modelId;
      }
      if (delegatedModel?.providerId) {
        childSessionMetadata.providerId = delegatedModel.providerId;
      }
      if (delegatedModel?.variant) {
        childSessionMetadata.variant = delegatedModel.variant;
      }
      if (parentToolReference) {
        childSessionMetadata[TASK_PARENT_TOOL_REQUEST_ID_KEY] = parentToolReference.clientRequestId;
        childSessionMetadata[TASK_PARENT_TOOL_CALL_ID_KEY] = parentToolReference.toolCallId;
      }
      if (category) {
        childSessionMetadata.taskCategory = category;
      }
      const inheritedWorkingDirectory = parentSessionMetadata.workingDirectory;
      if (typeof inheritedWorkingDirectory === 'string') {
        childSessionMetadata.workingDirectory = inheritedWorkingDirectory;
      }
      const inheritedDialogueMode = parentSessionMetadata.dialogueMode;
      if (typeof inheritedDialogueMode === 'string') {
        childSessionMetadata.dialogueMode = inheritedDialogueMode;
      }
      const inheritedUpstreamRetryMaxRetries =
        normalizeUpstreamRetryMaxRetries(childRequestData?.[UPSTREAM_RETRY_MAX_RETRIES_KEY]) ??
        normalizeUpstreamRetryMaxRetries(parentSessionMetadata[UPSTREAM_RETRY_MAX_RETRIES_KEY]);
      if (inheritedUpstreamRetryMaxRetries !== undefined) {
        childSessionMetadata[UPSTREAM_RETRY_MAX_RETRIES_KEY] = inheritedUpstreamRetryMaxRetries;
      }
      const existingChildSession = sqliteGet<{
        id: string;
        metadata_json: string;
      }>('SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1', [
        childSessionId,
        userId,
      ]);
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
          mergedMetadata = {
            ...parsedExistingMetadata,
            ...childSessionMetadata,
          };
        } catch {
          mergedMetadata = childSessionMetadata;
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
          reason: readChildSessionTerminalReason(getSessionMetadata(childSessionId)),
          result: taskState.result,
          sessionId: childSessionId,
          status: mapTaskStatusToToolOutputStatus(taskState.status),
          taskId: taskState.taskId,
          timeoutSource: readChildSessionTimeoutSource(getSessionMetadata(childSessionId)),
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
                description: effectiveTaskDescription,
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
          title: effectiveTaskDescription,
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
          label: effectiveTaskDescription,
          status: shouldRunInBackground || canExecuteImmediately ? 'in_progress' : 'pending',
          assignedAgent: resolvedAgent.agentId,
          ...(category ? { category } : {}),
          ...(requestedSkills.length > 0 ? { requestedSkills } : {}),
          sessionId: childSessionId,
          parentSessionId: sessionId,
        });

        if (shouldRunInBackground && childRequestData) {
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
              taskTitle: effectiveTaskDescription,
              userId,
            });
          }, 0);
        }

        if (!shouldRunInBackground && childRequestData) {
          await runChildTaskSessionInBackground({
            assignedAgent: resolvedAgent.agentId,
            childSessionId,
            childTaskId: resumableTask.id,
            parentToolReference,
            parentSessionId: sessionId,
            requestData: childRequestData,
            requestedSkills,
            taskCategory: category,
            taskTitle: effectiveTaskDescription,
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
              description: effectiveTaskDescription,
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
        title: effectiveTaskDescription,
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
        label: effectiveTaskDescription,
        status: shouldRunInBackground ? 'in_progress' : 'pending',
        assignedAgent: resolvedAgent.agentId,
        ...(category ? { category } : {}),
        ...(requestedSkills.length > 0 ? { requestedSkills } : {}),
        sessionId: childSessionId,
        parentSessionId: sessionId,
      });

      if (shouldRunInBackground && childRequestData) {
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
            taskTitle: effectiveTaskDescription,
            userId,
          });
        }, 0);
      }

      if (!shouldRunInBackground && childRequestData) {
        await runChildTaskSessionInBackground({
          assignedAgent: resolvedAgent.agentId,
          childSessionId,
          childTaskId: childTask.id,
          parentToolReference,
          parentSessionId: sessionId,
          requestData: childRequestData,
          requestedSkills,
          taskCategory: category,
          taskTitle: effectiveTaskDescription,
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
            reason: readChildSessionTerminalReason(getSessionMetadata(childSessionId)),
            result: refreshedTask.result,
            sessionId: childSessionId,
            status: mapTaskStatusToToolOutputStatus(refreshedTask.status),
            taskId: refreshedTask.id,
            timeoutSource: readChildSessionTimeoutSource(getSessionMetadata(childSessionId)),
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
            description: effectiveTaskDescription,
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

      const childMessages = listSessionMessages({
        sessionId: childSessionId,
        userId,
      });
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
        reason: readChildSessionTerminalReason(getSessionMetadata(childSessionId)),
        result: childDisplayText || task.result || getChildSessionSummary(childSessionId, userId),
        sessionId: childSessionId,
        status: mapTaskStatusToToolOutputStatus(task.status),
        taskId: task.id,
        timeoutSource: readChildSessionTimeoutSource(getSessionMetadata(childSessionId)),
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

      // Resolve owner user id for session_terminals bookkeeping. Falls
      // back to the session row if the execution context didn't thread
      // a userId explicitly (e.g. some non-stream call paths).
      const ownerUserId = executionContext?.userId ?? getSessionOwnerUserId(sessionId) ?? undefined;

      const output = await runBashCommand(parsed.data, {
        signal,
        ...(executionContext?.onPartialOutput
          ? { onPartialOutput: executionContext.onPartialOutput }
          : {}),
        ...(ownerUserId
          ? {
              tracking: {
                sessionId,
                userId: ownerUserId,
                toolName: 'bash',
                kind: 'foreground' as const,
                ...(executionContext?.clientRequestId
                  ? { clientRequestId: executionContext.clientRequestId }
                  : {}),
                ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
                ...(parsed.data.description
                  ? { description: parsed.data.description }
                  : { description: deriveBashDescription(parsed.data.command) }),
              },
            }
          : {}),
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: output.exitCode !== 0,
        durationMs: 0,
      };
    }

    if (request.toolName === 'interactive_bash') {
      const parsedTmux = interactiveBashToolDefinition.inputSchema.safeParse(rawInput);
      if (!parsedTmux.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatValidationIssues(parsedTmux.error.issues),
          isError: true,
          durationMs: 0,
        };
      }
      const ownerUserId = executionContext?.userId ?? getSessionOwnerUserId(sessionId) ?? undefined;
      const output = await runInteractiveBashCommand(
        parsedTmux.data.tmux_command,
        ownerUserId
          ? {
              sessionId,
              userId: ownerUserId,
              ...(executionContext?.clientRequestId
                ? { clientRequestId: executionContext.clientRequestId }
                : {}),
              toolCallId: request.toolCallId,
            }
          : undefined,
      );
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: typeof output === 'string' && output.startsWith('Error:'),
        durationMs: 0,
      };
    }

    if (request.toolName === 'run_bash_in_background') {
      const ownerUserId = executionContext?.userId ?? getSessionOwnerUserId(sessionId) ?? undefined;
      if (!ownerUserId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: 'run_bash_in_background 无法解析会话 owner，请稍后再试。',
          isError: true,
          durationMs: 0,
        };
      }
      const result = await dispatchRunBashInBackground({
        context: {
          sessionId,
          userId: ownerUserId,
          ...(executionContext?.clientRequestId
            ? { clientRequestId: executionContext.clientRequestId }
            : {}),
          toolCallId: request.toolCallId,
        },
        rawInput,
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: result.ok ? result.output : result.error,
        isError: !result.ok,
        durationMs: 0,
      };
    }

    if (request.toolName === 'bash_output') {
      const ownerUserId = executionContext?.userId ?? getSessionOwnerUserId(sessionId) ?? undefined;
      if (!ownerUserId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: 'bash_output 无法解析会话 owner，请稍后再试。',
          isError: true,
          durationMs: 0,
        };
      }
      const result = dispatchBashOutput({
        context: {
          sessionId,
          userId: ownerUserId,
          ...(executionContext?.clientRequestId
            ? { clientRequestId: executionContext.clientRequestId }
            : {}),
          toolCallId: request.toolCallId,
        },
        rawInput,
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: result.ok ? result.output : result.error,
        isError: !result.ok,
        durationMs: 0,
      };
    }

    if (request.toolName === 'bash_kill') {
      const ownerUserId = executionContext?.userId ?? getSessionOwnerUserId(sessionId) ?? undefined;
      if (!ownerUserId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: 'bash_kill 无法解析会话 owner，请稍后再试。',
          isError: true,
          durationMs: 0,
        };
      }
      const result = dispatchBashKill({
        context: {
          sessionId,
          userId: ownerUserId,
          ...(executionContext?.clientRequestId
            ? { clientRequestId: executionContext.clientRequestId }
            : {}),
          toolCallId: request.toolCallId,
        },
        rawInput,
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: result.ok ? result.output : result.error,
        isError: !result.ok,
        durationMs: 0,
      };
    }

    // ─── L1.2.3 Builtin Instructions Dispatch ─────────────────────────────
    // 如果 toolName 匹配某个已注册的内置指令，走 invokeInstruction 路径。
    // 这是五层架构"每层专属 LLM-facing 函数工具"的执行入口。
    // 只有 session.role_layer 属于五层之一时才尝试（普通 chat session 不走这里）。
    {
      const sessionRow = sqliteGet<{ role_layer: string | null; user_id: string }>(
        `SELECT role_layer, user_id FROM sessions WHERE id = ? LIMIT 1`,
        [sessionId],
      );
      if (
        sessionRow?.role_layer &&
        ['reception', 'pm1', 'pm2', 'executor', 'reviewer'].includes(sessionRow.role_layer)
      ) {
        const { getInstruction, invokeInstruction } =
          await import('../handoff/capability/builtin-instructions.js');
        const layer = sessionRow.role_layer as
          | 'reception'
          | 'pm1'
          | 'pm2'
          | 'executor'
          | 'reviewer';
        const inst = getInstruction(request.toolName, layer);
        if (inst) {
          const userId = sessionRow.user_id ?? executionContext?.userId ?? '';
          const result = await invokeInstruction({
            ctx: {
              callerLayer: layer,
              sessionId,
              userId,
            },
            instructionName: request.toolName,
            rawArgs: rawInput,
          });
          return {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output: result.ok
              ? result.message + (result.data ? `\n${JSON.stringify(result.data)}` : '')
              : `❌ ${result.message}`,
            isError: !result.ok,
            durationMs: 0,
          };
        }
      }
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
  errorMessage?: string;
  parentSessionId: string;
  reason?: string;
  requestedSkills?: string[];
  result?: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  taskId: string;
  taskTitle: string;
  timeoutSource?: ChildSessionTimeoutSource;
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
    ...(input.timeoutSource ? { timeoutSource: input.timeoutSource } : {}),
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
  const messages = listSessionMessages({
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const startIndex = input.sinceMessageId
    ? messages.findIndex((message) => message.id === input.sinceMessageId)
    : -1;
  const sliced = startIndex >= 0 ? messages.slice(startIndex + 1) : messages;
  const filtered = sliced
    .map((message) => ({
      ...message,
      content: input.includeToolResults
        ? message.content
        : message.content.filter((part) => part.type !== 'tool_result'),
    }))
    .filter((message) => message.content.length > 0);
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
    (typeof childMetadata.subagentType === 'string' ? childMetadata.subagentType : 'task');
  const category =
    typeof childMetadata.taskCategory === 'string' ? childMetadata.taskCategory : undefined;
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
    typeof input.requestData.clientRequestId === 'string'
      ? input.requestData.clientRequestId
      : undefined;
  const firstResponseTimeoutMs = getTaskChildFirstResponseTimeoutMs();
  const firstResponseRetryMaxRetries = getTaskChildFirstResponseRetryMaxRetries(input.requestData);

  try {
    const { runSessionInBackground } = await import('../routes/stream-runtime.js');
    let finalResult: TaskBackgroundRunResult | null = null;

    for (let attempt = 0; attempt <= firstResponseRetryMaxRetries; attempt += 1) {
      let pendingInteraction = false;
      let firstActivityReceived = false;
      let firstActivityTimedOut = false;
      const firstResponseTimer = setTimeout(() => {
        firstActivityTimedOut = true;
        void stopAnyInFlightStreamRequestForSession({
          sessionId: input.childSessionId,
          userId: input.userId,
        });
      }, firstResponseTimeoutMs);
      const markFirstActivityReceived = () => {
        if (firstActivityReceived) {
          return;
        }

        firstActivityReceived = true;
        clearTimeout(firstResponseTimer);
      };

      try {
        const result = await runSessionInBackground({
          onStarted: markFirstActivityReceived,
          requestData: input.requestData,
          sessionId: input.childSessionId,
          userId: input.userId,
          writeChunk: (chunk: RunEvent) => {
            if (
              isChildSessionFirstResponseEvent(chunk, firstActivityTimedOut, firstActivityReceived)
            ) {
              markFirstActivityReceived();
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

        if (firstActivityTimedOut && !firstActivityReceived) {
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
            timeoutSource: 'first_response',
            userId: input.userId,
          });
          finalResult = {
            pendingInteraction: false,
            reason: 'timeout',
            statusCode: 504,
            summary: `子代理在 ${firstResponseTimeoutMs}ms 内未启动或返回可见活动，已重试 ${attempt} 次后停止。`,
          };
          break;
        }

        const statusCode =
          result.stopReason === 'error' && result.statusCode < 400 ? 500 : result.statusCode;
        const childSummary = getChildSessionSummary(input.childSessionId, input.userId);
        finalResult = {
          pendingInteraction,
          statusCode,
          summary:
            statusCode >= 400 && childSummary.length === 0
              ? (result.errorSummary ?? '子代理执行失败：未产生可用结果。')
              : childSummary,
        };
        break;
      } catch (error) {
        clearTimeout(firstResponseTimer);

        if (firstActivityTimedOut && !firstActivityReceived) {
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
            timeoutSource: 'first_response',
            userId: input.userId,
          });
          finalResult = {
            pendingInteraction: false,
            reason: 'timeout',
            statusCode: 504,
            summary: `子代理在 ${firstResponseTimeoutMs}ms 内未启动或返回可见活动，已重试 ${attempt} 次后停止。`,
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

    await finalizeChildTaskRunSafely({
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
    await finalizeChildTaskRunSafely({
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

function isIgnorableChildFinalizeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('database is not open') ||
    (typeof (error as { code?: unknown }).code === 'string' &&
      (error as { code?: string }).code === 'ERR_INVALID_STATE')
  );
}

async function finalizeChildTaskRunSafely(
  input: Parameters<typeof finalizeChildTaskRun>[0],
): Promise<void> {
  try {
    await finalizeChildTaskRun(input);
  } catch (error) {
    if (isIgnorableChildFinalizeError(error)) {
      return;
    }
    throw error;
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
  if (input.result.reason) {
    writeChildSessionTerminalReason({
      childSessionId: input.childSessionId,
      reason: input.result.reason,
      timeoutSource:
        input.result.reason === 'timeout'
          ? readChildSessionTimeoutSource(getSessionMetadata(input.childSessionId))
          : undefined,
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
    const timeoutSource = readChildSessionTimeoutSource(childMetadata);
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
      timeoutSource,
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
        errorMessage: task.errorMessage,
        parentSessionId: input.parentSessionId,
        reason: terminalReason,
        requestedSkills: input.requestedSkills,
        result: task.result,
        status: terminalUpdateStatus,
        taskId: task.id,
        taskTitle: input.taskTitle,
        timeoutSource,
      }),
    );
    return;
  }

  if (input.result.pendingInteraction) {
    const resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
      childSessionId: input.childSessionId,
      userId: input.userId,
    });
    if (resolvedByParent) {
      return;
    }

    input.taskManager.updateTask(graph, task.id, {
      result: summary,
    });
    await input.taskManager.save(graph);
    const nextTask = graph.tasks[input.childTaskId] ?? task;
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

  const didChildRunFail = input.result.statusCode >= 400;
  if (task.status === 'running') {
    if (didChildRunFail) {
      input.taskManager.failTask(graph, task.id, summary);
    } else {
      input.taskManager.completeTask(graph, task.id, summary);
    }
  } else {
    input.taskManager.updateTask(graph, task.id, {
      errorMessage: didChildRunFail ? summary : undefined,
      result: didChildRunFail ? task.result : summary,
    });
  }

  await input.taskManager.save(graph);
  const nextTask = graph.tasks[input.childTaskId];
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
  return metadata.planMode === true;
}

function buildToolObservability(input: {
  canonicalToolName: string;
  metadata: Record<string, unknown>;
  presentedToolName: string;
}): NonNullable<PermissionRequestPayload['observability']> {
  return {
    presentedToolName: input.presentedToolName,
    canonicalToolName: input.canonicalToolName,
    adapterVersion: '1.0.0',
  };
}

function findApprovedPermission(
  sessionId: string,
  toolName: string,
  scope: string,
): PermissionApprovalRow | null {
  const userId = getSessionOwnerUserId(sessionId);
  // Pull every still-approved row for this category visible to this session.
  // `findApprovedPermission` runs once per tool call; the per-session row
  // count is bounded by user prompts so a full scan + JS-side wildcard
  // matching is cheaper and safer than encoding glob semantics in SQL.
  const candidates = sqliteAll<PermissionApprovalCandidateRow>(
    `SELECT pr.id, pr.decision, pr.scope, pr.always_json
     FROM permission_requests pr
     JOIN sessions s ON s.id = pr.session_id
     WHERE pr.tool_name = ?
       AND pr.status = 'approved'
       AND (
         (pr.session_id = ? AND pr.decision IN ('once', 'session'))
         OR (s.user_id = ? AND pr.decision = 'permanent')
       )
     ORDER BY pr.updated_at DESC, pr.created_at DESC`,
    [toolName, sessionId, userId],
  );
  for (const row of candidates) {
    if (approvalCoversScope(row, scope)) {
      return { id: row.id, decision: row.decision };
    }
  }

  // Session lineage: inherit session-level approvals from parent session.
  // Mirrors opencode's session lineage auto-accept behavior.
  const parentRow = sqliteGet<{ parent_id: string }>(
    `SELECT parent_id FROM sessions WHERE id = ? AND parent_id IS NOT NULL`,
    [sessionId],
  );
  if (parentRow?.parent_id) {
    const parentCandidates = sqliteAll<PermissionApprovalCandidateRow>(
      `SELECT pr.id, pr.decision, pr.scope, pr.always_json
       FROM permission_requests pr
       WHERE pr.tool_name = ?
         AND pr.session_id = ?
         AND pr.status = 'approved'
         AND pr.decision = 'session'
       ORDER BY pr.updated_at DESC, pr.created_at DESC`,
      [toolName, parentRow.parent_id],
    );
    for (const row of parentCandidates) {
      if (approvalCoversScope(row, scope)) {
        return { id: row.id, decision: row.decision };
      }
    }
  }

  return null;
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
    const timeoutMs = resolvePermissionRequestTimeoutMs();
    return typeof timeoutMs === 'number' ? Date.now() + timeoutMs : null;
  })();
  sqliteRun(
    `INSERT INTO permission_requests
     (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
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
      JSON.stringify(context.always),
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
      ...(context.always && context.always.length > 0 ? { always: context.always } : {}),
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
      null,
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

function resolveEffectivePermissionAction(
  toolName: string,
  scope: string,
  workspaceRules: PermissionRule[],
): PermissionAction {
  // Map raw tool name to permission category (e.g. 'workspace_write_file' → 'write').
  // Evaluate default rules first, then workspace rules on top (last-match-wins).
  const category = resolvePermissionCategory(toolName);
  return evaluatePermissionRules(category, scope, DEFAULT_PERMISSION_RULES, workspaceRules).action;
}

function ensurePermissionForTool(
  sessionId: string,
  request: ToolCallRequest,
  observability: PermissionRequestPayload['observability'] | undefined,
  executionContext?: SandboxExecutionContext,
): PermissionState {
  // Rule engine: evaluate default rules + workspace rules (last-match-wins).
  // Users override defaults via .openawork.permissions.json.
  const sessionMetadata = getSessionMetadata(sessionId);
  const isTaskCreatedSession = sessionMetadata.createdByTool === 'task';
  const explicitWorkingDirectory =
    typeof sessionMetadata.workingDirectory === 'string'
      ? String(sessionMetadata.workingDirectory)
      : null;
  const workspaceRoot = explicitWorkingDirectory
    ? getSessionWorkspaceRoot(sessionId)
    : isTaskCreatedSession
      ? null
      : getSessionWorkspaceRoot(sessionId);
  const workspaceRules = workspaceRoot ? loadWorkspacePermissionRules(workspaceRoot) : [];

  // Pre-check with wildcard scope: skip context building for globally allowed tools.
  const toolLevelAction = resolveEffectivePermissionAction(request.toolName, '*', workspaceRules);
  if (toolLevelAction === 'allow') {
    return { kind: 'not_needed' };
  }
  if (toolLevelAction === 'deny') {
    return {
      kind: 'denied',
      reason: `工具 "${request.toolName}" 被权限规则禁止。`,
    };
  }

  // 'ask' → build permission context for scope-specific evaluation.
  const context = buildPermissionRequestContext(sessionId, request);
  if (!context) {
    return { kind: 'not_needed' };
  }

  // Re-evaluate with the actual scope for fine-grained rules.
  const scopedAction = resolveEffectivePermissionAction(
    request.toolName,
    context.scope,
    workspaceRules,
  );
  if (scopedAction === 'allow') {
    return {
      kind: 'approved',
      requestId: 'workspace-rule',
      decision: 'permanent',
    };
  }
  if (scopedAction === 'deny') {
    return {
      kind: 'denied',
      reason: `工具 "${request.toolName}" 在作用域 "${context.scope}" 被权限规则禁止。`,
    };
  }

  // Use category ID for all permission lookup/storage so that tools in the
  // same category (e.g. edit, apply_patch, workspace_review_revert → 'edit')
  // share a single approval and don't prompt the user repeatedly.
  const category = resolvePermissionCategory(request.toolName);

  if (shouldAutoApproveToolForSessionMetadata(request.toolName, sessionMetadata)) {
    return {
      kind: 'approved',
      requestId: 'channel-policy',
      decision: 'session',
    };
  }

  if (workspaceRoot && hasWorkspacePermanentPermission(sessionId, category, context.scope)) {
    return {
      kind: 'approved',
      requestId: 'workspace-policy',
      decision: 'permanent',
    };
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

  const approved = findApprovedPermission(sessionId, category, context.scope);
  if (approved) {
    return {
      kind: 'approved',
      requestId: approved.id,
      decision: approved.decision,
    };
  }

  const pendingRequestId = findPendingPermission(sessionId, category, context.scope);
  if (pendingRequestId) {
    if (requestPayload) {
      updatePendingPermissionPayload(pendingRequestId, requestPayload);
    }
    return { kind: 'pending', requestId: pendingRequestId, created: false };
  }

  return {
    kind: 'pending',
    requestId: createPendingPermissionRequest(sessionId, category, context, requestPayload),
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

  /**
   * Register an array of dynamic tool definitions (from dynamic-tool-loader).
   * Each entry is converted to a ToolDefinition and whitelisted.
   */
  registerDynamicTools(entries: DynamicToolEntry[]): void {
    for (const entry of entries) {
      const toolDef = dynamicEntryToToolDefinition(entry);
      this.registry.register(toolDef as unknown as ToolDefinition);
      this.whitelist.add(entry.name);
    }
  }

  async execute(
    request: ToolCallRequest,
    signal: AbortSignal,
    sessionId: string,
    executionContext?: SandboxExecutionContext,
  ): Promise<ToolCallResult> {
    // Rewrite legacy `workspace_*` names to their canonical equivalents
    // before any other dispatch step. The canonical tools are the only
    // ones registered with the sandbox now.
    const legacyRewrite = rewriteLegacyToolRequest(request.toolName, request.rawInput);
    const incomingRequest: ToolCallRequest = legacyRewrite.rewritten
      ? { ...request, toolName: legacyRewrite.toolName, rawInput: legacyRewrite.rawInput }
      : request;

    const dispatchedRequest = dispatchClaudeCodeTool(
      incomingRequest.toolName,
      (incomingRequest.rawInput &&
      typeof incomingRequest.rawInput === 'object' &&
      !Array.isArray(incomingRequest.rawInput)
        ? incomingRequest.rawInput
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

    // Flat MCP tools (PR-C) are dynamic — their names are constructed
    // at request time from `(serverId, toolName)` pairs that the gateway
    // discovered after listing the user's MCP servers, so they can't
    // appear in the static `TOOL_WHITELIST`. Treat any name that
    // parses as `mcp__<serverId>__<toolName>` as implicitly whitelisted;
    // downstream permission gating (`buildPermissionRequestContext`)
    // and execution (`executeGatewayManagedTool`) still validate that
    // the server is configured and enabled for this user.
    const isFlatMcpTool = parseFlatMcpToolName(normalizedRequest.toolName) !== null;

    if (!isFlatMcpTool && !this.whitelist.has(normalizedRequest.toolName)) {
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
        (typeof rawInput.path === 'string' ? rawInput.path : undefined) ??
        (typeof rawInput.filePath === 'string' ? rawInput.filePath : undefined);
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
    if (permissionState.kind === 'denied') {
      const result: ToolCallResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: permissionState.reason,
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
        isError: true,
        durationMs: 0,
      });
      return result;
    }

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

    const toolPartOwnerUserId = getSessionOwnerUserId(sessionId);
    if (toolPartOwnerUserId) {
      transitionToolToRunning({
        sessionId,
        userId: toolPartOwnerUserId,
        callID: request.toolCallId,
        title: request.toolName,
      });
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

export interface CreateDefaultSandboxOptions {
  /**
   * When supplied, the sandbox registers a user-aware `websearch`
   * tool that consults the persisted `WEBSEARCH_POLICY_KEY` row
   * before falling back to the legacy single-provider call. Callers
   * that have no user context (verification scripts, ad-hoc tools)
   * keep the legacy registration so behaviour is unchanged.
   */
  userId?: string;
}

export function createDefaultSandbox(
  allowedTools: string[] = [],
  options: CreateDefaultSandboxOptions = {},
): ToolSandbox {
  const editTool = createEditTool('__sandbox__', '__sandbox__', '__sandbox__');
  const sandbox = new ToolSandbox({
    allowedTools: [...allowedTools, ...TOOL_WHITELIST],
    defaultTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  });
  // P2-WEBSEARCH: when we know the caller, swap in the factory
  // variant that consults `user_settings.websearch_policy` and falls
  // back to the legacy single-provider path otherwise. The resolver
  // is invoked per-call so a `PUT /settings/websearch` takes effect
  // for the very next tool invocation without rebuilding sandboxes.
  if (options.userId) {
    const userId = options.userId;
    const userAwareWebsearchTool = createWebsearchTool({
      resolveMultiConfig: () => {
        try {
          const row = sqliteGet<{ value: string }>(
            `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
            [userId, WEBSEARCH_POLICY_KEY],
          );
          if (!row?.value) return null;
          let parsed: unknown;
          try {
            parsed = JSON.parse(row.value);
          } catch {
            return null;
          }
          const policy = readWebsearchPolicy(parsed);
          // `readWebsearchPolicy` always returns a defaulted shape;
          // we only forward to the multi-call path when the user
          // actually opted in (≥1 provider configured).
          if (policy.providers.length === 0) return null;
          return {
            providers: policy.providers,
            rolloutMode: policy.rolloutMode,
            ...(policy.timeoutMs !== undefined ? { timeoutMs: policy.timeoutMs } : {}),
          };
        } catch (err) {
          console.warn('[websearch-policy] resolve failed —', String(err));
          return null;
        }
      },
    });
    sandbox.register<
      typeof userAwareWebsearchTool.inputSchema,
      typeof userAwareWebsearchTool.outputSchema
    >(userAwareWebsearchTool);
  } else {
    sandbox.register<typeof websearchTool.inputSchema, typeof websearchTool.outputSchema>(
      websearchTool,
    );
  }
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
  const multiEditTool = createMultiEditTool('__sandbox__', '__sandbox__', '__sandbox__');
  sandbox.register<typeof multiEditTool.inputSchema, typeof multiEditTool.outputSchema>(
    multiEditTool,
  );
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
  sandbox.register<typeof listTool.inputSchema, typeof listTool.outputSchema>(listTool);
  sandbox.register<typeof readTool.inputSchema, typeof readTool.outputSchema>(readTool);
  sandbox.register<typeof globTool.inputSchema, typeof globTool.outputSchema>(globTool);
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
  sandbox.register<typeof writeTool.inputSchema, typeof writeTool.outputSchema>(writeTool);
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
  sandbox.register<
    typeof repoCloneToolDefinition.inputSchema,
    typeof repoCloneToolDefinition.outputSchema
  >(repoCloneToolDefinition);
  sandbox.register<
    typeof repoOverviewToolDefinition.inputSchema,
    typeof repoOverviewToolDefinition.outputSchema
  >(repoOverviewToolDefinition);
  return sandbox;
}
