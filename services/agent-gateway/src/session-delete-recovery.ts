import { db, sqliteRun } from './db.js';
const SESSION_DELETE_RECOVERY_STATEMENTS: ReadonlyArray<{
  params: (input: { sessionId: string; userId: string }) => [string] | [string, string];
  sql: string;
}> = [
  {
    sql: 'UPDATE audit_logs SET session_id = NULL WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_messages WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
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

export function deleteSessionWithMalformedRecovery(input: {
  sessionId: string;
  userId: string;
}): void {
  let transactionStarted = false;

  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN');
    transactionStarted = true;

    for (const statement of SESSION_DELETE_RECOVERY_STATEMENTS) {
      sqliteRun(statement.sql, statement.params(input));
    }

    db.exec('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      db.exec('ROLLBACK');
    }

    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}
