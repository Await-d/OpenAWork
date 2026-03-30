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

interface MCPClientEntry {
  client: unknown;
  status: MCPConnectionStatus;
  disabledTools: Set<string>;
  headers: Record<string, string>;
}

type SDKClient = {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
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

type SDKModule = {
  Client: new (
    info: { name: string; version: string },
    opts: { capabilities: Record<string, unknown> },
  ) => SDKClient;
  StreamableHTTPClientTransport: new (url: URL) => unknown;
  SSEClientTransport: new (url: URL) => unknown;
  StdioClientTransport: new (config: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }) => unknown;
};

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
    server: MCPServerRef & { disabledTools?: string[]; headers?: Record<string, string> },
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
      await client.connect(
        new sdk.StdioClientTransport({
          command: server.command,
          args: server.args ?? [],
          env,
        }),
      );
    } else {
      if (!server.url) {
        throw new Error(`MCP server ${server.id} is missing url`);
      }
      const baseUrl = new URL(server.url);

      try {
        await client.connect(new sdk.StreamableHTTPClientTransport(baseUrl));
      } catch {
        await client.connect(new sdk.SSEClientTransport(baseUrl));
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
    const all: MCPToolDef[] = [];
    let cursor: string | undefined;
    do {
      const { tools, nextCursor } = await client.listTools({ cursor });
      for (const t of tools) {
        if (entry.disabledTools.has(t.name)) continue;
        all.push({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema as JSONSchema,
        });
      }
      cursor = nextCursor;
    } while (cursor);
    return all;
  }

  async listResources(serverId: string): Promise<MCPResourceDef[]> {
    const client = this.getClient(serverId);
    if (typeof client.listResources !== 'function') {
      throw new Error(`MCP server ${serverId} does not support listResources`);
    }
    const all: MCPResourceDef[] = [];
    let cursor: string | undefined;
    do {
      const result = await client.listResources({ cursor });
      all.push(...(result.resources ?? []));
      cursor = result.nextCursor;
    } while (cursor);
    return all;
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
    const all: MCPPromptDef[] = [];
    let cursor: string | undefined;
    do {
      const result = await client.listPrompts({ cursor });
      all.push(...(result.prompts ?? []));
      cursor = result.nextCursor;
    } while (cursor);
    return all;
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
