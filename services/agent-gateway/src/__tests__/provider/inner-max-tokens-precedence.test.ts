import { describe, expect, it } from 'vitest';
import type { AIProvider } from '@openAwork/agent-core';
import { resolveModelRouteFromProvider } from '../../provider/model-router.js';

/**
 * 内层调用输出上限的**优先级链**（用户配置必须优先于调用方传入的兜底值）。
 *
 * `look_at` / `computer_use` 在调用 `resolveModelRouteFromProvider` 时传的
 * `maxTokens` 只是**兜底默认值**；真正生效的是：
 *   模型级 requestOverrides.maxTokens > Provider 级 requestOverrides.maxTokens > 传入值
 * 该行为由 `buildRequestOverrides` 合并 + `mergedOverrides.maxTokens ?? request.maxTokens`
 * 保证。此文件把它锁成契约，防止未来改动让用户配置失效。
 */
function makeProvider(overrides?: {
  providerMaxTokens?: number;
  modelMaxTokens?: number;
}): AIProvider {
  return {
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    enabled: true,
    baseUrl: 'https://api.example.test',
    apiKey: 'test-key',
    ...(overrides?.providerMaxTokens !== undefined
      ? { requestOverrides: { maxTokens: overrides.providerMaxTokens } }
      : {}),
    defaultModels: [
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        enabled: true,
        ...(overrides?.modelMaxTokens !== undefined
          ? { requestOverrides: { maxTokens: overrides.modelMaxTokens } }
          : {}),
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const CALLER_FALLBACK = 2048;

describe('内层调用 maxTokens 优先级链', () => {
  it('无任何配置时采用调用方传入的兜底值', () => {
    const route = resolveModelRouteFromProvider(makeProvider(), 'gpt-5.4', {
      maxTokens: CALLER_FALLBACK,
      temperature: 0.2,
    });

    expect(route.maxTokens).toBe(CALLER_FALLBACK);
  });

  it('Provider 级 requestOverrides.maxTokens 覆盖调用方兜底值', () => {
    const route = resolveModelRouteFromProvider(
      makeProvider({ providerMaxTokens: 4096 }),
      'gpt-5.4',
      { maxTokens: CALLER_FALLBACK, temperature: 0.2 },
    );

    expect(route.maxTokens).toBe(4096);
  });

  it('模型级 requestOverrides.maxTokens 优先于 Provider 级', () => {
    const route = resolveModelRouteFromProvider(
      makeProvider({ providerMaxTokens: 4096, modelMaxTokens: 8192 }),
      'gpt-5.4',
      { maxTokens: CALLER_FALLBACK, temperature: 0.2 },
    );

    expect(route.maxTokens).toBe(8192);
  });

  it('模型级配置同样覆盖调用方兜底值（GUI 内层调用的实际场景）', () => {
    const route = resolveModelRouteFromProvider(makeProvider({ modelMaxTokens: 1024 }), 'gpt-5.4', {
      maxTokens: CALLER_FALLBACK,
      temperature: 0.2,
    });

    expect(route.maxTokens).toBe(1024);
  });

  it('requestOverrides 会原样带到路由上，供上游请求使用', () => {
    const route = resolveModelRouteFromProvider(
      makeProvider({ providerMaxTokens: 4096 }),
      'gpt-5.4',
      { maxTokens: CALLER_FALLBACK, temperature: 0.2 },
    );

    expect(route.requestOverrides.maxTokens).toBe(4096);
  });
});
