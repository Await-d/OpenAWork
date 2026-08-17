import { describe, expect, it } from 'vitest';
import {
  buildProviderOptions,
  type ExtendedThinkingConfig,
} from '../../v2-runtime/upstream/provider-options.js';

const thinking = (
  providerType: string,
  model: string,
  supportsThinking: boolean,
  effort: ExtendedThinkingConfig['effort'] = 'medium',
): ExtendedThinkingConfig => ({
  config: { type: 'enabled', budgetTokens: 8192 },
  effort,
  providerType,
  supportsThinking,
});

describe('thinking inference for matcher-based platforms', () => {
  it('infers Qwen thinking from its catalog matcher', () => {
    const result = buildProviderOptions({
      thinking: thinking('qwen', 'qwen3-235b-a22b', false),
      model: 'qwen3-235b-a22b',
    });
    expect(result?.qwen).toMatchObject({ enable_thinking: true, thinking_budget: 8192 });
  });

  it('infers Moonshot thinking from its catalog matcher', () => {
    const result = buildProviderOptions({
      thinking: thinking('moonshot', 'kimi-k2.5', false, 'high'),
      model: 'kimi-k2.5',
    });
    expect(result?.moonshot).toMatchObject({ thinking: { type: 'enabled' } });
  });

  it('infers MiMo thinking and effort from its catalog matcher', () => {
    const result = buildProviderOptions({
      thinking: thinking('mimo', 'mimo-v2.5-pro', false),
      model: 'mimo-v2.5-pro',
    });
    expect(result?.mimo).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'medium',
    });
  });

  it('returns undefined for a model without thinking support', () => {
    expect(
      buildProviderOptions({
        thinking: thinking('qwen', 'qwen-turbo', false),
        model: 'qwen-turbo',
      }),
    ).toBeUndefined();
  });

  it('honors an explicit thinking support flag', () => {
    const result = buildProviderOptions({
      thinking: thinking('anthropic', 'claude-opus-4-0', true),
      model: 'claude-opus-4-0',
    });
    expect(result?.anthropic?.thinking).toMatchObject({ type: 'enabled', budgetTokens: 8192 });
  });
});
