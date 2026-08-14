/**
 * 测试 thinking 配置的推断逻辑——验证依赖 thinkingModelMatcher 的平台
 * （如 Qwen、Moonshot、MiMo、智谱、豆包等）即使 supportsThinking=false 也能
 * 通过 catalog 推断正确下发 thinking 参数。
 */

import { describe, it, expect } from 'vitest';
import { buildProviderOptions } from '../../v2-runtime/upstream/provider-options.js';

describe('thinking inference for matcher-based platforms', () => {
  it('Qwen: qwen3-235b-a22b 即使 supportsThinking=false 也应推断支持', () => {
    const result = buildProviderOptions({
      thinking: {
        enabled: true,
        effort: 'medium',
        providerType: 'qwen',
        supportsThinking: false, // 显式标记为 false（模拟自定义模型场景）
      },
      model: 'qwen3-235b-a22b',
    });

    expect(result).toBeDefined();
    expect(result?.qwen).toBeDefined();
    expect(result?.qwen).toMatchObject({
      enable_thinking: true,
      thinking_budget: 8192, // medium 对应的 budget
    });
  });

  it('Moonshot: kimi-k2.5 即使 supportsThinking=false 也应推断支持', () => {
    const result = buildProviderOptions({
      thinking: {
        enabled: true,
        effort: 'high',
        providerType: 'moonshot',
        supportsThinking: false,
      },
      model: 'kimi-k2.5',
    });

    expect(result).toBeDefined();
    expect(result?.moonshot).toBeDefined();
    expect(result?.moonshot).toMatchObject({
      thinking: { type: 'enabled' },
    });
  });

  it('MiMo: mimo-v2.5-pro 即使 supportsThinking=false 也应推断支持', () => {
    const result = buildProviderOptions({
      thinking: {
        enabled: true,
        effort: 'medium',
        providerType: 'mimo',
        supportsThinking: false,
      },
      model: 'mimo-v2.5-pro',
    });

    expect(result).toBeDefined();
    expect(result?.mimo).toBeDefined();
    expect(result?.mimo).toMatchObject({
      thinking: { type: 'enabled' },
      reasoningEffort: 'medium',
    });
  });

  it('智谱: glm-4.5 即使 supportsThinking=false 也应推断支持', () => {
    const result = buildProviderOptions({
      thinking: {
        enabled: true,
        effort: 'low',
        providerType: 'zhipu',
        supportsThinking: false,
      },
      model: 'glm-4.5',
    });

    expect(result).toBeDefined();
    expect(result?.zhipu).toBeDefined();
    expect(result?.zhipu).toMatchObject({
      thinking: { type: 'enabled' },
    });
  });

  it('豆包: doubao-seed-1.6 即使 supportsThinking=false 也应推断支持', () => {
    const result = buildProviderOptions({
      thinking: {
        enabled: true,
        effort: 'high',
        providerType: 'doubao',
        supportsThinking: false,
      },
      model: 'doubao-seed-1.6',
    });

    expect(result).toBeDefined();
    expect(result?.doubao).toBeDefined();
    expect(result?.doubao).toMatchObject({
      thinking: { type: 'enabled' },
    });
  });

  it('不支持思考的模型应该返回 undefined', () => {
    const result = buildProviderOptions({
      thinking: {
        enabled: true,
        effort: 'medium',
        providerType: 'qwen',
        supportsThinking: false,
      },
      model: 'qwen-turbo', // qwen-turbo 不支持思考
    });

    expect(result).toBeUndefined();
  });

  it('thinkingStyle=none 的平台应该返回 undefined', () => {
    const result = buildProviderOptions({
      thinking: {
        enabled: true,
        effort: 'medium',
        providerType: 'ollama',
        supportsThinking: false,
      },
      model: 'llama3.1:8b',
    });

    expect(result).toBeUndefined();
  });

  it('显式 supportsThinking=true 应该优先级最高', () => {
    const result = buildProviderOptions({
      thinking: {
        enabled: true,
        effort: 'medium',
        providerType: 'anthropic',
        supportsThinking: true, // 显式标记为 true
      },
      model: 'claude-opus-4-0',
    });

    expect(result).toBeDefined();
    expect(result?.anthropic).toBeDefined();
    expect(result?.anthropic?.thinking).toMatchObject({
      type: 'enabled',
      budgetTokens: 8192,
    });
  });
});
