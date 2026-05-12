/**
 * Approval-row scope matching for the permission gate.
 *
 * Mirrors opencode's `permission/index.ts` evaluate + always push semantics:
 *
 *   - Exact scope match always wins (covers the original
 *     `permission_requests` row inserted at ask time).
 *   - `'*'` stored scope is the wildcard escape hatch.
 *   - For `once` decisions we deliberately stop there. Opencode's "once"
 *     reply only satisfies the in-flight deferred without pushing patterns
 *     into the approved ruleset, and OpenAWork's `consumeOncePermission`
 *     marks the row consumed after a single use, so broad pattern matching
 *     would over-approve.
 *   - For `session` and `permanent` decisions we additionally treat the
 *     stored scope itself as a glob pattern (synthetic rows inserted on
 *     reply already store `ls *` etc. as scope) and walk through each
 *     pattern recorded in `always_json` (covers original rows that were
 *     persisted before synthetic-row backfill landed, so users on existing
 *     databases also stop seeing the same arity-prefix command re-prompt).
 */
import { wildcardMatch } from '@openAwork/agent-core';
import { parsePermissionAlwaysJson, type PermissionDecision } from './permission-contract.js';

export interface PermissionApprovalCandidateRow {
  id: string;
  decision: PermissionDecision;
  scope: string;
  always_json: string | null;
}

export function approvalCoversScope(row: PermissionApprovalCandidateRow, scope: string): boolean {
  if (row.scope === scope || row.scope === '*') return true;
  if (row.decision === 'once') return false;
  if (wildcardMatch(scope, row.scope)) return true;
  for (const pattern of parsePermissionAlwaysJson(row.always_json)) {
    if (wildcardMatch(scope, pattern)) return true;
  }
  return false;
}
