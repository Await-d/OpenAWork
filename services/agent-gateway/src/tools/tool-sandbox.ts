import type { ToolCallRequest, ToolCallResult, ToolDefinition } from '@openAwork/agent-core';
import {
  defaultIgnoreManager,
  ToolNotFoundError,
  ToolRegistry,
  ToolTimeoutError,
  ToolValidationError,
} from '@openAwork/agent-core';
import type { ZodTypeAny } from 'zod';
import { agentManageToolDefinition } from '../agent/agent-admin-tools.js';
import { dispatchClaudeCodeTool } from '../claude-code/claude-code-tool-dispatch.js';
import { scheduleManageToolDefinition } from '../cron/schedule-admin-tools.js';
import { isBuiltinInstructionName } from '../handoff/capability/layer-capabilities.js';
import { writeAuditLog } from '../infra/audit-log.js';
import { sqliteGet } from '../infra/db.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { mcpManageServersToolDefinition } from '../mcp/mcp-admin-tools.js';
import type {} from '../mcp/mcp-server-authorization.js';
import { parseFlatMcpToolName } from '../mcp/mcp-tool-naming.js';
import { memoryManageToolDefinition } from '../memory/memory-admin-tools.js';
import { transitionToolToRunning } from '../message/message-store-v2.js';
import { pluginManageToolDefinition } from '../plugin/plugin-admin-tools.js';
import { executePluginTool, getPluginToolRegistry } from '../plugin/tool-registry.js';
import { injectDirectoryAgentsIntoReadResult } from '../session/directory-agents-injection.js';
import {
  sessionInfoToolDefinition,
  sessionListToolDefinition,
  sessionReadToolDefinition,
  sessionSearchToolDefinition,
} from '../session/session-manager-tools.js';
import { isGatewayToolEnabledForSessionMetadata } from '../session/session-tool-visibility.js';
import { readToolInvokeAllowlist } from '../session/tool-invoke-allowlist.js';
import { skillManageToolDefinition } from '../skill/skill-admin-tools.js';
import { skillMcpToolDefinition } from '../skill/skill-mcp-tools.js';
import {
  taskCreateToolDefinition,
  taskGetToolDefinition,
  taskListToolDefinition,
  taskUpdateToolDefinition,
} from '../task/task-crud-tools.js';
import { isTaskToolName } from '../task/task-tools.js';
import { teamWorkspaceManageToolDefinition } from '../team/team-workspace-admin-tools.js';
import { invalidateWorkspaceFileIndexForToolCall } from '../workspace/workspace-file-index-invalidation.js';
import {
  ensureIgnoreRulesLoadedForPath,
  getSessionWorkingDirectory,
  getSessionWorkspaceRoot,
  requiresBoundSessionWorkspace,
  rewriteUnboundPlaceholderPath,
  validateSessionWorkspacePath,
} from '../workspace/workspace-safety.js';
import { applyPatchToolDefinition } from './apply-patch-tools.js';
import { astGrepReplaceToolDefinition } from './ast-grep-tools.js';
import { callOmoAgentToolDefinition } from './call-omo-agent-tools.js';
import { CHANNEL_TOOL_NAME_SET, executeChannelTool } from './channel-tools.js';
import { CODEGRAPH_TOOL_NAME_SET, executeCodegraphTool } from './codegraph-tools.js';
import { convertMediaToolDefinition } from './convert-media-tool.js';
import { desktopAutomationToolDefinition } from './desktop-automation.js';
import { desktopControlToolDefinition } from './desktop-control.js';
import type { DynamicToolEntry } from './dynamic-tool-loader.js';
import { dynamicEntryToToolDefinition } from './dynamic-tool-loader.js';
import { extractMediaInfoToolDefinition } from './extract-media-info-tool.js';
import { extractVideoFrameToolDefinition } from './extract-video-frame-tool.js';
import { generateAudioToolDefinition } from './generate-audio-tool.js';
import { computerUseToolDefinition } from './gui/computer-use-tool.js';
import { generateImageToolDefinition } from './image-generation-tool.js';
import { rewriteLegacyToolRequest } from './legacy-tool-name-rewrite.js';
import { lookAtToolDefinition } from './look-at-tools.js';
import { lspRenameToolDefinition } from './lsp-tools.js';
import { modelSearchToolDefinition } from './model-search-tools.js';
import { enterPlanModeToolDefinition, exitPlanModeToolDefinition } from './plan-mode-tools.js';
import {
  isDesktopAutomationPluginEnabledForUser,
  isDesktopControlPluginEnabledForUser,
} from './plugin-tool-settings.js';
import {
  buildTaskUpdateEvent,
  CHILD_SESSION_TERMINAL_REASON_KEY,
  clearTaskParentToolReference,
  readTaskParentToolReference,
  syncParentTaskToolResult,
  terminateChildSession,
} from './sandbox/child-session.js';
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  FILE_TOOLS,
  normalizeWorkspaceManagedRawInput,
  READ_ONLY_WORKSPACE_TOOLS,
  SESSION_WORKSPACE_REQUIRED_TOOLS,
  TOOL_WHITELIST,
} from './sandbox/whitelist.js';
import {
  sessionMoveToolDefinition,
  sessionRenameToolDefinition,
} from './session-management-tools.js';
import {
  classifySshRemoteToolPolicy,
  executeSshRemoteTool,
  formatSshBlockedToolMessage,
  formatSshUnavailableToolMessage,
  resolveSshRemoteExecutionContext,
  type SshRemoteResolution,
} from './ssh-remote-execution.js';
import { subTodoReadTool, subTodoWriteTool, todoReadTool, todoWriteTool } from './todo-tools.js';
import {
  resolveToolInvokeRequest,
  TOOL_INVOKE_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
} from './tool-folding.js';
import { readToolOutputToolDefinition } from './tool-output-tools.js';
import { readToolPathInput } from './tool-path-aliases.js';
import {
  readTool,
  workspaceCreateDirectoryTool,
  workspaceReviewDiffTool,
  workspaceReviewRevertTool,
  workspaceReviewStatusTool,
  writeTool,
} from './workspace-tools.js';
export {
  applyToolExecuteBeforeHook,
  buildPermissionRequestContext,
  formatMissingSessionWorkspace,
  formatSessionWorkspaceViolation,
  hasWorkspaceScopedExecutionInput,
  isCodegraphUnavailableOutput,
  resolveInvokeEffectiveToolName,
} from './sandbox/context.js';
export {
  consumeOncePermission,
  createPendingQuestionRequest,
  ensurePermissionForTool,
  findPendingQuestionRequest,
  recordBlockedToolCallsForPendingRequest,
  updatePendingQuestionPayload,
} from './sandbox/permission-ladder.js';
export {
  BACKGROUND_OUTPUT_MESSAGES_MAX_CHARS,
  cancelBackgroundTaskEntry,
  finalizeChildTaskRunSafely,
  formatBackgroundOutputMessages,
  formatValidationIssues,
  getChildSessionSummary,
  reconcileResumedTaskChildSession,
  registerBackgroundChildTask,
  releaseChildSessionActiveSlot,
  runChildTaskSessionInBackground,
  waitForTaskTerminalState,
} from './sandbox/task-background.js';
export {
  buildDelegatedChildRequestData,
  buildSessionMcpExecutionScope,
  buildTaskTags,
  findTaskBySessionId,
  findTeamRoleBindingForAgent,
  resolveTaskGraphTurnClientRequestId,
} from './sandbox/task-reference.js';
export {
  DEFAULT_TOOL_TIMEOUT_MS,
  FILE_TOOLS,
  formatToolInputValidationOutput,
  isPermissionSafeSiblingTool,
  normalizeWorkspaceManagedRawInput,
  READ_ONLY_WORKSPACE_TOOLS,
  SESSION_WORKSPACE_REQUIRED_TOOLS,
  TOOL_WHITELIST,
} from './sandbox/whitelist.js';

