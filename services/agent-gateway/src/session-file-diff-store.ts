import type { FileDiffContent, ToolCallObservabilityAnnotation } from '@openAwork/shared';
import { sqliteAll, sqliteRun } from './db.js';

interface SessionFileDiffRow {
  file_path: string;
  before_text: string;
  after_text: string;
  additions: number;
  deletions: number;
  status: string | null;
  tool_name: string;
  request_id: string;
  created_at: string;
}

export function persistSessionFileDiffs(input: {
  sessionId: string;
  userId: string;
  requestId: string;
  toolName: string;
  diffs: FileDiffContent[];
  toolCallId?: string;
  observability?: ToolCallObservabilityAnnotation;
}): void {
  for (const diff of input.diffs) {
    sqliteRun(
      `INSERT OR REPLACE INTO session_file_diffs
       (session_id, user_id, request_id, tool_name, file_path, before_text, after_text, additions, deletions, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        input.sessionId,
        input.userId,
        input.requestId,
        input.toolName,
        diff.file,
        diff.before,
        diff.after,
        diff.additions,
        diff.deletions,
        diff.status ?? null,
      ],
    );
  }
}

export function listSessionFileDiffs(input: {
  sessionId: string;
  userId: string;
}): FileDiffContent[] {
  return sqliteAll<SessionFileDiffRow>(
    `SELECT file_path, before_text, after_text, additions, deletions, status, tool_name, request_id, created_at
     FROM session_file_diffs
     WHERE session_id = ? AND user_id = ?
     ORDER BY created_at DESC, file_path ASC`,
    [input.sessionId, input.userId],
  ).map((row) => ({
    file: row.file_path,
    before: row.before_text,
    after: row.after_text,
    additions: row.additions,
    deletions: row.deletions,
    requestId: row.request_id,
    toolName: row.tool_name,
    ...(row.status === 'added' || row.status === 'deleted' || row.status === 'modified'
      ? { status: row.status }
      : {}),
  }));
}
