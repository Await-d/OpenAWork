import { randomUUID } from 'node:crypto';
import type { ToolCallRequest, ToolCallResult, ToolDefinition } from '@openAwork/agent-core';
import {
  AgentTaskManagerImpl,
  AUTO_EDIT_EXCLUDED_TOOLS,
  AUTO_EDIT_PERMISSION_CATEGORIES,
  defaultIgnoreManager,
  lspDiagnosticsTool,
  lspTouchTool,
  PERMISSION_CATEGORIES,
  resolvePermissionCategory,
  resolveSessionPermissionMode,
  ToolNotFoundError,
  ToolRegistry,
  ToolTimeoutError,
  ToolValidationError,
} from '@openAwork/agent-core';
import type { BatchSubToolProgress, RunEvent } from '@openAwork/shared';
import type { ZodTypeAny } from 'zod';
import { applyPatchToolDefinition, executeApplyPatch } from './apply-patch-tools.js';
import {
  astGrepReplaceToolDefinition,
  astGrepSearchToolDefinition,
  executeAstGrepReplace,
} from './ast-grep-tools.js';
import { writeAuditLog } from '../infra/audit-log.js';
import {
  backgroundCancelToolDefinition,
  backgroundOutputToolDefinition,
} from './background-task-tools.js';
import { bashToolDefinition, deriveBashDescription, runBashCommand } from './bash-tools.js';
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
import {
  CHANNEL_TOOL_DEFINITIONS,
  CHANNEL_TOOL_NAME_SET,
  executeChannelTool,
} from './channel-tools.js';
import {
  CODEGRAPH_TOOL_DEFINITIONS,
  CODEGRAPH_TOOL_NAME_SET,
  executeCodegraphTool,
  markCodegraphFilesStaleBestEffort,
} from './codegraph-tools.js';
import { dispatchClaudeCodeTool } from '../claude-code/claude-code-tool-dispatch.js';
import { codesearchToolDefinition } from './codesearch-tools.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { isTeamRoleLayer } from '../handoff/capability/apply-team-layer-tools.js';
import { resolveSessionTurnClientRequestId } from '../handoff/store/handoff-store.js';
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
import {
  desktopAutomationManager,
  desktopAutomationToolDefinition,
  runDesktopAutomationTool,
} from './desktop-automation.js';
import {
  desktopControlManager,
  desktopControlToolDefinition,
  runDesktopControlTool,
} from './desktop-control.js';
import {
  computerUseToolDefinition,
  runComputerUseToolWithScreenshot,
} from './gui/computer-use-tool.js';
import {
  createDesktopScreenshotArtifactToolResult,
  readDesktopControlScreenshotPayload,
} from './desktop-screenshot-artifact.js';
import {
  isDesktopAutomationPluginEnabledForUser,
  isDesktopControlPluginEnabledForUser,
} from './plugin-tool-settings.js';
import type { DynamicToolEntry } from './dynamic-tool-loader.js';
import { dynamicEntryToToolDefinition } from './dynamic-tool-loader.js';
import { createEditTool } from './edit-tools.js';
import { executeGenerateImageTool, generateImageToolDefinition } from './image-generation-tool.js';
import { convertMediaToolDefinition, executeConvertMediaTool } from './convert-media-tool.js';
import {
  executeExtractMediaInfoTool,
  extractMediaInfoToolDefinition,
} from './extract-media-info-tool.js';
import {
  executeExtractVideoFrameTool,
  extractVideoFrameToolDefinition,
} from './extract-video-frame-tool.js';
import { executeGenerateAudioTool, generateAudioToolDefinition } from './generate-audio-tool.js';
import {
  interactiveBashToolDefinition,
  runInteractiveBashCommand,
} from './interactive-bash-tools.js';
import { lookAtToolDefinition, runLookAtTool } from './look-at-tools.js';
import { repoCloneToolDefinition } from './repo-clone-tools.js';
import { repoOverviewToolDefinition } from './repo-overview-tools.js';
import { lspManager } from '../lsp/router.js';
import {
  executeLspRename,
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
import type { McpSessionScope } from '../mcp/mcp-server-authorization.js';
import { isBuiltinInstructionName } from '../handoff/capability/layer-capabilities.js';
import { TOOLSET_TO_TOOL_NAMES } from '../handoff/capability/toolset-gate.js';
import {
  dispatchPermissionEvaluate,
  dispatchToolExecuteAfter,
  dispatchToolExecuteBefore,
  type PermissionEvaluateEvent,
} from '../runtime/plugin-host.js';
import {
  classifySshRemoteToolPolicy,
  executeSshRemoteTool,
  formatSshBlockedToolMessage,
  formatSshUnavailableToolMessage,
  resolveSshRemoteExecutionContext,
  type SshRemoteResolution,
} from './ssh-remote-execution.js';
import { callMcpToolForSession, listMcpToolsForSession } from '../mcp/mcp-runtime.js';
import { parseMcpCallRawInput, parseMcpListToolsRawInput } from '../mcp/mcp-tool-input.js';
import { transitionToolToRunning } from '../message/message-store-v2.js';
import {
  appendSessionMessageV2 as appendSessionMessage,
  deleteSessionMessagesByRequestScope,
  getLatestReferencedToolResult,
  getSessionToolResultByCallId,
  getSessionToolResultByReference,
  listSessionMessagesV2 as listSessionMessages,
  listSessionMessagesByRequestScope,
} from '../message/message-v2-adapter.js';
import { createMultiEditTool } from './multi-edit-tool.js';
import {
  approvalCoversScope,
  type PermissionApprovalCandidateRow,
} from '../permission/permission-approval-match.js';
import { findMatchingPermissionGrant } from '../permission/permission-grants-store.js';
import {
  type PermissionDecision,
  resolvePermissionRequestTimeoutMs,
} from '../permission/permission-contract.js';
import {
  evaluatePermissionRules,
  loadWorkspacePermissionRules,
  type PermissionAction,
  type PermissionRule,
} from '../permission/permission-rules.js';
import {
  buildToolPermissionRequestContext,
  type PermissionRequestContext,
} from '../permission/tool-permission-derivers.js';
import {
  buildExitPlanModeQuestionInput,
  enterPlanModeToolDefinition,
  exitPlanModeToolDefinition,
} from './plan-mode-tools.js';
import { resolveDelegatedTaskReasoningEffort } from '../task/task-thinking-effort.js';
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
import {
  runSessionMoveTool,
  runSessionRenameTool,
  sessionMoveToolDefinition,
  sessionRenameToolDefinition,
} from './session-management-tools.js';
import { modelSearchToolDefinition, runModelSearchTool } from './model-search-tools.js';
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
import {
  parseSessionMetadataJson,
  hasTeamDefinition,
} from '../session/session-workspace-metadata.js';
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
import { resolveTaskGraphProjectRoot } from '../task/task-graph-root.js';
import { selectDelegatedModelForUser } from '../task/task-model-selection.js';
import {
  completeInheritedParentModel,
  resolveInheritedParentModel,
  resolveSubagentModelPolicyForUser,
} from '../task/subagent-model-policy.js';
import {
  get as getTaskJob,
  settle as settleTaskJob,
  startBackground as startBackgroundTaskJob,
} from '../task/task-job.js';
import {
  clearTaskParentContext,
  upsertTaskParentContext,
} from '../task/task-parent-context-store.js';
import {
  buildTaskJobNoticeText,
  buildTaskJobNotificationId,
  deliverTaskCompletion,
} from '../task/task-job-delivery.js';
import { checkSubagentDepthAllowed } from '../task/subagent-depth.js';
import { tryResolveTaskPendingInteractionWithParent } from '../task/task-parent-auto-decision.js';
import { extractLatestChildSessionSummary } from '../task/task-result-extraction.js';
import { taskToolDefinition, isTaskToolName } from '../task/task-tools.js';
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
import { readToolPathInput } from './tool-path-aliases.js';
import { buildReadToolOutputResponse, readToolOutputToolDefinition } from './tool-output-tools.js';
import { buildToolResultContent, buildToolResultRunEvent } from './tool-result-contract.js';
import {
  DEFAULT_UPSTREAM_RETRY_MAX_RETRIES,
  normalizeUpstreamRetryMaxRetries,
  UPSTREAM_RETRY_MAX_RETRIES_KEY,
} from '../provider/upstream-retry-policy.js';
import { webfetchTool } from './web-tools.js';
import { invalidateWorkspaceFileIndexForToolCall } from '../workspace/workspace-file-index-invalidation.js';
import { injectDirectoryAgentsIntoReadResult } from '../session/directory-agents-injection.js';
import {
  assertSessionWorkspacePath,
  assertSessionWorkingDirectory,
  ensureIgnoreRulesLoadedForPath,
  getSessionWorkingDirectory,
  getSessionWorkspaceRoot,
  hasWorkspacePermanentPermission,
  requiresBoundSessionWorkspace,
  rewriteUnboundPlaceholderPath,
  validateSessionWorkspacePath,
} from '../workspace/workspace-safety.js';
import {
  executeWorkspaceCreateDirectory,
  executeWorkspaceReviewDiff,
  executeWorkspaceReviewRevert,
  executeWorkspaceReviewStatus,
  executeWriteTool,
  globTool,
  grepTool,
  listTool,
  readTool,
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

function normalizeWorkspaceManagedRawInput(
  sessionId: string,
  request: ToolCallRequest,
): ToolCallRequest | null {
  if (request.toolName === listTool.name) {
    const parsed = listTool.inputSchema.safeParse(request.rawInput);
    if (!parsed.success) {
      return null;
    }
    const path = readToolPathInput(parsed.data);
    if (!path) {
      return null;
    }
    return {
      ...request,
      rawInput: {
        ...parsed.data,
        path: assertSessionWorkspacePath({ path, sessionId, allowSkillResourceRead: true }),
      },
    };
  }

  if (request.toolName === readTool.name) {
    const parsed = readTool.inputSchema.safeParse(request.rawInput);
    if (!parsed.success) {
      return null;
    }
    const path = readToolPathInput(parsed.data);
    if (!path) {
      return null;
    }
    const normalizedPath = assertSessionWorkspacePath({
      path,
      sessionId,
      allowSkillResourceRead: true,
    });
    return {
      ...request,
      rawInput: {
        ...parsed.data,
        path: normalizedPath,
        ...(parsed.data.filePath !== undefined ? { filePath: normalizedPath } : {}),
      },
    };
  }

  if (request.toolName === globTool.name) {
    const parsed = globTool.inputSchema.safeParse(request.rawInput);
    if (!parsed.success) {
      return null;
    }
    return {
      ...request,
      rawInput: {
        ...parsed.data,
        ...(parsed.data.path
          ? {
              path: assertSessionWorkspacePath({
                path: parsed.data.path,
                sessionId,
                allowSkillResourceRead: true,
              }),
            }
          : { path: assertSessionWorkingDirectory(sessionId) }),
      },
    };
  }

  if (request.toolName === grepTool.name) {
    const parsed = grepTool.inputSchema.safeParse(request.rawInput);
    if (!parsed.success) {
      return null;
    }
    return {
      ...request,
      rawInput: {
        ...parsed.data,
        ...(parsed.data.path
          ? {
              path: assertSessionWorkspacePath({
                path: parsed.data.path,
                sessionId,
                allowSkillResourceRead: true,
              }),
            }
          : { path: assertSessionWorkingDirectory(sessionId) }),
      },
    };
  }

  return null;
}

const FILE_TOOLS = new Set([
  'edit',
  'glob',
  'grep',
  'list',
  'lsp_rename',
  'multi_edit',
  'read',
  'write',
  'workspace_create_directory',
  'workspace_review_diff',
  'workspace_review_status',
  'workspace_review_revert',
]);

/**
 * Workspace tools that only read: these may reach app-owned skill resource
 * roots outside the session workspace. Every other FILE_TOOLS entry keeps the
 * strict session-workspace containment check for both reads and writes.
 */
const READ_ONLY_WORKSPACE_TOOLS = new Set(['read', 'list', 'glob', 'grep']);

/**
 * Side-effect-free tools that may keep executing after a sibling pauses on a
 * permission request. Read-only siblings are order-independent, so running them
 * early is safe and preserves the user's batch instead of losing them to a
 * synthetic `[Tool execution was interrupted]` result.
 *
 * Everything else (write / edit / bash / task / MCP side effects …) is held back
 * until the pending approval resolves, preserving the model's `tool_use` order
 * semantics for anything that mutates state.
 */
const PERMISSION_SAFE_SIBLING_TOOLS = new Set([
  'read',
  'list',
  'glob',
  'grep',
  'webfetch',
  'websearch',
  'look_at',
  'lsp',
]);

export function isPermissionSafeSiblingTool(normalizedToolName: string): boolean {
  return PERMISSION_SAFE_SIBLING_TOOLS.has(normalizedToolName);
}

const SESSION_WORKSPACE_REQUIRED_TOOLS = new Set([
  'patch',
  'ast_grep_replace',
  'bash',
  'edit',
  'glob',
  'grep',
  'interactive_bash',
  'list',
  'lsp_rename',
  'multi_edit',
  'read',
  'run_bash_in_background',
  'workspace_create_directory',
  'workspace_review_diff',
  'workspace_review_status',
  'workspace_review_revert',
  'write',
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

export const TOOL_WHITELIST = new Set<string>([
  'patch',
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
  sessionRenameToolDefinition.name,
  sessionMoveToolDefinition.name,
  modelSearchToolDefinition.name,
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
  // multi_edit 与 edit/write 同属文件编辑家族，之前漏登记（靠 register() 运行时补进
  // 实例白名单才没暴露问题）；静态表补齐，visible/whitelist/category 三者对齐。
  'multi_edit',
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
  desktopControlToolDefinition.name,
  computerUseToolDefinition.name,
  'generate_image',
  convertMediaToolDefinition.name,
  extractMediaInfoToolDefinition.name,
  extractVideoFrameToolDefinition.name,
  generateAudioToolDefinition.name,
  repoCloneToolDefinition.name,
  repoOverviewToolDefinition.name,
  ...CHANNEL_TOOL_DEFINITIONS.map((tool) => tool.name),
  ...CODEGRAPH_TOOL_DEFINITIONS.map((tool) => tool.name),
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

type PermissionState =
  | { kind: 'approved'; decision: PermissionDecision; requestId: string }
  | { kind: 'denied'; reason: string }
  | { kind: 'pending'; requestId: string; created: boolean }
  | { kind: 'not_needed' };

async function loadTaskGraphForSession(taskManager: AgentTaskManagerImpl, graphSessionId: string) {
  return taskManager.loadOrCreate(resolveTaskGraphProjectRoot(graphSessionId), graphSessionId);
}

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

/**
 * One tool call that was blocked when the turn paused on a permission request.
 *
 * `blockedToolCalls[0]` is always the call that actually created/owns the
 * pending permission row; the remaining entries are the siblings that were
 * held back because they either needed approval themselves or were withheld
 * behind the pause (non read-only siblings after the first pending call).
 *
 * They are resumed together, in original `tool_use` order, so the next upstream
 * request carries the whole batch's `tool_result`s at once (prompt-cache friendly).
 */
interface BlockedToolCallPayload {
  toolCallId: string;
  toolName: string;
  rawInput: Record<string, unknown>;
}

interface PermissionRequestPayload {
  clientRequestId: string;
  nextRound: number;
  requestData: Record<string, unknown>;
  /** First blocked call — kept for backward compatibility with pre-batch payloads. */
  toolCallId: string;
  /** First blocked call input — kept for backward compatibility. */
  rawInput: Record<string, unknown>;
  /** Real (non-category) tool name of the first blocked call. */
  toolName?: string;
  /** All calls blocked by this pause, in `tool_use` order. */
  blockedToolCalls?: BlockedToolCallPayload[];
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

export const CHILD_SESSION_TERMINAL_REASON_KEY = 'terminalReason';
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
    roles: ['assistant', 'tool', 'synthetic'],
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
  const graph = await loadTaskGraphForSession(taskManager, input.graphSessionId);
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

  await settleChildTaskNotification({
    agent: taskEntry.assignedAgent ?? 'task',
    childSessionId: input.childSessionId,
    error: terminalErrorMessage,
    parentSessionId: input.graphSessionId,
    status: taskStatus,
    taskTitle: taskEntry.title ?? taskEntry.id,
    taskUpdatedAt: graph.tasks[input.taskId]?.updatedAt ?? Date.now(),
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

/**
 * 任务图节点归属的回合键：会话自身的真实回合键优先；子层内部运行键
 * （`handoff:` / `pm1:` / `pm2:`）继承活跃父 handoff 的回合键；普通 chat 会话
 * 无父 handoff，回退到当前 stream 请求键。两者都没有则返回 null。
 */
function resolveTaskGraphTurnClientRequestId(
  sessionId: string,
  executionContext: SandboxExecutionContext | undefined,
): string | null {
  return resolveSessionTurnClientRequestId(sessionId, executionContext?.clientRequestId);
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

function buildDelegatedChildRequestData(input: {
  agentId: string;
  category?: string;
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
  const baseRequestData =
    input.executionContext?.requestData && typeof input.executionContext.requestData === 'object'
      ? input.executionContext.requestData
      : {};

  const nextRequestData: Record<string, unknown> = {
    ...baseRequestData,
    thinkingEnabled: true,
    reasoningEffort: resolveDelegatedTaskReasoningEffort(input.category),
  };
  delete nextRequestData['thinking'];

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
function readSessionMcpScope(sessionId: string): {
  readonly isTeamSession: boolean;
  readonly requestedMcpServers: readonly string[];
} {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return { isTeamSession: false, requestedMcpServers: [] };
  const metadata = parseSessionMetadataJson(row.metadata_json ?? '{}');
  const candidate = metadata['requestedMcpServers'];
  const requestedMcpServers = Array.isArray(candidate)
    ? candidate.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  const roleInstance = metadata['teamRoleInstance'];
  const nestedRoleLayer =
    typeof roleInstance === 'object' && roleInstance !== null && 'roleLayer' in roleInstance
      ? roleInstance.roleLayer
      : undefined;
  const roleLayer = typeof metadata.roleLayer === 'string' ? metadata.roleLayer : nestedRoleLayer;
  return {
    isTeamSession: typeof roleLayer === 'string' && isTeamRoleLayer(roleLayer),
    requestedMcpServers,
  };
}

function buildSessionMcpExecutionScope(sessionId: string): McpSessionScope | undefined {
  const mcpScope = readSessionMcpScope(sessionId);
  if (mcpScope.requestedMcpServers.length > 0 || mcpScope.isTeamSession) {
    return { allowedServerIds: [...mcpScope.requestedMcpServers] };
  }
  return undefined;
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
  const graph = await loadTaskGraphForSession(taskManager, parentSessionId);
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

function formatSessionWorkspaceViolation(
  sessionId: string,
  path: string,
  reason: 'forbidden-path' | 'outside-session-workspace',
): string {
  if (reason === 'forbidden-path') {
    return `Forbidden workspace path: ${path}`;
  }
  const workingDirectory = getSessionWorkingDirectory(sessionId);
  return workingDirectory
    ? `目标路径超出当前工作区范围：${path}（当前工作区：${workingDirectory}）`
    : `目标路径超出当前工作区范围：${path}`;
}

function formatMissingSessionWorkspace(toolName: string): string {
  return `当前会话未绑定工作区，无法执行工具 "${toolName}"。请先设置 workingDirectory。`;
}

function hasWorkspaceScopedExecutionInput(request: ToolCallRequest): boolean {
  const rawInput = request.rawInput as Record<string, unknown>;
  switch (request.toolName) {
    case 'read':
    case 'list':
      return readToolPathInput(rawInput) !== undefined;
    case 'workspace_review_status':
    case 'workspace_review_diff':
    case 'write':
    case 'workspace_create_directory':
    case 'workspace_review_revert':
    case 'lsp_rename':
      return typeof rawInput.path === 'string' || typeof rawInput.filePath === 'string';
    case 'edit':
    case 'multi_edit':
      return typeof rawInput.filePath === 'string';
    case 'glob':
    case 'grep':
      return typeof rawInput.pattern === 'string' && rawInput.pattern.trim().length > 0;
    case 'patch':
      return typeof rawInput.patchText === 'string' && rawInput.patchText.trim().length > 0;
    case 'ast_grep_replace':
      return typeof rawInput.pattern === 'string' && rawInput.pattern.trim().length > 0;
    case 'bash':
    case 'run_bash_in_background':
      return typeof rawInput.command === 'string' && rawInput.command.trim().length > 0;
    case 'interactive_bash':
      return typeof rawInput.tmux_command === 'string' && rawInput.tmux_command.trim().length > 0;
    default:
      return true;
  }
}

function buildPermissionRequestContext(
  sessionId: string,
  request: ToolCallRequest,
  sshManaged = false,
): PermissionRequestContext | null {
  // 派生逻辑已下沉到 permission/tool-permission-derivers.ts：
  // 本函数只负责构造上下文并委托注册表，保留 flat-MCP 拦截与 default 兜底。
  return buildToolPermissionRequestContext({
    sessionId,
    toolName: request.toolName,
    rawInput: request.rawInput as Record<string, unknown>,
    sshManaged,
  });
}

/**
 * PR-D-Plugin hook handling: `tool.execute.before` is applied after
 * the requested tool name passes the whitelist / visibility gate and
 * before workspace validation, permission context building, execution,
 * and audit logging. Gateway-managed tools additionally run
 * `tool.execute.after` so plugins can observe or rewrite the output.
 *
 * The hook contracts mirror opencode
 * (`@/temp/opencode/packages/plugin/src/index.ts:170-200`):
 *   - `output.args` is mutated in place by the before hook; the
 *     sandbox replaces `request.rawInput` with the rewritten value
 *     before downstream safety gates and actual tool execution.
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
  sshResolution?: SshRemoteResolution | null,
): Promise<ToolCallResult | null> {
  const result = await executeGatewayManagedToolImpl(
    sandbox,
    sessionId,
    request,
    signal,
    observability,
    executionContext,
    sshResolution,
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
      args: request.rawInput,
    },
    afterOutput,
  );

  return {
    ...result,
    output: afterOutput.output,
    isError: afterOutput.metadata['isError'] === true,
  };
}

async function applyToolExecuteBeforeHook(
  sessionId: string,
  request: ToolCallRequest,
): Promise<ToolCallRequest> {
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
          rawInput: beforeOutput.args,
        };
  return effectiveRequest;
}

function isCodegraphUnavailableOutput(output: unknown): boolean {
  return (
    typeof output === 'object' &&
    output !== null &&
    'status' in output &&
    output.status === 'not_available'
  );
}

async function executeGatewayManagedToolImpl(
  sandbox: ToolSandbox,
  sessionId: string,
  request: ToolCallRequest,
  signal: AbortSignal,
  observability: PermissionRequestPayload['observability'] | undefined,
  executionContext?: SandboxExecutionContext,
  sshResolution?: SshRemoteResolution | null,
): Promise<ToolCallResult | null> {
  // SSH 远程会话：交由远端执行器处理（bash / read / write / edit /
  // multi_edit / list / glob / grep）。blocked 工具与连接不可用的情况
  // 已在外层 `execute()` 中提前拒绝，这里只会看到 kind === 'ready' 的远程
  // 工具请求；未绑定会话的 sshResolution 为 null 或 undefined。
  if (sshResolution?.kind === 'ready') {
    const remoteResult = await executeSshRemoteTool({
      request,
      sessionId,
      context: sshResolution.context,
    });
    if (remoteResult) return remoteResult;
  }

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

    if (CHANNEL_TOOL_NAME_SET.has(request.toolName)) {
      try {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: await executeChannelTool({
            rawInput,
            sessionId,
            signal,
            toolName: request.toolName,
          }),
          isError: false,
          durationMs: 0,
        };
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

    if (request.toolName === 'mcp_list_tools') {
      const { serverId } = parseMcpListToolsRawInput(rawInput);
      const mcpFilter = buildSessionMcpExecutionScope(sessionId) ?? {};
      const output = await listMcpToolsForSession(sessionId, {
        ...(serverId ? { serverId } : {}),
        ...mcpFilter,
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

      if (parsed.data.action === 'screenshot') {
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

        const screenshotResult = createDesktopScreenshotArtifactToolResult({
          userId,
          sessionId,
          toolCallId: request.toolCallId,
          screenshotPayload: await desktopAutomationManager.screenshot(),
          title: 'Desktop automation screenshot',
          summary: '已保存桌面自动化截图，完整图像已作为图片附件提供。',
          sourceKind: 'tool_desktop_automation_screenshot',
          createdByNote: 'desktop_automation screenshot',
        });
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: screenshotResult.output,
          attachments: screenshotResult.attachments,
          isError: false,
          durationMs: 0,
        };
      }

      // 运行环境层（`DESKTOP_AUTOMATION=1`）关闭时，manager 的 `assertEnabled()`
      // 会抛错；此处必须捕获并以结构化工具错误返回，否则异常会穿透沙箱分派
      // 打断整个工具回合（与 computer_use 分支的处理保持一致）。
      try {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: await runDesktopAutomationTool(parsed.data),
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

    if (request.toolName === desktopControlToolDefinition.name) {
      const parsed = desktopControlToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      if (parsed.data.action === 'screenshot') {
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

        const screenshotPayload = readDesktopControlScreenshotPayload(
          await desktopControlManager.screenshot(parsed.data),
        );
        if (!screenshotPayload) {
          return {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output: '系统桌面截图结果缺少可用的图像数据。',
            isError: true,
            durationMs: 0,
          };
        }

        const screenshotResult = createDesktopScreenshotArtifactToolResult({
          userId,
          sessionId,
          toolCallId: request.toolCallId,
          screenshotPayload,
          title: 'Desktop control screenshot',
          summary: '已保存系统桌面截图，完整图像已作为图片附件提供。',
          sourceKind: 'tool_desktop_control_screenshot',
          createdByNote: 'desktop_control screenshot',
        });
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: screenshotResult.output,
          attachments: screenshotResult.attachments,
          isError: false,
          durationMs: 0,
        };
      }

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: await runDesktopControlTool(parsed.data),
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === computerUseToolDefinition.name) {
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
      const parsed = computerUseToolDefinition.inputSchema.safeParse(rawInput ?? {});
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
        const computerUseResult = await runComputerUseToolWithScreenshot(parsed.data, {
          userId,
          sessionId,
          toolCallId: request.toolCallId,
          signal,
        });
        // G3：把最后一张截图转成 artifact，并以 attachments 回传（与 desktop_control 截图同范式）。
        const screenshot = computerUseResult.screenshot;
        if (screenshot) {
          try {
            const artifactResult = createDesktopScreenshotArtifactToolResult({
              userId,
              sessionId,
              toolCallId: request.toolCallId,
              screenshotPayload: screenshot.dataBase64.startsWith('data:')
                ? screenshot.dataBase64
                : `data:${screenshot.mediaType};base64,${screenshot.dataBase64}`,
              title: 'Computer use final screenshot',
              summary: 'GUI 任务结束时的屏幕画面已作为图片附件提供。',
              sourceKind: 'tool_desktop_control_screenshot',
              createdByNote: 'computer_use final screenshot',
            });
            return {
              toolCallId: request.toolCallId,
              toolName: request.toolName,
              output: computerUseResult.output,
              attachments: artifactResult.attachments,
              isError: false,
              durationMs: 0,
            };
          } catch {
            // artifact 生成失败不应让整个 GUI 任务算失败——降级为纯文本结果。
          }
        }
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: computerUseResult.output,
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

    if (request.toolName === sessionRenameToolDefinition.name) {
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
      const parsed = sessionRenameToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }
      const renamed = runSessionRenameTool(sessionId, userId, parsed.data);
      if (!renamed.ok) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: renamed.error,
          isError: true,
          durationMs: 0,
        };
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: { sessionID: renamed.sessionID, title: renamed.title },
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === sessionMoveToolDefinition.name) {
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
      const parsed = sessionMoveToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }
      const moved = runSessionMoveTool(sessionId, userId, parsed.data);
      if (!moved.ok) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: moved.error,
          isError: true,
          durationMs: 0,
        };
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: {
          sessionID: moved.sessionID,
          workingDirectory: moved.workingDirectory,
          changed: moved.changed,
          forced: moved.forced,
        },
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === modelSearchToolDefinition.name) {
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
      const parsed = modelSearchToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }
      const sessionMetadata = getSessionMetadata(sessionId);
      const ownProviderId =
        typeof sessionMetadata['providerId'] === 'string'
          ? sessionMetadata['providerId']
          : undefined;
      try {
        const output = await runModelSearchTool(userId, parsed.data, { ownProviderId });
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output,
          isError: false,
          durationMs: 0,
        };
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
        output: await runTaskCreateTool(
          sessionId,
          parsed.data,
          resolveTaskGraphTurnClientRequestId(sessionId, executionContext),
        ),
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
            ...(parsed.data.offset !== undefined ? { offset: parsed.data.offset } : {}),
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

    if (request.toolName === convertMediaToolDefinition.name) {
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
      const parsed = convertMediaToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }
      const convertStartAt = Date.now();
      const convertResult = await executeConvertMediaTool({
        signal,
        sessionId,
        userId,
        toolCallId: request.toolCallId,
        toolInput: parsed.data,
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: convertResult.output,
        isError: convertResult.isError,
        durationMs: Date.now() - convertStartAt,
      };
    }

    if (request.toolName === extractMediaInfoToolDefinition.name) {
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
      const parsed = extractMediaInfoToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }
      const probeStartAt = Date.now();
      const probeResult = await executeExtractMediaInfoTool({
        signal,
        sessionId,
        userId,
        toolInput: parsed.data,
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: probeResult.output,
        isError: probeResult.isError,
        durationMs: Date.now() - probeStartAt,
      };
    }

    if (request.toolName === extractVideoFrameToolDefinition.name) {
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
      const parsed = extractVideoFrameToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }
      const frameStartAt = Date.now();
      const frameResult = await executeExtractVideoFrameTool({
        signal,
        sessionId,
        userId,
        toolCallId: request.toolCallId,
        toolInput: parsed.data,
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: frameResult.output,
        isError: frameResult.isError,
        durationMs: Date.now() - frameStartAt,
      };
    }

    if (request.toolName === generateAudioToolDefinition.name) {
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
      const parsed = generateAudioToolDefinition.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }
      const audioStartAt = Date.now();
      const audioResult = await executeGenerateAudioTool({
        signal,
        sessionId,
        userId,
        toolCallId: request.toolCallId,
        toolInput: parsed.data,
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: audioResult.output,
        isError: audioResult.isError,
        durationMs: Date.now() - audioStartAt,
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

      if (executionContext?.userId && executionContext.userId !== userId) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: 'Current user does not own this session',
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
        : parsed.data.toolCallRef
          ? getSessionToolResultByReference({
              sessionId,
              userId,
              toolCallRef: parsed.data.toolCallRef,
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
          const output = await callMcpToolForSession(
            sessionId,
            {
              serverId: flatMcp.serverId,
              toolName: flatMcp.toolName,
              arguments: rawInput,
            },
            buildSessionMcpExecutionScope(sessionId),
          );
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

      try {
        const output = await callMcpToolForSession(
          sessionId,
          {
            serverId: parsed.serverId,
            toolName: parsed.toolName,
            arguments: parsed.arguments,
          },
          buildSessionMcpExecutionScope(sessionId),
        );
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output,
          isError: output.isError === true,
          durationMs: 0,
        };
      } catch (err) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: err instanceof Error ? err.message : String(err),
          isError: true,
          durationMs: 0,
        };
      }
    }

    if (request.toolName === workspaceReviewStatusTool.name) {
      const parsed = workspaceReviewStatusTool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await executeWorkspaceReviewStatus(parsed.data, sessionId);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === workspaceReviewDiffTool.name) {
      const parsed = workspaceReviewDiffTool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await executeWorkspaceReviewDiff(parsed.data, sessionId);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === workspaceCreateDirectoryTool.name) {
      const parsed = workspaceCreateDirectoryTool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await executeWorkspaceCreateDirectory(parsed.data, sessionId);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === workspaceReviewRevertTool.name) {
      const parsed = workspaceReviewRevertTool.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await executeWorkspaceReviewRevert(parsed.data, sessionId);
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (CODEGRAPH_TOOL_NAME_SET.has(request.toolName)) {
      const output = await executeCodegraphTool({
        sessionId,
        toolName: request.toolName,
        rawInput,
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: isCodegraphUnavailableOutput(output),
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
      await markCodegraphFilesStaleBestEffort({
        sessionId,
        files: [output.path],
        reason: 'edit',
      });
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
      await markCodegraphFilesStaleBestEffort({
        sessionId,
        files: [output.path],
        reason: 'multi_edit',
      });
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
        sessionId,
      });
      await markCodegraphFilesStaleBestEffort({
        sessionId,
        files: [output.path],
        reason: 'write',
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

      // 补丁是「先整体校验、再落盘」的两段式：解析 / 匹配失败属于模型可自愈
      // 的输入错误，必须以工具错误结果回传（模型据此换锚点重试），不能抛出
      // 异常中断整个回合。
      let output: Awaited<ReturnType<typeof executeApplyPatch>>;
      try {
        output = await executeApplyPatch(parsed.data, {
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
          sessionId,
        });
      } catch (error) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: error instanceof Error ? error.message : String(error),
          isError: true,
          durationMs: 0,
        };
      }
      await markCodegraphFilesStaleBestEffort({
        sessionId,
        files: output.files.map((file) => file.path),
        reason: 'patch',
      });
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === astGrepReplaceToolDefinition.name) {
      const parsed = astGrepReplaceToolDefinition.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await executeAstGrepReplace(
        parsed.data,
        assertSessionWorkingDirectory(sessionId),
      );
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output,
        isError: false,
        durationMs: 0,
      };
    }

    if (request.toolName === lspRenameToolDefinition.name) {
      const parsed = lspRenameToolDefinition.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
          isError: true,
          durationMs: 0,
        };
      }

      const output = await executeLspRename(parsed.data, assertSessionWorkingDirectory(sessionId));
      await markCodegraphFilesStaleBestEffort({
        sessionId,
        files: [parsed.data.filePath],
        reason: 'lsp_rename',
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

    if (isTaskToolName(request.toolName)) {
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
      const graph = await loadTaskGraphForSession(taskManager, sessionId);
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
      // 「子代理模型来源」策略：inherit-main 时用主对话当前模型替换自动选出的模型；
      // thinking 仍由 category 自动决定（buildDelegatedChildRequestData 不变）。
      // 团队模板是权威来源：team role binding 命中、或父会话带 teamDefinition 时不参与本策略，
      // 本设置只治理普通聊天派生的子代理。
      const subagentModelPolicy = resolveSubagentModelPolicyForUser(userId);
      const inheritedParentModelCandidate =
        !teamRoleBinding &&
        !hasTeamDefinition(parentSessionMetadata) &&
        subagentModelPolicy.modelMode === 'inherit-main'
          ? resolveInheritedParentModel({
              requestData: executionContext?.requestData,
              parentSessionMetadata,
            })
          : undefined;
      // 父轮请求可能只带 model：反查模型归属 provider，否则子会话流式解析会静默回落到聊天模型。
      const inheritedParentModel = inheritedParentModelCandidate
        ? completeInheritedParentModel(inheritedParentModelCandidate, (modelId) =>
            selectDelegatedModelForUser(userId, [modelId]),
          )
        : undefined;
      const effectiveDelegatedModel = inheritedParentModel ?? delegatedModel;
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
      // 子代理嵌套深度限制（对齐上游 `experimental.subagent_depth`，默认 1）。
      // 仅约束「新建子会话」；恢复既有子会话（session_id / task_id 命中）不受限，
      // 否则已完成的任务将无法被继续。
      const isResumingExistingChild = Boolean(resumableTask?.sessionId ?? requestedSessionId);
      if (!isResumingExistingChild) {
        const depthCheck = checkSubagentDepthAllowed({
          parentSessionId: sessionId,
          userId,
        });
        if (!depthCheck.allowed) {
          return {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output: depthCheck.message,
            isError: true,
            durationMs: 0,
          };
        }
      }
      const childSessionTitle = `${effectiveTaskDescription} (@${resolvedAgent.agentId})`;
      const childRequestData = buildDelegatedChildRequestData({
        agentId: resolvedAgent.agentId,
        ...(category ? { category } : {}),
        childSessionId,
        executionContext,
        modelSelection: effectiveDelegatedModel,
        prompt: parsed.data.prompt,
        systemPrompt: resolvedAgent.systemPrompt,
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
      const childSessionMetadata: Record<string, unknown> = {
        parentSessionId: sessionId,
        subagentType: resolvedAgent.agentId,
        createdByTool: 'task',
        delegatedPromptVersion: 'v2',
        delegatedSystemPrompt: resolvedAgent.systemPrompt,
        delegatedModelCandidates: resolvedAgent.modelCandidates,
        requestedSkills,
      };
      if (effectiveDelegatedModel?.modelId) {
        childSessionMetadata.modelId = effectiveDelegatedModel.modelId;
      }
      if (effectiveDelegatedModel?.providerId) {
        childSessionMetadata.providerId = effectiveDelegatedModel.providerId;
      }
      if (effectiveDelegatedModel?.variant) {
        childSessionMetadata.variant = effectiveDelegatedModel.variant;
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
      // 继承权限档位：子代理 session 在后台运行，无法与用户交互审批。
      // permissionMode 是规范键，仅在父会话确实表达过档位时才继承（已写规范键，
      // 或历史布尔 yoloMode === true）——auto-edit 父会话的子会话不得降级为 ask；
      // 父会话未表达时保持缺席（读取侧按 ask 兜底，不凭空写入）。
      // 旧布尔 yoloMode 同步保留，兼容仍直接读取它的历史消费方。
      if (
        parentSessionMetadata.permissionMode !== undefined ||
        parentSessionMetadata.yoloMode === true
      ) {
        childSessionMetadata.permissionMode = resolveSessionPermissionMode(parentSessionMetadata);
      }
      if (parentSessionMetadata.yoloMode === true) {
        childSessionMetadata.yoloMode = true;
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
        // 写入父会话上下文：子代理中途停下（待批准 / 待回答）时，
        // `task/task-parent-auto-decision.ts` 需要父会话的原始请求数据来构造父级决策请求。
        if (
          shouldRunInBackground &&
          parentToolReference !== undefined &&
          executionContext?.requestData !== undefined
        ) {
          upsertTaskParentContext({
            childSessionId,
            parentSessionId: sessionId,
            requestData: executionContext.requestData,
            taskId: resumableTask.id,
            userId,
          });
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
          registerBackgroundChildTask({
            assignedAgent: resolvedAgent.agentId,
            childSessionId,
            parentSessionId: sessionId,
            taskTitle: effectiveTaskDescription,
          });
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
          const refreshedGraph = await loadTaskGraphForSession(taskManager, sessionId);
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
        clientRequestId:
          resolveTaskGraphTurnClientRequestId(sessionId, executionContext) ?? undefined,
      });
      if (canExecuteImmediately) {
        taskManager.startTask(graph, childTask.id);
      }
      await taskManager.save(graph);
      // 同上前置条件：为父级决策路径留存父会话原始请求数据。
      if (
        shouldRunInBackground &&
        parentToolReference !== undefined &&
        executionContext?.requestData !== undefined
      ) {
        upsertTaskParentContext({
          childSessionId,
          parentSessionId: sessionId,
          requestData: executionContext.requestData,
          taskId: childTask.id,
          userId,
        });
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
        registerBackgroundChildTask({
          assignedAgent: resolvedAgent.agentId,
          childSessionId,
          parentSessionId: sessionId,
          taskTitle: effectiveTaskDescription,
        });
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
        const refreshedGraph = await loadTaskGraphForSession(taskManager, sessionId);
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
      let graph = await loadTaskGraphForSession(taskManager, sessionId);
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
        graph = await loadTaskGraphForSession(taskManager, sessionId);
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
        graph = await loadTaskGraphForSession(taskManager, sessionId);
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
      const graph = await loadTaskGraphForSession(taskManager, sessionId);
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
          taskManager,
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
        sessionId,
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
      const workingDirectory = assertSessionWorkingDirectory(sessionId);
      const ownerUserId = executionContext?.userId ?? getSessionOwnerUserId(sessionId) ?? undefined;
      const output = await runInteractiveBashCommand(parsedTmux.data.tmux_command, {
        sessionId,
        ...(ownerUserId ? { userId: ownerUserId } : {}),
        workingDirectory,
        ...(executionContext?.clientRequestId
          ? { clientRequestId: executionContext.clientRequestId }
          : {}),
        toolCallId: request.toolCallId,
      });
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
        // 幂等确保内置指令已注册（同 stream.ts 注入侧的理由）：执行侧若 REGISTRY 为空，
        // 即便工具被注入也会找不到 instruction 而无法执行。ESM 缓存保证重复 import 零成本。
        await import('../handoff/capability/builtin-instructions-impl.js');
        const { getInstruction, invokeInstruction } =
          await import('../handoff/capability/builtin-instructions.js');
        const layer = sessionRow.role_layer as
          'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';
        const inst = getInstruction(request.toolName, layer);
        if (inst) {
          const userId = sessionRow.user_id ?? executionContext?.userId ?? '';
          const result = await invokeInstruction({
            ctx: {
              callerLayer: layer,
              sessionId,
              userId,
              clientRequestId: executionContext?.clientRequestId ?? null,
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
    const graph = await loadTaskGraphForSession(taskManager, input.sessionId);
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
  taskManager: AgentTaskManagerImpl;
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

  await input.taskManager.save(input.graph);

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
  await settleChildTaskNotification({
    agent: taskEntry.assignedAgent ?? 'task',
    childSessionId,
    error: '子代理已被取消。',
    parentSessionId: input.graphSessionId,
    status: 'cancelled',
    taskTitle: taskEntry.title ?? taskEntry.id,
    taskUpdatedAt: input.graph.tasks[input.taskId]?.updatedAt ?? Date.now(),
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

async function settleChildTaskNotification(input: {
  agent: string;
  childSessionId: string;
  error: string;
  parentSessionId: string;
  status: 'failed' | 'cancelled';
  taskTitle: string;
  taskUpdatedAt: number;
  userId: string;
}): Promise<void> {
  const notificationId = buildTaskJobNotificationId({
    childSessionId: input.childSessionId,
    taskUpdatedAt: input.taskUpdatedAt,
  });
  settleTaskJob(input.childSessionId, {
    notificationId,
    status: input.status === 'cancelled' ? 'cancelled' : 'error',
    error: input.error,
  });
  await deliverTaskCompletion({
    agent: input.agent,
    childSessionId: input.childSessionId,
    description: input.taskTitle,
    notificationId,
    parentSessionId: input.parentSessionId,
    ...(input.status === 'cancelled' ? { resume: false } : {}),
    state: input.status,
    text: input.error,
    userId: input.userId,
  });
}

function registerBackgroundChildTask(input: {
  assignedAgent: string;
  childSessionId: string;
  parentSessionId: string;
  taskTitle: string;
}): void {
  startBackgroundTaskJob({
    id: input.childSessionId,
    title: input.taskTitle,
    recovery: {
      kind: 'subagent',
      parentSessionId: input.parentSessionId,
      childSessionId: input.childSessionId,
      agent: input.assignedAgent,
      description: input.taskTitle,
    },
  });
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

  const existingJob = getTaskJob(input.childSessionId);
  if (existingJob && existingJob.status !== 'running') {
    return;
  }
  const graph = await loadTaskGraphForSession(taskManager, input.parentSessionId);
  if (
    graph.tasks[input.childTaskId]?.status !== 'running' ||
    (existingJob && getTaskJob(input.childSessionId)?.status !== 'running')
  ) {
    return;
  }
  if (!existingJob) {
    registerBackgroundChildTask(input);
  }

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
            statusCode >= 400
              ? (result.errorSummary ?? (childSummary || '子代理执行失败：未产生可用结果。'))
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
    // 关库竞态：后台终结算器可能晚于 `closeDb()` 执行（网关关停 / 验收脚本收尾）。
    // ⚠️ 各运行时的措辞不同，必须都覆盖——只匹配一种会让「容忍」在另一种运行时**形同虚设**：
    //   - `database is not open`：旧运行时（迁移前）的措辞，保留兼容；
    //   - `Cannot use a closed database`：**bun:sqlite 的实际措辞**（迁移后曾漏配，
    //     导致本该被吞掉的竞态照样以 unhandled rejection 抛出、进程退出码为 1）。
    error.message.includes('database is not open') ||
    error.message.includes('Cannot use a closed database') ||
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

  const graph = await loadTaskGraphForSession(input.taskManager, input.parentSessionId);
  const task = graph.tasks[input.childTaskId];
  if (!task) {
    return;
  }

  if (task.status === 'cancelled' || task.status === 'failed' || task.status === 'completed') {
    const assignedAgent = task.assignedAgent ?? input.assignedAgent;
    const terminalOutputStatus = mapTaskStatusToToolOutputStatus(task.status);
    const terminalUpdateStatus = mapTaskStatusToUpdateStatus(task.status);
    const notificationId = buildTaskJobNotificationId({
      childSessionId: input.childSessionId,
      taskUpdatedAt: task.updatedAt,
    });
    settleTaskJob(input.childSessionId, {
      notificationId,
      status:
        task.status === 'completed'
          ? 'completed'
          : task.status === 'failed'
            ? 'error'
            : 'cancelled',
      ...(task.result ? { output: task.result } : {}),
      ...(task.errorMessage ? { error: task.errorMessage } : {}),
    });
    await input.taskManager.save(graph);
    await deliverTaskCompletion({
      agent: assignedAgent,
      childSessionId: input.childSessionId,
      description: input.taskTitle,
      notificationId,
      parentSessionId: input.parentSessionId,
      ...(task.status === 'cancelled' ? { resume: false } : {}),
      state:
        task.status === 'completed' ? 'done' : task.status === 'failed' ? 'failed' : 'cancelled',
      text: buildTaskJobNoticeText({
        errorMessage: task.errorMessage,
        result: task.result,
        summary,
      }),
      userId: input.userId,
    });
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

  const nextTask = graph.tasks[input.childTaskId];
  const eventStatus = mapTaskStatusToUpdateStatus(nextTask?.status ?? task.status);
  const nextAssignedAgent = nextTask?.assignedAgent ?? input.assignedAgent;
  const terminalToolOutputStatus = mapTaskStatusToToolOutputStatus(nextTask?.status ?? task.status);
  const notificationId = buildTaskJobNotificationId({
    childSessionId: input.childSessionId,
    taskUpdatedAt: nextTask?.updatedAt ?? task.updatedAt,
  });
  if (
    terminalToolOutputStatus === 'done' ||
    terminalToolOutputStatus === 'failed' ||
    terminalToolOutputStatus === 'cancelled'
  ) {
    settleTaskJob(input.childSessionId, {
      notificationId,
      status:
        terminalToolOutputStatus === 'done'
          ? 'completed'
          : terminalToolOutputStatus === 'failed'
            ? 'error'
            : 'cancelled',
      ...(nextTask?.result ? { output: nextTask.result } : {}),
      ...(nextTask?.errorMessage ? { error: nextTask.errorMessage } : {}),
    });
  }
  await input.taskManager.save(graph);
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
    // ── 单通道交付（T-25）：合成通知（幂等）+ 唤醒决策 ──────────────────
    // 取代旧的「伪造用户请求 + 定时重试」路径；忙时由交付层留库待消费。
    // 取消任务只投递通知、不唤醒（与旧语义一致）。
    await deliverTaskCompletion({
      agent: nextAssignedAgent,
      childSessionId: input.childSessionId,
      description: input.taskTitle,
      notificationId,
      parentSessionId: input.parentSessionId,
      ...(terminalToolOutputStatus === 'cancelled' ? { resume: false } : {}),
      state:
        terminalToolOutputStatus === 'done'
          ? 'done'
          : terminalToolOutputStatus === 'failed'
            ? 'failed'
            : 'cancelled',
      text: buildTaskJobNoticeText({
        errorMessage: nextTask?.errorMessage,
        result: nextTask?.result,
        summary,
      }),
      userId: input.userId,
    });
    // 任务已终态：父会话上下文不再需要（自动决策只在子代理中途停顿时读取）。
    clearTaskParentContext({
      childSessionId: input.childSessionId,
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

interface SessionRoleContextRow {
  handoff_state: string | null;
  role_layer: string | null;
  team_parent_session_id: string | null;
}

function getSessionRoleContext(sessionId: string): SessionRoleContextRow | null {
  return (
    sqliteGet<SessionRoleContextRow>(
      'SELECT role_layer, team_parent_session_id, handoff_state FROM sessions WHERE id = ? LIMIT 1',
      [sessionId],
    ) ?? null
  );
}

function hasTeamParentSessionId(row: SessionRoleContextRow): boolean {
  return (
    typeof row.team_parent_session_id === 'string' && row.team_parent_session_id.trim().length > 0
  );
}

function hasBackgroundTeamContext(row: SessionRoleContextRow): boolean {
  return (
    hasTeamParentSessionId(row) &&
    typeof row.handoff_state === 'string' &&
    row.handoff_state.trim().length > 0
  );
}

function isBackgroundAutoApprovedTeamSession(row: SessionRoleContextRow | null): boolean {
  if (!row) {
    return false;
  }

  const isTeamRole =
    row.role_layer === 'pm1' ||
    row.role_layer === 'pm2' ||
    row.role_layer === 'executor' ||
    row.role_layer === 'reviewer';

  return isTeamRole && hasBackgroundTeamContext(row);
}

const RECEPTION_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...TOOLSET_TO_TOOL_NAMES.read,
  ...TOOLSET_TO_TOOL_NAMES.web,
]);

// reception 只读白名单免审批：仅放行 read/web 类别工具，写入、Shell、LSP 改名等修改类
// 工具仍走 ask；显式 deny 在本分支之前求值（权限阶梯不变量），白名单只能跳过 ask，
// 永远无法放行被拒绝的调用。
function isReceptionReadOnlyToolAutoApproved(
  row: SessionRoleContextRow | null,
  toolName: string,
): boolean {
  if (!row) {
    return false;
  }

  return (
    row.role_layer === 'reception' &&
    hasTeamParentSessionId(row) &&
    RECEPTION_READ_ONLY_TOOL_NAMES.has(toolName)
  );
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
  // User-scoped durable permanent grants first: these survive the granting
  // session (unlike the session-owned `permission_requests` rows below), so a
  // brand-new session of the same user is still auto-approved.
  if (userId) {
    const grant = findMatchingPermissionGrant(userId, toolName, scope);
    if (grant) {
      return { id: grant.id, decision: 'permanent' };
    }
  }
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

/**
 * Merge the batch of calls blocked by a permission pause into the owning
 * pending request payload, so the approval resume can run all of them (in
 * `tool_use` order) instead of only the single call that created the request.
 *
 * Idempotent: entries are deduped by `toolCallId`, and the first entry is
 * mirrored onto the legacy `toolCallId` / `rawInput` / `toolName` fields.
 */
export function recordBlockedToolCallsForPendingRequest(
  requestId: string,
  calls: BlockedToolCallPayload[],
): void {
  if (calls.length === 0) return;
  const row = sqliteGet<{ request_payload_json: string | null }>(
    `SELECT request_payload_json FROM permission_requests WHERE id = ? AND status = 'pending' LIMIT 1`,
    [requestId],
  );
  if (!row?.request_payload_json) return;

  let payload: PermissionRequestPayload;
  try {
    payload = JSON.parse(row.request_payload_json) as PermissionRequestPayload;
  } catch {
    return;
  }

  const merged = new Map<string, BlockedToolCallPayload>();
  for (const call of payload.blockedToolCalls ?? []) merged.set(call.toolCallId, call);
  for (const call of calls) merged.set(call.toolCallId, call);
  const blockedToolCalls = [...merged.values()];
  const first = blockedToolCalls[0];
  if (!first) return;

  updatePendingPermissionPayload(requestId, {
    ...payload,
    toolCallId: first.toolCallId,
    toolName: first.toolName,
    rawInput: first.rawInput,
    blockedToolCalls,
  });
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

function resolveEffectivePermissionCategory(toolName: string): string {
  // 内置团队指令（reply_direct / route_to_orchestrate / dispatch_package ...）不是
  // 普通工具：它们由 apply-team-layer-tools 按层注入，真正的「能不能调」由下游
  // invokeInstruction → assertInstructionOwnedByLayer 按层把关（与本文件 whitelist /
  // session-enabled 门控处的同款豁免一致）。这里返回原始工具名，使其命中
  // DEFAULT_PERMISSION_RULES 的通配符 allow，保持 fail-closed 改造前的语义；
  // 否则未登记的指令会落到 custom(ask)，后台 team 会话无人可审批而被卡死。
  if (isBuiltinInstructionName(toolName)) return toolName;
  // Map raw tool name to permission category (e.g. 'multi_edit' → 'edit').
  return parseFlatMcpToolName(toolName) ? 'mcp_call' : resolvePermissionCategory(toolName);
}

function resolveEffectivePermissionAction(
  toolName: string,
  scope: string,
  workspaceRules: PermissionRule[],
): PermissionAction {
  // Evaluate default rules first, then workspace rules on top (last-match-wins).
  const category = resolveEffectivePermissionCategory(toolName);
  return evaluatePermissionRules(category, scope, DEFAULT_PERMISSION_RULES, workspaceRules).action;
}

/**
 * `permission.evaluate`（deny-only 后置裁决）的输入：内置权限阶梯最终结论的描述。
 *
 * `scope` 取与本次裁决最相关的资源——工具级通配符分支用 `'*'`，其余分支用派生的
 * 真实作用域（bash 命令串、工作区相对路径等）；`decision` 是进入 hook 时的内置
 * 结论：`allow` = 放行 / 免审批，`ask` = 将进入人工审批。
 */
interface PermissionEvaluationInput {
  sessionId: string;
  toolName: string;
  category: string;
  scope: string;
  decision: 'allow' | 'ask';
}

/**
 * 运行 `permission.evaluate` 后置裁决；返回非 null 表示本次调用被插件拒绝。
 *
 * 只有把 `effect` 设为 `'deny'` 才会被采纳，其它取值（包括试图改成 allow 的）
 * 一律忽略——插件只能把内置结论降级为拒绝，永远无法授权，deny-first 不变量
 * （显式 deny 优先于 yolo / auto-edit 等档位快捷分支）因此仍然成立。
 * 插件抛错由 `dispatchHook` 记录 warn 后继续，不会破坏本次请求。
 */
async function runPermissionEvaluateHook(
  input: PermissionEvaluationInput,
): Promise<{ kind: 'denied'; reason: string } | null> {
  const event: PermissionEvaluateEvent = {
    sessionID: input.sessionId,
    toolName: input.toolName,
    permission: input.category,
    scope: input.scope,
    decision: input.decision,
  };
  await dispatchPermissionEvaluate(event);
  if (event.effect !== 'deny') return null;
  const message = typeof event.message === 'string' ? event.message.trim() : '';
  return {
    kind: 'denied',
    reason: message || `工具 "${input.toolName}" 被插件权限策略（permission.evaluate）拒绝。`,
  };
}

/**
 * 先跑 deny-only 后置裁决，未被否决时保留内置结论。
 *
 * 所有「放行 / 免审批」分支都必须经过这里：hook 在规则、档位快捷分支
 * （yolo / auto-edit / 后台 team / reception）、渠道策略、workspace 永久规则、
 * saved approvals（含会话批准与父会话继承）全部判定之后运行，因此插件可以否决
 * 这些分支，但无法放行任何已被拒绝或未获批的调用。
 */
async function gatePermissionDecision(
  input: PermissionEvaluationInput,
  state: PermissionState,
): Promise<PermissionState> {
  return (await runPermissionEvaluateHook(input)) ?? state;
}

async function ensurePermissionForTool(
  sessionId: string,
  request: ToolCallRequest,
  observability: PermissionRequestPayload['observability'] | undefined,
  executionContext?: SandboxExecutionContext,
  sshManaged = false,
): Promise<PermissionState> {
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

  // Use category ID for all permission lookup/storage so that tools in the
  // same category (e.g. edit, patch, workspace_review_revert → 'edit')
  // share a single approval and don't prompt the user repeatedly.
  const category = resolveEffectivePermissionCategory(request.toolName);

  // deny-only 后置裁决（permission.evaluate）的公共输入；各分支只补 scope / decision。
  const evaluationBase = {
    sessionId,
    toolName: request.toolName,
    category,
  };

  // Pre-check with wildcard scope: skip context building for globally allowed tools.
  const toolLevelAction = resolveEffectivePermissionAction(request.toolName, '*', workspaceRules);
  if (toolLevelAction === 'allow') {
    return gatePermissionDecision(
      { ...evaluationBase, scope: '*', decision: 'allow' },
      { kind: 'not_needed' },
    );
  }
  if (toolLevelAction === 'deny') {
    // 已拒绝的早退路径不再调用 hook（插件只能降级，无法改变 deny）。
    return {
      kind: 'denied',
      reason: `工具 "${request.toolName}" 被权限规则禁止。`,
    };
  }

  // 'ask' → build permission context for scope-specific evaluation.
  const context = buildPermissionRequestContext(sessionId, request, sshManaged);
  if (!context) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: '*', decision: 'allow' },
      { kind: 'not_needed' },
    );
  }

  // Re-evaluate with the actual scope for fine-grained rules.
  const scopedAction = resolveEffectivePermissionAction(
    request.toolName,
    context.scope,
    workspaceRules,
  );
  if (scopedAction === 'allow') {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: 'workspace-rule',
        decision: 'permanent',
      },
    );
  }
  if (scopedAction === 'deny') {
    return {
      kind: 'denied',
      reason: `工具 "${request.toolName}" 在作用域 "${context.scope}" 被权限规则禁止。`,
    };
  }

  // Team session 自动批准修改类工具：
  // 后台运行的 team 成员（pm1/pm2/executor/reviewer）无法与用户交互审批，
  // 且父 session 已通过权限检查——子 session 继承信任链。
  // 同样适用于 yolo 档位的 session（用户已显式授权免审批）。
  //
  // 权限阶梯不变量：此免审批快捷分支只会在通配符 allow/deny 与作用域级
  // allow/deny 评估之后执行——显式 deny 已在上面两个分支提前返回，
  // 因此 auto-edit / yolo 只能跳过 ask，永远无法放行被 deny 的调用。
  const permissionMode = resolveSessionPermissionMode(sessionMetadata);
  const sessionRoleContext = getSessionRoleContext(sessionId);
  if (
    permissionMode === 'yolo' ||
    isBackgroundAutoApprovedTeamSession(sessionRoleContext) ||
    isReceptionReadOnlyToolAutoApproved(sessionRoleContext, request.toolName)
  ) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      { kind: 'not_needed' },
    );
  }

  // auto-edit 档位：仅自动放行文件编辑 / 写入类别（edit、write）。
  // bash、MCP、浏览器、桌面控制等其余类别仍走 ask；
  // 回滚类工具（AUTO_EDIT_EXCLUDED_TOOLS）保持人工确认。
  if (
    permissionMode === 'auto-edit' &&
    AUTO_EDIT_PERMISSION_CATEGORIES.has(category) &&
    !AUTO_EDIT_EXCLUDED_TOOLS.has(request.toolName)
  ) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      { kind: 'not_needed' },
    );
  }

  if (shouldAutoApproveToolForSessionMetadata(request.toolName, sessionMetadata)) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: 'channel-policy',
        decision: 'session',
      },
    );
  }

  if (workspaceRoot && hasWorkspacePermanentPermission(sessionId, category, context.scope)) {
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: 'workspace-policy',
        decision: 'permanent',
      },
    );
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
    return gatePermissionDecision(
      { ...evaluationBase, scope: context.scope, decision: 'allow' },
      {
        kind: 'approved',
        requestId: approved.id,
        decision: approved.decision,
      },
    );
  }

  // ask 阶段的最后一道裁决：必须先过 hook 再落 pending，否则被插件拒绝的调用
  // 会在 permission_requests 里留下一个无人应答的 pending 记录。
  const veto = await runPermissionEvaluateHook({
    ...evaluationBase,
    scope: context.scope,
    decision: 'ask',
  });
  if (veto) return veto;

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
      this.registry.register(toolDef);
      this.whitelist.add(entry.name);
    }
  }

  async execute(
    request: ToolCallRequest,
    signal: AbortSignal,
    sessionId: string,
    executionContext?: SandboxExecutionContext,
  ): Promise<ToolCallResult> {
    try {
      return await this.executeToolCall(request, signal, sessionId, executionContext);
    } finally {
      // 唯一的工具执行入口：agent 工具直接写盘，不经过 HTTP 路由，需在此按
      // 工具名补一次索引失效（含报错 / 取消路径）；只对可写工具生效，避免只读
      // 工具在长任务里强制下一次 `@` 查询全量重扫。
      invalidateWorkspaceFileIndexForToolCall(
        sessionId,
        rewriteLegacyToolRequest(request.toolName, request.rawInput).toolName,
      );
    }
  }

  private async executeToolCall(
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

    // Builtin team instructions (route_to_orchestrate / reply_direct /
    // submit_artifact / dispatch_package / ...) are injected per-layer by
    // `apply-team-layer-tools.ts` and dispatched downstream via
    // `invokeInstruction`, which enforces per-layer ownership
    // (`assertInstructionOwnedByLayer`). Their names aren't in the static
    // `TOOL_WHITELIST`, so — like flat MCP tools — treat them as implicitly
    // allowed here; otherwise the model is handed the tool but the gate
    // rejects the call with `is not allowed` before dispatch can run.
    const isBuiltinInstruction = isBuiltinInstructionName(normalizedRequest.toolName);

    if (
      !isFlatMcpTool &&
      !isBuiltinInstruction &&
      !this.whitelist.has(normalizedRequest.toolName)
    ) {
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
    if (
      !isBuiltinInstruction &&
      !isGatewayToolEnabledForSessionMetadata(normalizedRequest.toolName, sessionMetadata)
    ) {
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

    const effectiveRequest = await applyToolExecuteBeforeHook(sessionId, normalizedRequest);

    if (effectiveRequest.toolName === desktopControlToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      const output = userId
        ? '系统桌面控制插件未启用。请在设置 → 插件中启用后再使用 desktop_control。'
        : `Session owner not found for session ${sessionId}`;
      if (!userId || !isDesktopControlPluginEnabledForUser(userId)) {
        const result: ToolCallResult = {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output,
          isError: true,
          durationMs: 0,
        };
        writeAuditLog({
          sessionId,
          category: 'tool',
          sourceName: request.toolName,
          requestId: request.toolCallId,
          input: effectiveRequest.rawInput,
          output: result.output,
          isError: result.isError ?? false,
          durationMs: result.durationMs ?? null,
        });
        return result;
      }
    }

    // computer_use 与 desktop_control 共用「系统桌面控制」插件开关（T-14b）：
    // 二者本质都驱动系统桌面，启用/停用必须一致，不新增独立开关。
    if (effectiveRequest.toolName === computerUseToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      const output = userId
        ? '系统桌面控制插件未启用。请在设置 → 插件中启用后再使用 computer_use。'
        : `Session owner not found for session ${sessionId}`;
      if (!userId || !isDesktopControlPluginEnabledForUser(userId)) {
        const result: ToolCallResult = {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output,
          isError: true,
          durationMs: 0,
        };
        writeAuditLog({
          sessionId,
          category: 'tool',
          sourceName: request.toolName,
          requestId: request.toolCallId,
          input: effectiveRequest.rawInput,
          output: result.output,
          isError: result.isError ?? false,
          durationMs: result.durationMs ?? null,
        });
        return result;
      }
    }

    // desktop_automation 拥有独立于「系统桌面控制」的插件开关：即使运行环境
    // 已注入该工具（DESKTOP_AUTOMATION=1），用户级开关关闭时也必须在这里拒绝，
    // 避免直接调用 API 或历史会话绕过设置页配置。
    if (effectiveRequest.toolName === desktopAutomationToolDefinition.name) {
      const userId = getSessionOwnerUserId(sessionId);
      const output = userId
        ? '浏览器自动化插件未启用。请在设置 → 插件中启用后再使用 desktop_automation。'
        : `Session owner not found for session ${sessionId}`;
      if (!userId || !isDesktopAutomationPluginEnabledForUser(userId)) {
        const result: ToolCallResult = {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output,
          isError: true,
          durationMs: 0,
        };
        writeAuditLog({
          sessionId,
          category: 'tool',
          sourceName: request.toolName,
          requestId: request.toolCallId,
          input: effectiveRequest.rawInput,
          output: result.output,
          isError: result.isError ?? false,
          durationMs: result.durationMs ?? null,
        });
        return result;
      }
    }

    // SSH 远程会话：解析当前会话（或沿父会话链）的绑定关系。未绑定的会话在
    // 这里只产生一次内存 Map 查询 + 一次父链查询；非 SSH 管辖的工具
    // （unmanaged）完全不走这段逻辑，保持零额外开销。
    const sshToolPolicy = classifySshRemoteToolPolicy(effectiveRequest.toolName);
    const sshResolution: SshRemoteResolution | null =
      sshToolPolicy === 'unmanaged' ? null : await resolveSshRemoteExecutionContext(sessionId);
    const sshManaged = sshResolution !== null && sshResolution.kind !== 'unbound';

    // 绑定会话下：未实现远程执行的工作区/进程工具直接拒绝；连接不可用时所有
    // SSH 管辖工具都拒绝。二者均在权限流之前返回 —— 避免用户审批一个注定
    // 不会执行的调用，也避免任何"以为在改远端、实际改了本地"的静默回退。
    if (sshResolution?.kind === 'ready' && sshToolPolicy === 'blocked') {
      const result: ToolCallResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: formatSshBlockedToolMessage(effectiveRequest.toolName, sshResolution),
        isError: true,
        durationMs: 0,
      };
      writeAuditLog({
        sessionId,
        category: 'tool',
        sourceName: request.toolName,
        requestId: request.toolCallId,
        input: effectiveRequest.rawInput,
        output: result.output,
        isError: result.isError ?? false,
        durationMs: result.durationMs ?? null,
      });
      return result;
    }

    if (sshResolution?.kind === 'unavailable') {
      const result: ToolCallResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: formatSshUnavailableToolMessage(effectiveRequest.toolName, sshResolution),
        isError: true,
        durationMs: 0,
      };
      writeAuditLog({
        sessionId,
        category: 'tool',
        sourceName: request.toolName,
        requestId: request.toolCallId,
        input: effectiveRequest.rawInput,
        output: result.output,
        isError: result.isError ?? false,
        durationMs: result.durationMs ?? null,
      });
      return result;
    }

    if (
      SESSION_WORKSPACE_REQUIRED_TOOLS.has(effectiveRequest.toolName) &&
      hasWorkspaceScopedExecutionInput(effectiveRequest) &&
      requiresBoundSessionWorkspace(sessionId) &&
      !getSessionWorkingDirectory(sessionId) &&
      !sshManaged
    ) {
      const result: ToolCallResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: formatMissingSessionWorkspace(request.toolName),
        isError: true,
        durationMs: 0,
      };
      writeAuditLog({
        sessionId,
        category: 'tool',
        sourceName: request.toolName,
        requestId: request.toolCallId,
        input: effectiveRequest.rawInput,
        output: result.output,
        isError: result.isError ?? false,
        durationMs: result.durationMs ?? null,
      });
      return result;
    }

    if (FILE_TOOLS.has(effectiveRequest.toolName)) {
      const rawInput = effectiveRequest.rawInput as Record<string, unknown>;
      const filePath = readToolPathInput(rawInput);
      let safeFilePath: string | undefined;
      if (filePath) {
        // 仅未绑定：盘符根/占位路径先改写，再做会话范围校验。已绑定绝不改写。
        const effectiveFilePath = rewriteUnboundPlaceholderPath(sessionId, filePath);
        const validation = validateSessionWorkspacePath({
          path: effectiveFilePath,
          sessionId,
          allowSkillResourceRead: READ_ONLY_WORKSPACE_TOOLS.has(effectiveRequest.toolName),
        });
        if (!validation.ok) {
          const result: ToolCallResult = {
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            output: formatSessionWorkspaceViolation(
              sessionId,
              effectiveFilePath,
              validation.reason,
            ),
            isError: true,
            durationMs: 0,
          };
          writeAuditLog({
            sessionId,
            category: 'tool',
            sourceName: request.toolName,
            requestId: request.toolCallId,
            input: effectiveRequest.rawInput,
            output: result.output,
            isError: result.isError ?? false,
            durationMs: result.durationMs ?? null,
          });
          return result;
        }
        safeFilePath = validation.safePath;
        await ensureIgnoreRulesLoadedForPath(safeFilePath);
      }
      if (safeFilePath && defaultIgnoreManager.shouldIgnore(safeFilePath)) {
        const result: ToolCallResult = {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          output: `Access denied: file "${safeFilePath}" is protected by agentignore rules`,
          isError: true,
          durationMs: 0,
        };
        writeAuditLog({
          sessionId,
          category: 'tool',
          sourceName: request.toolName,
          requestId: request.toolCallId,
          input: effectiveRequest.rawInput,
          output: result.output,
          isError: result.isError ?? false,
          durationMs: result.durationMs ?? null,
        });
        return result;
      }
    }

    const permissionState = await ensurePermissionForTool(
      sessionId,
      effectiveRequest,
      toolObservability,
      executionContext,
      sshManaged,
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
        input: effectiveRequest.rawInput,
        output: result.output,
        isError: true,
        durationMs: 0,
      });
      return result;
    }

    if (permissionState.kind === 'pending') {
      const pendingMessage = permissionState.created
        ? `Tool "${request.toolName}" requires approval before it can run. Permission request ${permissionState.requestId} has been created. Ask the user to approve it, then retry.`
        : `Tool "${request.toolName}" is waiting for approval. Permission request ${permissionState.requestId} is still pending. Ask the user to approve it, then retry.`;
      const result: ToolCallResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: pendingMessage,
        isError: true,
        durationMs: 0,
        pendingPermissionRequestId: permissionState.requestId,
      };
      writeAuditLog({
        sessionId,
        category: 'tool',
        sourceName: request.toolName,
        requestId: request.toolCallId,
        input: effectiveRequest.rawInput,
        output: result.output,
        isError: false,
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
      effectiveRequest,
      signal,
      toolObservability,
      executionContext,
      sshResolution,
    );
    if (gatewayManagedResult) {
      gatewayManagedResult.toolName = request.toolName;
      writeAuditLog({
        sessionId,
        category: 'tool',
        sourceName: request.toolName,
        requestId: request.toolCallId,
        input: effectiveRequest.rawInput,
        output: gatewayManagedResult.output,
        isError: gatewayManagedResult.isError ?? false,
        durationMs: gatewayManagedResult.durationMs ?? null,
      });
      if (permissionState.kind === 'approved' && permissionState.decision === 'once') {
        consumeOncePermission(permissionState.requestId);
      }
      return gatewayManagedResult;
    }

    const tool = this.registry.get(effectiveRequest.toolName);
    if (tool && !tool.timeout) {
      const withTimeout = { ...tool, timeout: this.defaultTimeout };
      this.registry.register(withTimeout);
    }

    const startAt = Date.now();
    let result: ToolCallResult;
    try {
      const normalizedWorkspaceRequest =
        normalizeWorkspaceManagedRawInput(sessionId, effectiveRequest) ?? effectiveRequest;
      result = await this.registry.execute(normalizedWorkspaceRequest, signal);
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
      input: effectiveRequest.rawInput,
      output: result.output,
      isError: result.isError ?? false,
      durationMs: result.durationMs ?? null,
    });
    // read 成功后按需注入最近的 AGENTS.md 作为上下文指令（按「会话 + 路径」去重，
    // 失败不影响读取本身）。SSH 远程 read 走 executeGatewayManagedTool 提前返回，
    // 不会到达此处，符合「远程文件不注入本地指令」的预期。
    if (!result.isError && effectiveRequest.toolName === readTool.name) {
      try {
        result = await injectDirectoryAgentsIntoReadResult(result, {
          sessionId,
          workspaceRoot: getSessionWorkspaceRoot(sessionId),
        });
      } catch (error) {
        // 兜底：解析工作区根等前置步骤异常也不能让 read 失败。
        console.warn('[tool-sandbox] read 注入 AGENTS.md 失败，已跳过：', error);
      }
    }

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
