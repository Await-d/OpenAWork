/**
 * 任务引用与委派辅助域(261009-tool-sandbox 拆分 P1 / T-06)。
 *
 * 由 `tool-sandbox.ts` 原样搬出,行为不变:任务状态映射辅助、按会话查任务、
 * 任务标签、回合键解析、团队角色绑定、委派子会话请求体、会话 MCP 作用域。
 */

import type { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { buildDelegatedChildClientRequestId } from '../call-omo-agent-output.js';
import { sqliteGet } from '../../infra/db.js';
import { isTeamRoleLayer } from '../../handoff/capability/apply-team-layer-tools.js';
import { resolveSessionTurnClientRequestId } from '../../handoff/store/handoff-store.js';
import type { McpSessionScope } from '../../mcp/mcp-server-authorization.js';
import { resolveDelegatedTaskReasoningEffort } from '../../task/task-thinking-effort.js';
import { parseSessionMetadataJson } from '../../session/session-workspace-metadata.js';
import { type SandboxExecutionContext } from './session-context.js';

export function findTaskBySessionId(
  graph: Awaited<ReturnType<AgentTaskManagerImpl['loadOrCreate']>>,
  childSessionId: string,
) {
  return Object.values(graph.tasks).find((task) => task.sessionId === childSessionId) ?? null;
}

export function buildTaskTags(input: {
  agentId: string;
  category?: string;
  requestedSkills: string[];
}): string[] {
  return [
    'task-tool',
    input.agentId,
    ...(input.category ? [`category:${input.category}`] : []),
    ...input.requestedSkills.map((skill) => `skill:${skill}`),
  ];
}

/**
 * 任务图节点归属的回合键：会话自身的真实回合键优先；子层内部运行键
 * （`handoff:` / `pm1:` / `pm2:`）继承活跃父 handoff 的回合键；普通 chat 会话
 * 无父 handoff，回退到当前 stream 请求键。两者都没有则返回 null。
 */
export function resolveTaskGraphTurnClientRequestId(
  sessionId: string,
  executionContext: SandboxExecutionContext | undefined,
): string | null {
  return resolveSessionTurnClientRequestId(sessionId, executionContext?.clientRequestId);
}

interface TeamRoleBindingEntry {
  agentId: string;
  modelId?: string;
  providerId?: string;
  variant?: string;
}

export function findTeamRoleBindingForAgent(
  sessionMetadata: Record<string, unknown>,
  agentId: string,
): TeamRoleBindingEntry | undefined {
  const teamDefinition = sessionMetadata.teamDefinition;
  if (typeof teamDefinition !== 'object' || teamDefinition === null) return undefined;
  const requiredRoleBindings = (teamDefinition as Record<string, unknown>).requiredRoleBindings;
  if (!Array.isArray(requiredRoleBindings)) return undefined;
  return requiredRoleBindings.find(
    (binding: unknown) =>
      typeof binding === 'object' &&
      binding !== null &&
      (binding as { agentId: string }).agentId === agentId,
  ) as TeamRoleBindingEntry | undefined;
}

export function buildDelegatedChildRequestData(input: {
  agentId: string;
  category?: string;
  childSessionId: string;
  executionContext?: SandboxExecutionContext;
  modelSelection?: {
    modelId: string;
    providerId?: string;
    variant?: string;
  };
  prompt: string;
  systemPrompt?: string;
}): Record<string, unknown> | null {
  const baseRequestData =
    input.executionContext?.requestData && typeof input.executionContext.requestData === 'object'
      ? input.executionContext.requestData
      : {};

  const nextRequestData: Record<string, unknown> = {
    ...baseRequestData,
    thinkingEnabled: true,
    reasoningEffort: resolveDelegatedTaskReasoningEffort(input.category),
  };
  delete nextRequestData['thinking'];

  return {
    ...nextRequestData,
    agentId: input.agentId,
    clientRequestId: buildDelegatedChildClientRequestId({
      childSessionId: input.childSessionId,
      parentClientRequestId: input.executionContext?.clientRequestId,
    }),
    displayMessage: input.prompt,
    message: input.prompt,
    ...(input.modelSelection?.modelId ? { model: input.modelSelection.modelId } : {}),
    ...(input.modelSelection?.providerId ? { providerId: input.modelSelection.providerId } : {}),
    ...(input.modelSelection?.variant ? { variant: input.modelSelection.variant } : {}),
    ...(input.systemPrompt
      ? { systemPrompt: input.systemPrompt }
      : baseRequestData.systemPrompt !== undefined
        ? { systemPrompt: baseRequestData.systemPrompt }
        : {}),
  };
}

/**
 * 读取某 session 的模板初始 MCP 白名单（metadata.requestedMcpServers）。
 * 用于 mcp_list_tools 包装工具路径的按需过滤（flat 模式下该包装通常隐藏，
 * 但 flat 关闭时仍需尊重白名单）。
 */
function readSessionMcpScope(sessionId: string): {
  readonly isTeamSession: boolean;
  readonly requestedMcpServers: readonly string[];
} {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return { isTeamSession: false, requestedMcpServers: [] };
  const metadata = parseSessionMetadataJson(row.metadata_json ?? '{}');
  const candidate = metadata['requestedMcpServers'];
  const requestedMcpServers = Array.isArray(candidate)
    ? candidate.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  const roleInstance = metadata['teamRoleInstance'];
  const nestedRoleLayer =
    typeof roleInstance === 'object' && roleInstance !== null && 'roleLayer' in roleInstance
      ? roleInstance.roleLayer
      : undefined;
  const roleLayer = typeof metadata.roleLayer === 'string' ? metadata.roleLayer : nestedRoleLayer;
  return {
    isTeamSession: typeof roleLayer === 'string' && isTeamRoleLayer(roleLayer),
    requestedMcpServers,
  };
}

export function buildSessionMcpExecutionScope(sessionId: string): McpSessionScope | undefined {
  const mcpScope = readSessionMcpScope(sessionId);
  if (mcpScope.requestedMcpServers.length > 0 || mcpScope.isTeamSession) {
    return { allowedServerIds: [...mcpScope.requestedMcpServers] };
  }
  return undefined;
}

export function readTaskCategory(metadata: Record<string, unknown>): string | undefined {
  return typeof metadata.taskCategory === 'string' ? metadata.taskCategory : undefined;
}