import type { SandboxHandlerContext } from './sandbox/context.js';
import {
  applyToolExecuteAfterHook,
  applyToolExecuteBeforeHook,
  formatMissingSessionWorkspace,
  formatSessionWorkspaceViolation,
  hasWorkspaceScopedExecutionInput,
  isCodegraphUnavailableOutput,
  resolveInvokeEffectiveToolName,
} from './sandbox/context.js';

// Phase 2:T-08 批一(todo / desktop / media)的 handler 模块。门面只保留
// 与原 if 链逐字相同的判定条件与顺序,分支体在 handler 内。
import {
  handleComputerUseTool,
  handleDesktopAutomationTool,
  handleDesktopControlTool,
} from './sandbox/handlers/desktop.js';
import {
  handleConvertMediaTool,
  handleExtractMediaInfoTool,
  handleExtractVideoFrameTool,
  handleGenerateAudioTool,
  handleGenerateImageTool,
  handleLookAtTool,
} from './sandbox/handlers/media.js';
import {
  handleSubTodoReadTool,
  handleSubTodoWriteTool,
  handleTodoReadTool,
  handleTodoWriteTool,
} from './sandbox/handlers/todo.js';

// Phase 2:T-09 批二(session / task-graph / workspace)的 handler 模块。
import {
  handleModelSearchTool,
  handleReadToolOutputTool,
  handleSessionInfoTool,
  handleSessionListTool,
  handleSessionMoveTool,
  handleSessionReadTool,
  handleSessionRenameTool,
  handleSessionSearchTool,
  handleToolSearchTool,
} from './sandbox/handlers/session.js';
import {
  handleTaskCreateTool,
  handleTaskGetTool,
  handleTaskListTool,
  handleTaskUpdateTool,
} from './sandbox/handlers/task-graph.js';
import {
  handleWorkspaceCreateDirectoryTool,
  handleWorkspaceReviewDiffTool,
  handleWorkspaceReviewRevertTool,
  handleWorkspaceReviewStatusTool,
} from './sandbox/handlers/workspace.js';

