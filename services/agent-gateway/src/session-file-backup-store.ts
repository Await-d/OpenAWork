import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { FileBackupRef } from '@openAwork/shared';
import { sqliteAll, sqliteGet, sqliteRun } from './db.js';
import { resolveGatewayFileBackupsDir } from './storage-paths.js';

export type SessionFileBackupContentTier = 'text' | 'notebook' | 'binary';
export type SessionFileBackupFailurePolicy = 'block' | 'degrade';

interface BackupContentDescriptor {
  contentFormat: string;
  contentHash: string;
  contentTier: SessionFileBackupContentTier;
  hashScope: 'raw' | 'notebook_normalized';
}

interface SessionFileBackupRow {
  created_at?: string;
  artifact_id: string | null;
  backup_id: string;
  content_hash: string;
  content_format: string | null;
  content_tier: SessionFileBackupContentTier | null;
  file_path?: string;
  hash_scope: 'raw' | 'notebook_normalized' | null;
  kind: 'before_write' | 'after_write' | 'snapshot_base';
  session_id?: string;
  size_bytes?: number;
  source_request_id?: string | null;
  source_tool?: string | null;
  storage_path: string | null;
  tool_call_id?: string | null;
  user_id?: string;
}

export interface SessionFileBackupRecord {
  artifactId?: string;
  backupId: string;
  contentFormat?: string;
  contentHash: string;
  contentTier: SessionFileBackupContentTier;
  createdAt?: string;
  filePath: string;
  hashScope: 'raw' | 'notebook_normalized';
  kind: 'before_write' | 'after_write' | 'snapshot_base';
  requestId?: string;
  sessionId: string;
  sizeBytes: number;
  sourceTool?: string;
  storagePath?: string;
  toolCallId?: string;
  userId: string;
}

const BINARY_FILE_EXTENSIONS = new Set([
  '.7z',
  '.bin',
  '.db',
  '.dll',
  '.dylib',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.sqlite',
  '.tar',
  '.wasm',
  '.webp',
  '.zip',
]);

export class FileBackupUnsupportedContentError extends Error {
  constructor(filePath: string, tier: SessionFileBackupContentTier) {
    super(`Backup capture does not support ${tier} content for ${filePath}`);
    this.name = 'FileBackupUnsupportedContentError';
  }
}

export async function persistSessionFileBackup(input: {
  content: string;
  filePath: string;
  kind: 'before_write' | 'after_write' | 'snapshot_base';
  requestId?: string;
  sessionId: string;
  toolCallId?: string;
  toolName: string;
  userId: string;
}): Promise<FileBackupRef> {
  const descriptor = classifyBackupContent(input.filePath, input.content);
  if (descriptor.contentTier === 'binary') {
    throw new FileBackupUnsupportedContentError(input.filePath, descriptor.contentTier);
  }

  const existing = sqliteGet<SessionFileBackupRow>(
    `SELECT backup_id, kind, content_hash, storage_path, artifact_id, content_tier, content_format, hash_scope
     FROM session_file_backups
     WHERE session_id = ? AND file_path = ? AND kind = ? AND content_hash = ? AND content_tier = ? AND hash_scope = ?
     LIMIT 1`,
    [
      input.sessionId,
      input.filePath,
      input.kind,
      descriptor.contentHash,
      descriptor.contentTier,
      descriptor.hashScope,
    ],
  );
  if (existing) {
    return {
      backupId: existing.backup_id,
      kind: existing.kind,
      contentHash: existing.content_hash,
      storagePath: existing.storage_path ?? undefined,
      artifactId: existing.artifact_id ?? undefined,
    };
  }

  const dedupedStorage = sqliteGet<SessionFileBackupRow>(
    `SELECT backup_id, kind, content_hash, storage_path, artifact_id, content_tier, content_format, hash_scope
     FROM session_file_backups
     WHERE kind = ? AND content_hash = ? AND content_tier = ? AND hash_scope = ?
       AND (storage_path IS NOT NULL OR artifact_id IS NOT NULL)
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.kind, descriptor.contentHash, descriptor.contentTier, descriptor.hashScope],
  );

  const backupId = randomUUID();
  const storagePath =
    dedupedStorage?.storage_path ??
    join(
      resolveGatewayFileBackupsDir(),
      descriptor.contentTier,
      `${descriptor.contentHash}.${descriptor.contentFormat}`,
    );
  if (!dedupedStorage?.storage_path) {
    await mkdir(dirname(storagePath), { recursive: true });
    await writeFile(storagePath, input.content, 'utf8');
  }

  sqliteRun(
    `INSERT INTO session_file_backups
     (backup_id, session_id, user_id, file_path, content_hash, content_tier, content_format, hash_scope, kind, source_tool, source_request_id, tool_call_id, storage_path, artifact_id, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      backupId,
      input.sessionId,
      input.userId,
      input.filePath,
      descriptor.contentHash,
      descriptor.contentTier,
      descriptor.contentFormat,
      descriptor.hashScope,
      input.kind,
      input.toolName,
      input.requestId ?? null,
      input.toolCallId ?? null,
      storagePath,
      dedupedStorage?.artifact_id ?? null,
      Buffer.byteLength(input.content, 'utf8'),
    ],
  );

  return {
    backupId,
    kind: input.kind,
    contentHash: descriptor.contentHash,
    storagePath,
  };
}

