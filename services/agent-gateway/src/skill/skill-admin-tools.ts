/**
 * `skill_manage` —— 会话内模型在用户审批下安装 / 卸载 / 启停技能。
 *
 * 设计边界（对齐 260924-AI自助管理扩展四域 域二）：
 * - 安装只走**已配置注册源**（复用 `createRegistryClient` 与 HTTP 安装同源）；
 *   `github:` / `claude-marketplace:` 前缀技能 v1 不支持工具安装（引导到设置页）；
 * - 落库复用 `skill-installed-store`（与 `POST /skills/install` 同一 upsert 语义）；
 * - team / cron / channel 会话直接拒绝（技能影响用户级 Agent 工具面）；
 * - 安装结果回传技能声明的 permissions 与是否内嵌 MCP，便于模型向用户交代风险。
 */

import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import { sqliteGet } from '../infra/db.js';
import { createRegistryClient } from '../routes/skills.js';
import {
  listInstalledSkillsForUser,
  setInstalledSkillEnabled,
  uninstallSkillForUser,
  upsertInstalledSkill,
  type InstalledSkillRecord,
} from './skill-installed-store.js';
import { SKILL_MANAGE_TOOL_NAME } from './skill-manage-tool-name.js';

export { SKILL_MANAGE_TOOL_NAME } from './skill-manage-tool-name.js';

const UNSUPPORTED_INSTALL_PREFIXES = ['github:', 'claude-marketplace:'] as const;

// ---------------------------------------------------------------------------
// 输入 schema
// ---------------------------------------------------------------------------

