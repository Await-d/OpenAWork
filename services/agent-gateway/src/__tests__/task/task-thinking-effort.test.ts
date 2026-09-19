import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELEGATED_TASK_REASONING_EFFORT,
  resolveDelegatedTaskReasoningEffort,
} from '../../task/task-thinking-effort.js';

describe('resolveDelegatedTaskReasoningEffort', () => {
  it('maps every task category to its intensity tier', () => {
    expect(resolveDelegatedTaskReasoningEffort('quick')).toBe('minimal');
    expect(resolveDelegatedTaskReasoningEffort('unspecified-low')).toBe('low');
    expect(resolveDelegatedTaskReasoningEffort('writing')).toBe('medium');
    expect(resolveDelegatedTaskReasoningEffort('visual-engineering')).toBe('medium');
    expect(resolveDelegatedTaskReasoningEffort('deep')).toBe('high');
    expect(resolveDelegatedTaskReasoningEffort('unspecified-high')).toBe('high');
    expect(resolveDelegatedTaskReasoningEffort('artistry')).toBe('high');
    expect(resolveDelegatedTaskReasoningEffort('ultrabrain')).toBe('xhigh');
  });

  it('falls back to a valid default for missing or unknown categories', () => {
    expect(resolveDelegatedTaskReasoningEffort(undefined)).toBe(
      DEFAULT_DELEGATED_TASK_REASONING_EFFORT,
    );
    expect(resolveDelegatedTaskReasoningEffort('')).toBe(DEFAULT_DELEGATED_TASK_REASONING_EFFORT);
    expect(resolveDelegatedTaskReasoningEffort('not-a-category')).toBe(
      DEFAULT_DELEGATED_TASK_REASONING_EFFORT,
    );
    expect(resolveDelegatedTaskReasoningEffort('toString')).toBe(
      DEFAULT_DELEGATED_TASK_REASONING_EFFORT,
    );
  });

  it('normalizes casing and surrounding whitespace', () => {
    expect(resolveDelegatedTaskReasoningEffort('  ULTRABRAIN ')).toBe('xhigh');
    expect(resolveDelegatedTaskReasoningEffort('Deep')).toBe('high');
  });
});
