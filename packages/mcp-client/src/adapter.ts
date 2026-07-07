import type {
  MCPClientAdapter,
  MCPServerRef,
  MCPToolDef,
  MCPToolResult,
  MCPResourceDef,
  MCPResourceReadResult,
  MCPPromptDef,
  MCPPromptResult,
  MCPCallOptions,
  MCPConnectionStatus,
  JSONSchema,
} from '@openAwork/skill-types';
import { MCPTimeoutError } from './error-handler.js';

/**
 * Hard ceiling on a single MCP transport handshake. The SDK's
 * `client.connect()` performs the `initialize` round-trip but has no
 * built-in timeout: a stdio subprocess that spawns yet never answers
 * `initialize`, or an HTTP/SSE endpoint whose socket hangs, would leave
 * `connect()` pending forever. Because the gateway's connection pool
 * dedupes concurrent connects behind one pending promise, a single hung
 * handshake stalls every caller for that (user, server). Racing the
 * handshake against this timeout converts the hang into a recoverable
 * `MCPTimeoutError`.
 */
const MCP_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Race a transport handshake against {@link MCP_CONNECT_TIMEOUT_MS}. On
 * timeout the half-open client is closed (best-effort) so we don't leak
 * a subprocess / socket, then an `MCPTimeoutError` is thrown.
 */
