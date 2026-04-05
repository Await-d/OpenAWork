import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBuiltinProviderPreset } from '@openAwork/agent-core';
import {
  modelRequestSchema,
  resolveModelRoute,
  resolveModelRouteFromProvider,
  SUPPORTED_MODELS,
} from '../model-router.js';

describe('resolveModelRoute fallback metadata', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the default sentinel aligned with the current builtin fallback model', () => {
    const parsed = modelRequestSchema.parse({});
    const route = resolveModelRoute({ ...parsed, maxTokens: 2048, temperature: 1 });

    expect(parsed.model).toBe('default');
    expect(route.model).toBe('gpt-4o');
  });

  it('treats omitted model and explicit default sentinel the same under AI_DEFAULT_MODEL', () => {
    vi.stubEnv('AI_DEFAULT_MODEL', 'gemini-2.5-pro');

    const parsed = modelRequestSchema.parse({});
    const parsedRoute = resolveModelRoute({ ...parsed, maxTokens: 2048, temperature: 1 });
    const explicitRoute = resolveModelRoute({
      model: 'default',
      maxTokens: 2048,
      temperature: 1,
    });

    expect(parsedRoute.model).toBe('gemini-2.5-pro');
    expect(explicitRoute.model).toBe('gemini-2.5-pro');
    expect(parsedRoute.providerType).toBe('gemini');
    expect(explicitRoute.providerType).toBe('gemini');
  });

  it('hydrates OpenAI reasoning metadata from the real builtin presets', () => {
    const openaiProvider = getBuiltinProviderPreset('openai');
    const modelId =
      openaiProvider.defaultModels.find((model) => model.supportsThinking === true)?.id ?? 'o3';
    const route = resolveModelRoute({ model: modelId, maxTokens: 2048, temperature: 1 });

    expect(route.providerType).toBe('openai');
    expect(route.supportsThinking).toBe(true);
    expect(route.apiBaseUrl).toBe(openaiProvider.baseUrl);
  });

  it('hydrates Gemini fallback metadata from the real builtin presets', () => {
    const geminiProvider = getBuiltinProviderPreset('gemini');
    const modelId =
      geminiProvider.defaultModels.find((model) => model.supportsThinking === true)?.id ??
      'gemini-2.5-pro';
    const route = resolveModelRoute({ model: modelId, maxTokens: 2048, temperature: 1 });

    expect(route.providerType).toBe('gemini');
    expect(route.supportsThinking).toBe(true);
    expect(route.apiBaseUrl).toBe(geminiProvider.baseUrl);
  });

  it('uses the real Gemini builtin baseUrl when resolving apiKey env fallback', () => {
    vi.stubEnv('GEMINI_API_KEY', 'gemini-env-key');
    const geminiProvider = {
      ...getBuiltinProviderPreset('gemini'),
      apiKey: undefined,
    };

    const route = resolveModelRouteFromProvider(geminiProvider, 'gemini-2.5-pro', {
      maxTokens: 2048,
      temperature: 1,
    });

    expect(route.apiBaseUrl).toBe(geminiProvider.baseUrl);
    expect(route.apiKey).toBe('gemini-env-key');
  });

  it('uses the real DeepSeek builtin baseUrl when resolving apiKey env fallback', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-env-key');
    const deepseekProvider = {
      ...getBuiltinProviderPreset('deepseek'),
      apiKey: undefined,
    };

    const route = resolveModelRouteFromProvider(deepseekProvider, 'deepseek-chat', {
      maxTokens: 2048,
      temperature: 1,
    });

    expect(route.apiBaseUrl).toBe(deepseekProvider.baseUrl);
    expect(route.apiKey).toBe('deepseek-env-key');
  });

  it('derives supported model ids from the real builtin presets', () => {
    expect(SUPPORTED_MODELS).toContain('gpt-4o');
    expect(SUPPORTED_MODELS).toContain('o3');
    expect(SUPPORTED_MODELS).toContain('gemini-2.5-pro');
    expect(SUPPORTED_MODELS).toContain('kimi-k2.5');
  });
});
