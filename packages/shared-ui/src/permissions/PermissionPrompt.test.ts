/**
 * Locks down the decision-button layout in `PermissionPrompt` so a future
 * style refactor cannot accidentally swap the recommended action away from
 * "本会话允许" (opencode "always" semantics) or flip the destructive
 * "拒绝" away from the leftmost slot.
 *
 * We intentionally do not spin up jsdom here — shared-ui has no jsdom
 * setup and the visual / keyboard plumbing is exercised end-to-end in the
 * apps/web vitest jsdom config. This test focuses on the contract.
 */

import { describe, expect, it } from 'vitest';
import { getPermissionDecisionOptions } from './PermissionPrompt.js';

describe('getPermissionDecisionOptions', () => {
  it('orders buttons reject → once → session → permanent', () => {
    const options = getPermissionDecisionOptions('medium');
    expect(options.map((option) => option.decision)).toEqual([
      'reject',
      'once',
      'session',
      'permanent',
    ]);
  });

  it('flags 本会话允许 as the primary / recommended action', () => {
    const options = getPermissionDecisionOptions('medium');
    const sessionOption = options.find((option) => option.decision === 'session');
    expect(sessionOption?.tone).toBe('primary');
    expect(sessionOption?.label).toContain('本会话');
  });

  it('flags 拒绝 as danger so the destructive action reads as such', () => {
    const options = getPermissionDecisionOptions('high');
    const rejectOption = options.find((option) => option.decision === 'reject');
    expect(rejectOption?.tone).toBe('danger');
  });

  it('demotes 永久允许 to a subtle tone so it does not visually outrank session', () => {
    const options = getPermissionDecisionOptions('medium');
    const permanentOption = options.find((option) => option.decision === 'permanent');
    expect(permanentOption?.tone).toBe('subtle');
  });

  it('provides a non-empty tooltip hint for every action', () => {
    const options = getPermissionDecisionOptions('low');
    for (const option of options) {
      expect(option.hint.length).toBeGreaterThan(0);
    }
  });
});
