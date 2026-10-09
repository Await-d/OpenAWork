/**
 * bash 域 handler(261009-tool-sandbox 拆分 P2 / T-11)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * bash / interactive_bash / run_bash_in_background / bash_output / bash_kill
 * 分支体逐字保留。派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
import { assertSessionWorkingDirectory } from '../../../workspace/workspace-safety.js';
import { bashToolDefinition, deriveBashDescription, runBashCommand } from '../../bash-tools.js';
import {
  interactiveBashToolDefinition,
  runInteractiveBashCommand,
} from '../../interactive-bash-tools.js';
import {
  dispatchBashKill,
  dispatchBashOutput,
  dispatchRunBashInBackground,
} from '../../run-background-bash-tools.js';
import type { SandboxHandlerContext } from '../context.js';
import { getSessionOwnerUserId } from '../session-context.js';
import { formatValidationIssues } from '../task-background.js';

export async function handleBashTool(ctx: SandboxHandlerContext): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, signal, executionContext } = ctx;
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

  const bashStartAt = Date.now();
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
    durationMs: Date.now() - bashStartAt,
  };
}

export async function handleInteractiveBashTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, executionContext } = ctx;
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

export async function handleRunBashInBackgroundTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, executionContext } = ctx;
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

export async function handleBashOutputTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, executionContext } = ctx;
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

export async function handleBashKillTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput, executionContext } = ctx;
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