export async function captureBeforeWriteBackup(input: {
  content: string;
  filePath: string;
  kind: 'before_write' | 'after_write' | 'snapshot_base';
  requestId?: string;
  sessionId: string;
  toolCallId?: string;
  toolName: string;
  userId: string;
}): Promise<FileBackupRef | undefined> {
  try {
    return await persistSessionFileBackup(input);
  } catch (error) {
    if (resolveFileBackupFailurePolicy() === 'degrade') {
      return undefined;
    }
    throw error;
  }
}

export function listSessionFileBackups(input: {
  sessionId: string;
  userId: string;
}): SessionFileBackupRecord[] {
  return sqliteAll<SessionFileBackupRow>(
    `SELECT backup_id, session_id, user_id, file_path, content_hash, content_tier, content_format, hash_scope, kind, source_tool, source_request_id, tool_call_id, storage_path, artifact_id, size_bytes, created_at
     FROM session_file_backups
     WHERE session_id = ? AND user_id = ?
     ORDER BY created_at DESC, backup_id DESC`,
    [input.sessionId, input.userId],
  ).map(mapSessionFileBackupRow);
}

export function getSessionFileBackup(input: {
  backupId: string;
  sessionId: string;
  userId: string;
}): SessionFileBackupRecord | null {
  const row = sqliteGet<SessionFileBackupRow>(
    `SELECT backup_id, session_id, user_id, file_path, content_hash, content_tier, content_format, hash_scope, kind, source_tool, source_request_id, tool_call_id, storage_path, artifact_id, size_bytes, created_at
     FROM session_file_backups
     WHERE backup_id = ? AND session_id = ? AND user_id = ?
     LIMIT 1`,
    [input.backupId, input.sessionId, input.userId],
  );
  return row ? mapSessionFileBackupRow(row) : null;
}

export async function readSessionFileBackupContent(input: {
  backupId: string;
  sessionId: string;
  userId: string;
}): Promise<string | null> {
  const backup = getSessionFileBackup(input);
  if (!backup?.storagePath) {
    return null;
  }
  try {
    return await readFile(backup.storagePath, 'utf8');
  } catch {
    return null;
  }
}

export async function cleanupSessionBackupFiles(input: {
  sessionId: string;
  userId: string;
}): Promise<void> {
  const candidatePaths = collectSessionBackupStoragePaths(input);
  sqliteRun('DELETE FROM session_file_backups WHERE session_id = ? AND user_id = ?', [
    input.sessionId,
    input.userId,
  ]);

  await garbageCollectBackupStoragePaths(candidatePaths);
}

export function collectSessionBackupStoragePaths(input: {
  sessionId: string;
  userId: string;
}): string[] {
  return Array.from(
    new Set(
      listSessionFileBackups(input)
        .map((backup) => backup.storagePath)
        .filter((path): path is string => Boolean(path)),
    ),
  );
}

export async function garbageCollectBackupStoragePaths(paths: string[]): Promise<void> {
  for (const storagePath of Array.from(new Set(paths))) {
    const remaining = sqliteGet<{ count: number }>(
      'SELECT COUNT(*) as count FROM session_file_backups WHERE storage_path = ? LIMIT 1',
      [storagePath],
    );
    if ((remaining?.count ?? 0) > 0) {
      continue;
    }
    try {
      await rm(storagePath, { force: true });
    } catch {
      continue;
    }
  }
}

export function resolveFileBackupFailurePolicy(): SessionFileBackupFailurePolicy {
  return process.env['OPENAWORK_FILE_BACKUP_FAILURE_POLICY'] === 'degrade' ? 'degrade' : 'block';
}

export function classifyBackupContent(filePath: string, content: string): BackupContentDescriptor {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.ipynb') {
    return {
      contentTier: 'notebook',
      contentFormat: 'ipynb',
      hashScope: 'raw',
      contentHash: createHash('sha256').update(content).digest('hex'),
    };
  }

  if (content.includes('\u0000') || BINARY_FILE_EXTENSIONS.has(extension)) {
    return {
      contentTier: 'binary',
      contentFormat: extension.length > 1 ? extension.slice(1) : 'bin',
      hashScope: 'raw',
      contentHash: createHash('sha256').update(content).digest('hex'),
    };
  }

  return {
    contentTier: 'text',
    contentFormat: extension.length > 1 ? extension.slice(1) : 'txt',
    hashScope: 'raw',
    contentHash: createHash('sha256').update(content).digest('hex'),
  };
}

function mapSessionFileBackupRow(row: SessionFileBackupRow): SessionFileBackupRecord {
  return {
    backupId: row.backup_id,
    sessionId: row.session_id ?? '',
    userId: row.user_id ?? '',
    filePath: row.file_path ?? '',
    contentHash: row.content_hash,
    contentTier: row.content_tier ?? 'text',
    contentFormat: row.content_format ?? undefined,
    hashScope: row.hash_scope ?? 'raw',
    kind: row.kind,
    sourceTool: row.source_tool ?? undefined,
    requestId: row.source_request_id ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    storagePath: row.storage_path ?? undefined,
    artifactId: row.artifact_id ?? undefined,
    sizeBytes: row.size_bytes ?? 0,
    createdAt: row.created_at,
  };
}
