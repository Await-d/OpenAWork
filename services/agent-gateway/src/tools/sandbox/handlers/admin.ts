/**
 * admin 域 handler(261009-tool-sandbox 拆分 P2 / T-10)。
 *
 * 由 `tool-sandbox.ts::executeGatewayManagedToolImpl` 原位搬出,零行为变更:
 * memory_manage / skill_manage / plugin_manage / schedule_manage / agent_manage /
 * team_workspace_manage 分支体逐字保留。
 * 派发顺序仍由门面的 if 链决定(本模块不参与顺序决策)。
 */

import type { ToolCallResult } from '@openAwork/agent-core';
import { agentManageToolDefinition, runAgentManageTool } from '../../../agent/agent-admin-tools.js';
import {
  runScheduleManageTool,
  scheduleManageToolDefinition,
} from '../../../cron/schedule-admin-tools.js';
import {
  memoryManageToolDefinition,
  runMemoryManageTool,
} from '../../../memory/memory-admin-tools.js';
import {
  pluginManageToolDefinition,
  runPluginManageTool,
} from '../../../plugin/plugin-admin-tools.js';
import { runSkillManageTool, skillManageToolDefinition } from '../../../skill/skill-admin-tools.js';
import {
  runTeamWorkspaceManageTool,
  teamWorkspaceManageToolDefinition,
} from '../../../team/team-workspace-admin-tools.js';
import type { SandboxHandlerContext } from '../context.js';
import { getSessionOwnerUserId } from '../session-context.js';
import { formatToolInputValidationOutput } from '../whitelist.js';

export async function handleMemoryManageTool(
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
  const parsed = memoryManageToolDefinition.inputSchema.safeParse(rawInput ?? {});
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
      output: await runMemoryManageTool({ userId, sessionId, input: parsed.data }),
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

export async function handleSkillManageTool(
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
  const parsed = skillManageToolDefinition.inputSchema.safeParse(rawInput ?? {});
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
      output: await runSkillManageTool({ userId, sessionId, input: parsed.data }),
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

export async function handlePluginManageTool(
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
  const parsed = pluginManageToolDefinition.inputSchema.safeParse(rawInput ?? {});
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
      output: await runPluginManageTool({ userId, sessionId, input: parsed.data }),
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

export async function handleScheduleManageTool(
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
  const parsed = scheduleManageToolDefinition.inputSchema.safeParse(rawInput ?? {});
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
      output: await runScheduleManageTool({ userId, sessionId, input: parsed.data }),
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

export async function handleAgentManageTool(
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
  const parsed = agentManageToolDefinition.inputSchema.safeParse(rawInput ?? {});
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
      output: await runAgentManageTool({ userId, sessionId, input: parsed.data }),
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

export async function handleTeamWorkspaceManageTool(
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
  const parsed = teamWorkspaceManageToolDefinition.inputSchema.safeParse(rawInput ?? {});
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
      output: await runTeamWorkspaceManageTool({ userId, sessionId, input: parsed.data }),
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
