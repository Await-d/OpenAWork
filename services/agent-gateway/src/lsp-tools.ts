import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from '@openAwork/agent-core';
import {
  gotoDefinitionInputSchema,
  gotoImplementationInputSchema,
  findReferencesInputSchema,
  symbolsInputSchema,
  prepareRenameInputSchema,
  renameInputSchema,
  hoverInputSchema,
  callHierarchyInputSchema,
} from '@openAwork/agent-core';
import { z } from 'zod';
import { lspManager } from './lsp/router.js';

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Location = { uri: string; range: Range };
type LocationLink = {
  targetUri: string;
  targetRange: Range;
  targetSelectionRange?: Range;
  originSelectionRange?: Range;
};
type SymbolInfo = {
  name: string;
  kind: number;
  location: Location;
  containerName?: string;
};
type DocumentSymbol = {
  name: string;
  kind: number;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
};
type TextEdit = { range: Range; newText: string };
type WorkspaceEdit = {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: Array<
    | { kind: 'create'; uri: string }
    | { kind: 'rename'; oldUri: string; newUri: string }
    | { kind: 'delete'; uri: string }
    | { textDocument: { uri: string }; edits: TextEdit[] }
  >;
};

export const postWriteDiagnosticSchema = z.object({
  file: z.string(),
  severity: z.string(),
  line: z.number(),
  message: z.string(),
});

const renameOutputSchema = z.object({
  result: z.string(),
  diagnostics: z.array(postWriteDiagnosticSchema).optional(),
});

function uriToPath(uri: string): string {
  return fileURLToPath(uri);
}

/**
 * Pre-touch: sync file with LSP server before semantic queries.
 * Mirrors opencode's tool/lsp.ts: `await LSP.touchFile(file, true)` before any query.
 * Failures are silently ignored — LSP is best-effort, not blocking.
 */
async function preTouchForQuery(filePath: string): Promise<void> {
  try {
    await lspManager.touchFile(filePath, true);
  } catch {
    // LSP pre-touch is best-effort; do not block the query
  }
}

/** Simplified diagnostic entry for tool output. */
export interface PostWriteDiagnostic {
  file: string;
  severity: string;
  line: number;
  message: string;
}

const MAX_POST_WRITE_DIAGNOSTICS = 20;

/**
 * Retrieve diagnostics for recently-written files from the LSP server.
 * Best-effort: returns empty array on any error — never blocks the write operation.
 */
export async function getPostWriteDiagnostics(filePaths: string[]): Promise<PostWriteDiagnostic[]> {
  try {
    const allDiagnostics = await lspManager.diagnostics();
    const pathSet = new Set(filePaths);
    const result: PostWriteDiagnostic[] = [];

    for (const [file, summaries] of Object.entries(allDiagnostics)) {
      if (!pathSet.has(file)) continue;
      for (const diag of summaries) {
        result.push({
          file,
          severity: diag.severity,
          line: diag.line,
          message: diag.message,
        });
        if (result.length >= MAX_POST_WRITE_DIAGNOSTICS) {
          return result;
        }
      }
    }

    return result;
  } catch {
    // Diagnostics retrieval is best-effort; never block the caller
    return [];
  }
}

/**
 * Post-write touch + diagnostics: sync LSP state after file modifications.
 * Mirrors opencode's tool/write.ts: `touchFile(true)` + `diagnostics()` after writes.
 * Failures are silently ignored — do not roll back successful file modifications.
 */
async function postWriteTouch(filePaths: string[]): Promise<PostWriteDiagnostic[]> {
  try {
    for (const filePath of filePaths) {
      await lspManager.touchFile(filePath, true);
    }
  } catch {
    // Post-write LSP sync is best-effort; do not fail the rename operation
  }
  return getPostWriteDiagnostics(filePaths);
}

function collectWorkspaceEditFiles(edit: WorkspaceEdit | null): string[] {
  if (!edit) return [];
  const files: string[] = [];
  if (edit.changes) {
    for (const uri of Object.keys(edit.changes)) {
      files.push(uriToPath(uri));
    }
  }
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ('kind' in change) {
        if (change.kind === 'rename') {
          files.push(uriToPath(change.newUri));
        } else if (change.kind === 'create') {
          files.push(uriToPath(change.uri));
        }
      } else {
        files.push(uriToPath(change.textDocument.uri));
      }
    }
  }
  return files;
}

