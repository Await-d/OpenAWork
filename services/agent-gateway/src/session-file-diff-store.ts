import type {
  FileBackupRef,
  FileChangeGuaranteeLevel,
  FileChangeSourceKind,
  FileDiffContent,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';
import { sqliteAll, sqliteRun } from './db.js';

interface SessionFileDiffRow {
  client_request_id: string | null;
  file_path: string;
  before_text: string;
  after_text: string;
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

export function persistSessionFileDiffs(input: {
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
}): void {
  for (const diff of input.diffs) {
    sqliteRun(
      `INSERT OR REPLACE INTO session_file_diffs
       (session_id, user_id, client_request_id, request_id, tool_name, tool_call_id, file_path, before_text, after_text, additions, deletions, status, source_kind, guarantee_level, observability_json, backup_before_ref_json, backup_after_ref_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        input.sessionId,
        input.userId,
        diff.clientRequestId ?? input.clientRequestId ?? null,
        input.requestId,
        diff.toolName ?? input.toolName,
        diff.toolCallId ?? input.toolCallId ?? null,
        diff.file,
        diff.before,
        diff.after,
        diff.additions,
        diff.deletions,
        diff.status ?? null,
        diff.sourceKind ?? input.sourceKind ?? 'structured_tool_diff',
        diff.guaranteeLevel ?? input.guaranteeLevel ?? 'medium',
        JSON.stringify(diff.observability ?? input.observability ?? null),
        JSON.stringify(diff.backupBeforeRef ?? input.backupBeforeRef ?? null),
        JSON.stringify(diff.backupAfterRef ?? input.backupAfterRef ?? null),
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

function listSessionFileDiffsWithWhere(input: {
  sessionId: string;
  userId: string;
  whereClause?: string;
  whereParams?: string[];
}): FileDiffContent[] {
  return sqliteAll<SessionFileDiffRow>(
    `SELECT client_request_id, file_path, before_text, after_text, additions, deletions, status, source_kind, guarantee_level, observability_json, backup_before_ref_json, backup_after_ref_json, tool_name, tool_call_id, request_id, created_at
     FROM session_file_diffs
     WHERE session_id = ? AND user_id = ? ${input.whereClause ?? ''}
     ORDER BY created_at DESC, file_path ASC`,
    [input.sessionId, input.userId, ...(input.whereParams ?? [])],
  ).map(mapSessionFileDiffRow);
}

function mapSessionFileDiffRow(row: SessionFileDiffRow): FileDiffContent {
  const observability = parseNullableJson<ToolCallObservabilityAnnotation>(row.observability_json);
  const backupBeforeRef = parseNullableJson<FileBackupRef>(row.backup_before_ref_json);
  const backupAfterRef = parseNullableJson<FileBackupRef>(row.backup_after_ref_json);

  return {
    file: row.file_path,
    before: row.before_text,
    after: row.after_text,
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
