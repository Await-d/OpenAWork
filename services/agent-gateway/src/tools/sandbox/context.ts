/**
 * 沙箱派发上下文与钩子域(261009-tool-sandbox 拆分 P1 / T-04)。
 *
 * 由 `tool-sandbox.ts` 原样搬出,行为不变:`SandboxExecutionContext` /
 * `BlockedToolCallPayload` / `PermissionRequestPayload` / `TaskBackgroundRunResult`
 * 等公共载荷类型、gateway LSP 工具定义、权限请求上下文构造、
 * `executeGatewayManagedTool` / `applyToolExecuteBeforeHook` 入口包装。
 *
 * 依赖方向:`tool-sandbox.ts` → 本模块(单向)。
 */

import type { ToolCallRequest, ToolCallResult, ToolDefinition } from '@openAwork/agent-core';
import { lspDiagnosticsTool, lspTouchTool } from '@openAwork/agent-core';
import { lspManager } from '../../lsp/router.js';
import type {} from '../../mcp/mcp-server-authorization.js';
import {
  buildToolPermissionRequestContext,
  type PermissionRequestContext,
} from '../../permission/tool-permission-derivers.js';
import { dispatchToolExecuteAfter, dispatchToolExecuteBefore } from '../../runtime/plugin-host.js';
import { readToolInvokeAllowlist } from '../../session/tool-invoke-allowlist.js';
import { getSessionWorkingDirectory } from '../../workspace/workspace-safety.js';
import { rewriteLegacyToolRequest } from '../legacy-tool-name-rewrite.js';
import { type SshRemoteResolution } from '../ssh-remote-execution.js';
import { resolveToolInvokeRequest } from '../tool-folding.js';
import { readToolPathInput } from '../tool-path-aliases.js';
import {
  getSessionOwnerUserId,
  type PermissionRequestPayload,
  type SandboxExecutionContext,
} from './session-context.js';

export const gatewayLspDiagnosticsTool: ToolDefinition<
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

export const gatewayLspTouchTool: ToolDefinition<
  typeof lspTouchTool.inputSchema,
  typeof lspTouchTool.outputSchema
> = {
  ...lspTouchTool,
  execute: async (input) => {
    await lspManager.touchFile(input.path, input.waitForDiagnostics);
    return { ok: true };
  },
};

export function formatSessionWorkspaceViolation(
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

export function formatMissingSessionWorkspace(toolName: string): string {
  return `当前会话未绑定工作区，无法执行工具 "${toolName}"。请先设置 workingDirectory。`;
}

export function hasWorkspaceScopedExecutionInput(request: ToolCallRequest): boolean {
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

export function buildPermissionRequestContext(
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
/**
 * `tool_invoke` 的索引失效口径：解析内层工具名（解析失败回退外层名）。
 * 只用于 `invalidateWorkspaceFileIndexForToolCall`，不做任何放行判定。
 */
export function resolveInvokeEffectiveToolName(
  request: ToolCallRequest,
  sessionId: string,
): string {
  const decision = resolveToolInvokeRequest({
    toolName: request.toolName,
    rawInput: request.rawInput,
    allowlist: readToolInvokeAllowlist(sessionId, getSessionOwnerUserId(sessionId) ?? ''),
    isToolEnabled: () => true,
  });
  return decision.kind === 'rewrite'
    ? rewriteLegacyToolRequest(decision.toolName, decision.rawInput).toolName
    : rewriteLegacyToolRequest(request.toolName, request.rawInput).toolName;
}

/**
 * `execute` 之后置钩子包装:`tool.execute.after` 会把 output / isError 原地改写,
 * 这里把改写结果回填到 `ToolCallResult`。派发主体(`executeGatewayManagedToolImpl`)
 * 仍在门面 `tool-sandbox.ts` 内 —— 它依赖 `ToolSandbox` 类与整个 handler 网络,
 * 若在此引用会形成子模块 → 门面的反向依赖(运行时循环)。
 */
export async function applyToolExecuteAfterHook(
  sessionId: string,
  request: ToolCallRequest,
  result: ToolCallResult,
): Promise<ToolCallResult> {
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

/**
 * handler 函数共享的派发上下文。
 *
 * 由 `executeGatewayManagedToolImpl` 每次调用构造一次;handler 模块只依赖本类型与
 * 工具实现模块,不反向 import 门面 `tool-sandbox.ts`(那会造成运行时循环)。
 */
export interface SandboxHandlerContext {
  /** 与今日 if 链相同的原始请求(工具名已由 `execute()` 归一)。 */
  readonly request: ToolCallRequest;
  readonly sessionId: string;
  /** `request.rawInput` 的窄化结果,等价于 impl 内的 `rawInput` 局部量。 */
  readonly rawInput: Record<string, unknown>;
  readonly signal: AbortSignal;
  readonly observability: PermissionRequestPayload['observability'] | undefined;
  readonly executionContext: SandboxExecutionContext | undefined;
  readonly sshResolution: SshRemoteResolution | null | undefined;
  /**
   * 再入派发:`call_omo_agent` 把请求改写为 `task` 后走**完整**门面路径
   * (含 `tool.execute.after` 后置钩子),与今日直接调用完全一致。
   */
  readonly executeGatewayManagedTool: (input: {
    request: ToolCallRequest;
    observability: PermissionRequestPayload['observability'] | undefined;
    executionContext?: SandboxExecutionContext | undefined;
  }) => Promise<ToolCallResult | null>;
  /**
   * 递归执行子工具(`batch`):走 `ToolSandbox.execute` 的完整安全路径
   * (白名单 / 权限阶梯 / 审计),不跑后置钩子 —— 与今日 `sandbox.execute(...)` 一致。
   */
  readonly executeNestedTool: (input: {
    request: ToolCallRequest;
    executionContext?: SandboxExecutionContext | undefined;
  }) => Promise<ToolCallResult>;
}

export async function applyToolExecuteBeforeHook(
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

export function isCodegraphUnavailableOutput(output: unknown): boolean {
  return (
    typeof output === 'object' &&
    output !== null &&
    'status' in output &&
    output.status === 'not_available'
  );
}
