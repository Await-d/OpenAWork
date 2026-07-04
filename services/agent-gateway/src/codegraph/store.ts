import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  codegraphEdgeKindSchema,
  codegraphFileStatusSchema,
  codegraphFreshnessStatusSchema,
  codegraphRunStatusSchema,
  codegraphStartupStatusSchema,
  type CodegraphEdgeKind,
  type CodegraphEdgeRecord,
  type CodegraphFileRecord,
  type CodegraphFreshness,
  type CodegraphImportEdgeRecord,
  type CodegraphIndexRunRecord,
  type CodegraphRunStatus,
  type CodegraphStartupStatusRecord,
  type CodegraphStartupStatusValue,
  type CodegraphSymbolRecord,
  type CodegraphWorkspaceRoot,
} from './contracts.js';

const CODEGRAPH_SCHEMA_VERSION = 1;

type SqliteStatement = {
  readonly all: (...params: readonly unknown[]) => unknown[];
  readonly get: (...params: readonly unknown[]) => unknown;
  readonly run: (...params: readonly unknown[]) => unknown;
};

type CodegraphDatabase = {
  readonly close: () => void;
  readonly exec: (sql: string) => unknown;
  readonly prepare: (sql: string) => SqliteStatement;
};

type DatabaseConstructor = new (path: string) => CodegraphDatabase;

type UnknownRecord = Record<string, unknown>;

export type OpenCodegraphStoreInput = {
  readonly databasePath: string;
};

export type UpsertFileInput = {
  readonly workspaceRoot: string;
  readonly path: string;
  readonly relativePath: string;
  readonly language: string;
  readonly hash: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly status: CodegraphFileRecord['status'];
  readonly degradedReason?: string;
  readonly indexedAtMs?: number;
};

export type InsertSymbolInput = {
  readonly workspaceRoot: string;
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
};

export type RecordFileEdgeInput = {
  readonly workspaceRoot: string;
  readonly fromFileId: number;
  readonly toFileId?: number;
  readonly kind: Extract<CodegraphEdgeKind, 'imports'>;
  readonly label: string;
};

export type RecordSymbolEdgeInput = {
  readonly workspaceRoot: string;
  readonly fromSymbolId: number;
  readonly toSymbolId: number;
  readonly kind: Extract<CodegraphEdgeKind, 'calls' | 'references' | 'contains'>;
  readonly label?: string;
};

export type MarkFilesStaleInput = {
  readonly workspaceRoot: string;
  readonly files: readonly string[];
  readonly reason: string;
};

export type FinishIndexRunInput = {
  readonly workspaceRoot: string;
  readonly startedAtMs: number;
  readonly status: CodegraphRunStatus;
  readonly filesScanned: number;
  readonly filesIndexed: number;
  readonly symbolsIndexed: number;
  readonly degradedReason?: string;
};

export type SearchSymbolsInput = {
  readonly workspaceRoot: string;
  readonly query: string;
  readonly maxResults: number;
};

const requireRuntimeModule = createRequire(import.meta.url);

function loadDatabaseConstructor(): DatabaseConstructor {
  const runtime = globalThis as typeof globalThis & { readonly Bun?: unknown };
  const moduleName = runtime.Bun ? 'bun:sqlite' : 'node:sqlite';
  const sqliteModule = requireRuntimeModule(moduleName) as {
    readonly Database?: DatabaseConstructor;
    readonly DatabaseSync?: DatabaseConstructor;
  };
  const Database = sqliteModule.DatabaseSync ?? sqliteModule.Database;
  if (!Database) {
    throw new CodegraphStoreError(`SQLite runtime module ${moduleName} did not expose Database`);
  }
  return Database;
}

const DatabaseSync = loadDatabaseConstructor();

export class CodegraphStoreError extends Error {
  override name = 'CodegraphStoreError';
}

export class CodegraphStore {
  readonly databasePath: string;
  private readonly database: CodegraphDatabase;

