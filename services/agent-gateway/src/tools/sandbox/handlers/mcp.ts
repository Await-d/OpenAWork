/**
 * mcp 域 handler(261009-tool-sandbox 拆分 P2 / T-10)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * mcp_list_tools / skill_mcp / flat MCP 别名(mcp__<server>__<tool>)/ mcp_call /
 * mcp_manage_servers 分支体逐字保留(flat MCP 的 `if (flatMcp)` 谓词块整块进 handler;
 * 门面原位保留 `if (parseFlatMcpToolName(request.toolName)) return handleFlatMcpTool(...)`,
 * 位置与今日一致 —— mcp_list_tools 在 desktop 前、skill_mcp 在 task 后、flat/mcp_call/manage
 * 在 read_tool_output 后)。派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
import {
  mcpManageServersToolDefinition,
  runMcpManageServersTool,
} from '../../../mcp/mcp-admin-tools.js';
import { callMcpToolForSession, listMcpToolsForSession } from '../../../mcp/mcp-runtime.js';
import { parseMcpCallRawInput, parseMcpListToolsRawInput } from '../../../mcp/mcp-tool-input.js';
import { parseFlatMcpToolName } from '../../../mcp/mcp-tool-naming.js';
import {
  isSkillMcpAllowedByEffective,
  runSkillMcpTool,
  skillMcpToolDefinition,
} from '../../../skill/skill-mcp-tools.js';
import { getEffectiveSkillsForSession } from '../../../skill/skill-selection-context.js';
import type { SandboxHandlerContext } from '../context.js';
import { getSessionOwnerUserId } from '../session-context.js';
import { buildSessionMcpExecutionScope } from '../task-reference.js';
import { formatToolInputValidationOutput } from '../whitelist.js';

export async function handleMcpListToolsTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleSkillMcpTool(
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

// Flat MCP tools (PR-C): each MCP tool exposed as
// `mcp__<serverId>__<toolName>` routes here. The arguments come
// through `rawInput` directly — no `arguments` envelope unlike
// `mcp_call`, since the LLM treats the flat tool exactly like
// any other top-level function. Permission gating already ran
// upstream via `buildPermissionRequestContext`.
export async function handleFlatMcpTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
  const flatMcp = parseFlatMcpToolName(request.toolName);
  if (!flatMcp) return null;

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

export async function handleMcpCallTool(
  ctx: SandboxHandlerContext,
): Promise<ToolCallResult | null> {
  const { request, sessionId, rawInput } = ctx;
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

export async function handleMcpManageServersTool(
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
  const parsed = mcpManageServersToolDefinition.inputSchema.safeParse(rawInput ?? {});
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
      output: await runMcpManageServersTool({ userId, sessionId, input: parsed.data }),
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
