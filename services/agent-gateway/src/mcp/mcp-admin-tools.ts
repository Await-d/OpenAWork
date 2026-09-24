/**
 * `mcp_manage_servers` —— 会话内模型自助管理 MCP 服务器配置。
 *
 * 设计边界（对齐 260924-MCP自助管理工具 方案文档）：
 * - 只写「当前会话 owner」的 `user_settings.mcp_servers`，工具不接受 userId 参数；
 * - 写入与设置页 / `PUT /settings/mcp-servers` 完全同规（复用 `mcpServerConfigSchema`）；
 * - 内置 MCP 保护：system builtin（websearch / grep_app）与 protected virtual / adapter
 *   （codegraph / git_bash / lsp / omo）不允许模型覆盖端点，只能启停 / 调整 disabledTools；
 * - 从 runtime 合并结果构造内置条目时**绝不落 headers / env / oauth**（例如
 *   `EXA_API_KEY` 会以 header 形式注入内置 websearch，持久化会泄漏密钥）；
 * - 写库后立即探活（`retryMcpConnectionForUser`），把连接结果带回模型；
 * - team / cron / channel 会话直接拒绝（这些会话无人审批或被自动免审批）。
 */

import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { getBuiltinMcpKind, isProtectedBuiltinMcpId } from './builtin-mcps.js';
import {
  parseMcpServerConfigEntry,
  sanitizePersistedMcpServers,
  type McpServerSettingsConfig,
} from './mcp-settings-schemas.js';
import {
  getMcpPoolKey,
  loadConfiguredMcpServersForUser,
  retryMcpConnectionForUser,
  type ConfiguredMCPServer,
  type RetryMcpConnectResult,
} from './mcp-runtime.js';
import { mcpConnectionPool } from '../skill/skill-mcp-connection-pool.js';
import { clearCatalogSnapshot } from './mcp-tool-catalog.js';
import { MCP_MANAGE_SERVERS_TOOL_NAME } from './mcp-manage-tool-name.js';

export { MCP_MANAGE_SERVERS_TOOL_NAME } from './mcp-manage-tool-name.js';

const MCP_SERVERS_SETTING_KEY = 'mcp_servers';

// ---------------------------------------------------------------------------
// 输入 schema
// ---------------------------------------------------------------------------

const mcpManageServerDraftSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(120),
    transport: z.enum(['sse', 'stdio']),
    url: z.string().trim().url().max(2000).optional(),
    command: z.string().trim().min(1).max(300).optional(),
    args: z.array(z.string().max(300)).max(80).optional(),
    cwd: z.string().trim().min(1).max(1000).optional(),
    env: z.record(z.string().trim().min(1).max(160), z.string().max(2000)).optional(),
    headers: z.record(z.string().trim().min(1).max(160), z.string().max(2000)).optional(),
    required: z.boolean().optional(),
    disabledTools: z.array(z.string().trim().min(1).max(160)).max(300).optional(),
    oauth: z
      .union([
        z.literal(false),
        z
          .object({
            clientId: z.string().trim().min(1).max(200).optional(),
            clientSecret: z.string().trim().min(1).max(500).optional(),
            scope: z.string().trim().min(1).max(500).optional(),
            redirectUri: z.string().trim().url().max(1000).optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((server, ctx) => {
    if (server.transport === 'sse' && !server.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sse 传输必须提供 url。',
        path: ['url'],
      });
    }
    if (server.transport === 'stdio' && !server.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'stdio 传输必须提供 command。',
        path: ['command'],
      });
    }
  });

export type McpManageServerDraft = z.infer<typeof mcpManageServerDraftSchema>;

