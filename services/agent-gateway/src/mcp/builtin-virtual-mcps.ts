import type { MCPToolDef, MCPToolResult } from '@openAwork/mcp-client';
import type { ConfiguredMCPServer, MCPCallInput, MCPCallOutput } from './mcp-runtime.js';
import { callCodegraphVirtualMcp, CODEGRAPH_VIRTUAL_MCP_TOOLS } from './virtual-codegraph-mcp.js';
import { callGitBashVirtualMcp, listGitBashVirtualMcpTools } from './virtual-git-bash-mcp.js';
import { callLspVirtualMcp, LSP_VIRTUAL_MCP_TOOLS } from './virtual-lsp-mcp.js';

export const VIRTUAL_BUILTIN_MCP_IDS = ['codegraph', 'git_bash', 'lsp'] as const;

type VirtualBuiltinMcpId = (typeof VIRTUAL_BUILTIN_MCP_IDS)[number];

const VIRTUAL_BUILTIN_MCP_ID_SET: ReadonlySet<string> = new Set(VIRTUAL_BUILTIN_MCP_IDS);

export function isVirtualBuiltinMcpId(id: string): id is VirtualBuiltinMcpId {
  return VIRTUAL_BUILTIN_MCP_ID_SET.has(id);
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
  switch (serverId) {
    case 'codegraph':
      return [...CODEGRAPH_VIRTUAL_MCP_TOOLS];
    case 'lsp':
      return [...LSP_VIRTUAL_MCP_TOOLS];
    case 'git_bash':
      return listGitBashVirtualMcpTools();
    default:
      return [];
  }
}

export async function callVirtualMcpToolForSession(
  sessionId: string,
  server: ConfiguredMCPServer,
  input: MCPCallInput,
): Promise<MCPCallOutput> {
  switch (server.id) {
    case 'codegraph':
      return textOutput(server.id, input.toolName, await callCodegraphVirtualMcp(sessionId, input));
    case 'lsp':
      return textOutput(server.id, input.toolName, await callLspVirtualMcp(sessionId, input));
    case 'git_bash':
      return textOutput(server.id, input.toolName, await callGitBashVirtualMcp(sessionId, input));
    default:
      throw new Error(`Unsupported virtual MCP server: ${server.id}`);
  }
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
