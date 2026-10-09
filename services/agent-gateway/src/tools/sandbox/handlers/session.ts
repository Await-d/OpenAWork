/**
 * session 域 handler(261009-tool-sandbox 拆分 P2 / T-09)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * session_list / session_read / session_search / session_info / session_rename /
 * session_move / model_search / tool_search / read_tool_output 分支体逐字保留。
 * 派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
import {
  getLatestReferencedToolResult,
  getSessionToolResultByCallId,
  getSessionToolResultByReference,
} from '../../../message/message-v2-adapter.js';
import {
  runSessionInfoTool,
  runSessionListTool,
  runSessionReadTool,
  runSessionSearchTool,
  sessionInfoToolDefinition,
  sessionListToolDefinition,
  sessionReadToolDefinition,
  sessionSearchToolDefinition,
} from '../../../session/session-manager-tools.js';
import { readToolInvokeAllowlist } from '../../../session/tool-invoke-allowlist.js';
import { modelSearchToolDefinition, runModelSearchTool } from '../../model-search-tools.js';
import {
  runSessionMoveTool,
  runSessionRenameTool,
  sessionMoveToolDefinition,
  sessionRenameToolDefinition,
} from '../../session-management-tools.js';
import { buildGatewayToolDefinitions } from '../../tool-definitions.js';
import { toolSearchInputSchema } from '../../tool-folding.js';
import { readSpilledToolOutput } from '../../tool-output-spill.js';
import {
  buildReadToolOutputResponse,
  readToolOutputToolDefinition,
} from '../../tool-output-tools.js';
import type { SandboxHandlerContext } from '../context.js';
import { getSessionMetadata, getSessionOwnerUserId } from '../session-context.js';
import { formatToolInputValidationOutput } from '../whitelist.js';

export async function handleSessionListTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleSessionReadTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleSessionSearchTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleSessionInfoTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleSessionRenameTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleSessionMoveTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleModelSearchTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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
    typeof sessionMetadata['providerId'] === 'string' ? sessionMetadata['providerId'] : undefined;
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

export async function handleToolSearchTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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
  const parsed = toolSearchInputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: formatToolInputValidationOutput(request.toolName, parsed.error.issues),
      isError: true,
      durationMs: 0,
    };
  }
  const allowlist = new Set(readToolInvokeAllowlist(sessionId, userId));
  const terms = parsed.data.query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const matches = buildGatewayToolDefinitions()
    .filter((tool) => allowlist.has(tool.function.name))
    .filter((tool) => {
      const name = tool.function.name.toLowerCase();
      const description = (tool.function.description ?? '').toLowerCase();
      return terms.some((term) => name.includes(term) || description.includes(term));
    })
    .slice(0, parsed.data.limit)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output:
      matches.length > 0
        ? JSON.stringify({ tools: matches }, null, 2)
        : `No folded tool matched "${parsed.data.query}". Try a broader keyword (e.g. "lsp", "session", "mcp", "media").`,
    isError: false,
    durationMs: 0,
  };
}

export async function handleReadToolOutputTool(
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

  // 超限工具结果可能已把全文落盘（tool-output-spill）：优先用 spill 文件，
  // 否则退回数据库里的截断输出。
  const spilledOutput = readSpilledToolOutput(sessionId, resolvedStored.toolCallId);
  const effectiveOutput = spilledOutput ?? resolvedStored.output;
  const serializedOutput = (() => {
    if (typeof effectiveOutput === 'string') {
      return effectiveOutput;
    }
    try {
      return JSON.stringify(effectiveOutput);
    } catch {
      return String(effectiveOutput);
    }
  })();

  const sizeBytes = Buffer.byteLength(serializedOutput, 'utf8');
  const response = buildReadToolOutputResponse({
    toolCallId: resolvedStored.toolCallId,
    output: effectiveOutput,
    isError: resolvedStored.isError,
    request: parsed.data,
    sizeBytes,
  });
  const latestReferenceNote =
    !parsed.data.toolCallId && parsed.data.useLatestReferenced
      ? `已自动解析为最近一个被引用的大输出：${resolvedStored.toolCallId}。${response.note ? ` ${response.note}` : ''}`
      : response.note;
  // 落盘取回时补一句来源说明，便于模型理解「这里能拿到超过持久化上限的全文」。
  const noteParts = [spilledOutput ? '（全文来自落盘文件）' : '', latestReferenceNote ?? ''].filter(
    (part) => part.length > 0,
  );
  const note = noteParts.length > 0 ? noteParts.join(' ') : undefined;
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    output: {
      ...response,
      note,
    },
    isError: false,
    durationMs: 0,
  };
}
