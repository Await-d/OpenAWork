import { createHash } from 'node:crypto';
import type { MCPToolDef, MCPToolResult } from '@openAwork/mcp-client';
import type { MCPServerRef } from '@openAwork/skill-types';
import { sqliteGet } from '../infra/db.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { mergeBuiltinAndConfiguredMcps } from './builtin-mcps.js';
import { sanitizePersistedMcpServers } from './mcp-settings-schemas.js';
import {
  mcpConnectionPool,
  type McpPoolConnectionOptions,
} from '../skill/skill-mcp-connection-pool.js';
import {
  clearCatalogSnapshot,
  clearCatalogSnapshotsMatching,
  ensureToolCatalogPoolListener,
  getCatalogSnapshot,
  publishOAuthRedirect,
  setCatalogSnapshot,
  setCatalogSnapshotToolFilter,
} from './mcp-tool-catalog.js';
import { McpOAuthProvider } from './mcp-oauth-provider.js';
import {
  resolveSessionMcpLayer,
  shouldInheritUserMcpServers,
} from '../session-extension/session-mcp-resolution.js';
import type { SessionMcpServerRecord } from '../session-extension/session-extension-contract.js';
import { parseSessionSecretRefName } from '../session-extension/session-extension-runtime-policy.js';
import {
  getSessionExtensionSecretUpdatedAt,
  resolveSessionExtensionSecretValue,
} from '../session-extension/session-extension-secret-store.js';
import {
  callVirtualMcpToolForSession,
  isVirtualBuiltinMcpId,
  listVirtualMcpTools,
} from './builtin-virtual-mcps.js';
import {
  assertMcpServerAllowedForScope,
  isSystemMcpServer,
  type McpServerSource,
  type McpSessionScope,
} from './mcp-server-authorization.js';

// Wire the catalog cache to the connection pool's
// `notifications/tools/list_changed` fan-out at module load time.
// This is idempotent — callers that don't import the catalog still
// pay no cost, but any path that warms the cache via
// `setCatalogSnapshot` (below) is then automatically refreshed when
// the underlying server pushes an update.
ensureToolCatalogPoolListener();

// Enforce the catalog's "post `disabledTools` filter" contract at the single
// write choke point. Without this, a server-config change would be enforced at
// call time (`callMcpToolForSession`) while the push-driven refresh could still
// hand the model a tool it can never call. Both helper functions are hoisted
// declarations in this module, so referencing them at load time is safe.
setCatalogSnapshotToolFilter(({ userId, serverId, tools }) => {
  const server = loadConfiguredMcpServersForUser(userId).find((entry) => entry.id === serverId);
  return filterEnabledMcpTools(tools, server?.disabledTools);
});

interface UserSettingRow {
  value: string;
}

interface SessionOwnerRow {
  user_id: string;
}

/**
 * OAuth configuration for an MCP server (PR-D-OAuth, mirrors
 * opencode's `mcp/oauth-provider.ts:18-23` `McpOAuthConfig`).
 *
 * Three valid shapes:
 *   - `undefined` / absent — server uses bearer-token / no auth.
 *   - `false` — explicitly opted out of OAuth even if the server
 *      advertises it (used during testing or to keep an SSE server
 *      on stale tokens past their expiry).
 *   - object — opt in. All fields optional; when omitted the
 *      provider falls back to dynamic client registration (RFC 7591)
 *      and the gateway's `/mcp/oauth/callback` redirect.
 */
export interface McpOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  redirectUri?: string;
}

export interface ConfiguredMCPServer {
  id: string;
  name: string;
  transport: 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  required?: boolean;
  builtin?: boolean;
  builtinKind?: 'system' | 'virtual' | 'adapter';
  enabled: boolean;
  disabledTools?: string[];
  headers?: Record<string, string>;
  source?: McpServerSource;
  /**
   * OAuth opt-in/opt-out. See {@link McpOAuthConfig}. Stdio servers
   * always treat this as `false` regardless of value (OAuth is
   * meaningless for local subprocesses).
   */
  oauth?: McpOAuthConfig | false;
  /**
   * 会话级凭据引用（261101）：**非明文**，只指向 `session_extension_secrets`。
   * 仅在会话级条目上出现，且必须在建连时解析成 header / env 才有意义。
   */
  secretRef?: string;
  /** 凭据注入点。与 `secretRef` 同时存在才生效。 */
  secretBinding?: { kind: 'header' | 'env'; name: string };
  /**
   * 凭据最后修改时间。参与连接指纹：轮换同一引用下的值必须让旧连接作废，
   * 否则改完密钥还在拿旧密文连。
   */
  secretUpdatedAt?: number;
  /**
   * 会话级条目标记（261031）。存在时该 server 属于**某个会话**而非用户：
   * 连接池键、目录缓存键都会带上会话身份，从而与其他会话彻底隔离；
   * 会话被删除 / 条目被禁用时按该标记回收连接与子进程。
   *
   * 该字段在 `sanitizePersistedMcpServers` **之后**注入，不参与持久化 schema。
   */
  sessionScope?: { readonly ownerUserId: string; readonly sessionId: string };
}