export const mcpManageServersInputSchema = z
  .object({
    action: z.enum(['list', 'add', 'update', 'remove', 'enable', 'disable']),
    server: mcpManageServerDraftSchema.optional(),
    serverId: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'add' || value.action === 'update') {
      if (!value.server) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'add/update 必须提供 server。',
          path: ['server'],
        });
      }
      if (value.action === 'update' && !value.serverId && !value.server?.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'update 必须提供 serverId 或 server.id。',
          path: ['serverId'],
        });
      }
      return;
    }
    if (value.action !== 'list' && !value.serverId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.action} 必须提供 serverId。`,
        path: ['serverId'],
      });
    }
  });

export const mcpManageServersToolDefinition: ToolDefinition<
  typeof mcpManageServersInputSchema,
  z.ZodString
> = {
  name: MCP_MANAGE_SERVERS_TOOL_NAME,
  description:
    '管理当前用户的 MCP 服务器配置。action=list 列举全部（含禁用项）；add/update 新增或覆盖自定义 SSE / stdio MCP；remove 移除用户配置（内置项移除后恢复默认）；enable/disable 启停。' +
    '变更类操作需要用户批准，写入后立即尝试连接并返回结果，下一轮即可使用新的 MCP 工具。' +
    '系统内置 MCP（websearch / grep_app）与受保护内置（codegraph / git_bash / lsp / omo）不支持覆盖端点，只能启停或调整 disabledTools。' +
    'update 时未提供的字段（env / headers / oauth / disabledTools / enabled）保留原值。',
  inputSchema: mcpManageServersInputSchema,
  outputSchema: z.string(),
  timeout: 120000,
  execute: async () => {
    throw new Error('mcp_manage_servers must execute through the gateway-managed sandbox path');
  },
};

// ---------------------------------------------------------------------------
// 会话守卫（fail-closed）
// ---------------------------------------------------------------------------

export interface McpManageSessionRow {
  metadata_json: string;
  role_layer: string | null;
  team_parent_session_id: string | null;
  handoff_state: string | null;
}

const TEAM_ROLE_LAYERS = new Set(['pm1', 'pm2', 'executor', 'reviewer', 'reception']);

/**
 * 返回拒绝原因；`null` 表示允许进入正常权限门控。
 *
 * 纯函数，便于单测。team 后台成员会被 `isBackgroundAutoApprovedTeamSession` 自动
 * 免审批，cron 会话无人审批，channel 会话本就不该管理个人配置——三类都在此拒绝。
 */
export function resolveMcpManageSessionDenial(row: McpManageSessionRow | null): string | null {
  if (!row) {
    return '当前会话不存在或无法解析，已拒绝 MCP 配置变更。';
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
    return '团队会话不允许修改 MCP 配置，请回到个人会话操作。';
  }

  const source = typeof metadata['source'] === 'string' ? metadata['source'] : '';
  if (source === 'cron') {
    return '定时任务会话无人审批，不允许修改 MCP 配置。';
  }
  if (source === 'channel') {
    return '消息渠道会话不允许修改 MCP 配置，请在设置页或桌面端操作。';
  }

  return null;
}

function readMcpManageSessionRow(sessionId: string): McpManageSessionRow | null {
  return (
    sqliteGet<McpManageSessionRow>(
      'SELECT metadata_json, role_layer, team_parent_session_id, handoff_state FROM sessions WHERE id = ? LIMIT 1',
      [sessionId],
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// 持久化读写（读-改-写全程同步，避免并发交错）
// ---------------------------------------------------------------------------

interface UserSettingRow {
  value: string;
}

function readPersistedMcpServers(userId: string): McpServerSettingsConfig[] {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'mcp_servers'`,
    [userId],
  );
  if (!row?.value) {
    return [];
  }
  try {
    return sanitizePersistedMcpServers(JSON.parse(row.value));
  } catch {
    // 坏 JSON 与 runtime 读取路径保持一致的容错：视为空用户配置。
    return [];
  }
}

function writePersistedMcpServers(userId: string, servers: McpServerSettingsConfig[]): void {
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, '${MCP_SERVERS_SETTING_KEY}', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, JSON.stringify(servers)],
  );
}

// ---------------------------------------------------------------------------
// 条目构造
// ---------------------------------------------------------------------------

function generateMcpServerId(name: string, existingIds: ReadonlySet<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `mcp-${Date.now().toString(36)}`;
  if (!existingIds.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }
  return `mcp-${Date.now().toString(36)}`;
}

/**
 * system builtin（websearch / grep_app）的启停条目：镜像设置页语义——写完整
 * 内置端点且不带 `source`，等价于「用户覆盖」。刻意丢弃 headers / env / oauth，
 * 防止把 runtime 注入的密钥（如 EXA_API_KEY）持久化到用户配置。
 */