  constructor(input: OpenCodegraphStoreInput) {
    this.databasePath = input.databasePath;
    if (input.databasePath !== ':memory:') {
      mkdirSync(dirname(input.databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(input.databasePath);
    this.database.exec('PRAGMA journal_mode=WAL');
    this.database.exec('PRAGMA busy_timeout=5000');
    this.database.exec('PRAGMA foreign_keys=ON');
  }

  initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS codegraph_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS codegraph_workspace_roots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root_path TEXT NOT NULL UNIQUE,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS codegraph_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES codegraph_workspace_roots(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        language TEXT NOT NULL,
        hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        degraded_reason TEXT,
        indexed_at_ms INTEGER NOT NULL,
        UNIQUE(workspace_id, path)
      );

      CREATE TABLE IF NOT EXISTS codegraph_symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES codegraph_workspace_roots(id) ON DELETE CASCADE,
        file_id INTEGER NOT NULL REFERENCES codegraph_files(id) ON DELETE CASCADE,
        parent_symbol_id INTEGER REFERENCES codegraph_symbols(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        detail TEXT,
        start_line INTEGER NOT NULL,
        start_character INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        end_character INTEGER NOT NULL,
        selection_start_line INTEGER NOT NULL,
        selection_start_character INTEGER NOT NULL,
        selection_end_line INTEGER NOT NULL,
        selection_end_character INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS codegraph_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES codegraph_workspace_roots(id) ON DELETE CASCADE,
        from_symbol_id INTEGER REFERENCES codegraph_symbols(id) ON DELETE CASCADE,
        to_symbol_id INTEGER REFERENCES codegraph_symbols(id) ON DELETE CASCADE,
        from_file_id INTEGER REFERENCES codegraph_files(id) ON DELETE CASCADE,
        to_file_id INTEGER REFERENCES codegraph_files(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        label TEXT,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS codegraph_stale_markers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES codegraph_workspace_roots(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        reason TEXT NOT NULL,
        marked_at_ms INTEGER NOT NULL,
        UNIQUE(workspace_id, path)
      );

      CREATE TABLE IF NOT EXISTS codegraph_index_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES codegraph_workspace_roots(id) ON DELETE CASCADE,
        started_at_ms INTEGER NOT NULL,
        finished_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        files_scanned INTEGER NOT NULL,
        files_indexed INTEGER NOT NULL,
        symbols_indexed INTEGER NOT NULL,
        degraded_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS codegraph_startup_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        checked_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        missing_servers_json TEXT NOT NULL,
        install_results_json TEXT NOT NULL,
        degraded_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_codegraph_files_workspace ON codegraph_files(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_codegraph_symbols_lookup ON codegraph_symbols(workspace_id, name);
      CREATE INDEX IF NOT EXISTS idx_codegraph_edges_to_symbol ON codegraph_edges(workspace_id, to_symbol_id);
      CREATE INDEX IF NOT EXISTS idx_codegraph_edges_from_symbol ON codegraph_edges(workspace_id, from_symbol_id);
    `);
    this.setMeta('schema_version', String(CODEGRAPH_SCHEMA_VERSION));
  }

  close(): void {
    this.database.close();
  }

  getSchemaVersion(): number {
    const row = this.getRow('SELECT value FROM codegraph_meta WHERE key = ?', ['schema_version']);
    if (!row || typeof row['value'] !== 'string') {
      return 0;
    }
    const parsed = Number(row['value']);
    return Number.isInteger(parsed) ? parsed : 0;
  }

  listTableNames(): readonly string[] {
    return this.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => parseStringField(asRecord(row), 'name'));
  }

  upsertWorkspaceRoot(workspaceRoot: string): CodegraphWorkspaceRoot {
    const rootPath = resolve(workspaceRoot);
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO codegraph_workspace_roots (root_path, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?)
         ON CONFLICT(root_path) DO UPDATE SET updated_at_ms = excluded.updated_at_ms`,
      )
      .run(rootPath, now, now);
    const row = this.mustGetRow('SELECT * FROM codegraph_workspace_roots WHERE root_path = ?', [
      rootPath,
    ]);
    return parseWorkspaceRoot(row);
  }

  getWorkspaceRoot(workspaceRoot: string): CodegraphWorkspaceRoot | undefined {
    const row = this.getRow('SELECT * FROM codegraph_workspace_roots WHERE root_path = ?', [
      resolve(workspaceRoot),
    ]);
    return row ? parseWorkspaceRoot(row) : undefined;
  }

  upsertFile(input: UpsertFileInput): CodegraphFileRecord {
    const workspace = this.upsertWorkspaceRoot(input.workspaceRoot);
    const indexedAtMs = input.indexedAtMs ?? Date.now();
    this.database
      .prepare(
        `INSERT INTO codegraph_files (
          workspace_id, path, relative_path, language, hash, size_bytes, mtime_ms,
          status, degraded_reason, indexed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, path) DO UPDATE SET
          relative_path = excluded.relative_path,
          language = excluded.language,
          hash = excluded.hash,
          size_bytes = excluded.size_bytes,
          mtime_ms = excluded.mtime_ms,
          status = excluded.status,
          degraded_reason = excluded.degraded_reason,
          indexed_at_ms = excluded.indexed_at_ms`,
      )
      .run(
        workspace.id,
        resolve(input.path),
        input.relativePath,
        input.language,
        input.hash,
        input.sizeBytes,
        input.mtimeMs,
        input.status,
        input.degradedReason ?? null,
        indexedAtMs,
      );
    const row = this.mustGetRow(
      'SELECT * FROM codegraph_files WHERE workspace_id = ? AND path = ?',
      [workspace.id, resolve(input.path)],
    );
    return parseFileRecord(row);
  }

  clearFileGraph(fileId: number): void {
    this.database
      .prepare(
        `DELETE FROM codegraph_edges
         WHERE from_file_id = ?
            OR to_file_id = ?
            OR from_symbol_id IN (SELECT id FROM codegraph_symbols WHERE file_id = ?)
            OR to_symbol_id IN (SELECT id FROM codegraph_symbols WHERE file_id = ?)`,
      )
      .run(fileId, fileId, fileId, fileId);
    this.database.prepare('DELETE FROM codegraph_symbols WHERE file_id = ?').run(fileId);
  }

  insertSymbol(input: InsertSymbolInput): CodegraphSymbolRecord {
    const workspace = this.upsertWorkspaceRoot(input.workspaceRoot);
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO codegraph_symbols (
          workspace_id, file_id, parent_symbol_id, name, kind, detail,
          start_line, start_character, end_line, end_character,
          selection_start_line, selection_start_character, selection_end_line,
          selection_end_character, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspace.id,
        input.fileId,
        input.parentSymbolId ?? null,
        input.name,
        input.kind,
        input.detail ?? null,
        input.startLine,
        input.startCharacter,
        input.endLine,
        input.endCharacter,
        input.selectionStartLine,
        input.selectionStartCharacter,
        input.selectionEndLine,
        input.selectionEndCharacter,
        now,
      );
    const row = this.mustGetRow('SELECT * FROM codegraph_symbols WHERE id = last_insert_rowid()');
    return parseSymbolRecord(row);
  }

  recordFileEdge(input: RecordFileEdgeInput): CodegraphEdgeRecord {
    const workspace = this.upsertWorkspaceRoot(input.workspaceRoot);
    return this.insertEdge({
      workspaceId: workspace.id,
      fromFileId: input.fromFileId,
      toFileId: input.toFileId,
      kind: input.kind,
      label: input.label,
    });
  }

  recordSymbolEdge(input: RecordSymbolEdgeInput): CodegraphEdgeRecord {
    const workspace = this.upsertWorkspaceRoot(input.workspaceRoot);
    return this.insertEdge({
      workspaceId: workspace.id,
      fromSymbolId: input.fromSymbolId,
      toSymbolId: input.toSymbolId,
      kind: input.kind,
      label: input.label,
    });
  }

  listFiles(workspaceRoot: string): readonly CodegraphFileRecord[] {
    const workspace = this.getWorkspaceRoot(workspaceRoot);
    if (!workspace) {
      return [];
    }
    return this.database
      .prepare('SELECT * FROM codegraph_files WHERE workspace_id = ? ORDER BY relative_path')
      .all(workspace.id)
      .map((row) => parseFileRecord(asRecord(row)));
  }

  listImportEdges(workspaceRoot: string): readonly CodegraphImportEdgeRecord[] {
    const workspace = this.getWorkspaceRoot(workspaceRoot);
    if (!workspace) {
      return [];
    }
    return this.database
      .prepare(
        `SELECT e.*, from_file.relative_path AS from_relative_path, to_file.relative_path AS to_relative_path
         FROM codegraph_edges e
         JOIN codegraph_files from_file ON from_file.id = e.from_file_id
         LEFT JOIN codegraph_files to_file ON to_file.id = e.to_file_id
         WHERE e.workspace_id = ? AND e.kind = 'imports'
         ORDER BY from_file.relative_path, e.label`,
      )
      .all(workspace.id)
      .map((row) => parseImportEdgeRecord(asRecord(row)));
  }

  searchSymbols(input: SearchSymbolsInput): readonly CodegraphSymbolRecord[] {
    const workspace = this.getWorkspaceRoot(input.workspaceRoot);
    if (!workspace) {
      return [];
    }
    const query = input.query.trim();
    const pattern = `%${escapeLike(query)}%`;
    const sql =
      query.length === 0
        ? `SELECT * FROM codegraph_symbols WHERE workspace_id = ? ORDER BY file_id, start_line LIMIT ?`
        : `SELECT * FROM codegraph_symbols
           WHERE workspace_id = ? AND (name = ? OR name LIKE ? ESCAPE '\\')
           ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END, name, file_id, start_line
           LIMIT ?`;
    const rows =
      query.length === 0
        ? this.database.prepare(sql).all(workspace.id, input.maxResults)
        : this.database.prepare(sql).all(workspace.id, query, pattern, query, input.maxResults);
    return rows.map((row) => parseSymbolRecord(asRecord(row)));
  }

  getFileById(fileId: number): CodegraphFileRecord | undefined {
    const row = this.getRow('SELECT * FROM codegraph_files WHERE id = ?', [fileId]);
    return row ? parseFileRecord(row) : undefined;
  }

  getSymbolById(symbolId: number): CodegraphSymbolRecord | undefined {
    const row = this.getRow('SELECT * FROM codegraph_symbols WHERE id = ?', [symbolId]);
    return row ? parseSymbolRecord(row) : undefined;
  }

  listSymbolEdges(symbolId: number): readonly CodegraphEdgeRecord[] {
    return this.database
      .prepare(
        `SELECT * FROM codegraph_edges
         WHERE from_symbol_id = ? OR to_symbol_id = ?
         ORDER BY kind, id`,
      )
      .all(symbolId, symbolId)
      .map((row) => parseEdgeRecord(asRecord(row)));
  }

  listIncomingSymbolEdges(symbolId: number, maxResults: number): readonly CodegraphEdgeRecord[] {
    return this.database
      .prepare(
        `SELECT * FROM codegraph_edges
         WHERE to_symbol_id = ? AND from_symbol_id IS NOT NULL
         ORDER BY kind, id
         LIMIT ?`,
      )
      .all(symbolId, maxResults)
      .map((row) => parseEdgeRecord(asRecord(row)));
  }

  listOutgoingSymbolEdges(symbolId: number, maxResults: number): readonly CodegraphEdgeRecord[] {
    return this.database
      .prepare(
        `SELECT * FROM codegraph_edges
         WHERE from_symbol_id = ? AND to_symbol_id IS NOT NULL
         ORDER BY kind, id
         LIMIT ?`,
      )
      .all(symbolId, maxResults)
      .map((row) => parseEdgeRecord(asRecord(row)));
  }

  markFilesStale(input: MarkFilesStaleInput): void {
    const workspace = this.upsertWorkspaceRoot(input.workspaceRoot);
    const now = Date.now();
    const statement = this.database.prepare(
      `INSERT INTO codegraph_stale_markers (workspace_id, path, reason, marked_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, path) DO UPDATE SET
         reason = excluded.reason,
         marked_at_ms = excluded.marked_at_ms`,
    );
    for (const file of input.files) {
      statement.run(workspace.id, resolve(file), input.reason, now);
    }
  }

  clearStaleMarkersForFiles(workspaceRoot: string, files: readonly string[]): void {
    const workspace = this.getWorkspaceRoot(workspaceRoot);
    if (!workspace) {
      return;
    }
    const statement = this.database.prepare(
      'DELETE FROM codegraph_stale_markers WHERE workspace_id = ? AND path = ?',
    );
    for (const file of files) {
      statement.run(workspace.id, resolve(file));
    }
  }

  getStaleFiles(workspaceRoot: string): readonly string[] {
    const workspace = this.getWorkspaceRoot(workspaceRoot);
    if (!workspace) {
      return [];
    }
    return this.database
      .prepare('SELECT path FROM codegraph_stale_markers WHERE workspace_id = ? ORDER BY path')
      .all(workspace.id)
      .map((row) => parseStringField(asRecord(row), 'path'));
  }

  finishIndexRun(input: FinishIndexRunInput): CodegraphIndexRunRecord {
    const workspace = this.upsertWorkspaceRoot(input.workspaceRoot);
    const finishedAtMs = Date.now();
    this.database
      .prepare(
        `INSERT INTO codegraph_index_runs (
          workspace_id, started_at_ms, finished_at_ms, status, files_scanned,
          files_indexed, symbols_indexed, degraded_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspace.id,
        input.startedAtMs,
        finishedAtMs,
        input.status,
        input.filesScanned,
        input.filesIndexed,
        input.symbolsIndexed,
        input.degradedReason ?? null,
      );
    const row = this.mustGetRow(
      'SELECT * FROM codegraph_index_runs WHERE id = last_insert_rowid()',
    );
    return parseIndexRunRecord(row);
  }

  getLatestIndexRun(workspaceRoot: string): CodegraphIndexRunRecord | undefined {
    const workspace = this.getWorkspaceRoot(workspaceRoot);
    if (!workspace) {
      return undefined;
    }
    const row = this.getRow(
      `SELECT * FROM codegraph_index_runs
       WHERE workspace_id = ?
       ORDER BY finished_at_ms DESC, id DESC
       LIMIT 1`,
      [workspace.id],
    );
    return row ? parseIndexRunRecord(row) : undefined;
  }

  getFreshness(workspaceRoot: string): CodegraphFreshness {
    const root = resolve(workspaceRoot);
    const latestRun = this.getLatestIndexRun(root);
    const staleFiles = this.getStaleFiles(root);
    if (!latestRun) {
      return {
        workspaceRoot: root,
        status: codegraphFreshnessStatusSchema.parse('not_indexed'),
        staleFiles,
        degradedReason: 'workspace has not been indexed',
      };
    }
    if (staleFiles.length > 0) {
      return {
        workspaceRoot: root,
        indexedAt: latestRun.finishedAtMs,
        status: 'stale',
        staleFiles,
        degradedReason: latestRun.degradedReason,
      };
    }
    if (latestRun.status === 'degraded' || latestRun.status === 'failed') {
      return {
        workspaceRoot: root,
        indexedAt: latestRun.finishedAtMs,
        status: 'degraded',
        staleFiles,
        degradedReason: latestRun.degradedReason,
      };
    }
    return {
      workspaceRoot: root,
      indexedAt: latestRun.finishedAtMs,
      status: 'fresh',
      staleFiles,
    };
  }

  writeStartupStatus(input: CodegraphStartupStatusRecord): void {
    this.database
      .prepare(
        `INSERT INTO codegraph_startup_status (
          id, checked_at_ms, status, schema_version, missing_servers_json,
          install_results_json, degraded_reason
        ) VALUES (1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          checked_at_ms = excluded.checked_at_ms,
          status = excluded.status,
          schema_version = excluded.schema_version,
          missing_servers_json = excluded.missing_servers_json,
          install_results_json = excluded.install_results_json,
          degraded_reason = excluded.degraded_reason`,
      )
      .run(
        input.checkedAtMs,
        input.status,
        input.schemaVersion,
        JSON.stringify(input.missingServers),
        JSON.stringify(input.installResults),
        input.degradedReason ?? null,
      );
  }

  readStartupStatus(): CodegraphStartupStatusRecord | undefined {
    const row = this.getRow('SELECT * FROM codegraph_startup_status WHERE id = 1', []);
    return row ? parseStartupStatusRecord(row) : undefined;
  }

  private setMeta(key: string, value: string): void {
    this.database
      .prepare(
        `INSERT INTO codegraph_meta (key, value, updated_at_ms)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms`,
      )
      .run(key, value, Date.now());
  }

  private insertEdge(input: {
    readonly workspaceId: number;
    readonly fromSymbolId?: number;
    readonly toSymbolId?: number;
    readonly fromFileId?: number;
    readonly toFileId?: number;
    readonly kind: CodegraphEdgeKind;
    readonly label?: string;
  }): CodegraphEdgeRecord {
    this.database
      .prepare(
        `INSERT INTO codegraph_edges (
          workspace_id, from_symbol_id, to_symbol_id, from_file_id, to_file_id, kind, label, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.workspaceId,
        input.fromSymbolId ?? null,
        input.toSymbolId ?? null,
        input.fromFileId ?? null,
        input.toFileId ?? null,
        input.kind,
        input.label ?? null,
        Date.now(),
      );
    const row = this.mustGetRow('SELECT * FROM codegraph_edges WHERE id = last_insert_rowid()');
    return parseEdgeRecord(row);
  }

  private getRow(sql: string, params: readonly unknown[]): UnknownRecord | undefined {
    const row = this.database.prepare(sql).get(...params);
    if (row === null || row === undefined) {
      return undefined;
    }
    return asRecord(row);
  }

  private mustGetRow(sql: string, params: readonly unknown[] = []): UnknownRecord {
    const row = this.getRow(sql, params);
    if (!row) {
      throw new CodegraphStoreError(`Expected SQLite row for query: ${sql}`);
    }
    return row;
  }
}

export function openCodegraphStore(input: OpenCodegraphStoreInput): CodegraphStore {
  return new CodegraphStore(input);
}

export function hashCodegraphContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function asRecord(value: unknown): UnknownRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  throw new CodegraphStoreError('SQLite returned a non-object row');
}

function parseStringField(row: UnknownRecord, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new CodegraphStoreError(`SQLite column ${key} was not a string`);
  }
  return value;
}

function parseOptionalStringField(row: UnknownRecord, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new CodegraphStoreError(`SQLite column ${key} was not a string`);
  }
  return value;
}

function parseNumberField(row: UnknownRecord, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') {
    throw new CodegraphStoreError(`SQLite column ${key} was not a number`);
  }
  return value;
}

function parseOptionalNumberField(row: UnknownRecord, key: string): number | undefined {
  const value = row[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number') {
    throw new CodegraphStoreError(`SQLite column ${key} was not a number`);
  }
  return value;
}

function parseJsonStringArray(value: string): readonly string[] {
  const parsed = z.array(z.string()).safeParse(JSON.parse(value) as unknown);
  if (!parsed.success) {
    return [];
  }
  return parsed.data;
}

function parseInstallResults(value: string): Readonly<Record<string, boolean>> {
  const parsed = z.record(z.boolean()).safeParse(JSON.parse(value) as unknown);
  if (!parsed.success) {
    return {};
  }
  return parsed.data;
}

function parseWorkspaceRoot(row: UnknownRecord): CodegraphWorkspaceRoot {
  return {
    id: parseNumberField(row, 'id'),
    rootPath: parseStringField(row, 'root_path'),
    createdAtMs: parseNumberField(row, 'created_at_ms'),
    updatedAtMs: parseNumberField(row, 'updated_at_ms'),
  };
}

function parseFileRecord(row: UnknownRecord): CodegraphFileRecord {
  return {
    id: parseNumberField(row, 'id'),
    workspaceId: parseNumberField(row, 'workspace_id'),
    path: parseStringField(row, 'path'),
    relativePath: parseStringField(row, 'relative_path'),
    language: parseStringField(row, 'language'),
    hash: parseStringField(row, 'hash'),
    sizeBytes: parseNumberField(row, 'size_bytes'),
    mtimeMs: parseNumberField(row, 'mtime_ms'),
    status: codegraphFileStatusSchema.parse(parseStringField(row, 'status')),
    degradedReason: parseOptionalStringField(row, 'degraded_reason'),
    indexedAtMs: parseNumberField(row, 'indexed_at_ms'),
  };
}

function parseSymbolRecord(row: UnknownRecord): CodegraphSymbolRecord {
  return {
    id: parseNumberField(row, 'id'),
    workspaceId: parseNumberField(row, 'workspace_id'),
    fileId: parseNumberField(row, 'file_id'),
    parentSymbolId: parseOptionalNumberField(row, 'parent_symbol_id'),
    name: parseStringField(row, 'name'),
    kind: parseStringField(row, 'kind'),
    detail: parseOptionalStringField(row, 'detail'),
    startLine: parseNumberField(row, 'start_line'),
    startCharacter: parseNumberField(row, 'start_character'),
    endLine: parseNumberField(row, 'end_line'),
    endCharacter: parseNumberField(row, 'end_character'),
    selectionStartLine: parseNumberField(row, 'selection_start_line'),
    selectionStartCharacter: parseNumberField(row, 'selection_start_character'),
    selectionEndLine: parseNumberField(row, 'selection_end_line'),
    selectionEndCharacter: parseNumberField(row, 'selection_end_character'),
    createdAtMs: parseNumberField(row, 'created_at_ms'),
  };
}

function parseEdgeRecord(row: UnknownRecord): CodegraphEdgeRecord {
  return {
    id: parseNumberField(row, 'id'),
    workspaceId: parseNumberField(row, 'workspace_id'),
    fromSymbolId: parseOptionalNumberField(row, 'from_symbol_id'),
    toSymbolId: parseOptionalNumberField(row, 'to_symbol_id'),
    fromFileId: parseOptionalNumberField(row, 'from_file_id'),
    toFileId: parseOptionalNumberField(row, 'to_file_id'),
    kind: codegraphEdgeKindSchema.parse(parseStringField(row, 'kind')),
    label: parseOptionalStringField(row, 'label'),
    createdAtMs: parseNumberField(row, 'created_at_ms'),
  };
}

function parseImportEdgeRecord(row: UnknownRecord): CodegraphImportEdgeRecord {
  return {
    ...parseEdgeRecord(row),
    fromRelativePath: parseStringField(row, 'from_relative_path'),
    toRelativePath: parseOptionalStringField(row, 'to_relative_path'),
  };
}

function parseIndexRunRecord(row: UnknownRecord): CodegraphIndexRunRecord {
  return {
    id: parseNumberField(row, 'id'),
    workspaceId: parseNumberField(row, 'workspace_id'),
    startedAtMs: parseNumberField(row, 'started_at_ms'),
    finishedAtMs: parseNumberField(row, 'finished_at_ms'),
    status: codegraphRunStatusSchema.parse(parseStringField(row, 'status')),
    filesScanned: parseNumberField(row, 'files_scanned'),
    filesIndexed: parseNumberField(row, 'files_indexed'),
    symbolsIndexed: parseNumberField(row, 'symbols_indexed'),
    degradedReason: parseOptionalStringField(row, 'degraded_reason'),
  };
}

function parseStartupStatusRecord(row: UnknownRecord): CodegraphStartupStatusRecord {
  return {
    checkedAtMs: parseNumberField(row, 'checked_at_ms'),
    status: codegraphStartupStatusSchema.parse(parseStringField(row, 'status')),
    schemaVersion: parseNumberField(row, 'schema_version'),
    missingServers: parseJsonStringArray(parseStringField(row, 'missing_servers_json')),
    installResults: parseInstallResults(parseStringField(row, 'install_results_json')),
    degradedReason: parseOptionalStringField(row, 'degraded_reason'),
  };
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function buildStartupStatus(input: {
  readonly status: CodegraphStartupStatusValue;
  readonly missingServers: readonly string[];
  readonly installResults?: Readonly<Record<string, boolean>>;
  readonly degradedReason?: string;
}): CodegraphStartupStatusRecord {
  return {
    checkedAtMs: Date.now(),
    status: input.status,
    schemaVersion: CODEGRAPH_SCHEMA_VERSION,
    missingServers: input.missingServers,
    installResults: input.installResults ?? {},
    degradedReason: input.degradedReason,
  };
}

export const CODEGRAPH_CURRENT_SCHEMA_VERSION = CODEGRAPH_SCHEMA_VERSION;
