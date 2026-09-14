/**
 * `mcp_list_tools` returns `MCPServerToolCatalog[]` — one entry per enabled MCP
 * server with its resolved tool list (see the gateway's `mcp-runtime.ts`).
 * Rendering the array as JSON is hard to scan, so we group by server and list
 * the tool names.
 */
export interface McpToolListTool {
  description?: string;
  name: string;
}

export interface McpToolListServer {
  enabled: boolean;
  error?: string;
  serverId: string;
  serverName: string;
  status: string;
  tools: McpToolListTool[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function toServer(value: unknown): McpToolListServer | null {
  const record = asRecord(value);
  if (!record) return null;
  const serverId = record['serverId'];
  if (typeof serverId !== 'string' || serverId.length === 0) return null;

  const rawTools = Array.isArray(record['tools']) ? record['tools'] : [];
  const tools: McpToolListTool[] = [];
  for (const item of rawTools) {
    const tool = asRecord(item);
    const name = tool?.['name'];
    if (typeof name !== 'string' || name.length === 0) continue;
    tools.push({
      name,
      ...(typeof tool?.['description'] === 'string' ? { description: tool['description'] } : {}),
    });
  }

  return {
    enabled: record['enabled'] !== false,
    ...(typeof record['error'] === 'string' ? { error: record['error'] } : {}),
    serverId,
    serverName: typeof record['serverName'] === 'string' ? record['serverName'] : serverId,
    status: typeof record['status'] === 'string' ? record['status'] : 'unknown',
    tools,
  };
}

export function extractMcpToolList(output: unknown): McpToolListServer[] | null {
  const items = Array.isArray(output) ? output : [output];
  const servers: McpToolListServer[] = [];
  for (const item of items) {
    const server = toServer(item);
    if (server) servers.push(server);
  }
  return servers.length > 0 ? servers : null;
}

export function McpToolListPreview({ servers }: { servers: McpToolListServer[] }) {
  return (
    <div className="mcp-tools">
      {servers.map((server) => (
        <div className="mcp-tools-server" key={server.serverId}>
          <div className="mcp-tools-head">
            <span className="mcp-tools-name">{server.serverName}</span>
            <span className="mcp-tools-status" data-status={server.status}>
              {server.status}
            </span>
            <span className="mcp-tools-count">{server.tools.length} 个工具</span>
          </div>
          {server.error && <div className="mcp-tools-error">{server.error}</div>}
          {server.tools.length > 0 && (
            <div className="mcp-tools-list">
              {server.tools.map((tool) => (
                <div className="mcp-tools-item" key={tool.name} title={tool.description}>
                  <span className="mcp-tools-item-name">{tool.name}</span>
                  {tool.description && (
                    <span className="mcp-tools-item-desc">{tool.description}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
