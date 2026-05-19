import { describe, expect, it } from 'vitest';
import type { AIProvider } from '@openAwork/agent-core';
import { buildAISdkProviderFromConfig } from '../../v2-runtime/upstream/index.js';

function baseProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'p-1',
    type: 'openai',
    name: 'OpenAI',
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    defaultModels: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildAISdkProviderFromConfig', () => {
  it('routes the anthropic provider type to the anthropic SDK adapter', () => {
    const result = buildAISdkProviderFromConfig({
      provider: baseProvider({
        type: 'anthropic',
        name: 'Claude',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-anthropic',
      }),
    });
    expect(result.protocol).toBe('anthropic_messages');
    const model = result.built.languageModel('claude-sonnet-4');
    expect(model).toBeTruthy();
  });

  it('routes the openai-compatible vendors through the chat_completions protocol', () => {
    const result = buildAISdkProviderFromConfig({
      provider: baseProvider({
        type: 'qwen',
        name: 'Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: 'sk-qwen',
      }),
    });
    expect(result.protocol).toBe('chat_completions');
  });

  it('honors the explicit upstreamProtocol override over the type-based default', () => {
    const result = buildAISdkProviderFromConfig({
      provider: baseProvider({
        type: 'openai',
        upstreamProtocol: 'responses',
      }),
    });
    expect(result.protocol).toBe('responses');
    expect(result.built.protocol).toBe('responses');
  });

  it('merges provider-level and model-level requestOverrides (model wins on conflicts)', () => {
    const result = buildAISdkProviderFromConfig({
      provider: baseProvider({
        requestOverrides: {
          temperature: 0.4,
          headers: { 'x-org': 'team-a' },
          omitBodyKeys: ['logprobs'],
        },
      }),
      modelOverrides: {
        temperature: 0.9,
        headers: { 'x-trace-id': 'abc' },
        omitBodyKeys: ['logprobs', 'top_p'],
      },
    });
    expect(result.requestOverrides.temperature).toBe(0.9);
    expect(result.requestOverrides.headers).toMatchObject({
      'x-org': 'team-a',
      'x-trace-id': 'abc',
    });
    expect(result.requestOverrides.omitBodyKeys).toEqual(
      expect.arrayContaining(['logprobs', 'top_p']),
    );
  });

  it('reads the API key from `apiKeyEnv` when `apiKey` is unset', () => {
    const result = buildAISdkProviderFromConfig(
      {
        provider: baseProvider({
          apiKey: undefined,
          apiKeyEnv: 'OPENAWORK_TEST_KEY',
        }),
      },
      { OPENAWORK_TEST_KEY: 'sk-from-env' } as NodeJS.ProcessEnv,
    );
    // We can't assert the resolved key directly (the SDK hides it),
    // but the call must succeed without throwing.
    expect(result.protocol).toBe('chat_completions');
    const model = result.built.languageModel('gpt-5');
    expect(model).toBeTruthy();
  });

  it('appends extraHeaders on top of the merged provider+model headers', () => {
    const result = buildAISdkProviderFromConfig({
      provider: baseProvider({
        requestOverrides: { headers: { 'x-base': '1' } },
      }),
      modelOverrides: { headers: { 'x-model': '2' } },
      extraHeaders: { 'x-extra': '3' },
    });
    expect(result.requestOverrides.headers).toMatchObject({ 'x-base': '1', 'x-model': '2' });
    // extraHeaders are forwarded into the SDK config but kept out of the
    // returned `requestOverrides` so subsequent middleware doesn't double
    // apply them.
    expect(result.requestOverrides.headers).not.toHaveProperty('x-extra');
  });
});
