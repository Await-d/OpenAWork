import type { MCPToolDef } from '@openAwork/mcp-client';
import { executeCodegraphTool } from '../tools/codegraph-tools.js';
import type { MCPCallInput } from './mcp-runtime.js';
import { WORKSPACE_ROOT_FIELD } from './virtual-mcp-tool-schemas.js';

export const CODEGRAPH_VIRTUAL_MCP_TOOLS = [
  {
    name: 'codegraph_status',
    description: '查看当前工作区 codegraph 缓存状态、依赖健康和 stale 文件。',
    inputSchema: {
      type: 'object',
      properties: { workspaceRoot: WORKSPACE_ROOT_FIELD },
      additionalProperties: false,
    },
  },
  {
    name: 'codegraph_index',
    description: '为当前工作区触发 codegraph 索引。',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: WORKSPACE_ROOT_FIELD,
        path: { type: 'string', description: '可选的局部路径。' },
        force: { type: 'boolean', description: '是否强制重建。' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'codegraph_search',
    description: '按名称搜索当前工作区 codegraph 符号索引。',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: WORKSPACE_ROOT_FIELD,
        query: { type: 'string' },
        kind: {
          type: 'string',
          enum: [
            'function',
            'method',
            'class',
            'interface',
            'type',
            'variable',
            'route',
            'component',
          ],
        },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'codegraph_node',
    description: '查看某个符号或文件的 codegraph 节点、关系和 bounded 源码片段。',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: WORKSPACE_ROOT_FIELD,
        symbol: { type: 'string' },
        file: { type: 'string' },
        includeCode: { type: 'boolean' },
        offset: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
        symbolsOnly: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'codegraph_callers',
    description: '查看当前工作区中调用或引用某符号的 bounded codegraph 边。',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: WORKSPACE_ROOT_FIELD,
        symbol: { type: 'string' },
        file: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'codegraph_impact',
    description: '从某符号出发做 bounded impact traversal，用于发现变更影响面。',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: WORKSPACE_ROOT_FIELD,
        symbol: { type: 'string' },
        file: { type: 'string' },
        maxDepth: { type: 'integer', minimum: 1, maximum: 5 },
        maxResults: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
] satisfies readonly MCPToolDef[];

export async function callCodegraphVirtualMcp(
  sessionId: string,
  input: MCPCallInput,
): Promise<unknown> {
  return executeCodegraphTool({
    sessionId,
    toolName: input.toolName,
    rawInput: input.arguments ?? {},
  });
}