function formatLocation(location: Location | LocationLink): string {
  if ('targetUri' in location) {
    const filePath = uriToPath(location.targetUri);
    return `${filePath}:${location.targetRange.start.line + 1}:${location.targetRange.start.character}`;
  }
  const filePath = uriToPath(location.uri);
  return `${filePath}:${location.range.start.line + 1}:${location.range.start.character}`;
}

function formatDocumentSymbol(symbol: DocumentSymbol, indent = 0): string {
  const prefix = '  '.repeat(indent);
  const head = `${prefix}${symbol.name} (kind ${symbol.kind}) - line ${symbol.range.start.line + 1}`;
  const children = symbol.children?.map((child) => formatDocumentSymbol(child, indent + 1)) ?? [];
  return [head, ...children].join('\n');
}

function formatSymbolInfo(symbol: SymbolInfo): string {
  return `${symbol.name} (kind ${symbol.kind})${symbol.containerName ? ` in ${symbol.containerName}` : ''} - ${formatLocation(symbol.location)}`;
}

function formatPrepareRenameResult(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return 'Cannot rename at this position';
  }
  const record = result as Record<string, unknown>;
  if (record['defaultBehavior'] === true) {
    return 'Rename supported (using default behavior)';
  }
  const range = ('range' in record ? record['range'] : record) as Range | undefined;
  if (range?.start && range.end) {
    return `Rename available at ${range.start.line + 1}:${range.start.character}-${range.end.line + 1}:${range.end.character}`;
  }
  return 'Cannot rename at this position';
}

async function applyTextEdits(filePath: string, edits: TextEdit[]): Promise<number> {
  const content = await fsp.readFile(filePath, 'utf8');
  const lines = content.split('\n');
  const sortedEdits = [...edits].sort((left, right) => {
    if (right.range.start.line !== left.range.start.line) {
      return right.range.start.line - left.range.start.line;
    }
    return right.range.start.character - left.range.start.character;
  });
  for (const edit of sortedEdits) {
    const startLine = edit.range.start.line;
    const startChar = edit.range.start.character;
    const endLine = edit.range.end.line;
    const endChar = edit.range.end.character;
    if (startLine === endLine) {
      const line = lines[startLine] ?? '';
      lines[startLine] = line.slice(0, startChar) + edit.newText + line.slice(endChar);
      continue;
    }
    const firstLine = lines[startLine] ?? '';
    const lastLine = lines[endLine] ?? '';
    const next = firstLine.slice(0, startChar) + edit.newText + lastLine.slice(endChar);
    lines.splice(startLine, endLine - startLine + 1, ...next.split('\n'));
  }
  await fsp.writeFile(filePath, lines.join('\n'), 'utf8');
  return edits.length;
}

async function applyWorkspaceEdit(edit: WorkspaceEdit | null): Promise<string> {
  if (!edit) {
    return 'No changes';
  }
  const filesModified: string[] = [];
  let totalEdits = 0;
  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const filePath = uriToPath(uri);
      totalEdits += await applyTextEdits(filePath, edits);
      filesModified.push(filePath);
    }
  }
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ('kind' in change) {
        if (change.kind === 'create') {
          const filePath = uriToPath(change.uri);
          await fsp.mkdir(dirname(filePath), { recursive: true });
          await fsp.writeFile(filePath, '', 'utf8');
          filesModified.push(filePath);
        } else if (change.kind === 'rename') {
          const oldPath = uriToPath(change.oldUri);
          const newPath = uriToPath(change.newUri);
          await fsp.mkdir(dirname(newPath), { recursive: true });
          await fsp.rename(oldPath, newPath);
          filesModified.push(newPath);
        } else if (change.kind === 'delete') {
          const filePath = uriToPath(change.uri);
          await fsp.rm(filePath, { force: true });
          filesModified.push(filePath);
        }
        continue;
      }
      const filePath = uriToPath(change.textDocument.uri);
      totalEdits += await applyTextEdits(filePath, change.edits);
      filesModified.push(filePath);
    }
  }
  if (filesModified.length === 0) {
    return 'No changes';
  }
  return `Applied ${totalEdits} edit(s) to ${filesModified.length} file(s):\n${filesModified.map((file) => `- ${file}`).join('\n')}`;
}

