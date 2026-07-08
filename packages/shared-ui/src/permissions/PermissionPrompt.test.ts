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
  it('returns three Chinese scope levels when always is undefined', () => {
    const levels = categorizeAlwaysPatterns('ls -la /tmp', 'ls -la /tmp', undefined);
    expect(levels).toEqual([
      {
        label: '仅本次指令',
        description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
        pattern: 'ls -la /tmp',
        category: 'full',
      },
      {
        label: '同子命令',
        description: '当前没有可用的同子命令规则，选择后仍只覆盖当前命令。',
        pattern: 'ls -la /tmp',
        category: 'partial',
      },
      {
        label: '同类指令',
        description: '当前没有可用的同类指令规则，选择后仍只覆盖当前命令。',
        pattern: 'ls -la /tmp',
        category: 'base',
      },
    ]);
  });

  it('returns three Chinese scope levels when always is empty', () => {
    const levels = categorizeAlwaysPatterns('ls -la /tmp', 'ls -la /tmp', []);
    expect(levels).toEqual([
      {
        label: '仅本次指令',
        description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
        pattern: 'ls -la /tmp',
        category: 'full',
      },
      {
        label: '同子命令',
        description: '当前没有可用的同子命令规则，选择后仍只覆盖当前命令。',
        pattern: 'ls -la /tmp',
        category: 'partial',
      },
      {
        label: '同类指令',
        description: '当前没有可用的同类指令规则，选择后仍只覆盖当前命令。',
        pattern: 'ls -la /tmp',
        category: 'base',
      },
    ]);
  });

  it('assigns single unique pattern to 同子命令, falls back to scope for 同类指令', () => {
    const levels = categorizeAlwaysPatterns('ls -la /tmp', 'ls -la /tmp', ['ls *']);
    expect(levels).toEqual([
      {
        label: '仅本次指令',
        description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
        pattern: 'ls -la /tmp',
        category: 'full',
      },
      {
        label: '同子命令',
        description: '覆盖网关提供的相同子命令模式。',
        pattern: 'ls *',
        category: 'partial',
      },
      {
        label: '同类指令',
        description: '当前没有可用的同类指令规则，选择后仍只覆盖当前命令。',
        pattern: 'ls -la /tmp',
        category: 'base',
      },
    ]);
  });

  it('returns three Chinese scope levels when always has two unique patterns', () => {
    const levels = categorizeAlwaysPatterns(
      'OBSIDIAN_API_KEY="abc" OBSIDIAN_HOST="127.0.0.1" timeout 5 uvx mcp-obsidian --help',
      'OBSIDIAN_API_KEY="abc" OBSIDIAN_HOST="127.0.0.1" timeout 5 uvx mcp-obsidian --help',
      ['OBSIDIAN_API_KEY="abc" OBSIDIAN_HOST="127.0.0.1" *', 'OBSIDIAN_API_KEY="abc" *'],
    );
    expect(levels).toEqual([
      {
        label: '仅本次指令',
        description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
        pattern:
          'OBSIDIAN_API_KEY="abc" OBSIDIAN_HOST="127.0.0.1" timeout 5 uvx mcp-obsidian --help',
        category: 'full',
      },
      {
        label: '同子命令',
        description: '覆盖网关提供的相同子命令模式。',
        pattern: 'OBSIDIAN_API_KEY="abc" OBSIDIAN_HOST="127.0.0.1" *',
        category: 'partial',
      },
      {
        label: '同类指令',
        description: '覆盖网关提供的同类指令模式。',
        pattern: 'OBSIDIAN_API_KEY="abc" *',
        category: 'base',
      },
    ]);
  });

  it('deduplicates patterns that match the full command or scope without removing choices', () => {
    const levels = categorizeAlwaysPatterns('git status', 'git status', ['git status', 'git *']);
    expect(levels).toEqual([
      {
        label: '仅本次指令',
        description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
        pattern: 'git status',
        category: 'full',
      },
      {
        label: '同子命令',
        description: '覆盖网关提供的相同子命令模式。',
        pattern: 'git *',
        category: 'partial',
      },
      {
        label: '同类指令',
        description: '当前没有可用的同类指令规则，选择后仍只覆盖当前命令。',
        pattern: 'git status',
        category: 'base',
      },
    ]);
  });

  it('falls back to scope for duplicate derived patterns so all categories remain visible', () => {
    const levels = categorizeAlwaysPatterns('git status', 'git status', ['git *', 'git *']);
    expect(levels).toEqual([
      {
        label: '仅本次指令',
        description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
        pattern: 'git status',
        category: 'full',
      },
      {
        label: '同子命令',
        description: '覆盖网关提供的相同子命令模式。',
        pattern: 'git *',
        category: 'partial',
      },
      {
        label: '同类指令',
        description: '当前没有可用的同类指令规则，选择后仍只覆盖当前命令。',
        pattern: 'git status',
        category: 'base',
      },
    ]);
  });

  it('explains duplicate full-command patterns without hiding any level', () => {
    const levels = categorizeAlwaysPatterns('pwd', 'pwd', ['pwd', 'pwd']);
    expect(levels).toHaveLength(3);
    expect(levels.map((level) => level.label)).toEqual(['仅本次指令', '同子命令', '同类指令']);
    expect(levels.map((level) => level.pattern)).toEqual(['pwd', 'pwd', 'pwd']);
    expect(levels[1]!.description).toContain('当前没有可用的同子命令规则');
    expect(levels[2]!.description).toContain('当前没有可用的同类指令规则');
  });

  it('returns exactly three scope levels for every approval prompt', () => {
    expect(categorizeAlwaysPatterns(undefined, 'pwd', undefined)).toHaveLength(3);
    expect(categorizeAlwaysPatterns(undefined, 'pwd', [])).toHaveLength(3);
    expect(categorizeAlwaysPatterns(undefined, 'pwd', ['pwd'])).toHaveLength(3);
    expect(categorizeAlwaysPatterns(undefined, 'pwd', ['pwd', 'pwd'])).toHaveLength(3);
    expect(categorizeAlwaysPatterns(undefined, 'pwd', ['p*'])).toHaveLength(3);
    expect(categorizeAlwaysPatterns(undefined, 'pwd', ['p*', '*'])).toHaveLength(3);
  });

  it('uses Chinese labels for every approval prompt', () => {
    const assertLabels = (always: string[] | undefined) => {
      const levels = categorizeAlwaysPatterns(undefined, 'pwd', always);
      expect(levels.map((level) => level.label)).toEqual(['仅本次指令', '同子命令', '同类指令']);
    };

    assertLabels(undefined);
    assertLabels([]);
    assertLabels(['pwd']);
    assertLabels(['pwd', 'pwd']);
    assertLabels(['p*']);
    assertLabels(['p*', '*']);
  });

  it('uses scope rather than previewAction for the full command pattern', () => {
    const levels = categorizeAlwaysPatterns('执行命令: ls -la', 'ls -la', ['ls *']);
    expect(levels[0]!.pattern).toBe('ls -la');
  });

  it('falls back to scope when previewAction is undefined', () => {
    const levels = categorizeAlwaysPatterns(undefined, 'ls -la', ['ls *']);
    expect(levels[0]!.pattern).toBe('ls -la');
  });

  it('从 bash previewAction 推导 curl 主命令前缀，避免三档全等', () => {
    const levels = categorizeAlwaysPatterns(
      '执行命令: curl -s "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans" | head -20',
      'curl -s "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans" | head -20',
      undefined,
    );
    expect(levels).toEqual([
      {
        label: '仅本次指令',
        description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
        pattern: 'curl -s "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans" | head -20',
        category: 'full',
      },
      {
        label: '同子命令',
        description: '覆盖网关提供的相同子命令模式。',
        pattern: 'curl -s *',
        category: 'partial',
      },
      {
        label: '同类指令',
        description: '覆盖网关提供的同类指令模式。',
        pattern: 'curl *',
        category: 'base',
      },
    ]);
  });

  it('MCP 工具双层级 always 分配到 同子命令 和 同类指令', () => {
    const levels = categorizeAlwaysPatterns(
      '调用 websearch/web_search_exa {"numResults":8,"query":"latest news"}',
      'websearch:web_search_exa:a929023238de309b',
      ['websearch:web_search_exa:*', 'websearch:*'],
    );
    expect(levels).toEqual([
      {
        label: '仅本次指令',
        description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
        pattern: 'websearch:web_search_exa:a929023238de309b',
        category: 'full',
      },
      {
        label: '同子命令',
        description: '覆盖网关提供的相同子命令模式。',
        pattern: 'websearch:web_search_exa:*',
        category: 'partial',
      },
      {
        label: '同类指令',
        description: '覆盖网关提供的同类指令模式。',
        pattern: 'websearch:*',
        category: 'base',
      },
    ]);
  });

  it('MCP 工具单层级 always 分配到 同子命令，同类指令 fallback 到 scope', () => {
    const levels = categorizeAlwaysPatterns(
      '调用 websearch/web_search_exa {"query":"test"}',
      'websearch:web_search_exa:abc123',
      ['websearch:*'],
    );
    expect(levels).toEqual([
      {
        label: '仅本次指令',
        description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
        pattern: 'websearch:web_search_exa:abc123',
        category: 'full',
      },
      {
        label: '同子命令',
        description: '覆盖网关提供的相同子命令模式。',
        pattern: 'websearch:*',
        category: 'partial',
      },
      {
        label: '同类指令',
        description: '当前没有可用的同类指令规则，选择后仍只覆盖当前命令。',
        pattern: 'websearch:web_search_exa:abc123',
        category: 'base',
      },
    ]);
  });
});
