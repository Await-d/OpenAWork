import { createHash } from 'node:crypto';
import { MCPClientAdapterImpl } from '@openAwork/mcp-client';
import type { MCPToolDef, MCPToolResult } from '@openAwork/mcp-client';
import { sqliteGet } from './db.js';

interface UserSettingRow {
  value: string;
}

interface SessionOwnerRow {
  user_id: string;
}

export interface ConfiguredMCPServer {
  id: string;
  name: string;
  transport: 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  disabledTools?: string[];
  headers?: Record<string, string>;
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

function normalizeMcpTransport(value: unknown): 'sse' | 'stdio' {
  return value === 'stdio' ? 'stdio' : 'sse';
}

export function loadConfiguredMcpServersForUser(userId: string): ConfiguredMCPServer[] {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'mcp_servers'`,
    [userId],
  );

  if (!row?.value) {
    return [];
  }

  try {
    const parsed = JSON.parse(row.value) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      const server = entry as Record<string, unknown>;
      const id = typeof server['id'] === 'string' ? server['id'].trim() : '';
      const name = typeof server['name'] === 'string' ? server['name'].trim() : id;
      if (!id || !name) {
        return [];
      }

      const transport = normalizeMcpTransport(server['transport'] ?? server['type']);
      const args = Array.isArray(server['args'])
        ? server['args'].filter((arg): arg is string => typeof arg === 'string')
        : undefined;
      const disabledTools = Array.isArray(server['disabledTools'])
        ? server['disabledTools'].filter((tool): tool is string => typeof tool === 'string')
        : undefined;
      const headers =
        server['headers'] && typeof server['headers'] === 'object'
          ? Object.fromEntries(
              Object.entries(server['headers'] as Record<string, unknown>).filter(
                (pair): pair is [string, string] => typeof pair[1] === 'string',
              ),
            )
          : undefined;

      return [
        {
          id,
          name,
          transport,
          url: typeof server['url'] === 'string' ? server['url'] : undefined,
          command: typeof server['command'] === 'string' ? server['command'] : undefined,
          args,
          enabled: server['enabled'] !== false,
          disabledTools,
          headers,
        },
      ];
    });
  } catch {
    return [];
  }
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
    disabledTools: server.disabledTools ?? [],
  });

  return createHash('sha256').update(fingerprintSource).digest('hex').slice(0, 16);
}

async function withConnectedMcpServer<T>(
  server: ConfiguredMCPServer,
  fn: (client: MCPClientAdapterImpl) => Promise<T>,
): Promise<T> {
  const client = new MCPClientAdapterImpl();
  await client.connect({
    id: server.id,
    transport: server.transport,
    url: server.url,
    command: server.command,
    args: server.args,
    disabledTools: server.disabledTools,
    headers: server.headers,
  });

  try {
    return await fn(client);
  } finally {
    await client.disconnect(server.id).catch(() => undefined);
  }
}

export async function listMcpToolsForSession(
  sessionId: string,
  filter?: { serverId?: string },
): Promise<MCPServerToolCatalog[]> {
  const configuredServers = getConfiguredMcpServersForSession(sessionId);
  const selectedServers = filter?.serverId
    ? configuredServers.filter((server) => server.id === filter.serverId)
    : configuredServers;

  return Promise.all(
    selectedServers.map(async (server) => {
      if (!server.enabled) {
        return {
          serverId: server.id,
          serverName: server.name,
          transport: server.transport,
          enabled: false,
          status: 'disabled' as const,
          tools: [],
        };
      }

      try {
        const tools = await withConnectedMcpServer(server, (client) => client.listTools(server.id));
        return {
          serverId: server.id,
          serverName: server.name,
          transport: server.transport,
          enabled: true,
          status: 'connected' as const,
          tools,
        };
      } catch (error) {
        return {
          serverId: server.id,
          serverName: server.name,
          transport: server.transport,
          enabled: true,
          status: 'error' as const,
          tools: [],
          error: String(error),
        };
      }
    }),
  );
}

export async function callMcpToolForSession(
  sessionId: string,
  input: MCPCallInput,
): Promise<MCPCallOutput> {
  const server = getConfiguredMcpServerForSession(sessionId, input.serverId);
  if (server.disabledTools?.includes(input.toolName)) {
    throw new Error(`MCP tool ${input.toolName} is disabled for server ${server.id}`);
  }
  const result = await withConnectedMcpServer(server, (client) =>
    client.callTool(server.id, input.toolName, input.arguments ?? {}),
  );

  return {
    serverId: server.id,
    toolName: input.toolName,
    content: result.content,
    structuredContent: result.structuredContent,
    isError: result.isError,
  };
}