export const lspGotoDefinitionToolDefinition: ToolDefinition<
  typeof gotoDefinitionInputSchema,
  z.ZodString
> = {
  name: 'lsp_goto_definition',
  description: 'Jump to symbol definition. Find WHERE something is defined.',
  inputSchema: gotoDefinitionInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async (input) => {
    await preTouchForQuery(input.filePath);
    const result = await lspManager.definition({
      file: input.filePath,
      line: input.line - 1,
      character: input.character,
    });
    return result.length > 0
      ? result.map((item) => formatLocation(item as Location | LocationLink)).join('\n')
      : 'No definition found';
  },
};

export const lspGotoImplementationToolDefinition: ToolDefinition<
  typeof gotoImplementationInputSchema,
  z.ZodString
> = {
  name: 'lsp_goto_implementation',
  description:
    'Jump to symbol implementation. Find WHERE an interface or abstract method is concretely implemented.',
  inputSchema: gotoImplementationInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async (input) => {
    await preTouchForQuery(input.filePath);
    const result = await lspManager.implementation({
      file: input.filePath,
      line: input.line - 1,
      character: input.character,
    });
    return result.length > 0
      ? result.map((item) => formatLocation(item as Location | LocationLink)).join('\n')
      : 'No implementation found';
  },
};

export const lspFindReferencesToolDefinition: ToolDefinition<
  typeof findReferencesInputSchema,
  z.ZodString
> = {
  name: 'lsp_find_references',
  description: 'Find ALL usages/references of a symbol across the entire workspace.',
  inputSchema: findReferencesInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async (input) => {
    await preTouchForQuery(input.filePath);
    const result = await lspManager.references({
      file: input.filePath,
      line: input.line - 1,
      character: input.character,
      includeDeclaration: input.includeDeclaration,
    });
    return result.length > 0
      ? result.map((item) => formatLocation(item as Location)).join('\n')
      : 'No references found';
  },
};

export const lspSymbolsToolDefinition: ToolDefinition<typeof symbolsInputSchema, z.ZodString> = {
  name: 'lsp_symbols',
  description:
    "Get symbols from file (document) or search across workspace. Use scope='document' for file outline, scope='workspace' for project-wide symbol search.",
  inputSchema: symbolsInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async (input) => {
    await preTouchForQuery(input.filePath);
    if (input.scope === 'workspace') {
      if (!input.query) {
        throw new Error("'query' is required for workspace scope");
      }
      const result = (await lspManager.workspaceSymbols({
        file: input.filePath,
        query: input.query,
      })) as SymbolInfo[];
      const limited = result.slice(0, input.limit);
      return limited.length > 0 ? limited.map(formatSymbolInfo).join('\n') : 'No symbols found';
    }
    const result = (await lspManager.documentSymbols({ file: input.filePath })) as Array<
      DocumentSymbol | SymbolInfo
    >;
    const limited = result.slice(0, input.limit);
    const first = limited[0];
    if (!first) {
      return 'No symbols found';
    }
    return 'range' in first
      ? (limited as DocumentSymbol[]).map((symbol) => formatDocumentSymbol(symbol)).join('\n')
      : (limited as SymbolInfo[]).map(formatSymbolInfo).join('\n');
  },
};

export const lspPrepareRenameToolDefinition: ToolDefinition<
  typeof prepareRenameInputSchema,
  z.ZodString
> = {
  name: 'lsp_prepare_rename',
  description: 'Check if rename is valid. Use BEFORE lsp_rename.',
  inputSchema: prepareRenameInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async (input) => {
    await preTouchForQuery(input.filePath);
    return formatPrepareRenameResult(
      await lspManager.prepareRename({
        file: input.filePath,
        line: input.line - 1,
        character: input.character,
      }),
    );
  },
};

export const lspRenameToolDefinition: ToolDefinition<
  typeof renameInputSchema,
  typeof renameOutputSchema
> = {
  name: 'lsp_rename',
  description:
    'Rename symbol across entire workspace. APPLIES changes to all files. Use lsp_prepare_rename first to verify.',
  inputSchema: renameInputSchema,
  outputSchema: renameOutputSchema,
  timeout: 30000,
  execute: async (input) => {
    await preTouchForQuery(input.filePath);
    const workspaceEdit = (await lspManager.rename({
      file: input.filePath,
      line: input.line - 1,
      character: input.character,
      newName: input.newName,
    })) as WorkspaceEdit | null;
    const modifiedFiles = collectWorkspaceEditFiles(workspaceEdit);
    const result = await applyWorkspaceEdit(workspaceEdit);
    const diagnostics = await postWriteTouch(modifiedFiles);
    return {
      result,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    };
  },
};

