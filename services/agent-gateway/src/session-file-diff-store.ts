import type {
  FileBackupRef,
  FileChangeGuaranteeLevel,
  FileChangeSourceKind,
  FileDiffContent,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';
import { sqliteAll, sqliteRun } from './db.js';
import {
  captureBeforeWriteBackup,
  readSessionFileBackupContent,
} from './session-file-backup-store.js';

interface SessionFileDiffRow {
  client_request_id: string | null;
  file_path: string;
  before_backup_id: string | null;
  after_backup_id: string | null;
  additions: number;
  deletions: number;
  status: string | null;
  source_kind: string | null;
  guarantee_level: string | null;
  observability_json: string | null;
  backup_before_ref_json: string | null;
  backup_after_ref_json: string | null;
  tool_name: string;
  tool_call_id: string | null;
  request_id: string;
  created_at: string;
}

export async function persistSessionFileDiffs(input: {
  sessionId: string;
  userId: string;
  clientRequestId?: string;
  requestId: string;
  toolName: string;
  diffs: FileDiffContent[];
  toolCallId?: string;
  sourceKind?: FileChangeSourceKind;
  guaranteeLevel?: FileChangeGuaranteeLevel;
  backupBeforeRef?: FileBackupRef;
  backupAfterRef?: FileBackupRef;
  observability?: ToolCallObservabilityAnnotation;
}): Promise<void> {
  for (const diff of input.diffs) {
    // Store before/after content as file system backups instead of in DB
    const beforeBackupRef =
      diff.backupBeforeRef ??
      (diff.before !== undefined
        ? await captureBeforeWriteBackup({
            sessionId: input.sessionId,
            userId: input.userId,
            filePath: diff.file,
            content: diff.before,
            kind: 'before_write',
            toolName: diff.toolName ?? input.toolName,
            requestId: input.requestId,
            toolCallId: diff.toolCallId ?? input.toolCallId,
          }).catch(() => undefined)
        : undefined);
    const afterBackupRef =
      diff.backupAfterRef ??
      (diff.after !== undefined
        ? await captureBeforeWriteBackup({
            sessionId: input.sessionId,
            userId: input.userId,
            filePath: diff.file,
            content: diff.after,
            kind: 'after_write',
            toolName: diff.toolName ?? input.toolName,
            requestId: input.requestId,
            toolCallId: diff.toolCallId ?? input.toolCallId,
          }).catch(() => undefined)
        : undefined);

    sqliteRun(
      `INSERT OR REPLACE INTO session_file_diffs
       (session_id, user_id, client_request_id, request_id, tool_name, tool_call_id, file_path, before_backup_id, after_backup_id, additions, deletions, status, source_kind, guarantee_level, observability_json, backup_before_ref_json, backup_after_ref_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        input.sessionId,
        input.userId,
        diff.clientRequestId ?? input.clientRequestId ?? null,
        input.requestId,
        diff.toolName ?? input.toolName,
        diff.toolCallId ?? input.toolCallId ?? null,
        diff.file,
        beforeBackupRef?.backupId ?? null,
        afterBackupRef?.backupId ?? null,
        diff.additions,
        diff.deletions,
        diff.status ?? null,
        diff.sourceKind ?? input.sourceKind ?? 'structured_tool_diff',
        diff.guaranteeLevel ?? input.guaranteeLevel ?? 'medium',
        JSON.stringify(diff.observability ?? input.observability ?? null),
        JSON.stringify(beforeBackupRef ?? input.backupBeforeRef ?? null),
        JSON.stringify(afterBackupRef ?? input.backupAfterRef ?? null),
      ],
    );
  }
}

export function listSessionFileDiffs(input: {
  sessionId: string;
  userId: string;
}): FileDiffContent[] {
  return listSessionFileDiffsWithWhere({
    sessionId: input.sessionId,
    userId: input.userId,
  });
}

export async function listSessionFileDiffsWithText(input: {
  sessionId: string;
  userId: string;
}): Promise<FileDiffContent[]> {
  return listSessionFileDiffsWithWhereAndText({
    sessionId: input.sessionId,
    userId: input.userId,
  });
}

export function listRequestFileDiffs(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): FileDiffContent[] {
  return listSessionFileDiffsWithWhere({
    sessionId: input.sessionId,
    userId: input.userId,
    whereClause: 'AND client_request_id = ?',
    whereParams: [input.clientRequestId],
  });
}

export async function listRequestFileDiffsWithText(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): Promise<FileDiffContent[]> {
  return listSessionFileDiffsWithWhereAndText({
    sessionId: input.sessionId,
    userId: input.userId,
    whereClause: 'AND client_request_id = ?',
    whereParams: [input.clientRequestId],
  });
}

export function deleteRequestFileDiffs(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): void {
  sqliteRun(
    'DELETE FROM session_file_diffs WHERE session_id = ? AND user_id = ? AND client_request_id = ?',
    [input.sessionId, input.userId, input.clientRequestId],
  );
}

function listSessionFileDiffsWithWhere(input: {
  sessionId: string;
  userId: string;
  whereClause?: string;
  whereParams?: string[];
}): FileDiffContent[] {
  const rows = sqliteAll<SessionFileDiffRow>(
    `SELECT client_request_id, file_path, before_backup_id, after_backup_id, additions, deletions, status, source_kind, guarantee_level, observability_json, backup_before_ref_json, backup_after_ref_json, tool_name, tool_call_id, request_id, created_at
     FROM session_file_diffs
     WHERE session_id = ? AND user_id = ? ${input.whereClause ?? ''}
     ORDER BY created_at DESC, file_path ASC`,
    [input.sessionId, input.userId, ...(input.whereParams ?? [])],
  );
  // Synchronous: returns metadata only, before/after are empty strings
  // Use listSessionFileDiffsWithWhereAndText for full content
  return rows.map((row) => mapSessionFileDiffRow(row));
}

async function listSessionFileDiffsWithWhereAndText(input: {
  sessionId: string;
  userId: string;
  whereClause?: string;
  whereParams?: string[];
}): Promise<FileDiffContent[]> {
  const rows = sqliteAll<SessionFileDiffRow>(
    `SELECT client_request_id, file_path, before_backup_id, after_backup_id, additions, deletions, status, source_kind, guarantee_level, observability_json, backup_before_ref_json, backup_after_ref_json, tool_name, tool_call_id, request_id, created_at
     FROM session_file_diffs
     WHERE session_id = ? AND user_id = ? ${input.whereClause ?? ''}
     ORDER BY created_at DESC, file_path ASC`,
    [input.sessionId, input.userId, ...(input.whereParams ?? [])],
  );
  const results: FileDiffContent[] = [];
  for (const row of rows) {
    const beforeText = row.before_backup_id
      ? await readSessionFileBackupContent({
          backupId: row.before_backup_id,
          sessionId: input.sessionId,
          userId: input.userId,
        })
      : null;
    const afterText = row.after_backup_id
      ? await readSessionFileBackupContent({
          backupId: row.after_backup_id,
          sessionId: input.sessionId,
          userId: input.userId,
        })
      : null;
    results.push(mapSessionFileDiffRow(row, beforeText ?? undefined, afterText ?? undefined));
  }
  return results;
}

function mapSessionFileDiffRow(
  row: SessionFileDiffRow,
  beforeText?: string,
  afterText?: string,
): FileDiffContent {
  const observability = parseNullableJson<ToolCallObservabilityAnnotation>(row.observability_json);
  const backupBeforeRef = parseNullableJson<FileBackupRef>(row.backup_before_ref_json);
  const backupAfterRef = parseNullableJson<FileBackupRef>(row.backup_after_ref_json);

  return {
    file: row.file_path,
    before: beforeText ?? '',
    after: afterText ?? '',
    additions: row.additions,
    deletions: row.deletions,
    clientRequestId: row.client_request_id ?? undefined,
    requestId: row.request_id,
    toolName: row.tool_name,
    toolCallId: row.tool_call_id ?? undefined,
    ...(row.status === 'added' || row.status === 'deleted' || row.status === 'modified'
      ? { status: row.status }
      : {}),
    ...(isFileChangeSourceKind(row.source_kind) ? { sourceKind: row.source_kind } : {}),
    ...(isFileChangeGuaranteeLevel(row.guarantee_level)
      ? { guaranteeLevel: row.guarantee_level }
      : {}),
    ...(observability ? { observability } : {}),
    ...(backupBeforeRef ? { backupBeforeRef } : {}),
    ...(backupAfterRef ? { backupAfterRef } : {}),
  } satisfies FileDiffContent;
}

function parseNullableJson<T>(value: string | null): T | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    return (JSON.parse(value) as T | null | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

function isFileChangeSourceKind(value: string | null): value is FileChangeSourceKind {
  return (
    value === 'structured_tool_diff' ||
    value === 'session_snapshot' ||
    value === 'restore_replay' ||
    value === 'workspace_reconcile' ||
    value === 'manual_revert'
  );
}

function isFileChangeGuaranteeLevel(value: string | null): value is FileChangeGuaranteeLevel {
  return value === 'strong' || value === 'medium' || value === 'weak';
}
