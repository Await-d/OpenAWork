import { describe, expect, it } from 'vitest';
import { SlashCommandRouterImpl } from '../index.js';

describe('SlashCommandRouterImpl.parse', () => {
  it('preserves quoted positional arguments', () => {
    const router = new SlashCommandRouterImpl();
    const command = router.parse(
      '/start-work "聊天界面 opencode 能力集成方案" --worktree /tmp/worktree',
    );

    expect(command).not.toBeNull();
    expect(command?.name).toBe('start-work');
    expect(command?.args).toEqual([
      '聊天界面 opencode 能力集成方案',
      '--worktree',
      '/tmp/worktree',
    ]);
  });

  it('preserves quoted option values', () => {
    const router = new SlashCommandRouterImpl();
    const command = router.parse(
      '/refactor "Auth Service" --strategy="aggressive" --scope project',
    );

    expect(command?.args).toEqual(['Auth Service', '--strategy=aggressive', '--scope', 'project']);
  });
});
