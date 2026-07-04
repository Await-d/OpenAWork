import { z } from 'zod';

export const codegraphEdgeKindSchema = z.enum(['contains', 'imports', 'calls', 'references']);
export const codegraphFileStatusSchema = z.enum(['indexed', 'metadata-only', 'skipped', 'error']);
export const codegraphRunStatusSchema = z.enum(['indexed', 'degraded', 'failed']);
export const codegraphFreshnessStatusSchema = z.enum(['fresh', 'stale', 'not_indexed', 'degraded']);
export const codegraphStartupStatusSchema = z.enum(['healthy', 'degraded']);

export type CodegraphEdgeKind = z.infer<typeof codegraphEdgeKindSchema>;
export type CodegraphFileStatus = z.infer<typeof codegraphFileStatusSchema>;
export type CodegraphRunStatus = z.infer<typeof codegraphRunStatusSchema>;
export type CodegraphFreshnessStatus = z.infer<typeof codegraphFreshnessStatusSchema>;
export type CodegraphStartupStatusValue = z.infer<typeof codegraphStartupStatusSchema>;

export type CodegraphWorkspaceRoot = {
  readonly id: number;
  readonly rootPath: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type CodegraphFileRecord = {
  readonly id: number;
  readonly workspaceId: number;
  readonly path: string;
  readonly relativePath: string;
  readonly language: string;
  readonly hash: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly status: CodegraphFileStatus;
  readonly degradedReason?: string;
  readonly indexedAtMs: number;
};

export type CodegraphSymbolRecord = {
  readonly id: number;
  readonly workspaceId: number;
  readonly fileId: number;
  readonly parentSymbolId?: number;
  readonly name: string;
  readonly kind: string;
  readonly detail?: string;
  readonly startLine: number;
  readonly startCharacter: number;
  readonly endLine: number;
  readonly endCharacter: number;
  readonly selectionStartLine: number;
  readonly selectionStartCharacter: number;
  readonly selectionEndLine: number;
  readonly selectionEndCharacter: number;
  readonly createdAtMs: number;
};

export type CodegraphEdgeRecord = {
  readonly id: number;
  readonly workspaceId: number;
  readonly fromSymbolId?: number;
  readonly toSymbolId?: number;
  readonly fromFileId?: number;
  readonly toFileId?: number;
  readonly kind: CodegraphEdgeKind;
  readonly label?: string;
  readonly createdAtMs: number;
};

export type CodegraphImportEdgeRecord = CodegraphEdgeRecord & {
  readonly fromRelativePath: string;
  readonly toRelativePath?: string;
};

export type CodegraphIndexRunRecord = {
  readonly id: number;
  readonly workspaceId: number;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly status: CodegraphRunStatus;
  readonly filesScanned: number;
  readonly filesIndexed: number;
  readonly symbolsIndexed: number;
  readonly degradedReason?: string;
};

export type CodegraphStartupStatusRecord = {
  readonly checkedAtMs: number;
  readonly status: CodegraphStartupStatusValue;
  readonly schemaVersion: number;
  readonly missingServers: readonly string[];
  readonly installResults: Readonly<Record<string, boolean>>;
  readonly degradedReason?: string;
};

export type CodegraphFreshness = {
  readonly workspaceRoot: string;
  readonly indexedAt?: number;
  readonly status: CodegraphFreshnessStatus;
  readonly staleFiles: readonly string[];
  readonly degradedReason?: string;
};

export type CodegraphPosition = {
  readonly line: number;
  readonly character: number;
};

export type CodegraphRange = {
  readonly start: CodegraphPosition;
  readonly end: CodegraphPosition;
};

export type LspDocumentSymbol = {
  readonly name: string;
  readonly kind: number;
  readonly detail?: string;
  readonly range: CodegraphRange;
  readonly selectionRange: CodegraphRange;
  readonly children?: readonly LspDocumentSymbol[];
};

export interface CodegraphLspManager {
  documentSymbols(input: { readonly file: string }): Promise<readonly LspDocumentSymbol[]>;
}

export type CodegraphMissingServer = {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly binary: string | readonly string[];
  readonly installCommand?: string;
  readonly installed: boolean;
};

export interface CodegraphInstallManager {
  missingServers(): readonly CodegraphMissingServer[];
  ensureAllInstalled(): Promise<Record<string, boolean>>;
}

export type CodegraphIndexResult = {
  readonly workspaceRoot: string;
  readonly status: CodegraphRunStatus;
  readonly filesScanned: number;
  readonly filesIndexed: number;
  readonly symbolsIndexed: number;
  readonly degradedReason?: string;
};
