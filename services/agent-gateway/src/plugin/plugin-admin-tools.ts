/**
 * `plugin_manage` —— 会话内模型在用户审批下管理插件（安装 / 卸载 / 启停 /
 * 重载）与插件市场（搜索 / 来源管理）。
 *
 * 设计边界（对齐 260924-AI插件管理工具）：
 * - 安装只走**市场来源**（GitHub zipball，复用 `installPluginFromGitHub` 与
 *   HTTP 路由同源）；不接受本地路径（模型不应直传服务器文件系统路径）；
 * - 卸载/启停/重载复用 `lifecycle-ops`（校验、存储清理、热重载与路由一致）；
 * - team / cron / channel 会话直接拒绝（插件是网关全局代码执行面）；
 * - 安装结果必须带来源与「无沙箱」提示，便于模型向用户交代风险。
 */

import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import { sqliteGet } from '../infra/db.js';
import { getTrackedPlugins } from '../runtime/plugin-host.js';
import { PluginFetchError } from './github-fetch.js';
import { PluginInstallError } from './installer.js';
import {
  installIdForSource,
  reloadPluginByInstallId,
  setPluginEnabledById,
  uninstallPluginByInstallId,
  type PluginOpResult,
} from './lifecycle-ops.js';
import { installPluginFromGitHub } from './market-install.js';
import { getMarketEntryDetail, searchMarketPlugins } from './marketplace.js';
import { PLUGIN_MANAGE_TOOL_NAME } from './plugin-manage-tool-name.js';
import { getPluginRegistry } from './registry.js';
import {
  addPluginSource,
  listPluginSources,
  PluginSourceError,
  removePluginSource,
} from './sources-store.js';
import { isPluginGuarded } from './supervisor.js';

export { PLUGIN_MANAGE_TOOL_NAME } from './plugin-manage-tool-name.js';

// ---------------------------------------------------------------------------
// 输入 schema
// ---------------------------------------------------------------------------

export const pluginManageInputSchema = z
  .object({
    action: z.enum([
      'list',
      'search',
      'source_list',
      'install',
      'uninstall',
      'enable',
      'disable',
      'reload',
      'source_add',
      'source_remove',
    ]),
    /** search 关键字（可选）。 */
    query: z.string().trim().max(200).optional(),
    /** 市场条目：来源 id（`owner/repo`）。 */
    sourceId: z.string().trim().min(1).max(200).optional(),
    /** 市场条目：插件名。 */
    name: z.string().trim().min(1).max(100).optional(),
    /** GitHub 直装：`owner/repo` 或 `owner/repo@ref`。 */
    repo: z.string().trim().min(1).max(200).optional(),
    /** GitHub 直装/市场条目：仓库内路径。 */
    path: z.string().trim().max(300).optional(),
    /** GitHub 直装：分支 / tag。 */
    ref: z.string().trim().max(200).optional(),
    /** 已安装插件目录名（卸载 / 重载）。 */
    installId: z.string().trim().min(1).max(64).optional(),
    /** 插件 id（启停）。 */
    pluginId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (message: string, field: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [field] });
    };
    switch (value.action) {
      case 'install':
        if (value.sourceId && value.name) return;
        if (value.repo) return;
        issue('install 需要提供 sourceId+name（市场条目）或 repo（GitHub 直装）。', 'repo');
        return;
      case 'uninstall':
      case 'reload':
        if (!value.installId) issue(`${value.action} 必须提供 installId。`, 'installId');
        return;
      case 'enable':
      case 'disable':
        if (!value.pluginId) issue(`${value.action} 必须提供 pluginId。`, 'pluginId');
        return;
      case 'source_add':
        if (!value.repo)
          issue('source_add 必须提供 repo（owner/repo 或 owner/repo@ref）。', 'repo');
        return;
      case 'source_remove':
        if (!value.sourceId) issue('source_remove 必须提供 sourceId。', 'sourceId');
        return;
      default:
        return;
    }
  });

export const pluginManageToolDefinition: ToolDefinition<
  typeof pluginManageInputSchema,
  z.ZodString
> = {
  name: PLUGIN_MANAGE_TOOL_NAME,
  description:
    '管理网关插件平台。action=list 列出已安装插件（状态/来源/installId）；search 搜索插件市场（可选 query）；' +
    'source_list / source_add / source_remove 管理市场来源（GitHub 仓库）；' +
    'install 从市场条目（sourceId+name）或 GitHub（repo，可带 path/ref）安装；uninstall 卸载；enable/disable 启停；reload 重载。' +
    '变更类操作需要用户批准。插件与网关同进程运行、没有沙箱——安装前请向用户说明来源与风险；' +
    '受保护（guarded）的内置插件不可停用或卸载。',
  inputSchema: pluginManageInputSchema,
  outputSchema: z.string(),
  timeout: 120000,
  execute: async () => {
    throw new Error('plugin_manage must execute through the gateway-managed sandbox path');
  },
};

// ---------------------------------------------------------------------------
// 会话守卫（fail-closed）
// ---------------------------------------------------------------------------