export async function connectWithTimeout(
  serverId: string,
  client: SDKClient,
  transport: unknown,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new MCPTimeoutError(serverId, MCP_CONNECT_TIMEOUT_MS));
    }, MCP_CONNECT_TIMEOUT_MS);
  });

  try {
    await Promise.race([client.connect(transport), timeout]);
  } catch (err) {
    if (timedOut) {
      // Tear down the half-open transport so a slow-but-eventual
      // handshake can't resurrect a connection we already abandoned.
      await client.close().catch(() => undefined);
    }
    throw err;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Hard ceilings on a single MCP cursor-paginated listing
 * (`listTools` / `listResources` / `listPrompts`). The MCP wire
 * contract lets the server keep returning a non-empty `nextCursor`
 * indefinitely, and the SDK does not enforce any termination. A
 * buggy or hostile upstream that always echoes the same cursor — or
 * walks a runaway cursor space — would otherwise spin the gateway in
 * an infinite `do { ... } while (cursor)` loop while the accumulator
 * grows unboundedly, starving the event loop and exhausting heap.
 *
 * Both ceilings are intentionally generous: real-world MCP servers
 * return tens of items in a handful of pages. Either limit hitting is
 * a strong signal of a misbehaving server, so we surface it as a
 * recoverable error rather than truncating silently.
 */
export const MCP_PAGINATION_MAX_PAGES = 1000;
export const MCP_PAGINATION_MAX_ITEMS = 50_000;

export class MCPPaginationError extends Error {
  readonly serverId: string;
  readonly operation: string;
  readonly reason: 'max_pages' | 'max_items' | 'cursor_loop';

  constructor(
    serverId: string,
    operation: string,
    reason: 'max_pages' | 'max_items' | 'cursor_loop',
    detail: string,
  ) {
    super(`MCP server '${serverId}' ${operation} pagination aborted (${reason}): ${detail}`);
    this.name = 'MCPPaginationError';
    this.serverId = serverId;
    this.operation = operation;
    this.reason = reason;
  }
}

/**
 * Walk a cursor-paginated MCP listing with three independent
 * termination guards:
 *
 * 1. Page count must stay below {@link MCP_PAGINATION_MAX_PAGES}.
 * 2. Accumulated item count must stay below
 *    {@link MCP_PAGINATION_MAX_ITEMS}.
 * 3. Cursors must not repeat. A server that returns the same
 *    `nextCursor` (including the empty initial cursor after the
 *    first page) is in a loop, not making progress.
 *
 * Hitting any guard throws {@link MCPPaginationError}. The caller is
 * expected to surface it the same way it surfaces other adapter
 * errors — agent-gateway's `mcp-tool-catalog.ts` already wraps list
 * calls in try/catch and the resulting error becomes a connection
 * health signal.
 */
export async function collectPaginated<TPage, TItem>(
  serverId: string,
  operation: string,
  fetchPage: (cursor?: string) => Promise<TPage>,
  pickItems: (page: TPage) => readonly TItem[],
  pickNextCursor: (page: TPage) => string | undefined,
): Promise<TItem[]> {
  const all: TItem[] = [];
  const seenCursors = new Set<string | undefined>();
  let cursor: string | undefined;
  let page = 0;

  do {
    if (page >= MCP_PAGINATION_MAX_PAGES) {
      throw new MCPPaginationError(
        serverId,
        operation,
        'max_pages',
        `exceeded ${MCP_PAGINATION_MAX_PAGES} pages`,
      );
    }
    if (seenCursors.has(cursor)) {
      throw new MCPPaginationError(
        serverId,
        operation,
        'cursor_loop',
        `cursor ${cursor === undefined ? '<initial>' : JSON.stringify(cursor)} repeated`,
      );
    }
    seenCursors.add(cursor);

    const result = await fetchPage(cursor);
    const items = pickItems(result);
    if (all.length + items.length > MCP_PAGINATION_MAX_ITEMS) {
      throw new MCPPaginationError(
        serverId,
        operation,
        'max_items',
        `exceeded ${MCP_PAGINATION_MAX_ITEMS} items`,
      );
    }
    for (const item of items) all.push(item);

    cursor = pickNextCursor(result);
    page += 1;
  } while (cursor);

  return all;
}

interface MCPClientEntry {
  client: unknown;
  status: MCPConnectionStatus;
  disabledTools: Set<string>;
  headers: Record<string, string>;
}

type SDKClient = {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  /**
   * Register a notification handler. The MCP SDK keys handlers by the
   * notification's Zod schema (e.g. `ToolListChangedNotificationSchema`).
   * We accept `unknown` here because the schemas are loaded lazily from
   * the SDK in {@link MCPClientAdapterImpl.subscribeToolListChanged}.
   */
  setNotificationHandler(
    schema: unknown,
    handler: (notification: unknown) => void | Promise<void>,
  ): void;
  listTools(opts?: { cursor?: string }): Promise<{
    tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
    nextCursor?: string;
  }>;
  listResources?(opts?: { cursor?: string }): Promise<{
    resources: MCPResourceDef[];
    nextCursor?: string;
  }>;
  readResource?(params: { uri: string }): Promise<MCPResourceReadResult>;
  listPrompts?(opts?: { cursor?: string }): Promise<{
    prompts: MCPPromptDef[];
    nextCursor?: string;
  }>;
  getPrompt?(params: {
    name: string;
    arguments?: Record<string, string>;
  }): Promise<MCPPromptResult>;
  callTool(
    params: { name: string; arguments: Record<string, unknown> },
    opts?: {
      timeout?: number;
      resetTimeoutOnProgress?: boolean;
      onprogress?: (p: { progress: number; total?: number }) => void;
    },
  ): Promise<{ content: MCPToolResult['content']; structuredContent?: unknown; isError?: boolean }>;
};

/**
 * Subset of the SDK's OAuth provider contract we surface through the
 * adapter API. Mirrors `@modelcontextprotocol/sdk/client/auth.js`'s
 * `OAuthClientProvider` interface (PR-D-OAuth). Declared structurally
 * so callers can pass any conforming object — typically gateway's
 * `McpOAuthProvider` from `services/agent-gateway/src/mcp-oauth-provider.ts`.
 */
export interface MCPAuthProviderLike {
  readonly redirectUrl: string | URL;
  readonly clientMetadata: unknown;
  clientInformation(): Promise<unknown>;
  saveClientInformation?(info: unknown): Promise<void>;
  tokens(): Promise<unknown>;
  saveTokens(tokens: unknown): Promise<void>;
  redirectToAuthorization(authorizationUrl: URL): Promise<void>;
  saveCodeVerifier(codeVerifier: string): Promise<void>;
  codeVerifier(): Promise<string>;
}

/**
 * Optional second argument the SDK transports accept. We pass
 * `authProvider` when the caller configured OAuth on the upstream
 * MCP server; the SDK then wires the OAuth handshake into the
 * transport's outgoing requests automatically.
 */
type TransportOpts = { authProvider?: MCPAuthProviderLike };

type SDKModule = {
  Client: new (
    info: { name: string; version: string },
    opts: { capabilities: Record<string, unknown> },
  ) => SDKClient;
  StreamableHTTPClientTransport: new (url: URL, opts?: TransportOpts) => unknown;
  SSEClientTransport: new (url: URL, opts?: TransportOpts) => unknown;
  StdioClientTransport: new (config: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  }) => unknown;
};

/**
 * Cached `ToolListChangedNotificationSchema` reference.
 *
 * The MCP SDK keys notification handlers by Zod schema instance —
 * passing the same imported reference to multiple
 * `setNotificationHandler` calls is required for correct dispatch.
 * We cache the dynamic import so every adapter hooked into the same
 * MCP server receives the same schema object.
 */
let cachedToolListChangedSchema: unknown;
async function loadToolListChangedSchema(): Promise<unknown> {
  if (cachedToolListChangedSchema) return cachedToolListChangedSchema;
  const typesMod = (await import('@modelcontextprotocol/sdk/types.js')) as {
    ToolListChangedNotificationSchema: unknown;
  };
  cachedToolListChangedSchema = typesMod.ToolListChangedNotificationSchema;
  return cachedToolListChangedSchema;
}

