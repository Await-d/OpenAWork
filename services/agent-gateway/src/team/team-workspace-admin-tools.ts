/**
 * `team_workspace_manage` —— 会话内模型在用户审批下管理团队工作区。
 *
 * 设计边界：
 * - 复用 `team/team-workspace-store.ts`（与 `/team/workspaces` 路由同源）；
 * - roster 输入采用「原始对象数组 + 显式校验」：
 *   ① 非空输入若有槽位未通过必填校验 → 报错（拒绝静默回退默认编制）；
 *   ② 归一化后逐项校验能力绑定白名单——`skillIds` 必须命中内置/已安装技能，
 *      `mcpServerIds` 必须命中用户合并后的 MCP server 列表；
 * - team / cron / channel 会话拒绝（团队会话不得修改团队配置）；
 * - `list` 免审批；变更类默认 ask，永久允许按动作隔离；
 * - `defaultWorkingRoot` 不做会话级路径限制（与 UI 语义一致），但进审批预览。
 */

import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import type { FixedTeamMemberSlot } from '@openAwork/shared';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import { sqliteGet } from '../infra/db.js';
import { loadConfiguredMcpServersForUser } from '../mcp/mcp-runtime.js';
import { listInstalledSkillsForUser } from '../skill/skill-installed-store.js';
import {
  countValidMemberSlots,
  normalizeTeamWorkspaceDefaultRoster,
} from './team-default-roster-store.js';
import {
  createTeamWorkspace,
  updateTeamWorkspace,
  deleteTeamWorkspace,
  listTeamWorkspacesForUser,
  type TeamWorkspaceRecord,
} from './team-workspace-store.js';
import { TEAM_WORKSPACE_MANAGE_TOOL_NAME } from './team-workspace-manage-tool-name.js';

export { TEAM_WORKSPACE_MANAGE_TOOL_NAME } from './team-workspace-manage-tool-name.js';

// ---------------------------------------------------------------------------
// 输入 schema
// ---------------------------------------------------------------------------

const workspaceDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    visibility: z.enum(['open', 'closed', 'private']).optional(),
    defaultWorkingRoot: z.string().trim().min(1).max(1000).nullable().optional(),
    /** roster 槽位原样传入（必填字段校验在 normalize 侧，见 countValidMemberSlots）。 */
    defaultTeamRoster: z.array(z.record(z.unknown())).max(40).optional(),
  })
  .strict();

export const teamWorkspaceManageInputSchema = z
  .object({
    action: z.enum(['list', 'create', 'update', 'delete']),
    workspaceId: z.string().trim().min(1).max(200).optional(),
    workspace: workspaceDraftSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'create' && !value.workspace?.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'create 必须提供 workspace.name。',
        path: ['workspace', 'name'],
      });
    }
    if (value.action === 'update') {
      if (!value.workspaceId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'update 必须提供 workspaceId。',
          path: ['workspaceId'],
        });
      }
      if (!value.workspace) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'update 必须提供 workspace 字段。',
          path: ['workspace'],
        });
      }
    }
    if (value.action === 'delete' && !value.workspaceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'delete 必须提供 workspaceId。',
        path: ['workspaceId'],
      });
    }
  });

export const teamWorkspaceManageToolDefinition: ToolDefinition<
  typeof teamWorkspaceManageInputSchema,
  z.ZodString
> = {
  name: TEAM_WORKSPACE_MANAGE_TOOL_NAME,
  description:
    '管理当前用户的团队工作区。action=list 列举；create 新建；update 修改；delete 删除。' +
    '变更类操作需要用户批准。defaultTeamRoster 的每个成员槽位需要完整字段（id / layer / specialty / displayName / personaKey / toolsets / required）；' +
    '其能力绑定 skillIds / mcpServerIds 必须命中已安装技能 / 已配置 MCP server，否则会被拒绝。',
  inputSchema: teamWorkspaceManageInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('team_workspace_manage must execute through the gateway-managed sandbox path');
  },
};

// ---------------------------------------------------------------------------
// 会话守卫（fail-closed）
// ---------------------------------------------------------------------------

export interface TeamWorkspaceManageSessionRow {
  metadata_json: string;
  role_layer: string | null;
  team_parent_session_id: string | null;
  handoff_state: string | null;
}

const TEAM_ROLE_LAYERS = new Set(['pm1', 'pm2', 'executor', 'reviewer', 'reception']);

