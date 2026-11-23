/**
 * Write path + retention for `permission_decision_logs`.
 *
 * Historically only the human approve/reject/permanent decision (the
 * `/permissions` route and the shared-read route) appended a row here, so every
 * *automatic* decision — the deny-first ladder's auto-allow / auto-deny /
 * no-approval branches (yolo, auto-edit, background team, channel policy, saved
 * approvals, workspace rules) and the new MCP pre-emptive denial — left no audit
 * trail at all. This module now owns BOTH write paths:
 *
 *   - `appendPermissionDecisionLog` — the human-decision write, unchanged shape
 *     (kept for the routes; its failure is meaningful there and must bubble so
 *     the caller can roll back the approval).
 *   - `recordLadderPermissionDecision` — the single accounting point used by
 *     `permission-ladder.ts` for every automatic exit. This one is
 *     BEST-EFFORT: a write failure must never break the permission flow, so any
 *     insert error is swallowed (the retention path already self-disables on DB
 *     corruption).
 *
 * The table is otherwise WRITE-ONLY; the only removal is the session-delete
 * CASCADE and the amortized most-recent-N retention (§0.40 audit_logs family):
 * trim every PRUNE_CHECK_INTERVAL inserts so the row count overshoots the cap by
 * at most one interval, and never let a prune failure break the decision write or
 * the main permission flow.
 */

import { sqliteAll, sqliteRun } from '../infra/db.js';
import { isSqliteMalformedError } from '../infra/sqlite-error-utils.js';
import { deleteRowsBeyondMostRecent } from '../infra/sqlite-retention.js';

const DEFAULT_PERMISSION_DECISION_LOG_MAX_ROWS = 20_000;
export const PERMISSION_DECISION_LOG_PRUNE_CHECK_INTERVAL = 200;

/**
 * Enumerable decision reasons. Every row — human or automatic — carries one of
 * these, so the audit trail can be grouped without parsing free-text.
 *
 * Naming contract: an automatic allow must never masquerade as user consent.
 * `USER_*` reasons are reserved for the human approval channel; the automatic
 * tiers below the line have their own distinct reasons.
 */
export const PERMISSION_DECISION_REASONS = {
  /** Human approved / rejected via the `/permissions` route or shared-read route. */
  USER_APPROVED: 'user_approved',
  USER_REJECTED: 'user_rejected',
  /** Rule engine (default rules + `.openawork.permissions.json`) verdict. */
  RULE_DENIED: 'rule_denied',
  RULE_ALLOWED: 'rule_allowed',
  /**
   * The tool's permission deriver returned no request context, so there is no
   * approval step to run (e.g. read-only list actions, or a tool that is
   * proposal-only and gated elsewhere). Distinct from `rule_allowed`: the rule
   * engine may well have said `ask`; the auto-allow comes from the deriver, NOT
   * from a rule. Recording `rule_allowed` here would misstate the audit.
   */
  DERIVER_NOT_REQUIRED: 'deriver_not_required',
  /** MCP pre-emptive denial surfaced while building the permission context. */
  MCP_DENIED: 'mcp_denied',
  /** Permission mode shortcut: yolo passes everything the rule engine did not deny. */
  MODE_YOLO: 'mode_yolo',
  /** Permission mode shortcut: auto-edit passes edit/write categories only. */
  MODE_AUTO_EDIT: 'mode_auto_edit',
  /** Background (unattended) team member session auto-approval. */
  TEAM_BACKGROUND: 'team_background',
  /** Unattended delegated (task child) session auto-approval. */
  DELEGATION_UNATTENDED: 'delegation_unattended',
  /** Reception (read-only) session auto-approval. */
  RECEPTION_READONLY: 'reception_readonly',
  /** Channel policy auto-approval (per-tool visibility metadata). */
  CHANNEL_POLICY: 'channel_policy',
  /** Workspace permanent rule (`.openawork` allow). */
  WORKSPACE_RULE: 'workspace_rule',
  /** Durable user-scoped or session-scoped saved approval. */
  SAVED_APPROVAL: 'saved_approval',
  /** No automatic tier matched → a human approval request is now pending. */
  AWAITING_USER: 'awaiting_user',
  /** Plugin `permission.evaluate` denied an otherwise-allowed/ask call. */
  PLUGIN_DENIED: 'plugin_denied',
  /** Channel session has no human approval channel → hard deny. */
  CHANNEL_NO_APPROVAL: 'channel_no_approval',
} as const;

export type PermissionDecisionReason =
  (typeof PERMISSION_DECISION_REASONS)[keyof typeof PERMISSION_DECISION_REASONS];

/** Automatic decisions recorded by the ladder (a distinct row from a human reply). */
export interface LadderPermissionDecisionInput {
  sessionId: string;
  toolName: string;
  scope: string;
  /**
   * Outcome vocabulary. `not_needed` = auto-allowed without a saved approval;
   * `approved` = passed on a saved/persisted approval; `denied` = blocked;
   * `pending` = waiting on a human.
   */
  outcome: 'not_needed' | 'approved' | 'denied' | 'pending';
  reason: PermissionDecisionReason;
  /** Existing pending request id when one exists; otherwise a synthesized id. */
  requestId?: string | null;
  workspaceRoot?: string | null;
}

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
  // 走主键边界删除，避免 `id NOT IN (...)` 全表物化。
  deleteRowsBeyondMostRecent({ table: 'permission_decision_logs', idColumn: 'id', limit });
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
      console.warn('[permission-decision-log] retention disabled after DB corruption', {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return;
    }
    // Otherwise swallow after logging — retention is best-effort only.
    logPruneFailure(error);
  }
}

