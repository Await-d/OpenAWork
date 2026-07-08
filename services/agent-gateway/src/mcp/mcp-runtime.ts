import { createHash } from 'node:crypto';
import type { MCPToolDef, MCPToolResult } from '@openAwork/mcp-client';
import type { MCPServerRef } from '@openAwork/skill-types';
import { sqliteGet } from '../infra/db.js';
import { mergeBuiltinAndConfiguredMcps } from './builtin-mcps.js';
import { sanitizePersistedMcpServers } from './mcp-settings-schemas.js';
import { mcpConnectionPool } from '../skill/skill-mcp-connection-pool.js';
import {
  clearCatalogSnapshot,
  ensureToolCatalogPoolListener,
  publishOAuthRedirect,
  setCatalogSnapshot,
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

function getConfiguredServerById(userId: string, serverId: string): ConfiguredMCPServer {
  const server = loadConfiguredMcpServersForUser(userId).find((entry) => entry.id === serverId);
  if (!server) {
    throw new Error(`Configured MCP server not found: ${serverId}`);
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

        // Persistent-pool path (PR-B): reuse the same connection across
        // turns instead of building/tearing-down a fresh
        // `MCPClientAdapterImpl` for every request. Mirrors opencode's
        // `MCP.Service` lifecycle (`@/temp/opencode/packages/opencode/src/mcp/index.ts:472-549`).
        // `withOperationRetry` will auto-reconnect transient
        // disconnects up to 3 times.
        const poolKey = getMcpPoolKey(server);
        const tools = await mcpConnectionPool.withOperationRetry(
          userId,
          poolKey,
          toMcpServerRef(server, userId),
          (adapter, serverId) => adapter.listTools(serverId),
        );
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
    const tools = await mcpConnectionPool.withOperationRetry(
      userId,
      poolKey,
      toMcpServerRef(server, userId),
      (adapter, sid) => adapter.listTools(sid),
    );
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
