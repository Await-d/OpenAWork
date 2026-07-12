import { afterEach, describe, expect, it } from 'vitest';
import type { AIProvider } from '@openAwork/agent-core';
import { resolveModelRoute } from '../../provider/model-router.js';
import { resolveModelRouteFromProvider } from '../../provider/model-router.js';

describe('resolveModelRoute env fallback', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('内置 Anthropic 模型缺少专用 key 时回退到通用 AI_API_KEY', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    process.env['AI_API_KEY'] = 'generic-test-key';

    const route = resolveModelRoute({
      model: 'claude-opus-4-0',
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.providerType).toBe('anthropic');
    expect(route.apiKey).toBe('generic-test-key');
  });

  it('内置 Anthropic 模型优先使用专用 ANTHROPIC_API_KEY', () => {
    process.env['ANTHROPIC_API_KEY'] = 'anthropic-test-key';
    process.env['AI_API_KEY'] = 'generic-test-key';

    const route = resolveModelRoute({
      model: 'claude-opus-4-0',
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.providerType).toBe('anthropic');
    expect(route.apiKey).toBe('anthropic-test-key');
  });

  it('为根路径 OpenAI relay 自动补上 /v1', () => {
    const provider: AIProvider = {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      enabled: true,
      baseUrl: 'https://relay.example.test',
      apiKey: 'test-key',
      upstreamProtocol: 'responses',
      defaultModels: [
        {
          id: 'gpt-5.4',
          label: 'GPT-5.4',
          enabled: true,
          supportsThinking: true,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const route = resolveModelRouteFromProvider(provider, 'gpt-5.4', {
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.apiBaseUrl).toBe('https://relay.example.test/v1');
  });

  it('保留已经带路径的 OpenAI relay baseUrl', () => {
    const provider: AIProvider = {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      enabled: true,
      baseUrl: 'https://relay.example.test/openai/v1',
      apiKey: 'test-key',
      upstreamProtocol: 'responses',
      defaultModels: [
        {
          id: 'gpt-5.4',
          label: 'GPT-5.4',
          enabled: true,
          supportsThinking: true,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const route = resolveModelRouteFromProvider(provider, 'gpt-5.4', {
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.apiBaseUrl).toBe('https://relay.example.test/openai/v1');
  });
});