export interface PermissionDecisionLogInput {
  requestId: string;
  sessionId: string;
  toolName: string;
  scope: string;
  decision: string;
  workspaceRoot?: string | null;
  /** Enumerable reason; omitted for legacy human-decision call sites. */
  reason?: string | null;
}

/**
 * Append one permission-decision row, then opportunistically prune. The write
 * itself is best-effort-bounded: callers append for audit trail only and must
 * not have their decision flow broken by a logging failure.
 */
export function appendPermissionDecisionLog(input: PermissionDecisionLogInput): void {
  sqliteRun(
    `INSERT INTO permission_decision_logs
       (request_id, session_id, tool_name, scope, decision, reason, workspace_root, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      input.requestId,
      input.sessionId,
      input.toolName,
      input.scope,
      input.decision,
      input.reason ?? null,
      input.workspaceRoot ?? null,
    ],
  );
  maybePrune();
}

/**
 * Single accounting point for the deny-first ladder's automatic exits
 * (auto-allow / auto-deny / no-approval branches). Unlike the human-decision
 * write, this is BEST-EFFORT: a logging failure must never change the permission
 * outcome, so every error is swallowed here and never propagated to
 * `ensurePermissionForTool`.
 */
export function recordLadderPermissionDecision(input: LadderPermissionDecisionInput): void {
  try {
    appendPermissionDecisionLog({
      requestId: input.requestId ?? `ladder:${input.reason}`,
      sessionId: input.sessionId,
      toolName: input.toolName,
      scope: input.scope,
      decision: input.outcome,
      reason: input.reason,
      workspaceRoot: input.workspaceRoot ?? null,
    });
  } catch (error) {
    // Audit is advisory — never break the permission decision on a write error.
    // Structured log so a persistent audit outage is observable rather than
    // silently swallowed; the decision outcome is still returned unchanged.
    logPermissionDecisionWriteFailure(input, error);
  }
}

/**
 * Best-effort structured warning for a failed ladder audit write.
 *
 * Kept separate from the write path so the catch block has a real body (empty
 * catch blocks are forbidden) and the log fields stay structured / parseable.
 * Only ever passed simple, already-extracted values, so it cannot itself throw
 * in a way that would break the permission flow.
 */
function logPermissionDecisionWriteFailure(
  input: LadderPermissionDecisionInput,
  error: unknown,
): void {
  console.warn('[permission-decision-log] failed to record ladder decision', {
    sessionId: input.sessionId,
    toolName: input.toolName,
    outcome: input.outcome,
    reason: input.reason,
    errorType: error instanceof Error ? error.name : typeof error,
  });
}

/**
 * Best-effort structured warning for a failed retention prune.
 *
 * Retention is advisory: a prune failure must never break the decision write or
 * the permission flow, so the caller swallows after logging here. Only simple
 * pre-extracted values are logged, so this cannot throw.
 */
function logPruneFailure(error: unknown): void {
  console.warn('[permission-decision-log] retention prune failed', {
    errorType: error instanceof Error ? error.name : typeof error,
  });
}

/** Raw row shape of `permission_decision_logs` (snake_case columns). */
export interface PermissionDecisionLogRow {
  id: number;
  request_id: string;
  session_id: string;
  tool_name: string;
  scope: string;
  decision: string;
  /** Nullable: rows written before `reason` was added carry NULL here. */
  reason: string | null;
  workspace_root: string | null;
  created_at: string;
}

export interface ListPermissionDecisionLogsInput {
  sessionId: string;
  /** Maximum rows to return. Callers must clamp (see the route's hard cap). */
  limit: number;
  /**
   * Keyset cursor: when provided only rows with `id < beforeId` are returned.
   * Pagination keys off the autoincrement `id` because `created_at` is
   * second-precision TEXT and ties within the same second.
   */
  beforeId?: number;
}

/**
 * READ-ONLY list of a session's permission-decision audit rows, newest first.
 *
 * Ordering is `id DESC` (never `created_at DESC`) so same-second rows still have
 * a stable, non-overlapping page boundary. This function is strictly read-only:
 * it must NOT trigger retention/pruning or any other write — repeated reads with
 * the same cursor must be idempotent.
 */
export function listPermissionDecisionLogs(
  input: ListPermissionDecisionLogsInput,
): PermissionDecisionLogRow[] {
  const limit = Math.max(0, Math.floor(input.limit));
  if (limit === 0) {
    return [];
  }
  const beforeId = input.beforeId;
  if (typeof beforeId === 'number' && Number.isFinite(beforeId)) {
    return sqliteAll<PermissionDecisionLogRow>(
      `SELECT id, request_id, session_id, tool_name, scope, decision, reason, workspace_root, created_at
       FROM permission_decision_logs
       WHERE session_id = ? AND id < ?
       ORDER BY id DESC
       LIMIT ?`,
      [input.sessionId, beforeId, limit],
    );
  }
  return sqliteAll<PermissionDecisionLogRow>(
    `SELECT id, request_id, session_id, tool_name, scope, decision, reason, workspace_root, created_at
     FROM permission_decision_logs
     WHERE session_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [input.sessionId, limit],
  );
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