export interface MCPServerToolCatalog {
  serverId: string;
  serverName: string;
  transport: 'sse' | 'stdio';
  enabled: boolean;
  status: 'connected' | 'disabled' | 'error';
  tools: MCPToolDef[];
  error?: string;
}

export interface MCPCallInput {
  serverId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface MCPCallOutput {
  serverId: string;
  toolName: string;
  content: MCPToolResult['content'];
  structuredContent?: unknown;
  isError?: boolean;
}

function getUserIdForSession(sessionId: string): string {
  const session = sqliteGet<SessionOwnerRow>('SELECT user_id FROM sessions WHERE id = ? LIMIT 1', [
    sessionId,
  ]);

  if (!session?.user_id) {
    throw new Error(`Unable to resolve session owner for ${sessionId}`);
  }

  return session.user_id;
}

/**
 * 会话视角的 MCP 配置解析（261031）。
 *
 * 历史实现是 `session → session.user_id → 用户配置`，于是「在渠道会话里加一个
 * MCP」必然写进用户配置、并影响该用户的所有会话。现在叠加会话层：
 *
 *   inherit （老会话 / 个人会话默认）：用户配置 + 会话条目（同 id 会话优先）
 *   explicit（新开启本能力的渠道）    ：只用会话条目 + 系统内置
 *
 * 注意：`explicit` 下**不继承**用户配置——空集合就是「这个会话不连用户 MCP」，
 * 而不是「沿用全部」（旧实现把「空白名单」当作不限制，那是另一个语义）。
 */
export function getConfiguredMcpServersForSession(sessionId: string): ConfiguredMCPServer[] {
  const ownerUserId = getUserIdForSession(sessionId);
  const layer = resolveSessionMcpLayer(sessionId);

  const inherited = shouldInheritUserMcpServers(layer)
    ? readUserConfiguredMcpServers(ownerUserId)
    : [];

  // 会话条目的 enabled 以会话表为准（配置里的 enabled 只是快照）。
  const sessionEnabledById = new Map(layer.servers.map((record) => [record.displayId, record]));
  const sessionServers = sanitizePersistedMcpServers(layer.servers.map((record) => record.config))
    .filter((server) => sessionEnabledById.has(server.id))
    .map((server) => {
      const record = sessionEnabledById.get(server.id);
      const secret = resolveSessionMcpCredential({ sessionId, record });
      return {
        ...server,
        enabled: record?.enabled ?? server.enabled ?? true,
        source: 'user' as const,
        // 会话身份标记：让连接与目录按会话隔离（见 getMcpPoolKey / sessionScope 说明）。
        sessionScope: { ownerUserId, sessionId },
        ...secret,
      };
    });

  // 同 id 时**会话条目优先**（仅限本会话）；用户持久化配置本身不被改写。
  const byId = new Map(inherited.map((server) => [server.id, server]));
  for (const server of sessionServers) {
    byId.set(server.id, server);
  }
  return mergeBuiltinAndConfiguredMcps([...byId.values()]);
}

/**
 * 从会话条目解析凭据三元组（引用 / 注入点 / 轮换版本）。
 *
 * 三者必须同时成立才返回，否则视为「这条会话 MCP 没有凭据」——只给引用而不给注入点
 * 是**无效配置**，运行时不能猜该塞到哪个头里去。
 */
function resolveSessionMcpCredential(input: {
  sessionId: string;
  record: SessionMcpServerRecord | undefined;
}): Pick<ConfiguredMCPServer, 'secretRef' | 'secretBinding' | 'secretUpdatedAt'> {
  const secretRef = input.record?.secretRef ?? null;
  if (!secretRef) return {};
  const binding = readSecretBinding(input.record?.config);
  if (!binding) return {};
  const name = parseSessionSecretRefName({ secretRef, sessionId: input.sessionId });
  if (!name) return {};
  const updatedAt = getSessionExtensionSecretUpdatedAt(input.sessionId, name);
  return {
    secretRef,
    secretBinding: binding,
    ...(updatedAt === null ? {} : { secretUpdatedAt: updatedAt }),
  };
}

function readSecretBinding(config: unknown): { kind: 'header' | 'env'; name: string } | null {
  if (!config || typeof config !== 'object') return null;
  const binding = (config as Record<string, unknown>)['secretBinding'];
  if (!binding || typeof binding !== 'object') return null;
  const kind = (binding as Record<string, unknown>)['kind'];
  const name = (binding as Record<string, unknown>)['name'];
  if ((kind === 'header' || kind === 'env') && typeof name === 'string' && name.length > 0) {
    return { kind, name };
  }
  return null;
}

/** 读取用户持久化的 MCP 配置（**不含**内置合并，供会话层自行合并）。 */
function readUserConfiguredMcpServers(userId: string): ConfiguredMCPServer[] {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'mcp_servers'`,
    [userId],
  );
  if (!row?.value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(row.value);
    return sanitizePersistedMcpServers(parsed);
  } catch {
    return [];
  }
}

export function loadConfiguredMcpServersForUser(userId: string): ConfiguredMCPServer[] {
  // 即便用户没有任何自定义 MCP 配置，仍然要把内置 MCP（websearch / grep_app）
  // 暴露给运行时；同 id 的用户配置会在 mergeBuiltinAndConfiguredMcps
  // 中完全覆盖内置项（含 enabled=false 的禁用语义）。
  return mergeBuiltinAndConfiguredMcps(readUserConfiguredMcpServers(userId));
}

export function getConfiguredServerByIdForUser(
  userId: string,
  serverId: string,
): ConfiguredMCPServer {
  return getConfiguredServerById(userId, serverId);
}

/**
 * 归一化用于「id / 展示名」比对键：忽略大小写与空格、下划线、短横线差异，
 * 这样 `Open WebSearch`、`open-websearch`、`open_websearch` 都能命中同一项。
 */
function normalizeMcpLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/**
 * 把「serverId 不存在」渲染成**可自我纠正**的错误信息。
 *
 * `serverId` 是模型的入参，而模型经常把**展示名**当 id 传（2026-10-12 线上排障：
 * 传入 `Open WebSearch`，真实 id 是 `open_websearch`）。旧文案
 * `Configured MCP server not found: Open WebSearch` 既不给可用 id、也不指出
 * 「你传的是名称」，调用方只能原样重试。这里额外做两件事：
 *   1. 用归一化键按展示名反查真实 id 并直接告诉调用方；
 *   2. 无论是否命中，都附上可用 id 列表，让下一次调用能自纠正。
 */
function describeUnknownMcpServer(
  servers: readonly ConfiguredMCPServer[],
  serverId: string,
): string {
  const normalized = normalizeMcpLookupKey(serverId);
  const byName = servers.find((entry) => normalizeMcpLookupKey(entry.name) === normalized);
  const availableIds = servers.map((entry) => entry.id).sort((a, b) => a.localeCompare(b));
  const available =
    availableIds.length > 0 ? availableIds.join(', ') : '（当前用户没有可用的 MCP server）';
  const hint = byName
    ? `传入的是展示名 "${serverId}"，该 server 的正确 id 是 "${byName.id}"，请改用 id 调用。`
    : `未找到 id 为 "${serverId}" 的 MCP server。`;
  return `Configured MCP server not found: ${serverId}. ${hint}可用 id：${available}。`;
}

function getConfiguredServerById(userId: string, serverId: string): ConfiguredMCPServer {
  const servers = loadConfiguredMcpServersForUser(userId);
  const server = servers.find((entry) => entry.id === serverId);
  if (!server) {
    throw new Error(describeUnknownMcpServer(servers, serverId));
  }
  if (!server.enabled) {
    throw new Error(`Configured MCP server is disabled: ${serverId}`);
  }
  return server;
}

export function getConfiguredMcpServerForSession(
  sessionId: string,
  serverId: string,
): ConfiguredMCPServer {
  const servers = getConfiguredMcpServersForSession(sessionId);
  const server = servers.find((entry) => entry.id === serverId);
  if (!server) throw new Error(describeUnknownMcpServer(servers, serverId));
  if (!server.enabled) throw new Error(`Configured MCP server is disabled: ${serverId}`);
  return server;
}

export function getMcpServerFingerprint(server: ConfiguredMCPServer): string {
  const fingerprintSource = JSON.stringify({
    id: server.id,
    transport: server.transport,
    url: server.url ?? null,
    command: server.command ?? null,
    args: server.args ?? [],
    cwd: server.cwd ?? null,
    env: server.env ?? {},
    required: server.required ?? false,
    builtin: server.builtin ?? false,
    disabledTools: server.disabledTools ?? [],
    // `headers` / `oauth` MUST participate in the fingerprint. Users
    // routinely fix a broken MCP server by adding/replacing an auth
    // header or enabling OAuth; if those fields were excluded, the
    // pool key would be unchanged and the session would keep reusing
    // the already-cached (broken) adapter forever. See the pool-key
    // docstring in {@link getMcpPoolKey}.
    headers: server.headers ?? {},
    oauth: server.oauth ?? null,
    // 会话凭据必须参与指纹：`secretRef` 本身不变而值被轮换时，只有
    // `secretUpdatedAt` 会变——漏掉它就会一直用旧密文重连。
    secretRef: server.secretRef ?? null,
    secretUpdatedAt: server.secretUpdatedAt ?? null,
  });

  return createHash('sha256').update(fingerprintSource).digest('hex').slice(0, 16);
}

/**
 * Build the {@link MCPServerRef} payload that the connection pool /
 * adapter expect. We forward the OpenAWork-specific extension fields
 * (`disabledTools`, `headers`, `authProvider`) that
 * `MCPClientAdapterImpl.connect` reads via its
 * `MCPServerRef & { ... }` parameter type.
 *
 * When `userId` is supplied AND the server has an `oauth` config
 * (object — not `false`/undefined), we attach a fresh
 * {@link McpOAuthProvider} so the SDK can negotiate OAuth on first
 * connect. The provider's `onRedirect` callback fans the
 * authorization URL out via {@link publishOAuthRedirect} so the
 * `/mcp/events` SSE stream can deliver it to the user's browser.
 *
 * Stdio servers ignore the OAuth provider regardless — OAuth is
 * meaningless for local subprocesses, the SDK transports we use for
 * stdio simply don't read the field.
 */
function toMcpServerRef(
  server: ConfiguredMCPServer,
  userId?: string,
): MCPServerRef & {
  disabledTools?: string[];
  headers?: Record<string, string>;
  authProvider?: McpOAuthProvider;
} {
  const base: MCPServerRef & {
    disabledTools?: string[];
    headers?: Record<string, string>;
    authProvider?: McpOAuthProvider;
  } = {
    id: server.id,
    transport: server.transport,
    url: server.url,
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    env: server.env,
    required: server.required,
    disabledTools: server.disabledTools,
    headers: server.headers,
  };

  // 会话级凭据注入（261101）。只有同时拿到引用、注入点与会话身份才解析明文；
  // 解析不到就**抛错**而不是「无凭据照连」——后者会安静地把请求发给一个未认证的
  // 端点，排查方向会被彻底带偏。
  if (server.secretRef && server.secretBinding && server.sessionScope) {
    const name = parseSessionSecretRefName({
      secretRef: server.secretRef,
      sessionId: server.sessionScope.sessionId,
    });
    const resolved = name
      ? resolveSessionExtensionSecretValue({
          sessionId: server.sessionScope.sessionId,
          name,
        })
      : null;
    if (!resolved) {
      throw new Error(
        `会话凭据（${server.secretBinding.kind}:${server.secretBinding.name}）不可用，请在会话扩展面板重新录入后再试。`,
      );
    }
    if (server.secretBinding.kind === 'env') {
      base.env = { ...(base.env ?? {}), [server.secretBinding.name]: resolved.value };
    } else {
      base.headers = { ...(base.headers ?? {}), [server.secretBinding.name]: resolved.value };
    }
  }

  // OAuth opt-in path. We require `userId` because token storage is
  // per-user; without it we can't safely persist credentials. The
  // `server.oauth` truthy check already excludes both `false` (opt-out)
  // and `undefined` (no config), narrowing to `McpOAuthConfig`.
  const oauthConfig = server.oauth;
  if (
    userId &&
    server.transport !== 'stdio' &&
    server.url &&
    oauthConfig &&
    typeof oauthConfig === 'object'
  ) {
    base.authProvider = new McpOAuthProvider(userId, server.id, server.url, oauthConfig, {
      onRedirect: (authorizationUrl: URL) => {
        publishOAuthRedirect({
          userId,
          mcpId: server.id,
          authorizationUrl: authorizationUrl.toString(),
        });
      },
    });
  }

  return base;
}

/**
 * Build the cache key under which the persistent MCP connection is
 * stashed in `mcpConnectionPool`. We salt the server id with the
 * config fingerprint so that **changing the MCP server's
 * url/command/args/headers/disabledTools immediately invalidates the
 * old connection** — the next call sees a key miss, builds a fresh
 * client, and the now-orphaned old connection is reclaimed by the
 * pool's idle-cleanup timer (5 min).
 *
 * Without this salt a user editing their `mcp_servers` setting would
 * keep talking to the previous transport for up to 5 min, which is
 * the behaviour opencode also avoids by tearing down the old
 * `MCPClient` whenever its config changes
 * (`@/temp/opencode/packages/opencode/src/mcp/index.ts:486-549`).
 */
export function getMcpPoolKey(server: ConfiguredMCPServer): string {
  const base = `${server.id}:${getMcpServerFingerprint(server)}`;
  const scope = server.sessionScope;
  if (!scope) {
    // 用户级 / 系统内置：沿用既有共享语义。
    return base;
  }
  // 会话级：把会话身份编进键（用 `::` 分隔并整体编码，避免 id 里出现冒号时产生
  // 歧义键）。这样同一用户的会话 A 与会话 B 各自持有独立的客户端与 stdio 子进程，
  // 目录缓存（`${userId}::${poolKey}`）也随之隔离。
  return `${base}::session::${encodeURIComponent(scope.ownerUserId)}::${encodeURIComponent(scope.sessionId)}`;
}

/** 会话级连接键的标记片段，用于按会话回收（`releaseSessionMcpConnections`）。 */
export function buildSessionMcpKeyMarker(params: {
  ownerUserId: string;
  sessionId: string;
}): string {
  return `::session::${encodeURIComponent(params.ownerUserId)}::${encodeURIComponent(params.sessionId)}`;
}

/**
 * Tear down the pooled connection + cached tool catalog for a single
 * MCP server configuration, so the next session turn rebuilds the
 * connection from the latest config instead of reusing a stale
 * adapter.
 *
 * Why this is needed even with the config fingerprint baked into the
 * pool key: a *successful* connect is cached in the pool; if that
 * adapter later starts failing with an error that the pool's
 * `withOperationRetry` reconnect heuristic doesn't recognise as
 * connection-related (e.g. a 401 / JSON-RPC error), the bad adapter
 * stays cached and every subsequent turn keeps returning the same
 * error. Editing the server config in settings is the user's repair
 * action, so the save path must proactively drop both the old (pre-save)
 * and the new connections.
 */
export async function invalidateMcpServerConnectionForUser(
  userId: string,
  server: ConfiguredMCPServer,
): Promise<void> {
  const poolKey = getMcpPoolKey(server);
  await mcpConnectionPool.disconnectUserConnection(userId, poolKey);
  clearCatalogSnapshot(userId, poolKey);
}

/**
 * 回收**某个会话**的全部 MCP 连接与目录缓存（261031）。
 *
 * 触发点：会话删除、会话级条目被移除 / 禁用。没有这一步，已删除的会话级配置仍会
 * 通过连接池继续被调用（池里缓存着活的客户端 + stdio 子进程），构成「撤销不生效」。
 *
 * 只按会话标记匹配，**不会**误伤同用户其他会话或用户级连接（这正是
 * `disconnectAllForUser` 做不到的）。
 */
export async function releaseSessionMcpConnections(params: {
  ownerUserId: string;
  sessionId: string;
}): Promise<number> {
  const marker = buildSessionMcpKeyMarker(params);
  const removed = await mcpConnectionPool.disconnectMatching((key) => key.includes(marker));
  // 目录缓存键是 `${userId}::${poolKey}`，poolKey 已含 marker，故前缀扫描即可。
  clearCatalogSnapshotsMatching((cacheKey) => cacheKey.includes(marker));
  return removed;
}

/**
 * 会话级条目被移除时只清它自己的目录缓存。
 *
 * 与 `releaseSessionMcpConnections` 的分工：一个是「整个会话下线」，一个是
 * 「单个 server 下线」；两者都必须清缓存，否则 stale 目录会跨 revision 复用。
 */
export function releaseSessionMcpServerConnection(params: {
  ownerUserId: string;
  sessionId: string;
  server: ConfiguredMCPServer;
}): Promise<void> {
  return invalidateMcpServerConnectionForUser(params.ownerUserId, params.server);
}

function filterEnabledMcpTools(
  tools: readonly MCPToolDef[],
  disabledTools?: readonly string[],
): MCPToolDef[] {
  if (!disabledTools || disabledTools.length === 0) {
    return [...tools];
  }
  const disabled = new Set(disabledTools);
  return tools.filter((tool) => !disabled.has(tool.name));
}

function isRuntimeVirtualBuiltinMcpServer(server: ConfiguredMCPServer): boolean {
  return (
    server.builtin === true && isVirtualBuiltinMcpId(server.id) && server.transport === 'stdio'
  );
}

/**
 * 由 server 推导连接池选项（T-10）。
 *
 * 会话级配置与用户级配置的信任级别不同，故对会话级：
 *   - stdio 使用**最小环境**（不把网关凭据带进第三方子进程）；
 *   - 用户级沿用既有 `inherit` 行为，行为零变化。
 */
function resolveMcpPoolEnvPolicy(server: ConfiguredMCPServer): 'inherit' | 'minimal' {
  return server.sessionScope ? 'minimal' : 'inherit';
}

/**
 * 调用路径的池选项。
 *
 * 会话级调用面向的是**任意第三方工具**，很多是非幂等的（写文件、发消息、下单）。
 * 断线自动重放会让远端副作用执行两次，因此会话级调用只允许**一次尝试**；
 * 用户级保持既有的 3 次重连语义。
 */
function resolveMcpCallPoolOptions(server: ConfiguredMCPServer): McpPoolConnectionOptions {
  const envPolicy = resolveMcpPoolEnvPolicy(server);
  return server.sessionScope ? { envPolicy, maxAttempts: 1 } : { envPolicy };
}

/** 只读路径（列目录 / 探活）的池选项：重连是安全的，保留既有重试次数。 */
function resolveMcpReadPoolOptions(server: ConfiguredMCPServer): McpPoolConnectionOptions {
  return { envPolicy: resolveMcpPoolEnvPolicy(server) };
}

/**
 * 后台刷新去重：同一 `(userId, poolKey)` 只允许一个在途刷新，避免并发
 * 请求各自拉起一次「重连 + listTools」。
 */
const backgroundCatalogRefreshInFlight = new Set<string>();

/**
 * Serve-stale + background-refresh 的重连路径。
 *
 * 连接池空闲 5 分钟即清理连接（`IDLE_TIMEOUT_MS`），但工具目录快照仍在
 * catalog 缓存里。此前空闲后的第一次目录读取要在请求路径上真实重连
 * （stdio spawn / SSE 握手，单 server 握手超时 30s，连接类错误还会重试
 * 3 次），`/capabilities/session/:id` 等读取端点因此动辄数秒到数十秒。
 *
 * 这里改为：立即向调用方返回快照，把重连挪到后台——成功则刷新快照
 * （订阅方按既有 push 语义收到更新），失败则丢弃快照，让下一次读取走
 * 真实连接路径并如实暴露连接错误。手动「重试连接」
 * （`retryMcpConnectionForUser`）仍强制真连，是显式的修复入口。
 */
function scheduleBackgroundCatalogRefresh(
  userId: string,
  server: ConfiguredMCPServer,
  poolKey: string,
): void {
  const inflightKey = `${userId}:${poolKey}`;
  if (backgroundCatalogRefreshInFlight.has(inflightKey)) {
    return;
  }
  backgroundCatalogRefreshInFlight.add(inflightKey);
  void mcpConnectionPool
    .withOperationRetry(
      userId,
      poolKey,
      toMcpServerRef(server, userId),
      (adapter, serverId) => adapter.listTools(serverId),
      resolveMcpReadPoolOptions(server),
    )
    .then((tools) => {
      setCatalogSnapshot(userId, poolKey, server.id, tools);
    })
    .catch((error: unknown) => {
      logGatewayWarn(
        `[mcp-runtime] 后台刷新 MCP 工具目录失败（${server.id}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // 快照对应的连接已丢失且重连失败——继续保留会把「已下线」的
      // server 永远呈现为 connected；丢弃后下次读取走真实连接路径。
      clearCatalogSnapshot(userId, poolKey);
    })
    .finally(() => {
      backgroundCatalogRefreshInFlight.delete(inflightKey);
    });
}

