/**
 * edit 域 handler(261009-tool-sandbox 拆分 P2 / T-10)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * edit / multi_edit / write / apply_patch / ast_grep_replace / lsp_rename
 * 分支体逐字保留(含 write 的 before-write 备份回调与 codegraph 失效标记)。
 * 派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
import { captureBeforeWriteBackup } from '../../../session/session-file-backup-store.js';
import { assertSessionWorkingDirectory } from '../../../workspace/workspace-safety.js';
import { applyPatchToolDefinition, executeApplyPatch } from '../../apply-patch-tools.js';
import { astGrepReplaceToolDefinition, executeAstGrepReplace } from '../../ast-grep-tools.js';
import { markCodegraphFilesStaleBestEffort } from '../../codegraph-tools.js';
import { createEditTool } from '../../edit-tools.js';
import { executeLspRename, lspRenameToolDefinition } from '../../lsp-tools.js';
import { createMultiEditTool } from '../../multi-edit-tool.js';
import { executeWriteTool, writeTool } from '../../workspace-tools.js';
import type { SandboxHandlerContext } from '../context.js';
import { getSessionOwnerUserId } from '../session-context.js';
import { formatToolInputValidationOutput } from '../whitelist.js';

export async function handleEditTool(ctx: SandboxHandlerContext): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal, executionContext } = ctx;
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

export async function handleMultiEditTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal, executionContext } = ctx;
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

export async function handleWriteTool(ctx: SandboxHandlerContext): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal, executionContext } = ctx;
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

export async function handleApplyPatchTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, executionContext } = ctx;
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

export async function handleAstGrepReplaceTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

  const output = await executeAstGrepReplace(parsed.data, assertSessionWorkingDirectory(sessionId));
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output,
    isError: false,
    durationMs: 0,
  };
}

export async function handleLspRenameTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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
