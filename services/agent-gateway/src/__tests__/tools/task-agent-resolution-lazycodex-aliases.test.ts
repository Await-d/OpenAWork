import { describe, expect, it, vi } from 'vitest';
import { resolveDelegatedAgent } from '../../task/task-agent-resolution.js';

vi.mock('../../infra/db.js', () => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
  sqliteTransaction: <T>(fn: () => T) => fn(),
}));

describe('resolveDelegatedAgent LazyCodex role aliases', () => {
  it.each([
    ['explorer', 'explore'],
    ['librarian', 'librarian'],
    ['planner', 'plan'],
    ['executor', 'hephaestus'],
    ['reviewer', 'momus'],
    ['lazycodex-gate-reviewer', 'momus'],
    ['qa-executor', 'sisyphus-junior'],
  ] as const)('把 %s 解析为 OpenAWork 内置 agent %s', (subagentType, expectedAgentId) => {
    const result = resolveDelegatedAgent('user-lazycodex-aliases', {
      subagent_type: subagentType,
    });

    expect(result.agentId).toBe(expectedAgentId);
    expect(result.systemPrompt).toContain('Delegation contract:');
  });
});
