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

  it('为 Anthropic 兼容的 MiMo 文档地址自动补上 /v1', () => {
    const provider: AIProvider = {
      id: 'mimo',
      type: 'mimo',
      name: 'Xiaomi MiMo',
      enabled: true,
      baseUrl: 'https://api.xiaomimimo.com/anthropic',
      apiKey: 'test-key',
      upstreamProtocol: 'anthropic_messages',
      defaultModels: [
        {
          id: 'mimo-v2.5-pro',
          label: 'MiMo V2.5 Pro',
          enabled: true,
          supportsThinking: true,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const route = resolveModelRouteFromProvider(provider, 'mimo-v2.5-pro', {
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.apiBaseUrl).toBe('https://api.xiaomimimo.com/anthropic/v1');
  });

  it('为裸 Anthropic 根地址自动补上 /v1', () => {
    const provider: AIProvider = {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      enabled: true,
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'test-key',
      upstreamProtocol: 'anthropic_messages',
      defaultModels: [
        {
          id: 'claude-opus-4-0',
          label: 'Claude Opus 4',
          enabled: true,
          supportsThinking: true,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const route = resolveModelRouteFromProvider(provider, 'claude-opus-4-0', {
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.apiBaseUrl).toBe('https://api.anthropic.com/v1');
  });
});