function buildSystemBuiltinEntry(
  server: ConfiguredMCPServer,
  options: { name: string; disabledTools: string[] | undefined },
  enabled: boolean,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    id: server.id,
    name: options.name,
    transport: server.transport,
    enabled,
  };
  if (server.url) entry['url'] = server.url;
  if (server.command) entry['command'] = server.command;
  if (server.args) entry['args'] = server.args;
  if (server.cwd) entry['cwd'] = server.cwd;
  if (options.disabledTools && options.disabledTools.length > 0) {
    entry['disabledTools'] = options.disabledTools;
  }
  return entry;
}

function buildProtectedBuiltinEntry(
  server: ConfiguredMCPServer,
  enabled: boolean,
  disabledTools: string[] | undefined,
): Record<string, unknown> {
  return {
    id: server.id,
    name: server.name,
    transport: 'stdio',
    builtin: true,
    source: 'system',
    enabled,
    ...(disabledTools && disabledTools.length > 0 ? { disabledTools } : {}),
  };
}

function buildUserEntry(input: {
  id: string;
  draft: McpManageServerDraft;
  existing: McpServerSettingsConfig | undefined;
  enabled: boolean;
}): Record<string, unknown> {
  const { id, draft, existing, enabled } = input;
  const entry: Record<string, unknown> = {
    id,
    name: draft.name,
    transport: draft.transport,
    enabled,
  };

  if (draft.transport === 'sse') {
    if (draft.url) entry['url'] = draft.url;
  } else {
    if (draft.command) entry['command'] = draft.command;
    const args = draft.args ?? existing?.args;
    if (args) entry['args'] = args;
    const cwd = draft.cwd ?? existing?.cwd;
    if (cwd) entry['cwd'] = cwd;
    const env = draft.env ?? existing?.env;
    if (env) entry['env'] = env;
  }

  const headers = draft.headers ?? existing?.headers;
  if (headers) entry['headers'] = headers;
  const required = draft.required ?? existing?.required;
  if (required !== undefined) entry['required'] = required;
  const disabledTools = draft.disabledTools ?? existing?.disabledTools;
  if (disabledTools && disabledTools.length > 0) entry['disabledTools'] = disabledTools;
  if (draft.oauth !== undefined) {
    entry['oauth'] = draft.oauth;
  } else if (existing?.oauth !== undefined) {
    entry['oauth'] = existing.oauth;
  }

  return entry;
}

function replaceOrAppend(
  servers: McpServerSettingsConfig[],
  entry: McpServerSettingsConfig,
): McpServerSettingsConfig[] {
  const index = servers.findIndex((server) => server.id === entry.id);
  if (index < 0) {
    return [...servers, entry];
  }
  return servers.map((server, current) => (current === index ? entry : server));
}

// ---------------------------------------------------------------------------
// 连接刷新
// ---------------------------------------------------------------------------

async function safeConnect(userId: string, serverId: string): Promise<RetryMcpConnectResult> {
  try {
    return await retryMcpConnectionForUser(userId, serverId);
  } catch (error) {
    return {
      serverId,
      serverName: serverId,
      status: 'error',
      toolCount: 0,
      durationMs: 0,
      error: sanitizeConnectError(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function disconnectMcpServer(userId: string, server: ConfiguredMCPServer): Promise<void> {
  const poolKey = getMcpPoolKey(server);
  await mcpConnectionPool.disconnectUserConnection(userId, poolKey);
  clearCatalogSnapshot(userId, poolKey);
}

function toSafeServerSummary(server: ConfiguredMCPServer): Record<string, unknown> {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    builtin: server.builtin === true,
    builtinKind: server.builtinKind ?? null,
    source: server.source ?? 'user',
    disabledTools: server.disabledTools ?? [],
  };
}

/**
 * 连接错误脱敏：SDK / transport 的错误文本可能携带完整 URL（含 query 里的
 * API Key）。模型从未在 list 里看到过这些端点，不能让失败信息把它们带回
 * 会话历史——统一把 URL 折叠为 origin + pathname。
 */
function sanitizeConnectError(message: string): string {
  return message.replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
    try {
      const url = new URL(raw);
      return `${url.origin}${url.pathname}`;
    } catch {
      return raw;
    }
  });
}

function formatConnectResult(result: RetryMcpConnectResult): Record<string, unknown> {
  return {
    status: result.status,
    toolCount: result.toolCount,
    durationMs: result.durationMs,
    ...(result.error ? { error: sanitizeConnectError(result.error) } : {}),
  };
}

// ---------------------------------------------------------------------------
// 动作实现
// ---------------------------------------------------------------------------

function requireServerId(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error('缺少 serverId。');
  }
  return value.trim();
}