// Phase 2:T-10 批三(mcp / admin / edit)的 handler 模块。
import {
  handleAgentManageTool,
  handleMemoryManageTool,
  handlePluginManageTool,
  handleScheduleManageTool,
  handleSkillManageTool,
  handleTeamWorkspaceManageTool,
} from './sandbox/handlers/admin.js';
import {
  handleApplyPatchTool,
  handleAstGrepReplaceTool,
  handleEditTool,
  handleLspRenameTool,
  handleMultiEditTool,
  handleWriteTool,
} from './sandbox/handlers/edit.js';
import {
  handleFlatMcpTool,
  handleMcpCallTool,
  handleMcpListToolsTool,
  handleMcpManageServersTool,
  handleSkillMcpTool,
} from './sandbox/handlers/mcp.js';

// Phase 2:T-11 批四(batch / interactive / background / bash)的 handler 模块。
import {
  handleBackgroundCancelTool,
  handleBackgroundOutputTool,
} from './sandbox/handlers/background.js';
import {
  handleBashKillTool,
  handleBashOutputTool,
  handleBashTool,
  handleInteractiveBashTool,
  handleRunBashInBackgroundTool,
} from './sandbox/handlers/bash.js';
import { handleBatchTool } from './sandbox/handlers/batch.js';
import {
  handleEnterPlanModeTool,
  handleExitPlanModeTool,
  handleQuestionTool,
  handleSkillTool,
} from './sandbox/handlers/interactive.js';

// Phase 4:T-15 delegation(call_omo_agent + isTaskToolName 块)的 handler 模块。
import { handleCallOmoAgentTool, handleTaskTool } from './sandbox/handlers/delegation.js';

import { consumeOncePermission, ensurePermissionForTool } from './sandbox/permission-ladder.js';

import {
  buildToolObservability,
  getSessionMetadata,
  getSessionOwnerUserId,
  type PermissionRequestPayload,
  type SandboxExecutionContext,
} from './sandbox/session-context.js';

export {
  buildToolObservability,
  getSessionMetadata,
  getSessionOwnerUserId,
  getSessionRoleContext,
  isBackgroundAutoApprovedTeamSession,
  isPlanModeEnabled,
  isReceptionReadOnlyToolAutoApproved,
  isUnattendedSessionDelegationAutoApproved,
  updateSessionMetadata,
  type BatchProgressCallback,
  type BlockedToolCallPayload,
  type PermissionApprovalRow,
  type PermissionPendingRow,
  type PermissionRequestPayload,
  type PermissionState,
  type QuestionPendingRow,
  type SandboxExecutionContext,
  type TaskBackgroundRunResult,
} from './sandbox/session-context.js';

