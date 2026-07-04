import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import type {
  CodegraphIndexResult,
  CodegraphLspManager,
  CodegraphRunStatus,
  LspDocumentSymbol,
} from './contracts.js';
import { hashCodegraphContent, type CodegraphStore } from './store.js';

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const INDEXABLE_EXTENSIONS = new Set(['.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  '.git',
  '.codegraph',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

const SYMBOL_KIND_LABELS: Readonly<Record<number, string>> = {
  1: 'file',
  2: 'module',
  3: 'namespace',
  4: 'package',
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'constructor',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'constant',
  15: 'string',
  16: 'number',
  17: 'boolean',
  18: 'array',
  19: 'object',
  20: 'key',
  21: 'null',
  22: 'enumMember',
  23: 'struct',
  24: 'event',
  25: 'operator',
  26: 'typeParameter',
};

export type CodegraphIndexerLimits = {
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
};

export type CodegraphIndexerInput = {
  readonly store: CodegraphStore;
  readonly lspManager: CodegraphLspManager;
  readonly limits?: CodegraphIndexerLimits;
};

type IndexedFile = {
  readonly id: number;
  readonly path: string;
  readonly relativePath: string;
};

export class CodegraphIndexer {
  private readonly store: CodegraphStore;
  private readonly lspManager: CodegraphLspManager;
  private readonly maxFiles: number;
  private readonly maxFileBytes: number;

  constructor(input: CodegraphIndexerInput) {
    this.store = input.store;
    this.lspManager = input.lspManager;
    this.maxFiles = input.limits?.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxFileBytes = input.limits?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  async indexWorkspace(input: { readonly workspaceRoot: string }): Promise<CodegraphIndexResult> {
    const workspaceRoot = resolve(input.workspaceRoot);
    const startedAtMs = Date.now();
    this.store.upsertWorkspaceRoot(workspaceRoot);
    const discovered = await this.discoverFiles(workspaceRoot);
    const filesByRelativePath = new Map<string, IndexedFile>();
    let filesIndexed = 0;
    let symbolsIndexed = 0;
    const degradedReasons: string[] = [];

    for (const filePath of discovered) {
      const relativePath = relative(workspaceRoot, filePath).replace(/\\/g, '/');
      const fileStat = await stat(filePath);
      const content =
        fileStat.size <= this.maxFileBytes ? await readFile(filePath, 'utf8') : undefined;
      const baseFileInput = {
        workspaceRoot,
        path: filePath,
        relativePath,
        language: languageForPath(filePath),
        hash: content ? hashCodegraphContent(content) : '',
        sizeBytes: fileStat.size,
        mtimeMs: Math.floor(fileStat.mtimeMs),
      };

      if (!content) {
        const file = this.store.upsertFile({
          ...baseFileInput,
          status: 'metadata-only',
          degradedReason: `file exceeds codegraph byte limit (${this.maxFileBytes})`,
        });
        this.store.clearFileGraph(file.id);
        filesByRelativePath.set(relativePath, file);
        degradedReasons.push(`${relativePath}: file exceeds codegraph byte limit`);
        continue;
      }

      try {
        const symbols = await this.lspManager.documentSymbols({ file: filePath });
        const file = this.store.upsertFile({ ...baseFileInput, status: 'indexed' });
        this.store.clearFileGraph(file.id);
        filesByRelativePath.set(relativePath, file);
        symbolsIndexed += this.insertSymbols(workspaceRoot, file.id, symbols, undefined);
        filesIndexed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const file = this.store.upsertFile({
          ...baseFileInput,
          status: 'metadata-only',
          degradedReason: message,
        });
        this.store.clearFileGraph(file.id);
        filesByRelativePath.set(relativePath, file);
        degradedReasons.push(`${relativePath}: ${message}`);
      }
    }

    for (const filePath of discovered) {
      const relativePath = relative(workspaceRoot, filePath).replace(/\\/g, '/');
      const indexedFile = filesByRelativePath.get(relativePath);
      if (!indexedFile || !INDEXABLE_EXTENSIONS.has(extname(filePath))) {
        continue;
      }
      const content = await readFile(filePath, 'utf8');
      for (const specifier of extractImportSpecifiers(content)) {
        const targetRelativePath = resolveImportRelativePath(relativePath, specifier);
        const target = targetRelativePath ? filesByRelativePath.get(targetRelativePath) : undefined;
        this.store.recordFileEdge({
          workspaceRoot,
          fromFileId: indexedFile.id,
          toFileId: target?.id,
          kind: 'imports',
          label: specifier,
        });
      }
    }

    this.store.clearStaleMarkersForFiles(workspaceRoot, discovered);
    const status: CodegraphRunStatus = degradedReasons.length > 0 ? 'degraded' : 'indexed';
    const degradedReason =
      degradedReasons.length > 0 ? degradedReasons.slice(0, 20).join('; ') : undefined;
    this.store.finishIndexRun({
      workspaceRoot,
      startedAtMs,
      status,
      filesScanned: discovered.length,
      filesIndexed,
      symbolsIndexed,
      degradedReason,
    });

    return {
      workspaceRoot,
      status,
      filesScanned: discovered.length,
      filesIndexed,
      symbolsIndexed,
      degradedReason,
    };
  }

  private async discoverFiles(workspaceRoot: string): Promise<readonly string[]> {
    const files: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      if (files.length >= this.maxFiles) {
        return;
      }
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= this.maxFiles) {
          return;
        }
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            await visit(fullPath);
          }
          continue;
        }
        if (entry.isFile() && INDEXABLE_EXTENSIONS.has(extname(entry.name))) {
          files.push(resolve(fullPath));
        }
      }
    };
    await visit(workspaceRoot);
    return files.sort();
  }

  private insertSymbols(
    workspaceRoot: string,
    fileId: number,
    symbols: readonly LspDocumentSymbol[],
    parentSymbolId: number | undefined,
  ): number {
    let count = 0;
    for (const symbol of symbols) {
      const inserted = this.store.insertSymbol({
        workspaceRoot,
        fileId,
        parentSymbolId,
        name: symbol.name,
        kind: SYMBOL_KIND_LABELS[symbol.kind] ?? `kind-${symbol.kind}`,
        detail: symbol.detail,
        startLine: symbol.range.start.line + 1,
        startCharacter: symbol.range.start.character,
        endLine: symbol.range.end.line + 1,
        endCharacter: symbol.range.end.character,
        selectionStartLine: symbol.selectionRange.start.line + 1,
        selectionStartCharacter: symbol.selectionRange.start.character,
        selectionEndLine: symbol.selectionRange.end.line + 1,
        selectionEndCharacter: symbol.selectionRange.end.character,
      });
      count += 1;
      if (parentSymbolId !== undefined) {
        this.store.recordSymbolEdge({
          workspaceRoot,
          fromSymbolId: parentSymbolId,
          toSymbolId: inserted.id,
          kind: 'contains',
        });
      }
      count += this.insertSymbols(workspaceRoot, fileId, symbol.children ?? [], inserted.id);
    }
    return count;
  }
}

function languageForPath(filePath: string): string {
  const extension = extname(filePath);
  if (extension === '.tsx') {
    return 'typescriptreact';
  }
  if (extension === '.ts') {
    return 'typescript';
  }
  return 'unknown';
}

function extractImportSpecifiers(content: string): readonly string[] {
  const specifiers: string[] = [];
  const importPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"](?<specifier>[^'"]+)['"]/g;
  for (const match of content.matchAll(importPattern)) {
    const specifier = match.groups?.['specifier'];
    if (specifier?.startsWith('.')) {
      specifiers.push(specifier);
    }
  }
  return specifiers.slice(0, 200);
}

function resolveImportRelativePath(
  fromRelativePath: string,
  specifier: string,
): string | undefined {
  const fromDir = fromRelativePath.split('/').slice(0, -1).join('/');
  const withoutJs = specifier.replace(/\.(js|jsx|mjs|cjs)$/, '');
  const candidates = [`${withoutJs}.ts`, `${withoutJs}.tsx`, `${withoutJs}/index.ts`];
  const normalizedCandidates = candidates.map((candidate) =>
    join(fromDir, candidate).replace(/\\/g, '/').replace(/^\.\//, ''),
  );
  return normalizedCandidates[0];
}
