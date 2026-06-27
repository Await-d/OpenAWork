import { describe, expect, it } from 'vitest';
import {
  normalizeChatThinkingState,
  resolveChatThinkingRequest,
} from './resolve-chat-thinking-request.js';

describe('normalizeChatThinkingState', () => {
  it('preserves the user-selected effort for configurable thinking models', () => {
    expect(
      normalizeChatThinkingState({
        providerType: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        declaredSupportsThinking: true,
        thinkingEnabled: true,
        reasoningEffort: 'low',
      }),
    ).toEqual({
      supportsThinking: true,
      canConfigureThinking: true,
      thinkingEnabled: true,
      reasoningEffort: 'low',
    });
  });

  it('disables manual thinking for intrinsic-thinking models', () => {
    expect(
      normalizeChatThinkingState({
        providerType: 'openai',
        modelId: 'gpt-5-pro',
        declaredSupportsThinking: true,
        thinkingEnabled: true,
        reasoningEffort: 'high',
      }),
    ).toEqual({
      supportsThinking: true,
      canConfigureThinking: false,
      thinkingEnabled: false,
      reasoningEffort: 'high',
    });
  });

  it('downgrades unsupported effort to the nearest supported tier', () => {
    expect(
      normalizeChatThinkingState({
        providerType: 'openai',
        modelId: 'gpt-5.1',
        declaredSupportsThinking: true,
        thinkingEnabled: true,
        reasoningEffort: 'xhigh',
      }),
    ).toEqual({
      supportsThinking: true,
      canConfigureThinking: true,
      thinkingEnabled: true,
      reasoningEffort: 'high',
    });
  });

  it('normalizes binary-toggle models to medium effort', () => {
    expect(
      normalizeChatThinkingState({
        providerType: 'moonshot',
        modelId: 'kimi-k2.5',
        declaredSupportsThinking: true,
        thinkingEnabled: true,
        reasoningEffort: 'xhigh',
      }),
    ).toEqual({
      supportsThinking: true,
      canConfigureThinking: true,
      thinkingEnabled: true,
      reasoningEffort: 'medium',
    });
  });
});

describe('resolveChatThinkingRequest', () => {
  it('preserves the normalized selected effort for configurable models', () => {
    expect(
      resolveChatThinkingRequest({
        providerType: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        declaredSupportsThinking: true,
        thinkingEnabled: true,
        reasoningEffort: 'low',
      }),
    ).toEqual({
      thinkingEnabled: true,
      reasoningEffort: 'low',
    });
  });

  it('keeps the selected effort even when thinking is disabled', () => {
    expect(
      resolveChatThinkingRequest({
        providerType: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        declaredSupportsThinking: true,
        thinkingEnabled: false,
        reasoningEffort: 'high',
      }),
    ).toEqual({
      thinkingEnabled: false,
      reasoningEffort: 'high',
    });
  });

  it('drops thinking parameters for models without thinking support', () => {
    expect(
      resolveChatThinkingRequest({
        providerType: 'openai',
        modelId: 'gpt-4o-mini',
        declaredSupportsThinking: false,
        thinkingEnabled: true,
        reasoningEffort: 'xhigh',
      }),
    ).toEqual({
      thinkingEnabled: false,
      reasoningEffort: undefined,
    });
  });

  it('drops manual thinking parameters for intrinsic-thinking models', () => {
    expect(
      resolveChatThinkingRequest({
        providerType: 'openai',
        modelId: 'gpt-5-pro',
        declaredSupportsThinking: true,
        thinkingEnabled: true,
        reasoningEffort: 'high',
      }),
    ).toEqual({
      thinkingEnabled: false,
      reasoningEffort: undefined,
    });
  });
});
