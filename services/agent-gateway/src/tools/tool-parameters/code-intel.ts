import type { ToolParameters } from './tool-parameter-schema.js';
import { AST_GREP_LANGUAGES } from '../ast-grep-tools.js';

export function buildCodeIntelParameters(name: string): ToolParameters | undefined {
  switch (name) {
    case 'codesearch':
      return {
        type: 'object',
        properties: {
          query: { type: 'string', description: '代码搜索关键词' },
          tokensNum: {
            type: 'integer',
            minimum: 1000,
            maximum: 50000,
            description: '返回的 token 近似数量',
          },
        },
        required: ['query'],
        additionalProperties: false,
      };
    case 'lsp_diagnostics':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '可选的文件路径过滤' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'lsp_touch':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: '被 touch 的文件路径' },
          waitForDiagnostics: {
            type: 'boolean',
            description: '返回前等待诊断更新',
          },
        },
        required: ['path'],
        additionalProperties: false,
      };
    case 'lsp_goto_definition':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'lsp_goto_implementation':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'lsp_find_references':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
          includeDeclaration: { type: 'boolean' },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'lsp_symbols':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          scope: { type: 'string', enum: ['document', 'workspace'] },
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
        required: ['filePath'],
        additionalProperties: false,
      };
    case 'lsp_prepare_rename':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'lsp_rename':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
          newName: { type: 'string' },
        },
        required: ['filePath', 'line', 'character', 'newName'],
        additionalProperties: false,
      };
    case 'lsp_hover':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'lsp_call_hierarchy':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
          direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'] },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'codegraph_status':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'codegraph_index':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
          path: { type: 'string', description: '可选：只索引 active workspace 内的子路径' },
          force: { type: 'boolean', description: '是否强制重新索引' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'codegraph_search':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
          query: { type: 'string', description: '符号名称或部分名称' },
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
      };
    case 'codegraph_node':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
          symbol: { type: 'string', description: '要查看的符号名' },
          file: {
            type: 'string',
            description: 'active workspace 内的文件路径，用于文件模式或消歧',
          },
          includeCode: { type: 'boolean' },
          offset: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 2000 },
          symbolsOnly: { type: 'boolean' },
        },
        required: [],
        anyOf: [
          { type: 'object', required: ['symbol'] },
          { type: 'object', required: ['file'] },
        ],
        additionalProperties: false,
      };
    case 'codegraph_callers':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
          symbol: { type: 'string', description: '要查找调用方的符号名' },
          file: { type: 'string', description: 'active workspace 内的文件路径，用于消歧' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['symbol'],
        additionalProperties: false,
      };
    case 'codegraph_impact':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
          symbol: { type: 'string', description: '影响面遍历起点符号' },
          file: { type: 'string', description: 'active workspace 内的文件路径，用于消歧' },
          maxDepth: { type: 'integer', minimum: 1, maximum: 5 },
          maxResults: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['symbol'],
        additionalProperties: false,
      };
    case 'ast_grep_search':
      return {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          lang: { type: 'string', enum: [...AST_GREP_LANGUAGES] },
          paths: { type: 'array', items: { type: 'string' } },
          globs: { type: 'array', items: { type: 'string' } },
          context: { type: 'integer', minimum: 0, maximum: 20 },
        },
        required: ['pattern', 'lang'],
        additionalProperties: false,
      };
    case 'ast_grep_replace':
      return {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          rewrite: { type: 'string' },
          lang: { type: 'string', enum: [...AST_GREP_LANGUAGES] },
          paths: { type: 'array', items: { type: 'string' } },
          globs: { type: 'array', items: { type: 'string' } },
          dryRun: { type: 'boolean' },
        },
        required: ['pattern', 'rewrite', 'lang'],
        additionalProperties: false,
      };
    default:
      return undefined;
  }
}