function hasEndpointFields(draft: McpManageServerDraft): boolean {
  return Boolean(
    draft.url ||
    draft.command ||
    draft.args ||
    draft.cwd ||
    draft.env ||
    draft.headers ||
    draft.oauth !== undefined,
  );
}

async function upsertServer(
  userId: string,
  input: z.infer<typeof mcpManageServersInputSchema>,
): Promise<string> {
  const draft = input.server;
  if (!draft) {
    throw new Error('add/update 必须提供 server。');
  }

  const merged = loadConfiguredMcpServersForUser(userId);
  const persisted = readPersistedMcpServers(userId);
  const requestedId = (input.serverId ?? draft.id ?? '').trim();
  if (input.serverId && draft.id && input.serverId.trim() !== draft.id.trim()) {
    throw new Error(`serverId(${input.serverId}) 与 server.id(${draft.id}) 不一致。`);
  }
  const id = requestedId || generateMcpServerId(draft.name, new Set(merged.map((s) => s.id)));

  const existingMerged = merged.find((server) => server.id === id);
  const existingPersisted = persisted.find((server) => server.id === id);
  const enabled = input.enabled ?? existingMerged?.enabled ?? true;
  const builtinKind = getBuiltinMcpKind(id);

  let entry: Record<string, unknown>;
  if (builtinKind === 'system') {
    if (hasEndpointFields(draft)) {
      throw new Error(
        `"${id}" 是系统内置 MCP，不支持修改端点；只能 enable/disable 或调整 disabledTools。`,
      );
    }
    if (!existingMerged) {
      throw new Error(`未找到内置 MCP "${id}"。`);
    }
    entry = buildSystemBuiltinEntry(
      existingMerged,
      { name: draft.name, disabledTools: draft.disabledTools ?? existingMerged.disabledTools },
      enabled,
    );
  } else if (isProtectedBuiltinMcpId(id)) {
    if (hasEndpointFields(draft)) {
      throw new Error(
        `"${id}" 是受保护的内置 MCP，端点由 runtime 提供；只支持 enabled / disabledTools。`,
      );
    }
    if (!existingMerged) {
      throw new Error(`未找到内置 MCP "${id}"。`);
    }
    entry = buildProtectedBuiltinEntry(
      existingMerged,
      enabled,
      draft.disabledTools ?? existingMerged.disabledTools,
    );
  } else {
    entry = buildUserEntry({ id, draft, existing: existingPersisted, enabled });
  }

  const parsed = parseMcpServerConfigEntry(entry);
  if (!parsed.ok) {
    throw new Error(`MCP 配置校验失败：${parsed.message}`);
  }

  writePersistedMcpServers(userId, replaceOrAppend(persisted, parsed.server));
  const connect = await safeConnect(userId, id);

  return JSON.stringify(
    {
      ok: true,
      action: input.action,
      serverId: id,
      enabled: parsed.server.enabled,
      saved: true,
      connect: formatConnectResult(connect),
    },
    null,
    2,
  );
}

async function removeServer(userId: string, rawServerId: string | undefined): Promise<string> {
  const serverId = requireServerId(rawServerId);
  const persisted = readPersistedMcpServers(userId);
  const index = persisted.findIndex((server) => server.id === serverId);
  const merged = loadConfiguredMcpServersForUser(userId);
  const mergedServer = merged.find((server) => server.id === serverId);

  if (index < 0) {
    if (mergedServer) {
      return JSON.stringify(
        {
          ok: true,
          action: 'remove',
          serverId,
          removed: false,
          note: '该 server 是内置 MCP（当前无用户覆盖配置），无需移除；如需停用请使用 disable。',
        },
        null,
        2,
      );
    }
    throw new Error(`未找到 MCP server "${serverId}"。`);
  }

  writePersistedMcpServers(
    userId,
    persisted.filter((server) => server.id !== serverId),
  );
  if (mergedServer) {
    await disconnectMcpServer(userId, mergedServer);
  }

  return JSON.stringify(
    {
      ok: true,
      action: 'remove',
      serverId,
      removed: true,
      builtinRestored: getBuiltinMcpKind(serverId) !== undefined,
      note: '用户配置已移除；同 id 内置 MCP 会恢复默认（若存在）。',
    },
    null,
    2,
  );
}

