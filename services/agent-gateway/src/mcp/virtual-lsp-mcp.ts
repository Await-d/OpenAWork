import type { MCPToolDef } from '@openAwork/mcp-client';
import type { JSONSchema } from '@openAwork/skill-types';
import { lspManager } from '../lsp/router.js';
import {
  executeLspRename,
  lspCallHierarchyToolDefinition,
  lspFindReferencesToolDefinition,
  lspGotoDefinitionToolDefinition,
  lspGotoImplementationToolDefinition,
  lspHoverToolDefinition,
  lspPrepareRenameToolDefinition,
  lspRenameToolDefinition,
  lspSymbolsToolDefinition,
} from '../tools/lsp-tools.js';
import {
  assertSessionWorkingDirectory,
  assertSessionWorkspacePath,
} from '../workspace/workspace-safety.js';
import type { MCPCallInput } from './mcp-runtime.js';
import { EMPTY_SCHEMA, FILE_POSITION_FIELDS } from './virtual-mcp-tool-schemas.js';

const VIRTUAL_TOOL_SIGNAL = new AbortController().signal;

function positionToolSchema(
  properties: Record<string, JSONSchema>,
  required: readonly string[],
): MCPToolDef['inputSchema'] {
  return {
    type: 'object',
    properties,
    required: [...required],
    additionalProperties: false,
  };
}

export const LSP_VIRTUAL_MCP_TOOLS = [
  {
    name: 'status',
    description: '列出已配置和当前活跃的 LSP server，不启动新的语言服务器。',
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: 'diagnostics',
    description: '获取源文件或全部已打开文件的 LSP 错误、警告和提示。',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        severity: { type: 'string', enum: ['error', 'warning', 'information', 'hint', 'all'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'goto_definition',
    description: '查找符号定义位置。',
    inputSchema: positionToolSchema(FILE_POSITION_FIELDS, ['filePath', 'line', 'character']),
  },
  {
    name: 'goto_implementation',
    description: '查找接口或抽象方法的具体实现位置。',
    inputSchema: positionToolSchema(FILE_POSITION_FIELDS, ['filePath', 'line', 'character']),
  },
  {
    name: 'find_references',
    description: '查找符号在工作区中的引用位置。',
    inputSchema: positionToolSchema(
      { ...FILE_POSITION_FIELDS, includeDeclaration: { type: 'boolean' } },
      ['filePath', 'line', 'character'],
    ),
  },
  {
    name: 'symbols',
    description: '列出文档符号，或在工作区范围内搜索符号。',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        scope: { type: 'string', enum: ['document', 'workspace'] },
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'prepare_rename',
    description: '检查指定位置是否可重命名。',
    inputSchema: positionToolSchema(FILE_POSITION_FIELDS, ['filePath', 'line', 'character']),
  },
  {
    name: 'rename',
    description: '跨工作区重命名符号并应用返回的 workspace edit。',
    inputSchema: positionToolSchema({ ...FILE_POSITION_FIELDS, newName: { type: 'string' } }, [
      'filePath',
      'line',
      'character',
      'newName',
    ]),
  },
  {
    name: 'hover',
    description: '获取指定位置符号的 hover 信息。',
    inputSchema: positionToolSchema(FILE_POSITION_FIELDS, ['filePath', 'line', 'character']),
  },
  {
    name: 'call_hierarchy',
    description: '获取符号的一跳调用层次，包括 incoming、outgoing 或 both。',
    inputSchema: positionToolSchema(
      {
        ...FILE_POSITION_FIELDS,
        direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'] },
      },
      ['filePath', 'line', 'character'],
    ),
  },
  {
    name: 'touch',
    description: '通知 LSP 某个文件已修改，可选择等待诊断更新。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        waitForDiagnostics: { type: 'boolean' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
] satisfies readonly MCPToolDef[];

export async function callLspVirtualMcp(sessionId: string, input: MCPCallInput): Promise<unknown> {
  const args = input.arguments ?? {};
  switch (input.toolName) {
    case 'status':
      return { servers: await lspManager.status(), missing: lspManager.missingServers() };
    case 'diagnostics':
      return lspDiagnostics(args, sessionId);
    case 'goto_definition':
      return lspGotoDefinitionToolDefinition.execute(
        scopeFileInput(lspGotoDefinitionToolDefinition.inputSchema.parse(args), sessionId),
        VIRTUAL_TOOL_SIGNAL,
      );
    case 'goto_implementation':
      return lspGotoImplementationToolDefinition.execute(
        scopeFileInput(lspGotoImplementationToolDefinition.inputSchema.parse(args), sessionId),
        VIRTUAL_TOOL_SIGNAL,
      );
    case 'find_references':
      return lspFindReferencesToolDefinition.execute(
        scopeFileInput(lspFindReferencesToolDefinition.inputSchema.parse(args), sessionId),
        VIRTUAL_TOOL_SIGNAL,
      );
    case 'symbols':
      return lspSymbolsToolDefinition.execute(
        scopeFileInput(lspSymbolsToolDefinition.inputSchema.parse(args), sessionId),
        VIRTUAL_TOOL_SIGNAL,
      );
    case 'prepare_rename':
      return lspPrepareRenameToolDefinition.execute(
        scopeFileInput(lspPrepareRenameToolDefinition.inputSchema.parse(args), sessionId),
        VIRTUAL_TOOL_SIGNAL,
      );
    case 'rename':
      return executeLspRename(
        scopeFileInput(lspRenameToolDefinition.inputSchema.parse(args), sessionId),
        assertSessionWorkingDirectory(sessionId),
      );
    case 'hover':
      return lspHoverToolDefinition.execute(
        scopeFileInput(lspHoverToolDefinition.inputSchema.parse(args), sessionId),
        VIRTUAL_TOOL_SIGNAL,
      );
    case 'call_hierarchy':
      return lspCallHierarchyToolDefinition.execute(
        scopeFileInput(lspCallHierarchyToolDefinition.inputSchema.parse(args), sessionId),
        VIRTUAL_TOOL_SIGNAL,
      );
    case 'touch':
      return lspTouch(args, sessionId);
    default:
      throw new Error(`Unsupported lsp MCP tool: ${input.toolName}`);
  }
}

function scopeFileInput<T extends { readonly filePath: string }>(input: T, sessionId: string): T {
  return { ...input, filePath: assertSessionWorkspacePath({ path: input.filePath, sessionId }) };
}

async function lspDiagnostics(args: Record<string, unknown>, sessionId: string): Promise<unknown> {
  const filePath = typeof args['filePath'] === 'string' ? args['filePath'] : undefined;
  const scopedFile = filePath
    ? assertSessionWorkspacePath({ path: filePath, sessionId })
    : undefined;
  const diagnostics = await lspManager.diagnostics();
  if (!scopedFile) return diagnostics;
  const key = Object.keys(diagnostics).find(
    (path) => path === scopedFile || path.endsWith(scopedFile),
  );
  return key ? { [key]: diagnostics[key] } : {};
}

async function lspTouch(args: Record<string, unknown>, sessionId: string): Promise<{ ok: true }> {
  const path = typeof args['path'] === 'string' ? args['path'] : '';
  const waitForDiagnostics = args['waitForDiagnostics'] === true;
  await lspManager.touchFile(assertSessionWorkspacePath({ path, sessionId }), waitForDiagnostics);
  return { ok: true };
}
