import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FileBackupRef } from '@openAwork/shared';
import { sqliteGet, sqliteRun } from './db.js';

interface SessionFileBackupRow {
  artifact_id: string | null;
  backup_id: string;
  content_hash: string;
  kind: 'before_write' | 'after_write' | 'snapshot_base';
  storage_path: string | null;
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
  const contentHash = createHash('sha256').update(input.content).digest('hex');
  const existing = sqliteGet<SessionFileBackupRow>(
    `SELECT backup_id, kind, content_hash, storage_path, artifact_id
     FROM session_file_backups
     WHERE session_id = ? AND file_path = ? AND kind = ? AND content_hash = ?
     LIMIT 1`,
    [input.sessionId, input.filePath, input.kind, contentHash],
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

  const backupId = randomUUID();
  const storagePath = resolve(
    process.cwd(),
    'data',
    'file-backups',
    input.sessionId,
    `${backupId}.txt`,
  );
  await mkdir(dirname(storagePath), { recursive: true });
  await writeFile(storagePath, input.content, 'utf8');

  sqliteRun(
    `INSERT INTO session_file_backups
     (backup_id, session_id, user_id, file_path, content_hash, kind, source_tool, source_request_id, tool_call_id, storage_path, artifact_id, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      backupId,
      input.sessionId,
      input.userId,
      input.filePath,
      contentHash,
      input.kind,
      input.toolName,
      input.requestId ?? null,
      input.toolCallId ?? null,
      storagePath,
      null,
      Buffer.byteLength(input.content, 'utf8'),
    ],
  );

  return {
    backupId,
    kind: input.kind,
    contentHash,
    storagePath,
  };
}
