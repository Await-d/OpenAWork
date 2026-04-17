import { describe, expect, it } from 'vitest';
import {
  buildLocalReasoningBlockKey,
  getLocalReasoningLabel,
} from './assistant-reasoning-block.helpers.js';

describe('assistant-reasoning-block.helpers', () => {
  it('uses CLI-aligned local label copy', () => {
    expect(getLocalReasoningLabel({ index: 0, streaming: true, total: 1 })).toBe('Thinking:');
    expect(getLocalReasoningLabel({ index: 0, streaming: false, total: 1 })).toBe('Thinking:');
    expect(getLocalReasoningLabel({ index: 1, streaming: true, total: 2 })).toBe('Thinking: 2');
    expect(getLocalReasoningLabel({ index: 1, streaming: false, total: 2 })).toBe('Thinking: 2');
  });

  it('builds a stable key from the first non-empty line', () => {
    expect(buildLocalReasoningBlockKey('hello\nworld', 0)).toMatch(/^hello-{1}\d+$/);
    expect(buildLocalReasoningBlockKey('  \n  leading whitespace', 3)).toMatch(
      /^leading whitespace/,
    );
    expect(buildLocalReasoningBlockKey('', 0)).toBe('reasoning-0');
  });
});
