import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from '@openAwork/agent-core';
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

const gotoDefinitionInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
});

const findReferencesInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
  includeDeclaration: z.boolean().optional().default(true),
});

const symbolsInputSchema = z.object({
  filePath: z.string().min(1),
  scope: z.enum(['document', 'workspace']).optional().default('document'),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});

const prepareRenameInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
});

const renameInputSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().min(1),
  character: z.number().int().min(0),
  newName: z.string().min(1),
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

/**
 * Post-write touch + diagnostics: sync LSP state after file modifications.
 * Mirrors opencode's tool/write.ts: `touchFile(true)` + `diagnostics()` after writes.
 * Failures are silently ignored — do not roll back successful file modifications.
 */
async function postWriteTouch(filePaths: string[]): Promise<void> {
  try {
    for (const filePath of filePaths) {
      await lspManager.touchFile(filePath, true);
    }
  } catch {
    // Post-write LSP sync is best-effort; do not fail the rename operation
  }
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

export const lspRenameToolDefinition: ToolDefinition<typeof renameInputSchema, z.ZodString> = {
  name: 'lsp_rename',
  description:
    'Rename symbol across entire workspace. APPLIES changes to all files. Use lsp_prepare_rename first to verify.',
  inputSchema: renameInputSchema,
  outputSchema: z.string(),
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
    await postWriteTouch(modifiedFiles);
    return result;
  },
};
