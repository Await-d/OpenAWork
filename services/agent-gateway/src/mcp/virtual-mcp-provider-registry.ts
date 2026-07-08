import type { MCPToolDef, MCPToolResult } from '@openAwork/mcp-client';
import type { ConfiguredMCPServer, MCPCallInput, MCPCallOutput } from './mcp-runtime.js';
import { callCodegraphVirtualMcp, CODEGRAPH_VIRTUAL_MCP_TOOLS } from './virtual-codegraph-mcp.js';
import { callGitBashVirtualMcp, listGitBashVirtualMcpTools } from './virtual-git-bash-mcp.js';
import { callLspVirtualMcp, LSP_VIRTUAL_MCP_TOOLS } from './virtual-lsp-mcp.js';
import { callOmoVirtualMcp, listOmoVirtualMcpTools } from './virtual-omo-mcp.js';

export interface VirtualMcpProvider {
  readonly id: string;
  readonly listTools: () => MCPToolDef[];
  readonly callTool: (
    sessionId: string,
    server: ConfiguredMCPServer,
    input: MCPCallInput,
  ) => Promise<MCPCallOutput>;
}

export const VIRTUAL_MCP_PROVIDERS = [
  {
    id: 'codegraph',
    listTools: () => [...CODEGRAPH_VIRTUAL_MCP_TOOLS],
    callTool: async (sessionId, server, input) =>
      textOutput(server.id, input.toolName, await callCodegraphVirtualMcp(sessionId, input)),
  },
  {
    id: 'git_bash',
    listTools: () => listGitBashVirtualMcpTools(),
    callTool: async (sessionId, server, input) =>
      textOutput(server.id, input.toolName, await callGitBashVirtualMcp(sessionId, input)),
  },
  {
    id: 'lsp',
    listTools: () => [...LSP_VIRTUAL_MCP_TOOLS],
    callTool: async (sessionId, server, input) =>
      textOutput(server.id, input.toolName, await callLspVirtualMcp(sessionId, input)),
  },
  {
    id: 'omo',
    listTools: () => listOmoVirtualMcpTools(),
    callTool: async (sessionId, server, input) =>
      textOutput(server.id, input.toolName, await callOmoVirtualMcp(sessionId, input)),
  },
] as const satisfies readonly VirtualMcpProvider[];

export type VirtualMcpProviderId = (typeof VIRTUAL_MCP_PROVIDERS)[number]['id'];

const VIRTUAL_MCP_PROVIDER_BY_ID: ReadonlyMap<string, VirtualMcpProvider> = new Map(
  VIRTUAL_MCP_PROVIDERS.map((provider) => [provider.id, provider]),
);

export function listVirtualMcpProviders(): readonly VirtualMcpProvider[] {
  return VIRTUAL_MCP_PROVIDERS;
}

export function listVirtualBuiltinMcpIds(): readonly VirtualMcpProviderId[] {
  return VIRTUAL_MCP_PROVIDERS.map((provider) => provider.id);
}

export function getVirtualMcpProvider(serverId: string): VirtualMcpProvider | undefined {
  return VIRTUAL_MCP_PROVIDER_BY_ID.get(serverId);
}

export function isVirtualMcpProviderId(id: string): id is VirtualMcpProviderId {
  return getVirtualMcpProvider(id) !== undefined;
}

function textOutput(serverId: string, toolName: string, value: unknown): MCPCallOutput {
  const result = readToolResultShape(value);
  const fallbackContent = [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ] satisfies MCPToolResult['content'];

  return {
    serverId,
    toolName,
    content: result.content ?? fallbackContent,
    ...(result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent }
      : {}),
    ...(result.isError !== undefined ? { isError: result.isError } : {}),
  };
}

function readToolResultShape(value: unknown): {
  readonly content?: MCPToolResult['content'];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
} {
  if (!isRecord(value)) return {};
  const content = isNonEmptyArray(value['content']) ? value['content'] : undefined;
  const isError = typeof value['isError'] === 'boolean' ? value['isError'] : undefined;
  return {
    ...(content ? { content } : {}),
    ...(value['structuredContent'] !== undefined
      ? { structuredContent: value['structuredContent'] }
      : {}),
    ...(isError !== undefined ? { isError } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyArray(value: unknown): value is MCPToolResult['content'] {
  return Array.isArray(value) && value.length > 0;
}
