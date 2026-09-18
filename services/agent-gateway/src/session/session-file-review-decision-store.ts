import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';

export type SessionFileReviewDecision = 'accepted' | 'rejected';

export interface SessionFileReviewDecisionRecord {
  createdAt: string;
  decision: SessionFileReviewDecision;
  filePath: string;
  requestId: string;
  revertRequestId: string | null;
}

interface SessionFileReviewDecisionRow {
  request_id: string;
  file_path: string;
  decision: string;
  revert_request_id: string | null;
  created_at: string;
}

export function upsertReviewDecision(input: {
  decision: SessionFileReviewDecision;
  filePath: string;
  requestId: string;
  revertRequestId?: string | null;
  sessionId: string;
  userId: string;
}): void {
  sqliteRun(
    `INSERT OR REPLACE INTO session_file_review_decisions
     (session_id, user_id, request_id, file_path, decision, revert_request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      input.sessionId,
      input.userId,
      input.requestId,
      input.filePath,
      input.decision,
      input.revertRequestId ?? null,
    ],
  );
}

export function getReviewDecision(input: {
  filePath: string;
  requestId: string;
  sessionId: string;
  userId: string;
}): SessionFileReviewDecisionRecord | null {
  const row = sqliteGet<SessionFileReviewDecisionRow>(
    `SELECT request_id, file_path, decision, revert_request_id, created_at
     FROM session_file_review_decisions
     WHERE session_id = ? AND user_id = ? AND request_id = ? AND file_path = ?
     LIMIT 1`,
    [input.sessionId, input.userId, input.requestId, input.filePath],
  );
  return row ? mapSessionFileReviewDecisionRow(row) : null;
}

export function listReviewDecisions(input: {
  sessionId: string;
  userId: string;
}): SessionFileReviewDecisionRecord[] {
  return sqliteAll<SessionFileReviewDecisionRow>(
    `SELECT request_id, file_path, decision, revert_request_id, created_at
     FROM session_file_review_decisions
     WHERE session_id = ? AND user_id = ?
     ORDER BY created_at DESC, request_id ASC, file_path ASC`,
    [input.sessionId, input.userId],
  ).map(mapSessionFileReviewDecisionRow);
}

function mapSessionFileReviewDecisionRow(
  row: SessionFileReviewDecisionRow,
): SessionFileReviewDecisionRecord {
  return {
    requestId: row.request_id,
    filePath: row.file_path,
    decision: row.decision === 'rejected' ? 'rejected' : 'accepted',
    revertRequestId: row.revert_request_id,
    createdAt: row.created_at,
  };
}