async function setServerEnabled(
  userId: string,
  rawServerId: string | undefined,
  enabled: boolean,
): Promise<string> {
  const serverId = requireServerId(rawServerId);
  const merged = loadConfiguredMcpServersForUser(userId);
  const server = merged.find((entry) => entry.id === serverId);
  if (!server) {
    throw new Error(`未找到 MCP server "${serverId}"。`);
  }

  const persisted = readPersistedMcpServers(userId);
  const existing = persisted.find((entry) => entry.id === serverId);
  const builtinKind = getBuiltinMcpKind(serverId);

  let entry: Record<string, unknown>;
  if (isProtectedBuiltinMcpId(serverId)) {
    entry = buildProtectedBuiltinEntry(server, enabled, server.disabledTools);
  } else if (builtinKind === 'system') {
    entry = buildSystemBuiltinEntry(
      server,
      { name: server.name, disabledTools: server.disabledTools },
      enabled,
    );
  } else if (existing) {
    entry = { ...existing, enabled };
  } else {
    // 理论上不可达：非内置 server 必然来自持久化配置。防御性构造完整条目。
    entry = buildUserEntry({
      id: serverId,
      draft: {
        name: server.name,
        transport: server.transport,
        ...(server.url ? { url: server.url } : {}),
        ...(server.command ? { command: server.command } : {}),
        ...(server.args ? { args: server.args } : {}),
        ...(server.cwd ? { cwd: server.cwd } : {}),
        ...(server.env ? { env: server.env } : {}),
        ...(server.headers ? { headers: server.headers } : {}),
        ...(server.disabledTools ? { disabledTools: server.disabledTools } : {}),
      },
      existing: undefined,
      enabled,
    });
  }

  const parsed = parseMcpServerConfigEntry(entry);
  if (!parsed.ok) {
    throw new Error(`MCP 配置校验失败：${parsed.message}`);
  }
  writePersistedMcpServers(userId, replaceOrAppend(persisted, parsed.server));

  if (!enabled) {
    await disconnectMcpServer(userId, server);
    return JSON.stringify(
      {
        ok: true,
        action: 'disable',
        serverId,
        enabled: false,
        saved: true,
        connect: { status: 'disabled', toolCount: 0, durationMs: 0 },
      },
      null,
      2,
    );
  }

  const connect = await safeConnect(userId, serverId);
  return JSON.stringify(
    {
      ok: true,
      action: 'enable',
      serverId,
      enabled: true,
      saved: true,
      connect: formatConnectResult(connect),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface RunMcpManageServersInput {
  userId: string;
  sessionId: string;
  input: z.infer<typeof mcpManageServersInputSchema>;
}

export async function runMcpManageServersTool(params: RunMcpManageServersInput): Promise<string> {
  const denial = resolveMcpManageSessionDenial(readMcpManageSessionRow(params.sessionId));
  if (denial) {
    throw new Error(denial);
  }

  const { userId, input } = params;
  switch (input.action) {
    case 'list':
      return JSON.stringify(
        {
          ok: true,
          action: 'list',
          servers: loadConfiguredMcpServersForUser(userId).map(toSafeServerSummary),
        },
        null,
        2,
      );
    case 'add':
    case 'update':
      return await upsertServer(userId, input);
    case 'remove':
      return await removeServer(userId, input.serverId);
    case 'enable':
      return await setServerEnabled(userId, input.serverId, true);
    case 'disable':
      return await setServerEnabled(userId, input.serverId, false);
    default: {
      const exhaustive: never = input.action;
      throw new Error(`不支持的 action: ${String(exhaustive)}`);
    }
  }
}