// 公共 API 再导出(消费方仍从 tool-sandbox.js 导入,拆分对调用方透明)。
export type {
  ChildSessionTerminalReason,
  ChildSessionTimeoutSource,
} from './sandbox/child-session.js';
export {
  buildTaskUpdateEvent,
  CHILD_SESSION_TERMINAL_REASON_KEY,
  clearTaskParentToolReference,
  readTaskParentToolReference,
  syncParentTaskToolResult,
  terminateChildSession,
};

/**
 * 网关托管工具的调用包装:先走 `executeGatewayManagedToolImpl` 的巨型派发链,
 * 命中后再跑 `tool.execute.after` 后置钩子并把改写结果回填。
 *
 * 该包装必须留在门面内:`executeGatewayManagedToolImpl` 依赖 `ToolSandbox` 类与
 * 全部 handler 模块,放进 `sandbox/context.ts` 会形成子模块 → 门面的反向依赖
 * (运行时循环)。派发链在 Phase 3 收成 `dispatchSandboxTool` 后同样如此。
 */
export async function executeGatewayManagedTool(
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

  return applyToolExecuteAfterHook(sessionId, request, result);
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

  // Phase 2 handler 上下文:与今日 if 链共享同一份 request / rawInput / signal。
  // 两个再入闭包把 `ToolSandbox` 实例与后置钩子包装绑定在此处,handler 模块因此
  // 无需反向 import 门面(否则会形成运行时循环)。
  const handlerContext: SandboxHandlerContext = {
    request,
    sessionId,
    rawInput,
    signal,
    observability,
    executionContext,
    sshResolution,
    // call_omo_agent 委派:改写成 task 后走完整门面路径(含后置钩子)。
    executeGatewayManagedTool: (input) =>
      executeGatewayManagedTool(
        sandbox,
        sessionId,
        input.request,
        signal,
        input.observability,
        input.executionContext,
      ),
    // batch 子工具递归:`ToolSandbox.execute` 全路径,不跑后置钩子。
    executeNestedTool: (input) =>
      sandbox.execute(input.request, signal, sessionId, input.executionContext),
  };

  try {
    // v2 plugin platform: dispatch plugin-contributed tools. Permission
    // gating already ran upstream — plugin tools are not mapped to a
    // built-in category, so the ladder resolves them to `custom` (ask).
    const pluginTool = getPluginToolRegistry().get(request.toolName);
    if (pluginTool) {
      return executePluginTool({ tool: pluginTool, request, sessionId, signal });
    }

    if (request.toolName === todoWriteTool.name) return handleTodoWriteTool(handlerContext);

    if (request.toolName === todoReadTool.name) return handleTodoReadTool(handlerContext);

    if (request.toolName === subTodoWriteTool.name) return handleSubTodoWriteTool(handlerContext);

    if (request.toolName === subTodoReadTool.name) return handleSubTodoReadTool(handlerContext);

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

    if (request.toolName === 'mcp_list_tools') return handleMcpListToolsTool(handlerContext);

    if (request.toolName === desktopAutomationToolDefinition.name)
      return handleDesktopAutomationTool(handlerContext);

    if (request.toolName === desktopControlToolDefinition.name)
      return handleDesktopControlTool(handlerContext);

    if (request.toolName === computerUseToolDefinition.name)
      return handleComputerUseTool(handlerContext);

    if (request.toolName === sessionListToolDefinition.name)
      return handleSessionListTool(handlerContext);

    if (request.toolName === sessionReadToolDefinition.name)
      return handleSessionReadTool(handlerContext);

    if (request.toolName === sessionSearchToolDefinition.name)
      return handleSessionSearchTool(handlerContext);

    if (request.toolName === sessionInfoToolDefinition.name)
      return handleSessionInfoTool(handlerContext);

    if (request.toolName === sessionRenameToolDefinition.name)
      return handleSessionRenameTool(handlerContext);

    if (request.toolName === sessionMoveToolDefinition.name)
      return handleSessionMoveTool(handlerContext);

    if (request.toolName === modelSearchToolDefinition.name)
      return handleModelSearchTool(handlerContext);

    if (request.toolName === taskCreateToolDefinition.name)
      return handleTaskCreateTool(handlerContext);

    if (request.toolName === taskGetToolDefinition.name) return handleTaskGetTool(handlerContext);

    if (request.toolName === taskListToolDefinition.name) return handleTaskListTool(handlerContext);

    if (request.toolName === taskUpdateToolDefinition.name)
      return handleTaskUpdateTool(handlerContext);

    if (request.toolName === skillMcpToolDefinition.name) return handleSkillMcpTool(handlerContext);

    if (request.toolName === lookAtToolDefinition.name) return handleLookAtTool(handlerContext);

    if (request.toolName === generateImageToolDefinition.name)
      return handleGenerateImageTool(handlerContext);

    if (request.toolName === convertMediaToolDefinition.name)
      return handleConvertMediaTool(handlerContext);

    if (request.toolName === extractMediaInfoToolDefinition.name)
      return handleExtractMediaInfoTool(handlerContext);

    if (request.toolName === extractVideoFrameToolDefinition.name)
      return handleExtractVideoFrameTool(handlerContext);

    if (request.toolName === generateAudioToolDefinition.name)
      return handleGenerateAudioTool(handlerContext);

    if (request.toolName === callOmoAgentToolDefinition.name)
      return handleCallOmoAgentTool(handlerContext);

    if (request.toolName === TOOL_SEARCH_TOOL_NAME) return handleToolSearchTool(handlerContext);

    if (request.toolName === readToolOutputToolDefinition.name)
      return handleReadToolOutputTool(handlerContext);

    // Flat MCP 别名(mcp__<server>__<tool>):判定条件原位保留,分支体在 handler 内。
    if (parseFlatMcpToolName(request.toolName)) return handleFlatMcpTool(handlerContext);

    if (request.toolName === 'mcp_call') return handleMcpCallTool(handlerContext);

    if (request.toolName === mcpManageServersToolDefinition.name)
      return handleMcpManageServersTool(handlerContext);

    if (request.toolName === memoryManageToolDefinition.name)
      return handleMemoryManageTool(handlerContext);

    if (request.toolName === skillManageToolDefinition.name)
      return handleSkillManageTool(handlerContext);

    if (request.toolName === pluginManageToolDefinition.name)
      return handlePluginManageTool(handlerContext);

    if (request.toolName === scheduleManageToolDefinition.name)
      return handleScheduleManageTool(handlerContext);

    if (request.toolName === agentManageToolDefinition.name)
      return handleAgentManageTool(handlerContext);

    if (request.toolName === teamWorkspaceManageToolDefinition.name)
      return handleTeamWorkspaceManageTool(handlerContext);

    if (request.toolName === workspaceReviewStatusTool.name)
      return handleWorkspaceReviewStatusTool(handlerContext);

    if (request.toolName === workspaceReviewDiffTool.name)
      return handleWorkspaceReviewDiffTool(handlerContext);

    if (request.toolName === workspaceCreateDirectoryTool.name)
      return handleWorkspaceCreateDirectoryTool(handlerContext);

    if (request.toolName === workspaceReviewRevertTool.name)
      return handleWorkspaceReviewRevertTool(handlerContext);

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

    if (request.toolName === 'edit') return handleEditTool(handlerContext);

    if (request.toolName === 'multi_edit') return handleMultiEditTool(handlerContext);

    if (request.toolName === writeTool.name) return handleWriteTool(handlerContext);

    if (request.toolName === applyPatchToolDefinition.name)
      return handleApplyPatchTool(handlerContext);

    if (request.toolName === astGrepReplaceToolDefinition.name)
      return handleAstGrepReplaceTool(handlerContext);

    if (request.toolName === lspRenameToolDefinition.name)
      return handleLspRenameTool(handlerContext);

    if (request.toolName === 'batch') return handleBatchTool(handlerContext);

    if (request.toolName === 'skill') return handleSkillTool(handlerContext);

    if (request.toolName === 'question') return handleQuestionTool(handlerContext);

    if (request.toolName === enterPlanModeToolDefinition.name)
      return handleEnterPlanModeTool(handlerContext);

    if (request.toolName === exitPlanModeToolDefinition.name)
      return handleExitPlanModeTool(handlerContext);

    if (isTaskToolName(request.toolName)) return handleTaskTool(handlerContext);

    if (request.toolName === 'background_output') return handleBackgroundOutputTool(handlerContext);

    if (request.toolName === 'background_cancel') return handleBackgroundCancelTool(handlerContext);

    if (request.toolName === 'bash') return handleBashTool(handlerContext);

    if (request.toolName === 'interactive_bash') return handleInteractiveBashTool(handlerContext);

    if (request.toolName === 'run_bash_in_background')
      return handleRunBashInBackgroundTool(handlerContext);

    if (request.toolName === 'bash_output') return handleBashOutputTool(handlerContext);

    if (request.toolName === 'bash_kill') return handleBashKillTool(handlerContext);

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

  /**
   * v2 plugin platform: add a plugin-contributed tool name to the
   * whitelist. Execution routes through the plugin registry in
   * `executeGatewayManagedToolImpl`; the plugin's JSON Schema input is
   * validated by the plugin itself (no zod definition here).
   */
  registerPluginToolName(name: string): void {
    this.whitelist.add(name);
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
      // `tool_invoke` 要按**内层工具**失效索引，否则写操作不会被下一次 `@` 看到。
      const effectiveToolName =
        request.toolName === TOOL_INVOKE_TOOL_NAME
          ? resolveInvokeEffectiveToolName(request, sessionId)
          : rewriteLegacyToolRequest(request.toolName, request.rawInput).toolName;
      invalidateWorkspaceFileIndexForToolCall(sessionId, effectiveToolName);
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

    // `tool_invoke` 解包（对齐参考库在 `execute` 内调用折叠工具的执行形状）：
    // 在最早的可用点把请求替换为**内层工具**，让后续的名称归一 / 静态白名单 /
    // 会话启用 / 插件 hook / 权限阶梯 / 执行全部按内层工具走与直接调用完全相同的
    // 路径——deny / ask / 审批 / team / channel / clarify 语义不降级。
    // 内层工具必须在本会话的 `toolInvokeAllowlist` 内（该名单由网关按过滤后的
    // 工具面写入），否则直接拒绝。
    const invokeDecision = resolveToolInvokeRequest({
      toolName: incomingRequest.toolName,
      rawInput: incomingRequest.rawInput,
      allowlist: readToolInvokeAllowlist(sessionId, getSessionOwnerUserId(sessionId) ?? ''),
      isToolEnabled: (toolName) =>
        isGatewayToolEnabledForSessionMetadata(toolName, getSessionMetadata(sessionId)),
    });
    if (invokeDecision.kind === 'reject') {
      const result: ToolCallResult = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: invokeDecision.message,
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
    const invokeRequest: ToolCallRequest =
      invokeDecision.kind === 'rewrite'
        ? {
            ...incomingRequest,
            toolName: invokeDecision.toolName,
            rawInput: invokeDecision.rawInput,
          }
        : incomingRequest;

    const dispatchedRequest = dispatchClaudeCodeTool(
      invokeRequest.toolName,
      (invokeRequest.rawInput &&
      typeof invokeRequest.rawInput === 'object' &&
      !Array.isArray(invokeRequest.rawInput)
        ? invokeRequest.rawInput
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
      ...invokeRequest,
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
        pendingInteraction: true,
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
        pendingInteraction: Boolean(gatewayManagedResult.pendingPermissionRequestId),
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
      // 提问 / 计划审批这类「已挂起、等用户输入」必须以 isError 返回给模型（让模型
      // 停下），但它不是故障——标记后由 /settings/diagnostics 与开发日志过滤掉。
      pendingInteraction: Boolean(result.pendingPermissionRequestId),
      // 兜底计时：多数工具分支（含历史上硬编码 0 的 bash）没有自报耗时，
      // 导致 audit_logs.duration_ms 全为 0，排障包里的「耗时」一列失去意义。
      // 分支自己量了就用它的，没量就用这里的兜底。
      durationMs: result.durationMs || Date.now() - startAt,
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
        logGatewayWarn('[tool-sandbox] read 注入 AGENTS.md 失败，已跳过：', error);
      }
    }

    if (permissionState.kind === 'approved' && permissionState.decision === 'once') {
      consumeOncePermission(permissionState.requestId);
    }
    return result;
  }
}

export {
  createDefaultSandbox,
  type CreateDefaultSandboxOptions,
} from './sandbox/create-default-sandbox.js';
