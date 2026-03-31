import type { FileDiffContent } from '@openAwork/shared';
import { sqliteAll, sqliteRun } from './db.js';

interface SessionSnapshotRow {
  client_request_id: string;
  summary_json: string;
  files_json: string;
  created_at: string;
}

export function persistSessionSnapshot(input: {
  sessionId: string;
  userId: string;
  clientRequestId: string;
  fileDiffs: FileDiffContent[];
}): void {
  if (input.fileDiffs.length === 0) {
    return;
  }
  const summary = {
    files: input.fileDiffs.length,
    additions: input.fileDiffs.reduce((sum, item) => sum + item.additions, 0),
    deletions: input.fileDiffs.reduce((sum, item) => sum + item.deletions, 0),
  };
  sqliteRun(
    `INSERT OR REPLACE INTO session_snapshots
     (session_id, user_id, client_request_id, summary_json, files_json, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [
      input.sessionId,
      input.userId,
      input.clientRequestId,
      JSON.stringify(summary),
      JSON.stringify(input.fileDiffs),
    ],
  );
}

export function listSessionSnapshots(input: { sessionId: string; userId: string }) {
  return sqliteAll<SessionSnapshotRow>(
    `SELECT client_request_id, summary_json, files_json, created_at
     FROM session_snapshots
     WHERE session_id = ? AND user_id = ?
     ORDER BY created_at DESC`,
    [input.sessionId, input.userId],
  ).flatMap((row) => {
    if (
      typeof row.client_request_id !== 'string' ||
      typeof row.summary_json !== 'string' ||
      typeof row.files_json !== 'string' ||
      typeof row.created_at !== 'string'
    ) {
      return [];
    }

    try {
      return [
        {
          clientRequestId: row.client_request_id,
          summary: JSON.parse(row.summary_json) as {
            files: number;
            additions: number;
            deletions: number;
          },
          files: JSON.parse(row.files_json) as FileDiffContent[],
          createdAt: row.created_at,
        },
      ];
    } catch {
      return [];
    }
  });
}
