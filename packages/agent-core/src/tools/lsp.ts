import { z } from 'zod';
import type { ToolDefinition } from '../tool-contract.js';

export const lspDiagnosticsTool: ToolDefinition<
  z.ZodObject<{ filePath: z.ZodOptional<z.ZodString> }>,
  z.ZodRecord<z.ZodString, z.ZodArray<z.ZodUnknown>>
> = {
  name: 'lsp_diagnostics',
  description:
    'Get LSP diagnostics (errors, warnings) for a file or all open files. Returns a map of filePath → diagnostic array.',
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
  description:
    'Notify the LSP server that a file has been modified. Optionally waits for diagnostics to update before returning.',
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
  description: 'Jump to symbol definition. Find WHERE something is defined.',
  inputSchema: gotoDefinitionInputSchema,
};

export const lspGotoImplementationMeta: LspToolMetadata = {
  name: 'lsp_goto_implementation',
  description:
    'Jump to symbol implementation. Find WHERE an interface or abstract method is concretely implemented.',
  inputSchema: gotoImplementationInputSchema,
};

export const lspFindReferencesMeta: LspToolMetadata = {
  name: 'lsp_find_references',
  description: 'Find ALL usages/references of a symbol across the entire workspace.',
  inputSchema: findReferencesInputSchema,
};

export const lspSymbolsMeta: LspToolMetadata = {
  name: 'lsp_symbols',
  description:
    "Get symbols from file (document) or search across workspace. Use scope='document' for file outline, scope='workspace' for project-wide symbol search.",
  inputSchema: symbolsInputSchema,
};

export const lspPrepareRenameMeta: LspToolMetadata = {
  name: 'lsp_prepare_rename',
  description: 'Check if rename is valid. Use BEFORE lsp_rename.',
  inputSchema: prepareRenameInputSchema,
};

export const lspRenameMeta: LspToolMetadata = {
  name: 'lsp_rename',
  description:
    'Rename symbol across entire workspace. APPLIES changes to all files. Use lsp_prepare_rename first to verify.',
  inputSchema: renameInputSchema,
};

export const lspHoverMeta: LspToolMetadata = {
  name: 'lsp_hover',
  description:
    'Get hover information (type signature, documentation) for a symbol at a given position. Returns human-readable text.',
  inputSchema: hoverInputSchema,
};

export const lspCallHierarchyMeta: LspToolMetadata = {
  name: 'lsp_call_hierarchy',
  description:
    'Get call hierarchy for a symbol: who calls it (incoming) and what it calls (outgoing). Single-hop only.',
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