/** 返回拒绝原因；`null` 表示允许进入正常权限门控。 */
export function resolveTeamWorkspaceManageSessionDenial(
  row: TeamWorkspaceManageSessionRow | null,
): string | null {
  if (!row) {
    return '当前会话不存在或无法解析，已拒绝团队工作区变更。';
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
    return '团队会话不允许修改团队工作区，请回到个人会话操作。';
  }

  const source = typeof metadata['source'] === 'string' ? metadata['source'] : '';
  if (source === 'cron') {
    return '定时任务会话无人审批，不允许修改团队工作区。';
  }
  if (source === 'channel') {
    return '消息渠道会话不允许修改团队工作区，请在设置页或桌面端操作。';
  }

  return null;
}

function readTeamWorkspaceManageSessionRow(
  sessionId: string,
): TeamWorkspaceManageSessionRow | null {
  return (
    sqliteGet<TeamWorkspaceManageSessionRow>(
      'SELECT metadata_json, role_layer, team_parent_session_id, handoff_state FROM sessions WHERE id = ? LIMIT 1',
      [sessionId],
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// roster 校验
// ---------------------------------------------------------------------------

/** 显式拒绝「输入了 roster 但槽位被丢弃」——normalize 会静默回退默认编制。 */
function normalizeRosterOrThrow(raw: readonly unknown[]): FixedTeamMemberSlot[] {
  if (raw.length === 0) {
    return [];
  }
  const validCount = countValidMemberSlots(raw);
  if (validCount < raw.length) {
    throw new Error(
      `defaultTeamRoster 有 ${raw.length - validCount} 个成员槽位未通过校验；` +
        '每个槽位必须提供 id / layer / specialty / displayName / personaKey / toolsets / required 完整字段。',
    );
  }
  return normalizeTeamWorkspaceDefaultRoster(raw as FixedTeamMemberSlot[]);
}

/** 能力绑定白名单：未知技能 / MCP server 一律拒绝（授权面）。 */
function assertRosterBindingsAllowed(userId: string, roster: readonly FixedTeamMemberSlot[]): void {
  const validSkillIds = new Set<string>([
    ...BUILTIN_SKILLS.map((entry) => entry.manifest.id),
    ...listInstalledSkillsForUser(userId).map((skill) => skill.skillId),
  ]);
  const validMcpIds = new Set(loadConfiguredMcpServersForUser(userId).map((server) => server.id));

  const unknownSkillIds = new Set<string>();
  const unknownMcpIds = new Set<string>();
  for (const slot of roster) {
    for (const skillId of slot.skillIds ?? []) {
      if (!validSkillIds.has(skillId)) unknownSkillIds.add(skillId);
    }
    for (const mcpId of slot.mcpServerIds ?? []) {
      if (!validMcpIds.has(mcpId)) unknownMcpIds.add(mcpId);
    }
  }

  const issues: string[] = [];
  if (unknownSkillIds.size > 0) {
    issues.push(`未安装 / 未知技能：${[...unknownSkillIds].join(', ')}`);
  }
  if (unknownMcpIds.size > 0) {
    issues.push(`未配置 / 未知 MCP server：${[...unknownMcpIds].join(', ')}`);
  }
  if (issues.length > 0) {
    throw new Error(
      `roster 能力绑定校验失败——${issues.join('；')}。请先安装技能 / 配置 MCP，或移除绑定。`,
    );
  }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function toWorkspaceSummary(workspace: TeamWorkspaceRecord): Record<string, unknown> {
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    visibility: workspace.visibility,
    defaultWorkingRoot: workspace.defaultWorkingRoot,
    memberCount: workspace.defaultTeamRoster.length,
    members: workspace.defaultTeamRoster.map((slot) => ({
      id: slot.id,
      layer: slot.layer,
      specialty: slot.specialty,
      displayName: slot.displayName,
      skillIds: slot.skillIds ?? [],
      mcpServerIds: slot.mcpServerIds ?? [],
    })),
    updatedAt: workspace.updatedAt,
  };
}

function toWorkspaceListEntry(workspace: TeamWorkspaceRecord): Record<string, unknown> {
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    visibility: workspace.visibility,
    defaultWorkingRoot: workspace.defaultWorkingRoot,
    memberCount: workspace.defaultTeamRoster.length,
    updatedAt: workspace.updatedAt,
  };
}

function requireWorkspaceId(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error('缺少 workspaceId。');
  }
  return value.trim();
}

// ---------------------------------------------------------------------------
// 动作实现
// ---------------------------------------------------------------------------

function listWorkspacesForTool(userId: string): string {
  const workspaces = listTeamWorkspacesForUser(userId).map(toWorkspaceListEntry);
  return JSON.stringify(
    { ok: true, action: 'list', count: workspaces.length, workspaces },
    null,
    2,
  );
}

function resolveRosterForTool(
  userId: string,
  rawRoster: readonly unknown[] | undefined,
): FixedTeamMemberSlot[] | undefined {
  if (rawRoster === undefined) {
    return undefined;
  }
  const roster = normalizeRosterOrThrow(rawRoster);
  assertRosterBindingsAllowed(userId, roster);
  return roster;
}

function createWorkspaceForTool(
  userId: string,
  input: z.infer<typeof teamWorkspaceManageInputSchema>,
): string {
  const draft = input.workspace;
  if (!draft?.name) {
    throw new Error('create 必须提供 workspace.name。');
  }
  const roster = resolveRosterForTool(userId, draft.defaultTeamRoster);
  const workspace = createTeamWorkspace(userId, {
    name: draft.name,
    ...(draft.description !== undefined ? { description: draft.description } : {}),
    ...(draft.visibility !== undefined ? { visibility: draft.visibility } : {}),
    ...(draft.defaultWorkingRoot !== undefined
      ? { defaultWorkingRoot: draft.defaultWorkingRoot }
      : {}),
    ...(roster !== undefined ? { defaultTeamRoster: roster } : {}),
  });
  return JSON.stringify(
    { ok: true, action: 'create', workspace: toWorkspaceSummary(workspace) },
    null,
    2,
  );
}

function updateWorkspaceForTool(
  userId: string,
  input: z.infer<typeof teamWorkspaceManageInputSchema>,
): string {
  const workspaceId = requireWorkspaceId(input.workspaceId);
  const draft = input.workspace ?? {};
  if (Object.keys(draft).length === 0) {
    throw new Error('update 至少需要一个要修改的字段。');
  }
  const roster = resolveRosterForTool(userId, draft.defaultTeamRoster);
  const workspace = updateTeamWorkspace(userId, workspaceId, {
    ...(draft.name !== undefined ? { name: draft.name } : {}),
    ...(draft.description !== undefined ? { description: draft.description } : {}),
    ...(draft.visibility !== undefined ? { visibility: draft.visibility } : {}),
    ...(draft.defaultWorkingRoot !== undefined
      ? { defaultWorkingRoot: draft.defaultWorkingRoot }
      : {}),
    ...(roster !== undefined ? { defaultTeamRoster: roster } : {}),
  });
  if (!workspace) {
    throw new Error(`未找到团队工作区 ${workspaceId}。`);
  }
  return JSON.stringify(
    { ok: true, action: 'update', workspace: toWorkspaceSummary(workspace) },
    null,
    2,
  );
}

function deleteWorkspaceForTool(
  userId: string,
  input: z.infer<typeof teamWorkspaceManageInputSchema>,
): string {
  const workspaceId = requireWorkspaceId(input.workspaceId);
  const removed = deleteTeamWorkspace(userId, workspaceId);
  if (!removed) {
    throw new Error(`未找到团队工作区 ${workspaceId}。`);
  }
  return JSON.stringify({ ok: true, action: 'delete', workspaceId, removed: true }, null, 2);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface RunTeamWorkspaceManageInput {
  userId: string;
  sessionId: string;
  input: z.infer<typeof teamWorkspaceManageInputSchema>;
}

export async function runTeamWorkspaceManageTool(
  params: RunTeamWorkspaceManageInput,
): Promise<string> {
  const denial = resolveTeamWorkspaceManageSessionDenial(
    readTeamWorkspaceManageSessionRow(params.sessionId),
  );
  if (denial) {
    throw new Error(denial);
  }

  const { userId, input } = params;
  switch (input.action) {
    case 'list':
      return listWorkspacesForTool(userId);
    case 'create':
      return createWorkspaceForTool(userId, input);
    case 'update':
      return updateWorkspaceForTool(userId, input);
    case 'delete':
      return deleteWorkspaceForTool(userId, input);
    default: {
      const exhaustive: never = input.action;
      throw new Error(`不支持的 action: ${String(exhaustive)}`);
    }
  }
}
