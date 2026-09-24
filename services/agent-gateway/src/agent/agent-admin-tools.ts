/**
 * `agent_manage` —— 会话内模型在用户审批下维护自定义 Agent。
 *
 * 设计边界：
 * - 复用 `agent-catalog` 的 create/update/remove/reset（与 `/agents` 路由同源）；
 *   校验 schema 与错误映射直接取自路由（`createManagedAgentSchema` /
 *   `updateManagedAgentSchema` / `mapAgentCatalogError`），避免两套规则漂移；
 * - 内置 Agent 只允许改模型配置（catalog 自身的 `builtinUpdateRestricted` 语义）；
 * - team / cron / channel 会话拒绝（Agent 影响用户级能力面）；
 * - 只读 list 免审批；变更类默认 ask，永久允许按动作隔离。
 */

import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import type { ManagedAgentRecord } from '@openAwork/shared';
import { sqliteGet } from '../infra/db.js';
import {
  createManagedAgentForUser,
  listManagedAgentsForUser,
  removeManagedAgentForUser,
  resetManagedAgentForUser,
  updateManagedAgentForUser,
} from './agent-catalog.js';
import {
  createManagedAgentSchema,
  mapAgentCatalogError,
  updateManagedAgentSchema,
} from '../routes/agents.js';
import { AGENT_MANAGE_TOOL_NAME } from './agent-manage-tool-name.js';

export { AGENT_MANAGE_TOOL_NAME } from './agent-manage-tool-name.js';

const SYSTEM_PROMPT_PREVIEW_CHARS = 200;

// ---------------------------------------------------------------------------
// 输入 schema
// ---------------------------------------------------------------------------

export const agentManageInputSchema = z
  .object({
    action: z.enum(['list', 'create', 'update', 'delete', 'reset']),
    agentId: z.string().trim().min(1).max(120).optional(),
    /** create 用 createManagedAgentSchema；update 用 updateManagedAgentSchema。 */
    agent: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'create' && !value.agent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'create 必须提供 agent。',
        path: ['agent'],
      });
    }
    if (value.action === 'update' && !value.agent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'update 必须提供 agent。',
        path: ['agent'],
      });
    }
    if (value.action !== 'list' && value.action !== 'create' && !value.agentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.action} 必须提供 agentId。`,
        path: ['agentId'],
      });
    }
  });

export const agentManageToolDefinition: ToolDefinition<typeof agentManageInputSchema, z.ZodString> =
  {
    name: AGENT_MANAGE_TOOL_NAME,
    description:
      '管理当前用户的自定义 Agent。action=list 列举；create 新建（需要 label 与 systemPrompt）；update 修改；delete 删除；reset 恢复默认。' +
      '变更类操作需要用户批准。内置 Agent 只允许修改模型配置（model / variant / fallbackModels 等）。',
    inputSchema: agentManageInputSchema,
    outputSchema: z.string(),
    timeout: 30000,
    execute: async () => {
      throw new Error('agent_manage must execute through the gateway-managed sandbox path');
    },
  };

// ---------------------------------------------------------------------------
// 会话守卫（fail-closed）
// ---------------------------------------------------------------------------

export interface AgentManageSessionRow {
  metadata_json: string;
  role_layer: string | null;
  team_parent_session_id: string | null;
  handoff_state: string | null;
}

const TEAM_ROLE_LAYERS = new Set(['pm1', 'pm2', 'executor', 'reviewer', 'reception']);

/** 返回拒绝原因；`null` 表示允许进入正常权限门控。 */
export function resolveAgentManageSessionDenial(row: AgentManageSessionRow | null): string | null {
  if (!row) {
    return '当前会话不存在或无法解析，已拒绝 Agent 变更。';
  }
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    // 坏 metadata 不阻止守卫判定，按无 metadata 处理。
  }

  const roleLayer = typeof row.role_layer === 'string' ? row.role_layer.trim() : '';
  const hasTeamParent =
    typeof row.team_parent_session_id === 'string' && row.team_parent_session_id.trim().length > 0;
  const hasTeamMetadata =
    typeof metadata['teamWorkspaceId'] === 'string' ||
    (typeof metadata['teamRoleInstance'] === 'object' && metadata['teamRoleInstance'] !== null);
  if (TEAM_ROLE_LAYERS.has(roleLayer) || hasTeamParent || hasTeamMetadata) {
    return '团队会话不允许修改自定义 Agent，请回到个人会话操作。';
  }

  const source = typeof metadata['source'] === 'string' ? metadata['source'] : '';
  if (source === 'cron') {
    return '定时任务会话无人审批，不允许修改自定义 Agent。';
  }
  if (source === 'channel') {
    return '消息渠道会话不允许修改自定义 Agent，请在设置页或桌面端操作。';
  }

  return null;
}

function readAgentManageSessionRow(sessionId: string): AgentManageSessionRow | null {
  return (
    sqliteGet<AgentManageSessionRow>(
      'SELECT metadata_json, role_layer, team_parent_session_id, handoff_state FROM sessions WHERE id = ? LIMIT 1',
      [sessionId],
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function toAgentSummary(agent: ManagedAgentRecord): Record<string, unknown> {
  const systemPrompt = typeof agent.systemPrompt === 'string' ? agent.systemPrompt : '';
  return {
    id: agent.id,
    label: agent.label,
    description: agent.description,
    source: agent.source,
    enabled: agent.enabled,
    model: agent.model ?? null,
    variant: agent.variant ?? null,
    systemPromptPreview:
      systemPrompt.length > SYSTEM_PROMPT_PREVIEW_CHARS
        ? `${systemPrompt.slice(0, SYSTEM_PROMPT_PREVIEW_CHARS)}…`
        : systemPrompt,
  };
}

function requireAgentId(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error('缺少 agentId。');
  }
  return value.trim();
}

function parseWithSchema<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
  label: string,
): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw new Error(`${label}参数校验失败：${path}${issue?.message ?? '未知错误'}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// 动作实现
// ---------------------------------------------------------------------------

