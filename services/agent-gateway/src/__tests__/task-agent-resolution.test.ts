import { describe, expect, it, vi } from 'vitest';

vi.mock('../agent-catalog.js', () => ({
  listManagedAgentsForUser: vi.fn((userId: string) => {
    if (userId !== 'user-1') {
      return [];
    }

    return [
      {
        id: 'explore',
        label: 'explore',
        aliases: [],
        enabled: true,
        model: 'xai/grok-code-fast-1',
        fallbackModels: ['opencode/gpt-5-nano'],
        systemPrompt: 'Inspect the repository before changing code.',
      },
      {
        id: 'sisyphus-junior',
        label: 'sisyphus-junior',
        aliases: [],
        enabled: true,
        systemPrompt: 'Sisyphus-Junior - Focused executor from OhMyOpenCode.',
      },
    ];
  }),
}));

import { resolveDelegatedAgent } from '../task-agent-resolution.js';

describe('task agent resolution', () => {
  it('wraps delegated system prompts with the child-session contract', () => {
    const resolved = resolveDelegatedAgent('user-1', {
      subagent_type: 'explore',
      load_skills: ['frontend-design', 'frontend-design', 'webapp-testing'],
    });

    expect(resolved.agentId).toBe('explore');
    expect(resolved.requestedSkills).toEqual(['frontend-design', 'webapp-testing']);
    expect(resolved.systemPrompt).toContain('Inspect the repository before changing code.');
    expect(resolved.systemPrompt).toContain('Delegation contract:');
    expect(resolved.systemPrompt).toContain('delegated child session created by the task tool');
    expect(resolved.systemPrompt).toContain('Requested skills:');
    expect(resolved.systemPrompt).toContain('frontend-design, webapp-testing');
    expect(resolved.systemPrompt).toContain('Completion requirements:');
    expect(resolved.modelCandidates).toContain('grok-code-fast-1');
    expect(resolved.modelCandidates).toContain('gpt-5-nano');
  });

  it('adds category execution guidance to category-routed agents', () => {
    const resolved = resolveDelegatedAgent('user-1', {
      category: 'deep',
      load_skills: [],
    });

    expect(resolved.agentId).toBe('sisyphus-junior');
    expect(resolved.category).toBe('deep');
    expect(resolved.systemPrompt).toContain(
      'Sisyphus-Junior - Focused executor from OhMyOpenCode.',
    );
    expect(resolved.systemPrompt).toContain('Execution style:');
    expect(resolved.systemPrompt).toContain('Task category: deep.');
    expect(resolved.systemPrompt).toContain('Goal-oriented autonomous problem-solving');
    expect(resolved.systemPrompt).toContain('Category prompt append (reference-aligned):');
    expect(resolved.systemPrompt).toContain('GOAL-ORIENTED AUTONOMOUS tasks');
    expect(resolved.modelCandidates[0]).toBe('gpt-5.3-codex');
  });
});