async function loadSDK(): Promise<SDKModule> {
  const [clientMod, streamMod, sseMod, stdioMod] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/client/sse.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  return {
    Client: (clientMod as { Client: SDKModule['Client'] }).Client,
    StreamableHTTPClientTransport: (
      streamMod as { StreamableHTTPClientTransport: SDKModule['StreamableHTTPClientTransport'] }
    ).StreamableHTTPClientTransport,
    SSEClientTransport: (sseMod as { SSEClientTransport: SDKModule['SSEClientTransport'] })
      .SSEClientTransport,
    StdioClientTransport: (
      stdioMod as {
        StdioClientTransport: SDKModule['StdioClientTransport'];
      }
    ).StdioClientTransport,
  };
}

export class MCPClientAdapterImpl implements MCPClientAdapter {
  private entries = new Map<string, MCPClientEntry>();

  private expandEnvVars(headers: Record<string, string>): Record<string, string> {
    const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
    const env: Record<string, string> = proc?.env ?? {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      result[k] = v
        .replace(/\$\(([^)]+)\)/g, (_, expr: string) => {
          const varName = expr.trim().replace(/^echo\s+/, '');
          return env[varName] ?? '';
        })
        .replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name: string) => env[name] ?? '');
    }
    return result;
  }

  async connect(
    server: MCPServerRef & {
      disabledTools?: string[];
      headers?: Record<string, string>;
      /**
       * Optional OAuth provider. When supplied, the SSE / Streamable
       * HTTP transport will negotiate OAuth on the first request and
       * persist tokens via the provider's `saveTokens` callback. Pass
       * a `McpOAuthProvider` from `services/agent-gateway`.
       *
       * Stdio transports ignore this argument — OAuth is meaningless
       * for local subprocesses.
       */
      authProvider?: MCPAuthProviderLike;
    },
  ): Promise<void> {
    const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
    const env = proc?.env ?? {};
    const expandedHeaders = this.expandEnvVars(server.headers ?? {});
    this.entries.set(server.id, {
      client: null,
      status: 'connecting',
      disabledTools: new Set(server.disabledTools ?? []),
      headers: expandedHeaders,
    });

    const sdk = await loadSDK();
    const client = new sdk.Client(
      { name: 'openAwork-mcp-client', version: '1.0.0' },
      { capabilities: { sampling: {} } },
    );

    if (server.transport === 'stdio') {
      if (!server.command) {
        throw new Error(`MCP stdio server ${server.id} is missing command`);
      }
      await connectWithTimeout(
        server.id,
        client as unknown as SDKClient,
        new sdk.StdioClientTransport({
          command: server.command,
          args: server.args ?? [],
          cwd: server.cwd,
          env: { ...env, ...(server.env ?? {}) },
        }),
      );
    } else {
      if (!server.url) {
        throw new Error(`MCP server ${server.id} is missing url`);
      }
      const baseUrl = new URL(server.url);
      const transportOpts: TransportOpts | undefined = server.authProvider
        ? { authProvider: server.authProvider }
        : undefined;

      try {
        await connectWithTimeout(
          server.id,
          client as unknown as SDKClient,
          new sdk.StreamableHTTPClientTransport(baseUrl, transportOpts),
        );
      } catch (streamableErr) {
        // A connect timeout is a hard transport failure — don't silently
        // fall through to SSE and risk a second 30s hang. Only the
        // "this server doesn't speak Streamable HTTP" case should retry
        // via the legacy SSE transport.
        if (streamableErr instanceof MCPTimeoutError) {
          throw streamableErr;
        }
        await connectWithTimeout(
          server.id,
          client as unknown as SDKClient,
          new sdk.SSEClientTransport(baseUrl, transportOpts),
        );
      }
    }

    const entry = this.entries.get(server.id)!;
    entry.client = client;
    entry.status = 'connected';
  }

  async disconnect(serverId: string): Promise<void> {
    const entry = this.entries.get(serverId);
    if (!entry) return;
    await (entry.client as SDKClient).close();
    this.entries.delete(serverId);
  }

  async listTools(serverId: string): Promise<MCPToolDef[]> {
    const client = this.getClient(serverId);
    const entry = this.entries.get(serverId)!;
    // Collect raw tools first so the pagination ceiling reflects the
    // upstream's true page sizes, then drop disabled entries — a server
    // that floods us with thousands of tools should still trip the
    // pagination guard even if all of them happen to be locally
    // disabled.
    const raw = await collectPaginated(
      serverId,
      'listTools',
      (cursor) => client.listTools({ cursor }),
      (page) => page.tools,
      (page) => page.nextCursor,
    );
    const all: MCPToolDef[] = [];
    for (const t of raw) {
      if (entry.disabledTools.has(t.name)) continue;
      all.push({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema as JSONSchema,
      });
    }
    return all;
  }

  async listResources(serverId: string): Promise<MCPResourceDef[]> {
    const client = this.getClient(serverId);
    if (typeof client.listResources !== 'function') {
      throw new Error(`MCP server ${serverId} does not support listResources`);
    }
    const listResources = client.listResources.bind(client);
    return collectPaginated(
      serverId,
      'listResources',
      (cursor) => listResources({ cursor }),
      (page) => page.resources ?? [],
      (page) => page.nextCursor,
    );
  }

  async readResource(serverId: string, uri: string): Promise<MCPResourceReadResult> {
    const client = this.getClient(serverId);
    if (typeof client.readResource !== 'function') {
      throw new Error(`MCP server ${serverId} does not support readResource`);
    }
    return client.readResource({ uri });
  }

  async listPrompts(serverId: string): Promise<MCPPromptDef[]> {
    const client = this.getClient(serverId);
    if (typeof client.listPrompts !== 'function') {
      throw new Error(`MCP server ${serverId} does not support listPrompts`);
    }
    const listPrompts = client.listPrompts.bind(client);
    return collectPaginated(
      serverId,
      'listPrompts',
      (cursor) => listPrompts({ cursor }),
      (page) => page.prompts ?? [],
      (page) => page.nextCursor,
    );
  }

  async getPrompt(
    serverId: string,
    name: string,
    args?: Record<string, string>,
  ): Promise<MCPPromptResult> {
    const client = this.getClient(serverId);
    if (typeof client.getPrompt !== 'function') {
      throw new Error(`MCP server ${serverId} does not support getPrompt`);
    }
    return client.getPrompt({ name, arguments: args });
  }

  setServerDisabledTools(serverId: string, toolNames: string[]): void {
    const entry = this.entries.get(serverId);
    if (entry) entry.disabledTools = new Set(toolNames);
  }

  getServerHeaders(serverId: string): Record<string, string> {
    return this.entries.get(serverId)?.headers ?? {};
  }

  /**
   * Subscribe to the MCP server's `notifications/tools/list_changed`
   * push (`@modelcontextprotocol/sdk` `ToolListChangedNotificationSchema`).
   *
   * Mirrors opencode's `mcp/index.ts:472-484` `watch()` helper which
   * registers a notification handler on the SDK client right after the
   * initial `listTools()` snapshot. Whenever the server signals that
   * its tool list mutated, our caller (`mcp-tool-catalog.ts` in
   * agent-gateway) re-fetches the tools and pushes the new snapshot to
   * subscribers (UI, downstream LLM-tools dictionary).
   *
   * Throws if the connection isn't yet established — call this AFTER
   * `connect()` has resolved (the connection-pool wires it up inside
   * `createConnection`).
   *
   * The SDK keys notification handlers by the Zod schema, so we
   * dynamic-import the schema from `@modelcontextprotocol/sdk/types.js`
   * to avoid coupling this package's public surface to the SDK's type
   * exports. The schema is cached after the first call.
   */
  async subscribeToolListChanged(
    serverId: string,
    handler: () => void | Promise<void>,
  ): Promise<void> {
    const client = this.getClient(serverId);
    const schema = await loadToolListChangedSchema();
    client.setNotificationHandler(schema, async () => {
      try {
        await handler();
      } catch (err) {
        // Swallow listener errors so a buggy subscriber can't take
        // down the SDK transport — the SDK rethrows handler errors as
        // protocol-level failures otherwise.
        console.warn(`MCP tool-list-changed handler for ${serverId} threw:`, err);
      }
    });
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: unknown,
    options?: MCPCallOptions,
  ): Promise<MCPToolResult> {
    const client = this.getClient(serverId);
    const result = await client.callTool(
      { name: toolName, arguments: args as Record<string, unknown> },
      {
        timeout: options?.timeout ?? 30_000,
        resetTimeoutOnProgress: options?.resetTimeoutOnProgress,
        onprogress: options?.onprogress,
      },
    );
    return {
      content: result.content,
      structuredContent: result.structuredContent,
      isError: result.isError,
    };
  }

  getStatus(serverId: string): MCPConnectionStatus {
    return this.entries.get(serverId)?.status ?? 'disconnected';
  }

  private getClient(serverId: string): SDKClient {
    const entry = this.entries.get(serverId);
    if (!entry || entry.status !== 'connected') {
      throw new Error(`MCP server ${serverId} not connected`);
    }
    return entry.client as SDKClient;
  }
}