export const skillManageInputSchema = z
  .object({
    action: z.enum(['list', 'install', 'uninstall', 'enable', 'disable']),
    skillId: z.string().trim().min(1).max(300).optional(),
    sourceId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'list') {
      return;
    }
    if (!value.skillId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.action} 必须提供 skillId。`,
        path: ['skillId'],
      });
    }
  });

export const skillManageToolDefinition: ToolDefinition<typeof skillManageInputSchema, z.ZodString> =
  {
    name: SKILL_MANAGE_TOOL_NAME,
    description:
      '管理当前用户已安装的技能。action=list 列举（含启用态、声明权限与是否内嵌 MCP）；install 从已配置注册源安装；uninstall 卸载；enable/disable 启停。' +
      '变更类操作需要用户批准。仅支持注册源技能（github: / claude-marketplace: 前缀请在设置页安装）。' +
      '技能若内嵌 MCP（stdio 命令）或声明高危权限，安装结果会列出，请向用户说明。',
    inputSchema: skillManageInputSchema,
    outputSchema: z.string(),
    timeout: 60000,
    execute: async () => {
      throw new Error('skill_manage must execute through the gateway-managed sandbox path');
    },
  };

// ---------------------------------------------------------------------------
// 会话守卫（fail-closed）
// ---------------------------------------------------------------------------

export interface SkillManageSessionRow {
  metadata_json: string;
  role_layer: string | null;
  team_parent_session_id: string | null;
  handoff_state: string | null;
}

const TEAM_ROLE_LAYERS = new Set(['pm1', 'pm2', 'executor', 'reviewer', 'reception']);

/** 返回拒绝原因；`null` 表示允许进入正常权限门控。 */
export function resolveSkillManageSessionDenial(row: SkillManageSessionRow | null): string | null {
  if (!row) {
    return '当前会话不存在或无法解析，已拒绝技能变更。';
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
    return '团队会话不允许修改技能安装，请回到个人会话操作。';
  }

  const source = typeof metadata['source'] === 'string' ? metadata['source'] : '';
  if (source === 'cron') {
    return '定时任务会话无人审批，不允许修改技能安装。';
  }
  if (source === 'channel') {
    return '消息渠道会话不允许修改技能安装，请在设置页或桌面端操作。';
  }

  return null;
}

function readSkillManageSessionRow(sessionId: string): SkillManageSessionRow | null {
  return (
    sqliteGet<SkillManageSessionRow>(
      'SELECT metadata_json, role_layer, team_parent_session_id, handoff_state FROM sessions WHERE id = ? LIMIT 1',
      [sessionId],
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function readManifestSummary(manifest: unknown): {
  name: string | null;
  displayName: string | null;
  version: string | null;
  description: string | null;
  declaredPermissions: unknown[];
  hasMcp: boolean;
} {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      name: null,
      displayName: null,
      version: null,
      description: null,
      declaredPermissions: [],
      hasMcp: false,
    };
  }
  const record = manifest as Record<string, unknown>;
  return {
    name: typeof record['name'] === 'string' ? record['name'] : null,
    displayName: typeof record['displayName'] === 'string' ? record['displayName'] : null,
    version: typeof record['version'] === 'string' ? record['version'] : null,
    description:
      typeof record['description'] === 'string' ? record['description'].slice(0, 400) : null,
    declaredPermissions: Array.isArray(record['permissions']) ? record['permissions'] : [],
    hasMcp: Boolean(record['mcp']),
  };
}

function toSkillSummary(skill: InstalledSkillRecord): Record<string, unknown> {
  return {
    skillId: skill.skillId,
    sourceId: skill.sourceId,
    enabled: skill.enabled,
    ...readManifestSummary(skill.manifest),
  };
}

function requireSkillId(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error('缺少 skillId。');
  }
  return value.trim();
}

// ---------------------------------------------------------------------------
// 动作实现
// ---------------------------------------------------------------------------

function listSkillsForTool(userId: string): string {
  const skills = listInstalledSkillsForUser(userId);
  return JSON.stringify(
    { ok: true, action: 'list', count: skills.length, skills: skills.map(toSkillSummary) },
    null,
    2,
  );
}

async function installSkillForTool(
  userId: string,
  input: z.infer<typeof skillManageInputSchema>,
): Promise<string> {
  const skillId = requireSkillId(input.skillId);
  const unsupportedPrefix = UNSUPPORTED_INSTALL_PREFIXES.find((prefix) =>
    skillId.startsWith(prefix),
  );
  if (unsupportedPrefix) {
    throw new Error(
      `"${unsupportedPrefix}" 来源的技能暂不支持由工具安装，请在设置页 → 技能 中安装。`,
    );
  }

  const client = createRegistryClient(userId);
  const record = await client.install(skillId, {
    sourceId: input.sourceId,
    skipSignatureVerification: true,
  });
  const installed = upsertInstalledSkill(userId, {
    skillId: record.skillId,
    sourceId: record.sourceId,
    manifestJson: JSON.stringify(record.manifest),
  });

  return JSON.stringify({ ok: true, action: 'install', skill: toSkillSummary(installed) }, null, 2);
}

function uninstallSkillForTool(
  userId: string,
  input: z.infer<typeof skillManageInputSchema>,
): string {
  const skillId = requireSkillId(input.skillId);
  const removed = uninstallSkillForUser(userId, skillId);
  if (!removed) {
    throw new Error(`技能 ${skillId} 尚未安装。`);
  }
  return JSON.stringify({ ok: true, action: 'uninstall', skillId, removed: true }, null, 2);
}

function setSkillEnabledForTool(
  userId: string,
  input: z.infer<typeof skillManageInputSchema>,
  enabled: boolean,
): string {
  const skillId = requireSkillId(input.skillId);
  const updated = setInstalledSkillEnabled(userId, skillId, enabled);
  if (!updated) {
    throw new Error(`技能 ${skillId} 尚未安装。`);
  }
  return JSON.stringify(
    { ok: true, action: enabled ? 'enable' : 'disable', skill: toSkillSummary(updated) },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface RunSkillManageInput {
  userId: string;
  sessionId: string;
  input: z.infer<typeof skillManageInputSchema>;
}

export async function runSkillManageTool(params: RunSkillManageInput): Promise<string> {
  const denial = resolveSkillManageSessionDenial(readSkillManageSessionRow(params.sessionId));
  if (denial) {
    throw new Error(denial);
  }

  const { userId, input } = params;
  switch (input.action) {
    case 'list':
      return listSkillsForTool(userId);
    case 'install':
      return await installSkillForTool(userId, input);
    case 'uninstall':
      return uninstallSkillForTool(userId, input);
    case 'enable':
      return setSkillEnabledForTool(userId, input, true);
    case 'disable':
      return setSkillEnabledForTool(userId, input, false);
    default: {
      const exhaustive: never = input.action;
      throw new Error(`不支持的 action: ${String(exhaustive)}`);
    }
  }
}
