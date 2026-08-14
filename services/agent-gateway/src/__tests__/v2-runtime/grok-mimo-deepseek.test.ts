/**
 * 测试 Grok、MiMo、DeepSeek 的 thinking 推断
 */

import { describe, it, expect } from 'vitest';
import { buildProviderOptions } from '../../v2-runtime/upstream/provider-options.js';

describe('Grok、MiMo、DeepSeek thinking 推断测试', () => {
  describe('xAI Grok', () => {
    it('grok-3 使用 supportsThinking=true 应该生成 reasoningEffort', () => {
      const result = buildProviderOptions({
        thinking: {
          enabled: true,
          effort: 'high',
          providerType: 'xai',
          supportsThinking: true, // 在 defaultModels 中
        },
        model: 'grok-3',
      });

      console.log('grok-3 (supportsThinking=true):', JSON.stringify(result, null, 2));
      expect(result).toBeDefined();
      expect(result?.openai?.reasoningEffort).toBeDefined();
    });

    it('grok-3 使用 supportsThinking=false 应该通过推断生成 reasoningEffort', () => {
      const result = buildProviderOptions({
        thinking: {
          enabled: true,
          effort: 'high',
          providerType: 'xai',
          supportsThinking: false, // 模拟自定义模型
        },
        model: 'grok-3',
      });

      console.log('grok-3 (supportsThinking=false):', JSON.stringify(result, null, 2));
      expect(result).toBeDefined();
      expect(result?.openai?.reasoningEffort).toBeDefined();
    });

    it('grok-2 使用 supportsThinking=false 应该通过推断生成 reasoningEffort', () => {
      const result = buildProviderOptions({
        thinking: {
          enabled: true,
          effort: 'medium',
          providerType: 'xai',
          supportsThinking: false,
        },
        model: 'grok-2',
      });

      console.log('grok-2 (supportsThinking=false):', JSON.stringify(result, null, 2));
      expect(result).toBeDefined();
      expect(result?.openai?.reasoningEffort).toBeDefined();
    });
  });

  describe('小米 MiMo', () => {
    it('mimo-v2.5-pro 使用 supportsThinking=true 应该生成 thinking 和 reasoningEffort', () => {
      const result = buildProviderOptions({
        thinking: {
          enabled: true,
          effort: 'high',
          providerType: 'mimo',
          supportsThinking: true,
        },
        model: 'mimo-v2.5-pro',
      });

      console.log('mimo-v2.5-pro (supportsThinking=true):', JSON.stringify(result, null, 2));
      expect(result).toBeDefined();
      expect(result?.mimo).toMatchObject({
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      });
    });

    it('mimo-v2.5-pro 使用 supportsThinking=false 应该通过推断生成', () => {
      const result = buildProviderOptions({
        thinking: {
          enabled: true,
          effort: 'medium',
          providerType: 'mimo',
          supportsThinking: false,
        },
        model: 'mimo-v2.5-pro',
      });

      console.log('mimo-v2.5-pro (supportsThinking=false):', JSON.stringify(result, null, 2));
      expect(result).toBeDefined();
      expect(result?.mimo).toMatchObject({
        thinking: { type: 'enabled' },
        reasoningEffort: 'medium',
      });
    });
  });

  describe('DeepSeek', () => {
    it('deepseek-chat 使用 supportsThinking=true 应该生成 thinking', () => {
      const result = buildProviderOptions({
        thinking: {
          enabled: true,
          effort: 'high',
          providerType: 'deepseek',
          supportsThinking: true,
        },
        model: 'deepseek-chat',
      });

      console.log('deepseek-chat (supportsThinking=true):', JSON.stringify(result, null, 2));
      expect(result).toBeDefined();
      expect(result?.deepseek).toBeDefined();
      expect(result?.deepseek?.thinking).toEqual({ type: 'enabled' });
    });

    it('deepseek-chat 使用 supportsThinking=false 应该通过推断生成', () => {
      const result = buildProviderOptions({
        thinking: {
          enabled: true,
          effort: 'medium',
          providerType: 'deepseek',
          supportsThinking: false, // 模拟自定义模型
        },
        model: 'deepseek-chat',
      });

      console.log('deepseek-chat (supportsThinking=false):', JSON.stringify(result, null, 2));
      expect(result).toBeDefined();
      expect(result?.deepseek).toBeDefined();
      expect(result?.deepseek?.thinking).toEqual({ type: 'enabled' });
    });

    it('deepseek-reasoner 不应该生成 thinking（模型自带推理）', () => {
      const result = buildProviderOptions({
        thinking: {
          enabled: true,
          effort: 'high',
          providerType: 'deepseek',
          supportsThinking: true,
        },
        model: 'deepseek-reasoner',
      });

      console.log('deepseek-reasoner:', JSON.stringify(result, null, 2));
      // reasoner 模型自带思考，不需要额外参数
      expect(result).toBeUndefined();
    });
  });
});