export interface PluginManageSessionRow {
  metadata_json: string;
  role_layer: string | null;
  team_parent_session_id: string | null;
  handoff_state: string | null;
}

const TEAM_ROLE_LAYERS = new Set(['pm1', 'pm2', 'executor', 'reviewer', 'reception']);

/** 返回拒绝原因；`null` 表示允许进入正常权限门控。 */
export function resolvePluginManageSessionDenial(
  row: PluginManageSessionRow | null,
): string | null {
  if (!row) {
    return '当前会话不存在或无法解析，已拒绝插件变更。';
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
    return '团队会话不允许修改插件安装（插件是网关全局能力），请回到个人会话操作。';
  }

  const source = typeof metadata['source'] === 'string' ? metadata['source'] : '';
  if (source === 'cron') {
    return '定时任务会话无人审批，不允许修改插件安装。';
  }
  if (source === 'channel') {
    return '消息渠道会话不允许修改插件安装，请在设置页或桌面端操作。';
  }

  return null;
}

function readPluginManageSessionRow(sessionId: string): PluginManageSessionRow | null {
  return (
    sqliteGet<PluginManageSessionRow>(
      'SELECT metadata_json, role_layer, team_parent_session_id, handoff_state FROM sessions WHERE id = ? LIMIT 1',
      [sessionId],
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// 输出（与 skill_manage / mcp_manage_servers 同构：成功返回 JSON，业务失败抛错）
// ---------------------------------------------------------------------------

const INSTALL_TRUST_NOTICE =
  '插件与网关同进程运行、没有沙箱；只安装来源可信的代码，可在「设置 → 插件 → 已安装插件」中停用或卸载。';

function listPluginsForTool(): string {
  const registryEntries = getPluginRegistry().list();
  const knownIds = new Set(registryEntries.map((entry) => entry.id));
  const disabledEntries = getTrackedPlugins()
    .filter((tracked) => tracked.disabled === true && !knownIds.has(tracked.pluginId))
    .map((tracked) => ({
      id: tracked.pluginId,
      source: tracked.spec,
      state: { status: 'disabled' as const },
      error: undefined as string | undefined,
    }));

  const plugins = [
    ...registryEntries.map((entry) => ({
      id: entry.id,
      state: entry.state.status,
      ...(entry.state.status === 'failed' ? { error: entry.state.error } : {}),
      ...(entry.source === undefined ? {} : { source: entry.source }),
      ...(installIdForSource(entry.source) === undefined
        ? {}
        : { installId: installIdForSource(entry.source) }),
      guarded: isPluginGuarded(entry.id),
    })),
    ...disabledEntries.map((entry) => ({
      id: entry.id,
      state: entry.state.status,
      ...(entry.source === undefined ? {} : { source: entry.source }),
      ...(installIdForSource(entry.source) === undefined
        ? {}
        : { installId: installIdForSource(entry.source) }),
      guarded: isPluginGuarded(entry.id),
    })),
  ];

  return JSON.stringify(
    {
      ok: true,
      action: 'list',
      count: plugins.length,
      plugins,
      ...(plugins.length === 0
        ? {
            hint: '当前没有已安装的插件；可用 search 搜索市场，或 source_add 添加 GitHub 来源。',
          }
        : {}),
    },
    null,
    2,
  );
}

async function searchMarketForTool(query?: string): Promise<string> {
  const listing = await searchMarketPlugins(query);
  return JSON.stringify(
    {
      ok: true,
      action: 'search',
      count: listing.entries.length,
      entries: listing.entries.map((entry) => ({
        name: entry.name,
        sourceId: entry.sourceId,
        repo: entry.repo,
        ...(entry.ref === undefined ? {} : { ref: entry.ref }),
        path: entry.path,
        ...(entry.version === undefined ? {} : { version: entry.version }),
        ...(entry.author === undefined ? {} : { author: entry.author }),
        description: entry.description,
        fallback: entry.fallback,
      })),
      failedSources: listing.failedSources,
      ...(listing.entries.length === 0
        ? {
            hint: '市场没有匹配的插件；可用 source_add（repo=owner/repo）添加 GitHub 来源。',
          }
        : {}),
    },
    null,
    2,
  );
}

function listSourcesForTool(): string {
  const sources = listPluginSources();
  return JSON.stringify(
    {
      ok: true,
      action: 'source_list',
      count: sources.length,
      sources: sources.map((source) => ({
        sourceId: source.id,
        repo: source.repo,
        ...(source.ref === undefined ? {} : { ref: source.ref }),
        name: source.name,
      })),
      ...(sources.length === 0
        ? { hint: '还没有配置市场来源；用 source_add（repo=owner/repo 或 owner/repo@ref）添加。' }
        : {}),
    },
    null,
    2,
  );
}

function addSourceForTool(input: z.infer<typeof pluginManageInputSchema>): string {
  let source;
  try {
    source = addPluginSource({
      repo: input.repo ?? '',
      ...(input.ref === undefined ? {} : { ref: input.ref }),
    });
  } catch (err) {
    if (err instanceof PluginSourceError) throw new Error(`添加来源失败：${err.message}`);
    throw err;
  }
  return JSON.stringify(
    {
      ok: true,
      action: 'source_add',
      source: {
        sourceId: source.id,
        repo: source.repo,
        ...(source.ref === undefined ? {} : { ref: source.ref }),
      },
      hint: '可用 search 浏览该来源中的插件。',
    },
    null,
    2,
  );
}

function removeSourceForTool(input: z.infer<typeof pluginManageInputSchema>): string {
  const sourceId = input.sourceId ?? '';
  const removed = removePluginSource(sourceId);
  if (!removed) {
    throw new Error(`市场来源 ${sourceId} 不存在。`);
  }
  return JSON.stringify({ ok: true, action: 'source_remove', sourceId, removed: true }, null, 2);
}

async function installForTool(input: z.infer<typeof pluginManageInputSchema>): Promise<string> {
  let repo = input.repo?.trim() ?? '';
  let path = input.path?.trim();
  let ref = input.ref?.trim();
  let name = input.name?.trim();

  if (repo.length === 0 && input.sourceId && name) {
    const detail = await getMarketEntryDetail(input.sourceId, name);
    if (!detail) {
      throw new Error(
        `市场条目不存在：sourceId=${input.sourceId}, name=${name}。请先 search 确认，或先 source_add 添加来源。`,
      );
    }
    repo = detail.entry.repo;
    ref = detail.entry.ref;
    path = detail.entry.path.length > 0 ? detail.entry.path : undefined;
    name = detail.entry.name;
  }
  if (repo.length === 0) {
    throw new Error('install 需要提供 sourceId+name（市场条目）或 repo（GitHub 直装）。');
  }

  try {
    const result = await installPluginFromGitHub({
      repo,
      ...(path === undefined || path.length === 0 ? {} : { path }),
      ...(ref === undefined || ref.length === 0 ? {} : { ref }),
      ...(name === undefined || name.length === 0 ? {} : { name }),
    });
    return JSON.stringify(
      {
        ok: true,
        action: 'install',
        install: {
          installId: result.install.installId,
          path: result.install.path,
          entrypoint: result.install.entrypoint,
        },
        source: result.source,
        plugin: result.plugin,
        notice: INSTALL_TRUST_NOTICE,
      },
      null,
      2,
    );
  } catch (err) {
    if (
      err instanceof PluginFetchError ||
      err instanceof PluginInstallError ||
      err instanceof PluginSourceError
    ) {
      throw new Error(`安装失败：${err.message}`);
    }
    throw err;
  }
}

function requireOpSuccess(label: string, result: PluginOpResult): string {
  if (!result.ok) {
    throw new Error(`${label}失败：${result.error}`);
  }
  return result.detail;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface RunPluginManageInput {
  /**
   * 保留字段：插件是**网关全局**能力（不分用户），守卫与生命周期操作均按
   * sessionId / 全局注册表判定；与沙箱对管理工具的统一调用形态保持一致。
   */
  readonly userId: string;
  readonly sessionId: string;
  readonly input: z.infer<typeof pluginManageInputSchema>;
}

export async function runPluginManageTool(params: RunPluginManageInput): Promise<string> {
  const denial = resolvePluginManageSessionDenial(readPluginManageSessionRow(params.sessionId));
  if (denial) {
    throw new Error(denial);
  }

  const { input } = params;
  switch (input.action) {
    case 'list':
      return listPluginsForTool();
    case 'search':
      return await searchMarketForTool(input.query);
    case 'source_list':
      return listSourcesForTool();
    case 'source_add':
      return addSourceForTool(input);
    case 'source_remove':
      return removeSourceForTool(input);
    case 'install':
      return await installForTool(input);
    case 'uninstall':
      return JSON.stringify(
        {
          ok: true,
          action: 'uninstall',
          installId: input.installId ?? '',
          detail: requireOpSuccess('卸载', await uninstallPluginByInstallId(input.installId ?? '')),
        },
        null,
        2,
      );
    case 'reload':
      return JSON.stringify(
        {
          ok: true,
          action: 'reload',
          installId: input.installId ?? '',
          detail: requireOpSuccess('重载', await reloadPluginByInstallId(input.installId ?? '')),
        },
        null,
        2,
      );
    case 'enable':
      return JSON.stringify(
        {
          ok: true,
          action: 'enable',
          pluginId: input.pluginId ?? '',
          detail: requireOpSuccess('启用', await setPluginEnabledById(input.pluginId ?? '', true)),
        },
        null,
        2,
      );
    case 'disable':
      return JSON.stringify(
        {
          ok: true,
          action: 'disable',
          pluginId: input.pluginId ?? '',
          detail: requireOpSuccess('停用', await setPluginEnabledById(input.pluginId ?? '', false)),
        },
        null,
        2,
      );
    default: {
      const exhaustive: never = input.action;
      throw new Error(`不支持的 action: ${String(exhaustive)}`);
    }
  }
}
