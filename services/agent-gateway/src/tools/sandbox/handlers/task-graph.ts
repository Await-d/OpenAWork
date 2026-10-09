/**
 * task-graph 域 handler(261009-tool-sandbox 拆分 P2 / T-09)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * task_create / task_get / task_list / task_update 分支体逐字保留。
 * 派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
import {
  runTaskCreateTool,
  runTaskGetTool,
  runTaskListTool,
  runTaskUpdateTool,
  taskCreateToolDefinition,
  taskGetToolDefinition,
  taskUpdateToolDefinition,
} from '../../../task/task-crud-tools.js';
import type { SandboxHandlerContext } from '../context.js';
import { resolveTaskGraphTurnClientRequestId } from '../task-reference.js';
import { formatToolInputValidationOutput } from '../whitelist.js';

export async function handleTaskCreateTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, executionContext } = ctx;
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

export async function handleTaskGetTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleTaskListTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId } = ctx;
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: await runTaskListTool(sessionId),
    isError: false,
    durationMs: 0,
  };
}

export async function handleTaskUpdateTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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
