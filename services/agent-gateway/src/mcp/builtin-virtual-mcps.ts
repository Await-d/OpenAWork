import type { MCPToolDef } from '@openAwork/mcp-client';
import type { ConfiguredMCPServer, MCPCallInput, MCPCallOutput } from './mcp-runtime.js';
import {
  getVirtualMcpProvider,
  isVirtualMcpProviderId,
  listVirtualBuiltinMcpIds,
  type VirtualMcpProviderId,
} from './virtual-mcp-provider-registry.js';

export const VIRTUAL_BUILTIN_MCP_IDS = listVirtualBuiltinMcpIds();

type VirtualBuiltinMcpId = VirtualMcpProviderId;

export function isVirtualBuiltinMcpId(id: string): id is VirtualBuiltinMcpId {
  return isVirtualMcpProviderId(id);
}

export function isVirtualBuiltinMcpServer(server: ConfiguredMCPServer): boolean {
  return (
    server.builtin === true &&
    isVirtualBuiltinMcpId(server.id) &&
    server.transport === 'stdio' &&
    typeof server.command === 'string' &&
    server.command.startsWith('openawork-virtual-')
  );
}

export function listVirtualMcpTools(serverId: string): MCPToolDef[] {
  return getVirtualMcpProvider(serverId)?.listTools() ?? [];
}

export async function callVirtualMcpToolForSession(
  sessionId: string,
  server: ConfiguredMCPServer,
  input: MCPCallInput,
): Promise<MCPCallOutput> {
  const provider = getVirtualMcpProvider(server.id);
  if (!provider) {
    throw new Error(`Unsupported virtual MCP server: ${server.id}`);
  }
  return provider.callTool(sessionId, server, input);
}
