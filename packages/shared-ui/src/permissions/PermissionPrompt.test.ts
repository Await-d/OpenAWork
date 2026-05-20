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
import { categorizeAlwaysPatterns, getPermissionDecisionOptions } from './PermissionPrompt.js';

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


describe('categorizeAlwaysPatterns', () => {
  it('returns only Full command when always is undefined', () => {
    const levels = categorizeAlwaysPatterns('ls -la /tmp', 'ls -la /tmp', undefined);
    expect(levels).toEqual([{ label: 'Full command', pattern: 'ls -la /tmp', category: 'full' }]);
  });

  it('returns only Full command when always is empty', () => {
    const levels = categorizeAlwaysPatterns('ls -la /tmp', 'ls -la /tmp', []);
    expect(levels).toEqual([{ label: 'Full command', pattern: 'ls -la /tmp', category: 'full' }]);
  });

  it('returns Full command + Base when always has one unique pattern', () => {
    const levels = categorizeAlwaysPatterns('ls -la /tmp', 'ls -la /tmp', ['ls *']);
    expect(levels).toEqual([
      { label: 'Full command', pattern: 'ls -la /tmp', category: 'full' },
      { label: 'Base', pattern: 'ls *', category: 'base' },
    ]);
  });

  it('returns Full command + Partial + Base when always has two unique patterns', () => {
    const levels = categorizeAlwaysPatterns(
      'OBSIDIAN_API_KEY="abc" OBSIDIAN_HOST="127.0.0.1" timeout 5 uvx mcp-obsidian --help',
      'OBSIDIAN_API_KEY="abc" OBSIDIAN_HOST="127.0.0.1" timeout 5 uvx mcp-obsidian --help',
      ['OBSIDIAN_API_KEY="abc" OBSIDIAN_HOST="127.0.0.1" *', 'OBSIDIAN_API_KEY="abc" *'],
    );
    expect(levels).toEqual([
      {
        label: 'Full command',
        pattern: 'OBSIDIAN_API_KEY="abc" OBSIDIAN_HOST="127.0.0.1" timeout 5 uvx mcp-obsidian --help',
        category: 'full',
      },
      {
        label: 'Partial',
        pattern: 'OBSIDIAN_API_KEY="abc" OBSIDIAN_HOST="127.0.0.1" *',
        category: 'partial',
      },
      { label: 'Base', pattern: 'OBSIDIAN_API_KEY="abc" *', category: 'base' },
    ]);
  });

  it('deduplicates patterns that match the full command or scope', () => {
    const levels = categorizeAlwaysPatterns('git status', 'git status', [
      'git status',
      'git *',
    ]);
    expect(levels).toEqual([
      { label: 'Full command', pattern: 'git status', category: 'full' },
      { label: 'Base', pattern: 'git *', category: 'base' },
    ]);
  });

  it('uses previewAction over scope for the full command', () => {
    const levels = categorizeAlwaysPatterns('执行命令: ls -la', 'ls -la', ['ls *']);
    expect(levels[0]!.pattern).toBe('执行命令: ls -la');
  });

  it('falls back to scope when previewAction is undefined', () => {
    const levels = categorizeAlwaysPatterns(undefined, 'ls -la', ['ls *']);
    expect(levels[0]!.pattern).toBe('ls -la');
  });
});
