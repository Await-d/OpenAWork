import { sqliteAll, sqliteRun } from '../infra/db.js';
import { approvalCoversScope } from './permission-approval-match.js';

export interface PermissionGrantRow {
  id: string;
  user_id: string;
  tool_name: string;
  scope: string;
}

export interface PermissionGrantRule {
  permission: string;
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
}

/**
 * Insert (or refresh) a user-scoped permanent grant.
 *
 * Idempotent on `(user_id, tool_name, scope)` so re-approving the same pattern
 * never creates duplicates.
 */
export function upsertPermissionGrant(input: {
  userId: string;
  toolName: string;
  scope: string;
}): void {
  if (!input.userId || !input.toolName || !input.scope) return;
  sqliteRun(
    `INSERT INTO permission_grants (id, user_id, tool_name, scope)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?)
     ON CONFLICT(user_id, tool_name, scope) DO UPDATE SET updated_at = datetime('now')`,
    [input.userId, input.toolName, input.scope],
  );
}

export function listPermissionGrantsForTool(
  userId: string,
  toolName: string,
): PermissionGrantRow[] {
  return sqliteAll<PermissionGrantRow>(
    `SELECT id, user_id, tool_name, scope
       FROM permission_grants
      WHERE user_id = ? AND tool_name = ?`,
    [userId, toolName],
  );
}

export function listPermissionGrantsForUser(userId: string): PermissionGrantRow[] {
  return sqliteAll<PermissionGrantRow>(
    `SELECT id, user_id, tool_name, scope
       FROM permission_grants
      WHERE user_id = ?`,
    [userId],
  );
}

/**
 * Return the first user-scoped grant whose stored pattern covers `scope`.
 *
 * Reuses the shared `approvalCoversScope` wildcard semantics so grants behave
 * exactly like `permanent` approval rows (exact / `*` / arity globs).
 */
export function findMatchingPermissionGrant(
  userId: string,
  toolName: string,
  scope: string,
): PermissionGrantRow | null {
  for (const grant of listPermissionGrantsForTool(userId, toolName)) {
    if (
      approvalCoversScope(
        { id: grant.id, decision: 'permanent', scope: grant.scope, always_json: null },
        scope,
      )
    ) {
      return grant;
    }
  }
  return null;
}

/**
 * Keep only the grants the user still wants.
 *
 * Any grant whose `(tool_name, scope)` is not present as an `allow` rule in
 * `rules` is deleted. Grants are never created here — permanent grants are only
 * created by the permission reply flow.
 */
export function reconcilePermissionGrants(userId: string, rules: PermissionGrantRule[]): void {
  const keep = new Set(
    rules
      .filter((rule) => rule.action === 'allow')
      .map((rule) => `${rule.permission}\u0000${rule.pattern}`),
  );
  for (const grant of listPermissionGrantsForUser(userId)) {
    if (!keep.has(`${grant.tool_name}\u0000${grant.scope}`)) {
      sqliteRun(`DELETE FROM permission_grants WHERE id = ?`, [grant.id]);
    }
  }
}
