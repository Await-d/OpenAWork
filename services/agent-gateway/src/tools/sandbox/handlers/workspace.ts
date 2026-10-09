/**
 * workspace 域 handler(261009-tool-sandbox 拆分 P2 / T-09)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * workspace_review_status / workspace_review_diff / workspace_create_directory /
 * workspace_review_revert 分支体逐字保留。
 * 派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
import {
  executeWorkspaceCreateDirectory,
  executeWorkspaceReviewDiff,
  executeWorkspaceReviewRevert,
  executeWorkspaceReviewStatus,
  workspaceCreateDirectoryTool,
  workspaceReviewDiffTool,
  workspaceReviewRevertTool,
  workspaceReviewStatusTool,
} from '../../workspace-tools.js';
import type { SandboxHandlerContext } from '../context.js';
import { formatToolInputValidationOutput } from '../whitelist.js';

export async function handleWorkspaceReviewStatusTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleWorkspaceReviewDiffTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleWorkspaceCreateDirectoryTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleWorkspaceReviewRevertTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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
