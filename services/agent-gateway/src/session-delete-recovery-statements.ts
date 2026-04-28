/**
 * Pure-data list of recovery SQL statements consumed by
 * `deleteSessionWithMalformedRecovery`. Kept in a dependency-free
 * module so it can be unit-tested without pulling in the SQLite
 * driver or the gateway db singleton.
 */

export interface SessionDeleteRecoveryStatement {
  params: (input: { sessionId: string; userId: string }) => [string] | [string, string];
  sql: string;
}

/**
 * Ordered list of SQL statements `deleteSessionWithMalformedRecovery`
 * runs with `PRAGMA foreign_keys=OFF`. Order matters: child tables
 * must come before their parents because cascades are disabled while
 * this list executes. Whenever a new session-scoped table is added
 * to the schema, append a statement here.
 */
export const SESSION_DELETE_RECOVERY_STATEMENTS: ReadonlyArray<SessionDeleteRecoveryStatement> = [
  // ── ON DELETE SET NULL → manual UPDATE (FK is off, so cascade does
  //    not fire; without these the row keeps a dangling session_id). ──
  {
    sql: 'UPDATE audit_logs SET session_id = NULL WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'UPDATE request_workflow_logs SET session_id = NULL WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  // ── Legacy v1 messages mirror ──
  {
    sql: 'DELETE FROM session_messages WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  // V2 event-sourced storage. With FK off the normal CASCADE chain
  // (sessions → message_v2 → part_v2) does not fire, so the recovery
  // path purges children first, then parents, then the typed event
  // log (`session_entry`) and FTS mirror.
  {
    sql: 'DELETE FROM part_v2 WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM message_v2 WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_entry WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_messages_fts WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  // ── Message rating + sharing rows ──
  {
    sql: 'DELETE FROM message_ratings WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM notifications WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_shares WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM shared_session_comments WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM shared_session_presence WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  // ── Artifacts: artifact_versions FK→artifacts(id), so child rows
  //    must be removed via a subquery before the parent artifacts go. ──
  {
    sql: 'DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE session_id = ?)',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM artifacts WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  // ── Memory extraction audit log ──
  {
    sql: 'DELETE FROM memory_extraction_logs WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_file_diffs WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM permission_decision_logs WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_run_events WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_runtime_threads WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_snapshots WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_file_backups WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM permission_requests WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM question_requests WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_todos WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM task_parent_auto_resume_contexts WHERE child_session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM task_parent_auto_resume_contexts WHERE parent_session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM sessions WHERE id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
];
