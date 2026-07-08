import type { MCPServerEntry } from './mcp-server-config-model.js';

export function genMcpServerId(): string {
  return `mcp-${Date.now().toString(36)}`;
}

export function splitMcpList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function stringifyMcpJson(value: unknown): string {
  if (value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

export function parseMcpRecordJson(value: string): Record<string, string> | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function readStringField(value: object, key: string): string | undefined {
  const entry = Object.entries(value).find(([field]) => field === key);
  return typeof entry?.[1] === 'string' ? entry[1] : undefined;
}

export function parseMcpOAuthJson(value: string): MCPServerEntry['oauth'] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'false') return false;
  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const clientId = readStringField(parsed, 'clientId');
  const clientSecret = readStringField(parsed, 'clientSecret');
  const scope = readStringField(parsed, 'scope');
  const redirectUri = readStringField(parsed, 'redirectUri');
  return {
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(scope ? { scope } : {}),
    ...(redirectUri ? { redirectUri } : {}),
  };
}

export function getMcpServerTransport(server: MCPServerEntry): 'sse' | 'stdio' {
  return server.transport ?? server.type ?? 'sse';
}

export function isProtectedBuiltinMcpEndpoint(server: MCPServerEntry): boolean {
  return server.builtinKind === 'virtual' || server.builtinKind === 'adapter';
}

type ProtectedMcpPersistedSource = 'system' | 'user';

function resolveProtectedMcpPersistedSource(
  source: string | undefined,
): ProtectedMcpPersistedSource {
  if (source === 'user' || source === 'plugin') {
    return 'user';
  }
  return 'system';
}

export function sanitizeProtectedMcpEndpoint(server: MCPServerEntry): MCPServerEntry {
  if (!isProtectedBuiltinMcpEndpoint(server)) {
    return server;
  }
  const {
    args: _args,
    command: _command,
    cwd: _cwd,
    env: _env,
    headers: _headers,
    oauth: _oauth,
    type: _type,
    url: _url,
    ...safeServer
  } = server;
  return {
    ...safeServer,
    builtin: true,
    source: resolveProtectedMcpPersistedSource(safeServer.source),
    transport: 'stdio',
  };
}

export function toPersistedMcpServers(servers: MCPServerEntry[]): MCPServerEntry[] {
  return servers
    .filter((server) => server.source !== 'builtin')
    .map((server) => {
      const safeServer = sanitizeProtectedMcpEndpoint(server);
      if (!isProtectedBuiltinMcpEndpoint(safeServer)) {
        const { source: _source, ...persisted } = safeServer;
        return persisted;
      }
      return {
        id: safeServer.id,
        name: safeServer.name,
        transport: 'stdio',
        builtin: true,
        builtinKind: safeServer.builtinKind,
        source: resolveProtectedMcpPersistedSource(safeServer.source),
        enabled: safeServer.enabled ?? true,
        ...(safeServer.disabledTools ? { disabledTools: safeServer.disabledTools } : {}),
      };
    });
}
