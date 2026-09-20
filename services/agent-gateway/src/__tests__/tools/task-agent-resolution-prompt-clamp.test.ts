/**
 * 回归：托管 Agent 的 systemPrompt 上限与委托请求的 systemPrompt 上限等值，
 * 而委派提示词会在其之上拼接委派契约 / 类别 / skill 说明，因此必须限幅，
 * 否则超长 Agent 提示词会让子会话请求以 `too_big` 失败（本轮修复的同类故障）。
 */
import { describe, expect, it, vi } from 'vitest';
import { MODEL_REQUEST_SYSTEM_PROMPT_MAX_CHARS } from '../../provider/model-router.js';
import { resolveDelegatedAgent } from '../../task/task-agent-resolution.js';

const mocks = vi.hoisted(() => ({
  listManagedAgentsForUser: vi.fn(() => [] as unknown[]),
}));

vi.mock('../../agent/agent-catalog.js', () => ({
  listManagedAgentsForUser: mocks.listManagedAgentsForUser,
}));

vi.mock('../../infra/db.js', () => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
  sqliteTransaction: <T>(fn: () => T) => fn(),
  WORKSPACE_ROOT: '/tmp/workspace',
  WORKSPACE_ROOTS: ['/tmp/workspace'],
  WORKSPACE_ACCESS_MODE: 'unrestricted' as const,
  WORKSPACE_ACCESS_RESTRICTED: false,
}));

function managedAgent(id: string, systemPrompt: string): unknown {
  return { id, label: id, enabled: true, systemPrompt, model: 'gpt-4o' };
}

describe('delegated system prompt clamp', () => {
  it('clamps an at-cap agent prompt plus the delegation wrapper under the cap', () => {
    mocks.listManagedAgentsForUser.mockReturnValue([
      managedAgent('big-agent', 'A'.repeat(MODEL_REQUEST_SYSTEM_PROMPT_MAX_CHARS)),
    ]);

    const resolved = resolveDelegatedAgent('user-1', { subagent_type: 'big-agent' });
    const systemPrompt = resolved.systemPrompt ?? '';

    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(systemPrompt.length).toBeLessThanOrEqual(MODEL_REQUEST_SYSTEM_PROMPT_MAX_CHARS);
  });

  it('leaves a normal-sized agent prompt untouched', () => {
    mocks.listManagedAgentsForUser.mockReturnValue([
      managedAgent('small-agent', 'You are concise.'),
    ]);

    const resolved = resolveDelegatedAgent('user-1', { subagent_type: 'small-agent' });

    expect(resolved.systemPrompt).toContain('You are concise.');
  });
});