function listAgentsForTool(userId: string): string {
  const agents = listManagedAgentsForUser(userId).map(toAgentSummary);
  return JSON.stringify({ ok: true, action: 'list', count: agents.length, agents }, null, 2);
}

function createAgentForTool(userId: string, input: z.infer<typeof agentManageInputSchema>): string {
  const parsed = parseWithSchema(createManagedAgentSchema, input.agent, 'create');
  try {
    const agent = createManagedAgentForUser(userId, parsed);
    return JSON.stringify({ ok: true, action: 'create', agent: toAgentSummary(agent) }, null, 2);
  } catch (error) {
    throw new Error(mapAgentCatalogError(error).error);
  }
}

function updateAgentForTool(userId: string, input: z.infer<typeof agentManageInputSchema>): string {
  const agentId = requireAgentId(input.agentId);
  const parsed = parseWithSchema(updateManagedAgentSchema, input.agent, 'update');
  try {
    const agent = updateManagedAgentForUser(userId, agentId, parsed);
    return JSON.stringify({ ok: true, action: 'update', agent: toAgentSummary(agent) }, null, 2);
  } catch (error) {
    throw new Error(mapAgentCatalogError(error).error);
  }
}

function deleteAgentForTool(userId: string, input: z.infer<typeof agentManageInputSchema>): string {
  const agentId = requireAgentId(input.agentId);
  try {
    removeManagedAgentForUser(userId, agentId);
    return JSON.stringify({ ok: true, action: 'delete', agentId, removed: true }, null, 2);
  } catch (error) {
    throw new Error(mapAgentCatalogError(error).error);
  }
}

function resetAgentForTool(userId: string, input: z.infer<typeof agentManageInputSchema>): string {
  const agentId = requireAgentId(input.agentId);
  try {
    const agent = resetManagedAgentForUser(userId, agentId);
    return JSON.stringify({ ok: true, action: 'reset', agent: toAgentSummary(agent) }, null, 2);
  } catch (error) {
    throw new Error(mapAgentCatalogError(error).error);
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface RunAgentManageInput {
  userId: string;
  sessionId: string;
  input: z.infer<typeof agentManageInputSchema>;
}

export async function runAgentManageTool(params: RunAgentManageInput): Promise<string> {
  const denial = resolveAgentManageSessionDenial(readAgentManageSessionRow(params.sessionId));
  if (denial) {
    throw new Error(denial);
  }

  const { userId, input } = params;
  switch (input.action) {
    case 'list':
      return listAgentsForTool(userId);
    case 'create':
      return createAgentForTool(userId, input);
    case 'update':
      return updateAgentForTool(userId, input);
    case 'delete':
      return deleteAgentForTool(userId, input);
    case 'reset':
      return resetAgentForTool(userId, input);
    default: {
      const exhaustive: never = input.action;
      throw new Error(`不支持的 action: ${String(exhaustive)}`);
    }
  }
}