export async function listMcpToolsForUser(
  userId: string,
  filter?: { serverId?: string; allowedServerIds?: readonly string[] },
): Promise<MCPServerToolCatalog[]> {
  return listMcpToolsForConfiguredServers(userId, loadConfiguredMcpServersForUser(userId), filter);
}

async function listMcpToolsForConfiguredServers(
  userId: string,
  configuredServers: ConfiguredMCPServer[],
  filter?: { serverId?: string; allowedServerIds?: readonly string[] },
): Promise<MCPServerToolCatalog[]> {
  let selectedServers = filter?.serverId
    ? configuredServers.filter((server) => server.id === filter.serverId)
    : configuredServers;
  // 模板初始绑定：当 session 指定了 MCP 白名单（requestedMcpServers）时，
  // 只暴露白名单内的 server（内置 MCP 不受限，始终可用）。
  //
  // 注意区分两种「无白名单」语义：
  //   - filter.allowedServerIds === undefined → 不做白名单过滤（chat 个人会话：用全部）。
  //   - filter.allowedServerIds === []（defined 但空）→ 过滤到「仅内置 MCP」
  //     （team 子会话没绑定任何 MCP 时的最小授权，不继承用户私有 MCP）。
  if (filter?.allowedServerIds !== undefined) {
    const allow = new Set(filter.allowedServerIds);
    selectedServers = selectedServers.filter(
      (server) => allow.has(server.id) || isSystemMcpServer(server),
    );
  }

  return Promise.all(
    selectedServers.map(async (server): Promise<MCPServerToolCatalog> => {
      if (!server.enabled) {
        return {
          serverId: server.id,
          serverName: server.name,
          transport: server.transport,
          enabled: false,
          status: 'disabled',
          tools: [],
        };
      }

      try {
        if (isRuntimeVirtualBuiltinMcpServer(server)) {
          const tools = filterEnabledMcpTools(listVirtualMcpTools(server.id), server.disabledTools);
          setCatalogSnapshot(userId, getMcpPoolKey(server), server.id, tools);
          return {
            serverId: server.id,
            serverName: server.name,
            transport: server.transport,
            enabled: true,
            status: 'connected',
            tools,
          };
        }

        const poolKey = getMcpPoolKey(server);
        // Snapshot-first 快路径：连接已被空闲清理（或尚在建立）但快照仍在时，
        // 立即返回缓存目录，把「重连 + listTools」挪到后台（见
        // scheduleBackgroundCatalogRefresh）。空闲后的第一次目录读取因此不再
        // 在请求路径上支付完整重连成本。
        if (!mcpConnectionPool.isConnected(userId, poolKey)) {
          const cachedTools = getCatalogSnapshot(userId, poolKey);
          if (cachedTools) {
            scheduleBackgroundCatalogRefresh(userId, server, poolKey);
            return {
              serverId: server.id,
              serverName: server.name,
              transport: server.transport,
              enabled: true,
              status: 'connected',
              tools: cachedTools,
            };
          }
        }

        // Persistent-pool path (PR-B): reuse the same connection across
        // turns instead of building/tearing-down a fresh
        // `MCPClientAdapterImpl` for every request. Mirrors opencode's
        // `MCP.Service` lifecycle (`@/temp/opencode/packages/opencode/src/mcp/index.ts:472-549`).
        // `withOperationRetry` will auto-reconnect transient
        // disconnects up to 3 times.
        const fetchedTools = await mcpConnectionPool.withOperationRetry(
          userId,
          poolKey,
          toMcpServerRef(server, userId),
          (adapter, serverId) => adapter.listTools(serverId),
          resolveMcpReadPoolOptions(server),
        );
        // 目录返回值与快照都必须过滤：模型不应看到永远调不通的工具
        // （`callMcpToolForSession` 会在执行侧拒绝 `disabledTools`）。
        const tools = filterEnabledMcpTools(fetchedTools, server.disabledTools);
        // Warm the per-user catalog cache so PR-C's flattened LLM
        // tool dictionary can read a stable snapshot, and so the
        // pool's `tools/list_changed` listener has somewhere to
        // refresh into. Subscribers fire on every snapshot write.
        setCatalogSnapshot(userId, poolKey, server.id, tools);
        return {
          serverId: server.id,
          serverName: server.name,
          transport: server.transport,
          enabled: true,
          status: 'connected',
          tools,
        };
      } catch (error) {
        return {
          serverId: server.id,
          serverName: server.name,
          transport: server.transport,
          enabled: true,
          status: 'error',
          tools: [],
          error: String(error),
        };
      }
    }),
  );
}

