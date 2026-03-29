import { describe, expect, it } from 'vitest';
import { getPermissionDecisionOptions } from './PermissionPrompt.js';

describe('PermissionPrompt decision options', () => {
  it('shows the four requested options even for high-risk prompts', () => {
    expect(getPermissionDecisionOptions('high').map((option) => option.label)).toEqual([
      '同意本次',
      '本次会话同意',
      '永久同意',
      '拒绝',
    ]);
  });

  it('keeps the same four-option order for medium risk prompts', () => {
    expect(getPermissionDecisionOptions('medium').map((option) => option.decision)).toEqual([
      'once',
      'session',
      'permanent',
      'reject',
    ]);
  });
});
