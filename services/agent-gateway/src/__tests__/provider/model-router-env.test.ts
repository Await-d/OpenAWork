import { afterEach, describe, expect, it } from 'vitest';
import { resolveModelRoute } from '../../provider/model-router.js';

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
});
