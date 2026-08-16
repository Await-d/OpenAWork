/**
 * ThinkingConfig 协议升级测试
 *
 * 验证新版 thinking 参数与旧版参数的兼容性和正确性
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// 模拟新版 thinking schema
const thinkingConfigSchema = z.union([
  z.object({ type: z.literal('adaptive') }),
  z.object({
    type: z.literal('enabled'),
    budgetTokens: z.number().int().min(0).max(100000),
  }),
  z.object({ type: z.literal('disabled') }),
]);

type ThinkingConfig = z.infer<typeof thinkingConfigSchema>;

describe('ThinkingConfig 协议升级', () => {
  describe('新版 thinking 参数解析', () => {
    it('应该正确解析 adaptive 模式', () => {
      const input = { type: 'adaptive' };
      const result = thinkingConfigSchema.parse(input);
      expect(result).toEqual({ type: 'adaptive' });
    });

    it('应该正确解析 enabled 模式', () => {
      const input = { type: 'enabled', budgetTokens: 16384 };
      const result = thinkingConfigSchema.parse(input);
      expect(result).toEqual({ type: 'enabled', budgetTokens: 16384 });
    });

    it('应该正确解析 disabled 模式', () => {
      const input = { type: 'disabled' };
      const result = thinkingConfigSchema.parse(input);
      expect(result).toEqual({ type: 'disabled' });
    });

    it('应该拒绝无效的 type', () => {
      const input = { type: 'invalid' };
      expect(() => thinkingConfigSchema.parse(input)).toThrow();
    });

    it('应该拒绝 enabled 模式缺少 budgetTokens', () => {
      const input = { type: 'enabled' };
      expect(() => thinkingConfigSchema.parse(input)).toThrow();
    });

    it('应该拒绝负数 budgetTokens', () => {
      const input = { type: 'enabled', budgetTokens: -100 };
      expect(() => thinkingConfigSchema.parse(input)).toThrow();
    });

    it('应该拒绝超过上限的 budgetTokens', () => {
      const input = { type: 'enabled', budgetTokens: 200000 };
      expect(() => thinkingConfigSchema.parse(input)).toThrow();
    });
  });

  describe('旧版参数到新版 ThinkingConfig 的转换', () => {
    function buildThinkingConfigFromLegacy(
      thinkingEnabled?: boolean,
      reasoningEffort?: string,
    ): ThinkingConfig {
      if (thinkingEnabled === false) {
        return { type: 'disabled' };
      }

      const effort = reasoningEffort ?? 'medium';
      const BUDGET_MAP: Record<string, number> = {
        none: 0,
        minimal: 1024,
        low: 4096,
        medium: 8192,
        high: 16384,
        xhigh: 31999,
        max: 31999,
      };

      return {
        type: 'enabled',
        budgetTokens: BUDGET_MAP[effort] ?? 8192,
      };
    }

    it('thinkingEnabled=false 应该转换为 disabled', () => {
      const result = buildThinkingConfigFromLegacy(false);
      expect(result).toEqual({ type: 'disabled' });
    });

    it('thinkingEnabled=true + reasoningEffort=low 应该转换为 enabled + 4096', () => {
      const result = buildThinkingConfigFromLegacy(true, 'low');
      expect(result).toEqual({ type: 'enabled', budgetTokens: 4096 });
    });

    it('thinkingEnabled=true + reasoningEffort=high 应该转换为 enabled + 16384', () => {
      const result = buildThinkingConfigFromLegacy(true, 'high');
      expect(result).toEqual({ type: 'enabled', budgetTokens: 16384 });
    });

    it('thinkingEnabled=true + 无 reasoningEffort 应该使用默认 medium (8192)', () => {
      const result = buildThinkingConfigFromLegacy(true);
      expect(result).toEqual({ type: 'enabled', budgetTokens: 8192 });
    });

    it('未指定 thinkingEnabled 应该使用默认 enabled + medium', () => {
      const result = buildThinkingConfigFromLegacy();
      expect(result).toEqual({ type: 'enabled', budgetTokens: 8192 });
    });

    it('reasoningEffort=xhigh 应该映射为 31999', () => {
      const result = buildThinkingConfigFromLegacy(true, 'xhigh');
      expect(result).toEqual({ type: 'enabled', budgetTokens: 31999 });
    });

    it('reasoningEffort=max 应该映射为 31999', () => {
      const result = buildThinkingConfigFromLegacy(true, 'max');
      expect(result).toEqual({ type: 'enabled', budgetTokens: 31999 });
    });
  });

  describe('模型是否支持 adaptive thinking', () => {
    function modelSupportsAdaptiveThinking(modelId: string, providerType: string): boolean {
      const canonical = modelId.toLowerCase();

      // Claude 4.6+ 系列
      if (canonical.includes('opus-4-6') || canonical.includes('sonnet-4-6')) {
        return true;
      }

      // 排除已知的旧模型
      if (
        canonical.includes('opus') ||
        canonical.includes('sonnet') ||
        canonical.includes('haiku')
      ) {
        return false;
      }

      // 1P 和 Foundry 上的未知模型默认支持
      const provider = providerType.toLowerCase();
      return provider === 'anthropic' || provider === 'claude' || provider === 'foundry';
    }

    it('claude-opus-4-6 应该支持 adaptive', () => {
      expect(modelSupportsAdaptiveThinking('claude-opus-4-6', 'anthropic')).toBe(true);
    });

    it('claude-sonnet-4-6 应该支持 adaptive', () => {
      expect(modelSupportsAdaptiveThinking('claude-sonnet-4-6', 'anthropic')).toBe(true);
    });

    it('claude-opus-4 应该不支持 adaptive（旧模型）', () => {
      expect(modelSupportsAdaptiveThinking('claude-opus-4', 'anthropic')).toBe(false);
    });

    it('claude-sonnet-4 应该不支持 adaptive（旧模型）', () => {
      expect(modelSupportsAdaptiveThinking('claude-sonnet-4', 'anthropic')).toBe(false);
    });

    it('claude-haiku-4-5 应该不支持 adaptive', () => {
      expect(modelSupportsAdaptiveThinking('claude-haiku-4-5', 'anthropic')).toBe(false);
    });

    it('未知新模型在 anthropic 上应该支持 adaptive', () => {
      expect(modelSupportsAdaptiveThinking('claude-future-5', 'anthropic')).toBe(true);
    });

    it('未知新模型在 foundry 上应该支持 adaptive', () => {
      expect(modelSupportsAdaptiveThinking('claude-future-5', 'foundry')).toBe(true);
    });

    it('OpenAI 模型不应该支持 adaptive', () => {
      expect(modelSupportsAdaptiveThinking('gpt-4o', 'openai')).toBe(false);
    });

    it('Gemini 模型不应该支持 adaptive', () => {
      expect(modelSupportsAdaptiveThinking('gemini-2.5-pro', 'google')).toBe(false);
    });
  });

  describe('新旧参数优先级', () => {
    function resolveThinkingConfig(input: {
      thinking?: ThinkingConfig;
      thinkingEnabled?: boolean;
      reasoningEffort?: string;
    }): ThinkingConfig | undefined {
      // 优先使用新版 thinking 参数
      if (input.thinking) {
        return input.thinking;
      }

      // 回退到旧版参数
      if (input.thinkingEnabled !== undefined || input.reasoningEffort !== undefined) {
        if (input.thinkingEnabled === false) {
          return { type: 'disabled' };
        }
        const effort = input.reasoningEffort ?? 'medium';
        const BUDGET_MAP: Record<string, number> = {
          medium: 8192,
          high: 16384,
        };
        return { type: 'enabled', budgetTokens: BUDGET_MAP[effort] ?? 8192 };
      }

      return undefined;
    }

    it('同时存在新旧参数时，thinking 应该优先', () => {
      const result = resolveThinkingConfig({
        thinking: { type: 'adaptive' },
        thinkingEnabled: true,
        reasoningEffort: 'high',
      });
      expect(result).toEqual({ type: 'adaptive' });
    });

    it('只有旧版参数时，应该正确转换', () => {
      const result = resolveThinkingConfig({
        thinkingEnabled: true,
        reasoningEffort: 'high',
      });
      expect(result).toEqual({ type: 'enabled', budgetTokens: 16384 });
    });

    it('只有新版参数时，应该直接使用', () => {
      const result = resolveThinkingConfig({
        thinking: { type: 'enabled', budgetTokens: 20000 },
      });
      expect(result).toEqual({ type: 'enabled', budgetTokens: 20000 });
    });

    it('都不存在时，应该返回 undefined', () => {
      const result = resolveThinkingConfig({});
      expect(result).toBeUndefined();
    });
  });

  describe('ThinkingConfig 降级逻辑', () => {
    function applyAdaptiveFallback(
      config: ThinkingConfig,
      modelId: string,
      providerType: string,
    ): ThinkingConfig {
      if (config.type !== 'adaptive') {
        return config;
      }

      const canonical = modelId.toLowerCase();
      if (canonical.includes('opus-4-6') || canonical.includes('sonnet-4-6')) {
        return config; // 支持 adaptive
      }

      // 降级为 enabled + 默认预算
      return { type: 'enabled', budgetTokens: 8192 };
    }

    it('claude-opus-4-6 使用 adaptive 应该保持不变', () => {
      const result = applyAdaptiveFallback({ type: 'adaptive' }, 'claude-opus-4-6', 'anthropic');
      expect(result).toEqual({ type: 'adaptive' });
    });

    it('claude-sonnet-4 使用 adaptive 应该降级为 enabled', () => {
      const result = applyAdaptiveFallback({ type: 'adaptive' }, 'claude-sonnet-4', 'anthropic');
      expect(result).toEqual({ type: 'enabled', budgetTokens: 8192 });
    });

    it('非 adaptive 模式不应该被修改', () => {
      const result = applyAdaptiveFallback(
        { type: 'enabled', budgetTokens: 16384 },
        'claude-sonnet-4',
        'anthropic',
      );
      expect(result).toEqual({ type: 'enabled', budgetTokens: 16384 });
    });
  });
});
