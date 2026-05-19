/**
 * Regression coverage for the opencode-aligned approval matcher.
 *
 * Before this fix, `findApprovedPermission` only matched on exact `scope`
 * or `'*'`. The session-level UI label "本会话允许" therefore stored
 * scope = the literal command (e.g. `ls -la`) and any subsequent variant
 * (`ls -la /tmp`, `ls foo`) re-prompted the user. opencode's
 * `permission/index.ts` instead pushes every `always` pattern computed at
 * ask time (e.g. `ls *` from `BashArity.prefix`) into the approved
 * ruleset, so identical-prefix bash commands stop re-prompting.
 *
 * These tests pin down the new `approvalCoversScope` semantics:
 *   - exact match always wins
 *   - `'*'` is the wildcard escape hatch
 *   - `once` decisions stay strictly exact (single-shot, consumed after use)
 *   - `session`/`permanent` decisions also match via the stored scope
 *     treated as a glob and via every pattern in `always_json`
 */

import { describe, expect, it } from 'vitest';
import {
  approvalCoversScope,
  type PermissionApprovalCandidateRow,
} from '../../permission/permission-approval-match.js';

function row(input: Partial<PermissionApprovalCandidateRow>): PermissionApprovalCandidateRow {
  return {
    id: input.id ?? 'pr-1',
    decision: input.decision ?? 'session',
    scope: input.scope ?? '*',
    always_json: input.always_json ?? null,
  };
}

describe('approvalCoversScope', () => {
  it('matches exact scope regardless of decision', () => {
    expect(approvalCoversScope(row({ decision: 'once', scope: 'ls -la' }), 'ls -la')).toBe(true);
    expect(approvalCoversScope(row({ decision: 'session', scope: 'ls -la' }), 'ls -la')).toBe(true);
    expect(approvalCoversScope(row({ decision: 'permanent', scope: 'ls -la' }), 'ls -la')).toBe(
      true,
    );
  });

  it('treats stored scope `*` as the wildcard escape hatch', () => {
    expect(approvalCoversScope(row({ decision: 'session', scope: '*' }), 'anything')).toBe(true);
    expect(approvalCoversScope(row({ decision: 'permanent', scope: '*' }), 'rm -rf /tmp')).toBe(
      true,
    );
  });

  it('uses the stored scope as a glob pattern for session/permanent', () => {
    // synthetic rows inserted on session reply store `ls *` as the scope
    expect(approvalCoversScope(row({ decision: 'session', scope: 'ls *' }), 'ls -la')).toBe(true);
    expect(approvalCoversScope(row({ decision: 'session', scope: 'ls *' }), 'ls -la /tmp')).toBe(
      true,
    );
    expect(approvalCoversScope(row({ decision: 'permanent', scope: 'git *' }), 'git status')).toBe(
      true,
    );
  });

  it('does NOT broaden once decisions via stored-scope globbing', () => {
    // once is strictly exact — opencode's "once" reply does not push
    // patterns into the approved ruleset, and OpenAWork consumes the row
    // after a single use, so the next variant must re-prompt.
    expect(approvalCoversScope(row({ decision: 'once', scope: 'ls *' }), 'ls -la')).toBe(false);
    expect(
      approvalCoversScope(
        row({ decision: 'once', scope: 'ls -la', always_json: '["ls *"]' }),
        'ls -la /tmp',
      ),
    ).toBe(false);
  });

  it('also broadens via patterns in always_json for session/permanent', () => {
    // legacy rows persisted before synthetic-row backfill: scope is the
    // literal command but always_json carries the arity prefix pattern.
    const legacy = row({
      decision: 'session',
      scope: 'ls -la',
      always_json: '["ls *"]',
    });
    expect(approvalCoversScope(legacy, 'ls -la')).toBe(true);
    expect(approvalCoversScope(legacy, 'ls /tmp')).toBe(true);
    expect(approvalCoversScope(legacy, 'cat foo')).toBe(false);
  });

  it('rejects mismatched commands', () => {
    expect(approvalCoversScope(row({ decision: 'session', scope: 'ls *' }), 'rm -rf foo')).toBe(
      false,
    );
    expect(
      approvalCoversScope(
        row({ decision: 'permanent', scope: 'git *', always_json: '["git *"]' }),
        'docker ps',
      ),
    ).toBe(false);
  });

  it('does NOT silently widen on null/malformed always_json', () => {
    // Legacy rows persisted before the always_json column was added have
    // null. Earlier the parser returned ['*'] which made any stored row
    // auto-approve every command in the category — a security cliff
    // when the corruption is unintentional. The matcher now only widens
    // via real array contents.
    const legacyNull = row({ decision: 'session', scope: 'ls -la', always_json: null });
    expect(approvalCoversScope(legacyNull, 'ls -la')).toBe(true); // exact match still works
    expect(approvalCoversScope(legacyNull, 'cat foo')).toBe(false); // no silent broadening

    const corrupted = row({ decision: 'session', scope: 'ls -la', always_json: '{' });
    expect(approvalCoversScope(corrupted, 'cat foo')).toBe(false);
  });
});
