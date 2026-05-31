/**
 * Write path + retention for `permission_decision_logs`.
 *
 * Every approve/reject/permanent decision (the `/permissions` route and the
 * shared-read route) appends a row here. The table is otherwise WRITE-ONLY —
 * nothing in production SELECTs it; the only removal is the session-delete
 * CASCADE. So on a long-lived install with many permission prompts it grows
 * without bound, eating disk for an audit trail no reader consumes. This
 * centralizes the insert and bounds the table with the same amortized
 * most-recent-N retention as `audit_logs` (§0.40 family): trim every
 * PRUNE_CHECK_INTERVAL inserts so the row count overshoots the cap by at most
 * one interval, and never let a prune failure break the decision write or the
 * main permission flow.
 */

import { sqliteRun } from '../infra/db.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';

const DEFAULT_PERMISSION_DECISION_LOG_MAX_ROWS = 20_000;
export const PERMISSION_DECISION_LOG_PRUNE_CHECK_INTERVAL = 200;

let retentionOverride: number | null = null;
let pruneCheckInterval = PERMISSION_DECISION_LOG_PRUNE_CHECK_INTERVAL;
let insertsSincePrune = 0;
let storeDisabled = false;

function resolveRetention(): number {
  if (retentionOverride !== null) {
    return retentionOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_PERMISSION_DECISION_LOG_MAX_ROWS'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_PERMISSION_DECISION_LOG_MAX_ROWS;
  }
  const parsed = Number(raw);
  // Non-positive / NaN disables retention, matching the sibling stores' env
  // dead-switch semantics.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function prune(limit: number): void {
  // Order by the autoincrement id: created_at is second-precision (same-second
  // rows tie), while id is monotonic and uniquely identifies "the most recent N".
  sqliteRun(
    `DELETE FROM permission_decision_logs
      WHERE id NOT IN (
        SELECT id FROM permission_decision_logs
         ORDER BY id DESC
         LIMIT ?
      )`,
    [limit],
  );
}

function maybePrune(): void {
  if (storeDisabled) {
    return;
  }
  const limit = resolveRetention();
  if (limit <= 0) {
    // Retention disabled: reset the counter so re-enabling later doesn't
    // trigger one giant catch-up prune.
    insertsSincePrune = 0;
    return;
  }
  insertsSincePrune += 1;
  if (insertsSincePrune < pruneCheckInterval) {
    return;
  }
  insertsSincePrune = 0;
  try {
    prune(limit);
  } catch (error) {
    // A prune failure must never break decision persistence or the permission
    // flow. On DB corruption disable the prune path entirely, consistent with
    // the sibling retention stores.
    if (isSqliteMalformedError(error)) {
      storeDisabled = true;
      return;
    }
    // Otherwise swallow — retention is best-effort.
  }
}

export interface PermissionDecisionLogInput {
  requestId: string;
  sessionId: string;
  toolName: string;
  scope: string;
  decision: string;
  workspaceRoot?: string | null;
}

/**
 * Append one permission-decision row, then opportunistically prune. The write
 * itself is best-effort-bounded: callers append for audit trail only and must
 * not have their decision flow broken by a logging failure.
 */
export function appendPermissionDecisionLog(input: PermissionDecisionLogInput): void {
  sqliteRun(
    `INSERT INTO permission_decision_logs
       (request_id, session_id, tool_name, scope, decision, workspace_root, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      input.requestId,
      input.sessionId,
      input.toolName,
      input.scope,
      input.decision,
      input.workspaceRoot ?? null,
    ],
  );
  maybePrune();
}

/** Test-only: override the global row cap (null clears the override). */
export function __setPermissionDecisionLogRetentionForTesting(
  limit: number | null,
  checkInterval?: number,
): void {
  retentionOverride = limit;
  pruneCheckInterval =
    typeof checkInterval === 'number' && checkInterval > 0
      ? Math.floor(checkInterval)
      : PERMISSION_DECISION_LOG_PRUNE_CHECK_INTERVAL;
  insertsSincePrune = 0;
  storeDisabled = false;
}
