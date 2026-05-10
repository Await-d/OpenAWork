import { z } from 'zod';
import type { ToolDefinition } from '../tool-contract.js';

export const lspDiagnosticsTool: ToolDefinition<
  z.ZodObject<{ filePath: z.ZodOptional<z.ZodString> }>,
  z.ZodRecord<z.ZodString, z.ZodArray<z.ZodUnknown>>
> = {
  name: 'lsp_diagnostics',
  description:
    '获取 LSP 诊断（错误、警告）：可针对单个文件或全部打开的文件。返回 filePath → 诊断数组的映射。',
  inputSchema: z.object({
    filePath: z.string().optional(),
  }),
  outputSchema: z.record(z.string(), z.array(z.unknown())),
  timeout: 10_000,
  execute: async (input, _signal) => {
    const gatewayUrl = globalThis.process?.env['GATEWAY_URL'] ?? 'http://localhost:3000';
    const token = globalThis.process?.env['GATEWAY_TOKEN'] ?? '';

    const res = await fetch(`${gatewayUrl}/lsp/diagnostics`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: _signal,
    });

    if (!res.ok) throw new Error(`LSP diagnostics request failed: ${res.status}`);

    const data = (await res.json()) as { diagnostics: Record<string, unknown[]> };
    const all = data.diagnostics;

    if (input.filePath) {
      const key = Object.keys(all).find((k) => k.endsWith(input.filePath!));
      return key ? { [key]: all[key]! } : {};
    }

    return all;
  },
};

export const lspTouchTool: ToolDefinition<
  z.ZodObject<{ path: z.ZodString; waitForDiagnostics: z.ZodDefault<z.ZodBoolean> }>,
  z.ZodObject<{ ok: z.ZodBoolean }>
> = {
  name: 'lsp_touch',
  description: '通知 LSP 服务器某个文件已被修改。可选等待诊断更新后再返回。',
  inputSchema: z.object({
    path: z.string(),
    waitForDiagnostics: z.boolean().default(true),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  timeout: 15_000,
  execute: async (input, _signal) => {
    const gatewayUrl = globalThis.process?.env['GATEWAY_URL'] ?? 'http://localhost:3000';
    const token = globalThis.process?.env['GATEWAY_TOKEN'] ?? '';

    const res = await fetch(`${gatewayUrl}/lsp/touch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ path: input.path, waitForDiagnostics: input.waitForDiagnostics }),
      signal: _signal,
    });

    if (!res.ok) throw new Error(`LSP touch request failed: ${res.status}`);
    return { ok: true };
  },
};

export const LSP_TOOLS = [lspDiagnosticsTool, lspTouchTool] as const;

export const gotoDefinitionInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
});

export const gotoImplementationInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
});

export const findReferencesInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
  includeDeclaration: z.boolean().optional().default(true),
});

export const symbolsInputSchema = z.object({
  filePath: z.string().min(1),
  scope: z.enum(['document', 'workspace']).optional().default('document'),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});

export const prepareRenameInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
});

export const renameInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
  newName: z.string().min(1),
});

export const hoverInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
});

export const callHierarchyInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
  direction: z.enum(['incoming', 'outgoing', 'both']).optional().default('both'),
});

export interface LspToolMetadata {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
}

export const lspGotoDefinitionMeta: LspToolMetadata = {
  name: 'lsp_goto_definition',
  description: '跳转到符号定义处。用于查找某个东西**在哪里被定义**。',
  inputSchema: gotoDefinitionInputSchema,
};

export const lspGotoImplementationMeta: LspToolMetadata = {
  name: 'lsp_goto_implementation',
  description: '跳转到符号实现处。用于查找某个接口或抽象方法**被具体实现在哪里**。',
  inputSchema: gotoImplementationInputSchema,
};

export const lspFindReferencesMeta: LspToolMetadata = {
  name: 'lsp_find_references',
  description: '查找符号在整个工作区中的**所有**使用/引用点。',
  inputSchema: findReferencesInputSchema,
};

export const lspSymbolsMeta: LspToolMetadata = {
  name: 'lsp_symbols',
  description:
    "获取文件符号列表（document）或在工作区范围内搜索。scope='document' 返回文件大纲，scope='workspace' 返回项目级符号搜索结果。",
  inputSchema: symbolsInputSchema,
};

export const lspPrepareRenameMeta: LspToolMetadata = {
  name: 'lsp_prepare_rename',
  description: '检查重命名是否可行。**调用 lsp_rename 之前**使用。',
  inputSchema: prepareRenameInputSchema,
};

export const lspRenameMeta: LspToolMetadata = {
  name: 'lsp_rename',
  description:
    '在整个工作区重命名符号。**会将改动应用到所有文件**。请先调 lsp_prepare_rename 验证。',
  inputSchema: renameInputSchema,
};

export const lspHoverMeta: LspToolMetadata = {
  name: 'lsp_hover',
  description: '获取指定位置上符号的 hover 信息（类型签名、文档），返回人可读文本。',
  inputSchema: hoverInputSchema,
};

export const lspCallHierarchyMeta: LspToolMetadata = {
  name: 'lsp_call_hierarchy',
  description: '获取符号的调用层次：谁调用了它（incoming）以及它调用了谁（outgoing）。仅返回一跳。',
  inputSchema: callHierarchyInputSchema,
};

/** All 8 richer LSP tool metadata (execution provided by gateway). */
export const LSP_RICHER_TOOL_METADATA: readonly LspToolMetadata[] = [
  lspGotoDefinitionMeta,
  lspGotoImplementationMeta,
  lspFindReferencesMeta,
  lspSymbolsMeta,
  lspPrepareRenameMeta,
  lspRenameMeta,
  lspHoverMeta,
  lspCallHierarchyMeta,
] as const;

/** Canonical list of all 10 LSP tool names (2 core + 8 richer). */
export const ALL_LSP_TOOL_NAMES = [
  'lsp_diagnostics',
  'lsp_touch',
  'lsp_goto_definition',
  'lsp_goto_implementation',
  'lsp_find_references',
  'lsp_symbols',
  'lsp_prepare_rename',
  'lsp_rename',
  'lsp_hover',
  'lsp_call_hierarchy',
] as const;