export async function listMcpToolsForSession(
  sessionId: string,
  filter?: { serverId?: string; allowedServerIds?: readonly string[] },
): Promise<MCPServerToolCatalog[]> {
  return listMcpToolsForConfiguredServers(
    getUserIdForSession(sessionId),
    getConfiguredMcpServersForSession(sessionId),
    filter,
  );
}

/**
 * Result of {@link retryMcpConnectionForUser}. The frontend's
 * "重试连接 / 安装" button reads this verbatim and surfaces
 * `error` to the user in red text on failure.
 */
export interface RetryMcpConnectResult {
  serverId: string;
  serverName: string;
  status: 'connected' | 'error' | 'disabled';
  toolCount: number;
  durationMs: number;
  error?: string;
}

/**
 * Force-retry connecting to a single MCP server for `userId`. Used
 * by the settings page's "重试连接" button to recover after an
 * earlier auto-connect failure (e.g. the upstream service was
 * temporarily down, or a stdio command needed a fresh `npx -y`
 * package install).
 *
 * Steps:
 *   1. Resolve the server config from user_settings + builtins. A
 *      missing id throws — bubbled up by the route as 404.
 *   2. If the server is `enabled: false`, short-circuit with status
 *      `'disabled'` so the UI can render a different chip.
 *   3. Drop any cached pool connection so the next attempt is a
 *      fresh client (avoids reusing a half-broken stream / stale
 *      OAuth token in memory).
 *   4. Run `listTools` through the pool's normal
 *      `withOperationRetry` path. Success ⇒ `'connected'` plus tool
 *      count; failure ⇒ `'error'` with the SDK / transport message
 *      forwarded verbatim so the user can read e.g. "command not
 *      found: filesystem-mcp" or "OAuth required".
 *
 * Note: for `command: 'npx', args: ['-y', '@something/server']`-style
 * stdio servers, step 4 implicitly runs `npx -y` again, which causes
 * `npx` to install the package on demand. So the same button covers
 * both "transient retry" and "missing dependency install" without us
 * having to spawn a separate `npm install -g` step.
 */
