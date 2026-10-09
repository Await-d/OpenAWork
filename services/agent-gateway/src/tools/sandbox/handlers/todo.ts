/**
 * todo 域 handler(261009-tool-sandbox 拆分 P2 / T-08)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * todo_write / todo_read / sub_todo_write / sub_todo_read 四个分支体逐字保留。
 * 派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
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
  subTodoWriteInputSchema,
  todoReadInputSchema,
  todoWriteInputSchema,
} from '../../todo-tools.js';
import type { SandboxHandlerContext } from '../context.js';

export async function handleTodoWriteTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleTodoReadTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleSubTodoWriteTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleSubTodoReadTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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
