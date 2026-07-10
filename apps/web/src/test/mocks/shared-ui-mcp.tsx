import type { ReactElement } from 'react';

export interface MCPServerEntry {
  id: string;
  name: string;
  transport?: 'sse' | 'stdio';
  type?: 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  required?: boolean;
  builtin?: boolean;
  builtinKind?: 'system' | 'virtual' | 'adapter';
  source?: 'builtin' | 'user' | 'system';
  enabled?: boolean;
  disabledTools?: string[];
  headers?: Record<string, string>;
  oauth?:
    false | { clientId?: string; clientSecret?: string; redirectUri?: string; scope?: string };
}

export interface MCPServerConfigProps {
  servers: MCPServerEntry[];
  onAdd: (entry: MCPServerEntry) => void;
  onRemove: (id: string) => void;
  onUpdate?: (id: string, entry: MCPServerEntry) => void;
}

const mcpServerConfigFocusVisibleCss = `
[data-openawork-mcp-server-config] :where(input, select, textarea, button, summary):focus {
  outline: none;
}

[data-openawork-mcp-server-config] :where(input, select, textarea, button, summary):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}

[data-openawork-mcp-server-config] [data-mcp-danger-action]:focus-visible {
  outline-color: var(--complement);
  box-shadow: 0 0 0 4px var(--complement-subtle);
}
`;

function isProtectedBuiltinMcpEndpoint(server: MCPServerEntry): boolean {
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

function sanitizeProtectedMcpEndpoint(server: MCPServerEntry): MCPServerEntry {
  if (!isProtectedBuiltinMcpEndpoint(server)) return server;
  return {
    id: server.id,
    name: server.name,
    transport: 'stdio',
    builtin: true,
    builtinKind: server.builtinKind,
    source: resolveProtectedMcpPersistedSource(server.source),
    enabled: server.enabled ?? true,
    ...(server.disabledTools ? { disabledTools: server.disabledTools } : {}),
  };
}

function splitMcpList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function MCPServerConfig(props: MCPServerConfigProps): ReactElement {
  return (
    <div data-openawork-mcp-server-config="true">
      <style>{mcpServerConfigFocusVisibleCss}</style>
      {props.servers.length === 0 ? <div>暂无服务器配置</div> : null}
      {props.servers.map((server) => {
        const isLocked = isProtectedBuiltinMcpEndpoint(server);
        const update = (patch: Partial<MCPServerEntry>) => {
          props.onUpdate?.(server.id, sanitizeProtectedMcpEndpoint({ ...server, ...patch }));
        };
        return (
          <div key={server.id} data-mcp-row={server.id}>
            <input aria-label="MCP ID" readOnly value={server.id} />
            <input aria-label="MCP 名称" readOnly value={server.name} />
            <label>
              <input
                aria-label="启用"
                checked={server.enabled !== false}
                type="checkbox"
                onChange={(event) => update({ enabled: event.target.checked })}
              />
              启用
            </label>
            <button
              type="button"
              data-mcp-danger-action="true"
              onClick={() => props.onRemove(server.id)}
            >
              {server.builtin ? '禁用' : '移除'}
            </button>
            {server.builtin ? <span>系统内置</span> : null}
            {isLocked ? <span>内置桥接</span> : null}
            {isLocked ? (
              <input
                aria-label="MCP 内置桥接"
                readOnly
                value="运行时内置桥接，无需 command / url"
              />
            ) : (
              <>
                <input aria-label="MCP command" readOnly value={server.command ?? ''} />
                <input aria-label="MCP URL" readOnly value={server.url ?? ''} />
              </>
            )}
            <input
              aria-label="禁用工具"
              value={(server.disabledTools ?? []).join(', ')}
              onChange={(event) => update({ disabledTools: splitMcpList(event.target.value) })}
            />
          </div>
        );
      })}
    </div>
  );
}

export function toPersistedMcpServers(servers: MCPServerEntry[]): MCPServerEntry[] {
  return servers
    .filter((server) => server.source !== 'builtin')
    .map((server) =>
      server.builtinKind === 'virtual' || server.builtinKind === 'adapter'
        ? {
            id: server.id,
            name: server.name,
            transport: 'stdio',
            builtin: true,
            builtinKind: server.builtinKind,
            source: resolveProtectedMcpPersistedSource(server.source),
            enabled: server.enabled ?? true,
            ...(server.disabledTools ? { disabledTools: server.disabledTools } : {}),
          }
        : server,
    );
}

export interface MCPServerStatus {
  id: string;
  name: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'disabled' | 'error';
  toolCount: number;
  authType?: string;
  builtin?: boolean;
  disabledTools?: string[];
  error?: string;
  tools?: Array<{ description?: string; name: string }>;
}