export async function retryMcpConnectionForUser(
  userId: string,
  serverId: string,
): Promise<RetryMcpConnectResult> {
  // Important: do NOT route through `getConfiguredServerByIdForUser`
  // — that helper throws on `enabled: false`, which is the wrong
  // semantics here. The retry button is allowed to be clicked
  // against a disabled server (the UI may not have hidden it yet);
  // we want to short-circuit with a clear `'disabled'` status, not
  // a 500-style throw the user has no way to recover from.
  const server = loadConfiguredMcpServersForUser(userId).find((entry) => entry.id === serverId);
  if (!server) {
    throw new Error(`Configured MCP server not found: ${serverId}`);
  }

  if (!server.enabled) {
    return {
      serverId: server.id,
      serverName: server.name,
      status: 'disabled',
      toolCount: 0,
      durationMs: 0,
    };
  }

  const poolKey = getMcpPoolKey(server);
  if (isRuntimeVirtualBuiltinMcpServer(server)) {
    const startedAt = Date.now();
    const tools = filterEnabledMcpTools(listVirtualMcpTools(server.id), server.disabledTools);
    setCatalogSnapshot(userId, poolKey, server.id, tools);
    return {
      serverId: server.id,
      serverName: server.name,
      status: 'connected',
      toolCount: tools.length,
      durationMs: Date.now() - startedAt,
    };
  }

  // Always start from a clean slate so a previously failed connect
  // doesn't keep returning a cached error from the same broken
  // adapter. `disconnectUserConnection` is a no-op if no entry is
  // currently held.
  await mcpConnectionPool.disconnectUserConnection(userId, poolKey);

  const startedAt = Date.now();
  try {
    const fetchedTools = await mcpConnectionPool.withOperationRetry(
      userId,
      poolKey,
      toMcpServerRef(server, userId),
      (adapter, sid) => adapter.listTools(sid),
      resolveMcpReadPoolOptions(server),
    );
    // 「重试连接」按钮的 toolCount 与目录快照一致，同样排除被禁用的工具。
    const tools = filterEnabledMcpTools(fetchedTools, server.disabledTools);
    setCatalogSnapshot(userId, poolKey, server.id, tools);
    return {
      serverId: server.id,
      serverName: server.name,
      status: 'connected',
      toolCount: tools.length,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    // Drop any catalog cache from a previous successful connect so
    // the next `listMcpToolsForSession` call refetches via
    // `withOperationRetry` instead of returning stale tools. We
    // don't strictly need this today (no production reader takes
    // `getCatalogSnapshot` directly), but keeping the cache in sync
    // with the actual connection state prevents future readers from
    // having to re-derive that invariant.
    clearCatalogSnapshot(userId, poolKey);
    return {
      serverId: server.id,
      serverName: server.name,
      status: 'error',
      toolCount: 0,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Whether the connection pool currently holds a live adapter for
 * `(userId, server)`. Cheap — just a `Map.has` against the pool's
 * connection table. Used by `/settings/mcp-status` to render
 * "已连接 / 已断开" without forcing a connect attempt for every
 * status poll (which would mask real transient failures and hide
 * idle-cleanup, since every poll would re-warm the pool).
 */
export function isMcpServerConnectedForUser(userId: string, server: ConfiguredMCPServer): boolean {
  if (!server.enabled) return false;
  if (isRuntimeVirtualBuiltinMcpServer(server)) return true;
  return mcpConnectionPool.isConnected(userId, getMcpPoolKey(server));
}

export async function callMcpToolForSession(
  sessionId: string,
  input: MCPCallInput,
  scope?: McpSessionScope,
): Promise<MCPCallOutput> {
  const userId = getUserIdForSession(sessionId);
  const server = getConfiguredMcpServerForSession(sessionId, input.serverId);
  assertMcpServerAllowedForScope(server, scope);
  if (server.disabledTools?.includes(input.toolName)) {
    throw new Error(`MCP tool ${input.toolName} is disabled for server ${server.id}`);
  }
  if (isRuntimeVirtualBuiltinMcpServer(server)) {
    return callVirtualMcpToolForSession(sessionId, server, input);
  }
  // Persistent-pool path (PR-B). See listMcpToolsForSession for rationale.
  const result = await mcpConnectionPool.withOperationRetry(
    userId,
    getMcpPoolKey(server),
    toMcpServerRef(server, userId),
    (adapter, serverId) => {
      const current = getConfiguredMcpServerForSession(sessionId, input.serverId);
      assertMcpServerAllowedForScope(current, scope);
      if (
        getMcpPoolKey(current) !== getMcpPoolKey(server) ||
        current.disabledTools?.includes(input.toolName)
      ) {
        throw new Error('MCP 配置或授权已变化，已阻止调用。');
      }
      return adapter.callTool(serverId, input.toolName, input.arguments ?? {});
    },
    resolveMcpCallPoolOptions(server),
  );

  return {
    serverId: server.id,
    toolName: input.toolName,
    content: result.content,
    structuredContent: result.structuredContent,
    isError: result.isError,
  };
}
