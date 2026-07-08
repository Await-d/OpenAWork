import { BUILTIN_MCP_IDS } from './builtin-mcps.js';

export type McpServerSource = 'system' | 'user' | 'plugin';

export interface McpServerAuthorizationTarget {
  readonly id: string;
  readonly builtin?: boolean;
  readonly source?: McpServerSource;
}

export interface McpSessionScope {
  readonly allowedServerIds?: readonly string[];
}

export class McpServerScopeDeniedError extends Error {
  readonly serverId: string;

  constructor(serverId: string) {
    super(`MCP server ${serverId} is not allowed for this session`);
    this.name = 'McpServerScopeDeniedError';
    this.serverId = serverId;
  }
}

export function readPersistedMcpServerSource(value: unknown): Exclude<McpServerSource, 'system'> {
  return value === 'plugin' ? 'plugin' : 'user';
}

export function isSystemMcpServer(
  server: McpServerAuthorizationTarget,
  builtinIds: readonly string[] = BUILTIN_MCP_IDS,
): boolean {
  return (
    server.source === 'system' ||
    (server.source === undefined && server.builtin === true && builtinIds.includes(server.id))
  );
}

export function assertMcpServerAllowedForScope(
  server: McpServerAuthorizationTarget,
  scope?: McpSessionScope,
  builtinIds: readonly string[] = BUILTIN_MCP_IDS,
): void {
  if (scope?.allowedServerIds === undefined) {
    return;
  }

  if (isSystemMcpServer(server, builtinIds)) {
    return;
  }

  if (scope.allowedServerIds.includes(server.id)) {
    return;
  }

  throw new McpServerScopeDeniedError(server.id);
}
