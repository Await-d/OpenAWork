import { describe, expect, it } from 'vitest';
import {
  buildProviderOptions,
  type ExtendedThinkingConfig,
} from '../../v2-runtime/upstream/provider-options.js';

const thinking = (
  providerType: string,
  supportsThinking: boolean,
  effort: ExtendedThinkingConfig['effort'] = 'high',
): ExtendedThinkingConfig => ({
  config: { type: 'enabled', budgetTokens: 8192 },
  effort,
  providerType,
  supportsThinking,
});

describe('native provider thinking options', () => {
  it('maps xAI reasoning to its native provider scope', () => {
    const result = buildProviderOptions({
      thinking: thinking('xai', true),
      model: 'grok-3',
    });
    expect(result?.xai).toMatchObject({ reasoning_effort: 'high' });
  });

  it('maps MiMo thinking and reasoning effort', () => {
    const result = buildProviderOptions({
      thinking: thinking('mimo', true),
      model: 'mimo-v2.5-pro',
    });
    expect(result?.mimo).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
  });

  it('maps DeepSeek thinking for chat models', () => {
    const result = buildProviderOptions({
      thinking: thinking('deepseek', true),
      model: 'deepseek-chat',
    });
    expect(result?.deepseek).toMatchObject({ thinking: { type: 'enabled' } });
  });

  it('omits explicit thinking for DeepSeek reasoner models', () => {
    const result = buildProviderOptions({
      thinking: thinking('deepseek', true),
      model: 'deepseek-reasoner',
    });
    expect(result).toBeUndefined();
  });
});
