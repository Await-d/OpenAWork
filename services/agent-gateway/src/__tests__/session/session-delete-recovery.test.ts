/**
 * Regression coverage for `deleteSessionWithMalformedRecovery`.
 *
 * The function runs with `PRAGMA foreign_keys=OFF`, so the normal
 * CASCADE chain (`sessions` → `message_v2` → `part_v2`, etc.) does
 * not fire. Every session-scoped table must therefore be cleaned by
 * an explicit statement in `SESSION_DELETE_RECOVERY_STATEMENTS` —
 * if a new table is added to the schema and the recovery list is
 * forgotten, the v1-malformed fallback path leaves orphaned rows.
 *
 * These checks freeze the contract by name; they intentionally do
 * NOT assert exact ordering beyond the parent/child rule we need for
 * FK-off correctness (`part_v2` must come before `message_v2`).
 */

import { describe, expect, it } from 'vitest';
import { SESSION_DELETE_RECOVERY_STATEMENTS } from '../../session/session-delete-recovery-statements.js';

const REQUIRED_TABLE_HITS: ReadonlyArray<{
  table: string;
  /** Optional: assert this table is hit before another (FK-off ordering). */
  before?: string;
}> = [
  // V1 surfaces.
  { table: 'session_messages' },
  { table: 'session_file_diffs' },
  { table: 'permission_decision_logs' },
  { table: 'session_run_events' },
  { table: 'session_runtime_threads' },
  { table: 'session_snapshots' },
  { table: 'session_file_backups' },
  { table: 'permission_requests' },
  { table: 'question_requests' },
  { table: 'session_todos' },
  { table: 'task_parent_auto_resume_contexts' },
  { table: 'sessions' },
  // V2 event-sourced storage — these were missing prior to the
  // single-write-path audit and are the core of this regression.
  { table: 'part_v2', before: 'message_v2' },
  { table: 'message_v2' },
  { table: 'session_entry' },
  // Search index mirror — no FK so cascade never helped here either.
  { table: 'session_messages_fts' },
  // Newly added FK-bearing tables that the original recovery list
  // forgot. Each one references `sessions(id) ON DELETE CASCADE`
  // (or, for request_workflow_logs, ON DELETE SET NULL — handled via
  // a separate UPDATE assertion below).
  { table: 'message_ratings' },
  { table: 'notifications' },
  { table: 'session_shares' },
  { table: 'shared_session_comments' },
  { table: 'shared_session_presence' },
  { table: 'memory_extraction_logs' },
  // Artifact versions must precede artifacts because their FK is to
  // artifacts(id), not directly to sessions(id) — under FK-off the
  // cascade chain breaks at this hop unless we explicitly clear the
  // child rows first.
  { table: 'artifact_versions', before: 'artifacts' },
  { table: 'artifacts' },
];

function indexOfStatementForTable(table: string): number {
  // Match the table name only when it is the leading DELETE-target /
  // UPDATE-target. A naive `\\b<table>\\b` regex would also hit
  // sub-queries (e.g. the artifact_versions purge has
  // `... IN (SELECT id FROM artifacts WHERE ...)`), which collapsed
  // the parent/child ordering check.
  const re = new RegExp(`^(DELETE\\s+FROM|UPDATE)\\s+${table}\\b`, 'i');
  return SESSION_DELETE_RECOVERY_STATEMENTS.findIndex((stmt) => re.test(stmt.sql));
}

describe('SESSION_DELETE_RECOVERY_STATEMENTS', () => {
  it('targets every session-scoped table the schema currently owns', () => {
    for (const { table } of REQUIRED_TABLE_HITS) {
      const idx = indexOfStatementForTable(table);
      expect(idx, `missing statement for ${table}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('purges child tables before their parents (FK-off correctness)', () => {
    for (const { table, before } of REQUIRED_TABLE_HITS) {
      if (!before) continue;
      const childIdx = indexOfStatementForTable(table);
      const parentIdx = indexOfStatementForTable(before);
      expect(childIdx, `expected ${table} delete to precede ${before} delete`).toBeLessThan(
        parentIdx,
      );
    }
  });

  it('deletes sessions last so other statements still see the session row', () => {
    const sessionsIdx = indexOfStatementForTable('sessions');
    expect(sessionsIdx).toBe(SESSION_DELETE_RECOVERY_STATEMENTS.length - 1);
  });

  it('does not delete from audit_logs (history must survive session removal)', () => {
    const auditStmt = SESSION_DELETE_RECOVERY_STATEMENTS.find((stmt) =>
      stmt.sql.includes('audit_logs'),
    );
    expect(auditStmt?.sql).toMatch(/UPDATE\s+audit_logs/i);
    expect(auditStmt?.sql).toMatch(/SET\s+session_id\s*=\s*NULL/i);
  });

  it('NULLs out request_workflow_logs.session_id instead of deleting (ON DELETE SET NULL)', () => {
    const stmt = SESSION_DELETE_RECOVERY_STATEMENTS.find((s) =>
      s.sql.includes('request_workflow_logs'),
    );
    expect(stmt?.sql).toMatch(/UPDATE\s+request_workflow_logs/i);
    expect(stmt?.sql).toMatch(/SET\s+session_id\s*=\s*NULL/i);
  });
});
