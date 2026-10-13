import { createHash } from 'node:crypto';
import type { MCPToolDef, MCPToolResult } from '@openAwork/mcp-client';
import type { MCPServerRef } from '@openAwork/skill-types';
import { sqliteGet } from '../infra/db.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { mergeBuiltinAndConfiguredMcps } from './builtin-mcps.js';
import { sanitizePersistedMcpServers } from './mcp-settings-schemas.js';
import { mcpConnectionPool } from '../skill/skill-mcp-connection-pool.js';
import {
  clearCatalogSnapshot,
  ensureToolCatalogPoolListener,
  getCatalogSnapshot,
  publishOAuthRedirect,
  setCatalogSnapshot,
  setCatalogSnapshotToolFilter,
} from './mcp-tool-catalog.js';
import { McpOAuthProvider } from './mcp-oauth-provider.js';
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

export function getConfiguredMcpServersForSession(sessionId: string): ConfiguredMCPServer[] {
  return loadConfiguredMcpServersForUser(getUserIdForSession(sessionId));
}

export function loadConfiguredMcpServersForUser(userId: string): ConfiguredMCPServer[] {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'mcp_servers'`,
    [userId],
  );

  // 即便用户没有任何自定义 MCP 配置，仍然要把内置 MCP（websearch / grep_app）
  // 暴露给运行时；同 id 的用户配置会在 mergeBuiltinAndConfiguredMcps
  // 中完全覆盖内置项（含 enabled=false 的禁用语义）。
  if (!row?.value) {
    return mergeBuiltinAndConfiguredMcps([]);
  }

  try {
    const parsed: unknown = JSON.parse(row.value);
    const userServers = sanitizePersistedMcpServers(parsed);
    return mergeBuiltinAndConfiguredMcps(userServers);
  } catch {
    // JSON 解析失败时仍要兜底暴露内置 MCP，避免单条坏配置把整组
    // 内置能力一起拖下水。
    return mergeBuiltinAndConfiguredMcps([]);
  }
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
  return getConfiguredServerById(getUserIdForSession(sessionId), serverId);
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
  return `${server.id}:${getMcpServerFingerprint(server)}`;
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
    .withOperationRetry(userId, poolKey, toMcpServerRef(server, userId), (adapter, serverId) =>
      adapter.listTools(serverId),
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
  const configuredServers = loadConfiguredMcpServersForUser(userId);
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
  return listMcpToolsForUser(getUserIdForSession(sessionId), filter);
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
    (adapter, serverId) => adapter.callTool(serverId, input.toolName, input.arguments ?? {}),
  );

  return {
    serverId: server.id,
    toolName: input.toolName,
    content: result.content,
    structuredContent: result.structuredContent,
    isError: result.isError,
  };
}