type MarkedString = string | { language: string; value: string };
type MarkupContent = { kind: string; value: string };
type HoverResult = {
  contents: MarkupContent | MarkedString | MarkedString[];
  range?: Range;
} | null;

function formatHoverResult(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return 'No hover information available';
  }

  const hover = result as HoverResult;
  if (!hover) {
    return 'No hover information available';
  }

  const contents = hover.contents;

  if (typeof contents === 'string') {
    return contents || 'No hover information available';
  }

  if (typeof contents === 'object' && 'value' in contents) {
    return (contents as MarkupContent).value || 'No hover information available';
  }

  if (Array.isArray(contents)) {
    const parts = contents
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && 'value' in item) return item.value;
        return '';
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join('\n\n') : 'No hover information available';
  }

  return 'No hover information available';
}

export const lspHoverToolDefinition: ToolDefinition<typeof hoverInputSchema, z.ZodString> = {
  name: 'lsp_hover',
  description:
    'Get hover information (type signature, documentation) for a symbol at a given position. Returns human-readable text.',
  inputSchema: hoverInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async (input) => {
    await preTouchForQuery(input.filePath);
    const result = await lspManager.hover({
      file: input.filePath,
      line: input.line - 1,
      character: input.character,
    });
    return formatHoverResult(result);
  },
};

type CallHierarchyItem = {
  name: string;
  kind: number;
  uri: string;
  range: Range;
  selectionRange: Range;
  detail?: string;
  tags?: number[];
  data?: unknown;
};

type IncomingCallHierarchyCall = {
  from: CallHierarchyItem;
  fromRanges: Range[];
};

type OutgoingCallHierarchyCall = {
  to: CallHierarchyItem;
  fromRanges: Range[];
};

function formatCallHierarchyItem(item: CallHierarchyItem): string {
  const filePath = uriToPath(item.uri);
  const line = item.selectionRange.start.line + 1;
  const col = item.selectionRange.start.character;
  const detail = item.detail ? ` (${item.detail})` : '';
  return `${item.name}${detail} - ${filePath}:${line}:${col}`;
}

export const lspCallHierarchyToolDefinition: ToolDefinition<
  typeof callHierarchyInputSchema,
  z.ZodString
> = {
  name: 'lsp_call_hierarchy',
  description:
    'Get call hierarchy for a symbol: who calls it (incoming) and what it calls (outgoing). Single-hop only.',
  inputSchema: callHierarchyInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async (input) => {
    await preTouchForQuery(input.filePath);

    const items = (await lspManager.prepareCallHierarchy({
      file: input.filePath,
      line: input.line - 1,
      character: input.character,
    })) as CallHierarchyItem[];

    if (items.length === 0) {
      return 'No call hierarchy found';
    }

    const item = items[0]!;
    const sections: string[] = [`Symbol: ${formatCallHierarchyItem(item)}`];

    const wantIncoming = input.direction === 'incoming' || input.direction === 'both';
    const wantOutgoing = input.direction === 'outgoing' || input.direction === 'both';

    if (wantIncoming) {
      const incoming = (await lspManager.incomingCalls({
        file: input.filePath,
        item,
      })) as IncomingCallHierarchyCall[];
      if (incoming.length > 0) {
        sections.push(
          '\nIncoming calls:',
          ...incoming.map((call) => `  ${formatCallHierarchyItem(call.from)}`),
        );
      } else {
        sections.push('\nNo incoming calls found');
      }
    }

    if (wantOutgoing) {
      const outgoing = (await lspManager.outgoingCalls({
        file: input.filePath,
        item,
      })) as OutgoingCallHierarchyCall[];
      if (outgoing.length > 0) {
        sections.push(
          '\nOutgoing calls:',
          ...outgoing.map((call) => `  ${formatCallHierarchyItem(call.to)}`),
        );
      } else {
        sections.push('\nNo outgoing calls found');
      }
    }

    return sections.join('\n');
  },
};
