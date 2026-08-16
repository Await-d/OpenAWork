/**
 * 端到端集成测试 - 简化版
 *
 * 验证 opencode-llm 包的核心功能集成
 */

import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';

describe('OpenCode LLM 端到端集成测试', () => {
  describe('包导出验证', () => {
    it('应该成功导出核心模块', async () => {
      const { LLMClient } = await import('../../route/client.js');
      const { Auth } = await import('../../route/auth.js');
      const { Provider } = await import('../../provider.js');

      expect(LLMClient).toBeDefined();
      expect(Auth).toBeDefined();
      expect(Provider).toBeDefined();
    });

    it('应该成功导出 Schema 模块', async () => {
      const { LLMRequest, Model, ProviderID } = await import('../../schema/index.js');

      expect(LLMRequest).toBeDefined();
      expect(Model).toBeDefined();
      expect(ProviderID).toBeDefined();
    });

    it('应该成功导出 Tool 模块', async () => {
      const { Tool } = await import('../../tool.js');
      const { ToolRuntime } = await import('../../tool-runtime.js');

      expect(Tool).toBeDefined();
      expect(ToolRuntime).toBeDefined();
    });

    it('应该成功导出错误处理模块', async () => {
      const { createCircuitBreaker } = await import('../../error/circuit-breaker.js');
      const { withRetry } = await import('../../error/retry-policy.js');
      const { withFallback } = await import('../../error/fallback.js');

      expect(createCircuitBreaker).toBeDefined();
      expect(withRetry).toBeDefined();
      expect(withFallback).toBeDefined();
    });

    it('应该成功导出流处理模块', async () => {
      const { StreamProcessor } = await import('../../stream/processor.js');
      const { IncrementalJsonParser } = await import('../../stream/incremental-json-parser.js');
      const { BackpressureController } = await import('../../stream/backpressure.js');

      expect(StreamProcessor).toBeDefined();
      expect(IncrementalJsonParser).toBeDefined();
      expect(BackpressureController).toBeDefined();
    });
  });

  describe('Effect 类型系统集成', () => {
    it('应该正确使用 Effect 创建成功效果', async () => {
      const effect = Effect.succeed(42);
      const result = await Effect.runPromise(effect);

      expect(result).toBe(42);
    });

    it('应该正确使用 Effect 处理失败', async () => {
      const effect = Effect.fail(new Error('Test error'));

      await expect(Effect.runPromise(effect)).rejects.toThrow('Test error');
    });

    it('应该正确使用 Effect.gen 进行组合', async () => {
      const effect = Effect.gen(function* () {
        const a = yield* Effect.succeed(10);
        const b = yield* Effect.succeed(20);
        return a + b;
      });

      const result = await Effect.runPromise(effect);
      expect(result).toBe(30);
    });
  });

  describe('Provider 集成', () => {
    it('应该能够创建 Provider 实例', async () => {
      const { Provider } = await import('../../provider.js');

      const provider = Provider.make('openai');
      expect(provider).toBeDefined();
    });

    it('应该能够创建多个不同的 Provider', async () => {
      const { Provider } = await import('../../provider.js');

      const openaiProvider = Provider.make('openai');
      const anthropicProvider = Provider.make('anthropic');

      expect(openaiProvider).toBeDefined();
      expect(anthropicProvider).toBeDefined();
    });
  });

  describe('重试策略集成', () => {
    it('应该能够创建重试策略', async () => {
      const { withRetry } = await import('../../error/retry-policy.js');

      const effect = Effect.succeed('test');
      const withRetryEffect = withRetry(effect);

      expect(withRetryEffect).toBeDefined();
    });

    it('应该支持自定义重试配置', async () => {
      const { withRetry } = await import('../../error/retry-policy.js');

      const effect = Effect.succeed('test');
      const withRetryEffect = withRetry(effect, {
        maxAttempts: 5,
        initialDelayMs: 100,
      });

      const result = await Effect.runPromise(withRetryEffect);
      expect(result).toBe('test');
    });
  });

  describe('断路器集成', () => {
    it('应该能够创建断路器', async () => {
      const { createCircuitBreaker } = await import('../../error/circuit-breaker.js');

      const breaker = createCircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeoutMs: 60000,
        halfOpenMaxConcurrency: 1,
      });

      expect(breaker).toBeDefined();
    });
  });

  describe('流处理器集成', () => {
    it('应该能够创建流处理器', async () => {
      const { StreamProcessor } = await import('../../stream/processor.js');

      const processor = new StreamProcessor({
        incrementalJson: true,
        idleTimeout: 5000,
      });

      expect(processor).toBeDefined();
      expect(processor.getStats).toBeDefined();
    });

    it('应该能够创建增量 JSON 解析器', async () => {
      const { IncrementalJsonParser } = await import('../../stream/incremental-json-parser.js');

      const parser = new IncrementalJsonParser();

      expect(parser).toBeDefined();
      expect(parser.append).toBeDefined();
    });

    it('应该能够创建背压控制器', async () => {
      const { BackpressureController } = await import('../../stream/backpressure.js');

      const controller = new BackpressureController({
        maxQueueSize: 10,
        maxBufferBytes: 1000,
        highWaterMark: 0.8,
        lowWaterMark: 0.2,
      });

      expect(controller).toBeDefined();
      expect(controller.push).toBeDefined();
      expect(controller.pull).toBeDefined();
    });
  });

  describe('协议支持集成', () => {
    it('应该支持 OpenAI Chat 协议', async () => {
      const OpenAIChat = await import('../../protocols/openai-chat.js');

      expect(OpenAIChat.route).toBeDefined();
    });

    it('应该支持协议路由配置', async () => {
      const OpenAIChat = await import('../../protocols/openai-chat.js');

      const route = OpenAIChat.route.with({
        endpoint: { baseURL: 'https://api.openai.com/v1' },
      });

      expect(route).toBeDefined();
      expect(route.id).toBeDefined();
    });
  });

  describe('模块依赖完整性', () => {
    it('所有核心模块应该可以正常加载', async () => {
      const modules = [
        '../../index.js',
        '../../provider.js',
        '../../tool.js',
        '../../tool-runtime.js',
        '../../llm.js',
      ];

      for (const modulePath of modules) {
        const module = await import(modulePath);
        expect(module).toBeDefined();
      }
    });

    it('所有错误处理模块应该可以正常加载', async () => {
      const modules = [
        '../../error/circuit-breaker.js',
        '../../error/retry-policy.js',
        '../../error/fallback.js',
        '../../error/error-handler.js',
      ];

      for (const modulePath of modules) {
        const module = await import(modulePath);
        expect(module).toBeDefined();
      }
    });

    it('所有流处理模块应该可以正常加载', async () => {
      const modules = [
        '../../stream/processor.js',
        '../../stream/incremental-json-parser.js',
        '../../stream/backpressure.js',
        '../../stream/retry-handler.js',
        '../../stream/utils.js',
      ];

      for (const modulePath of modules) {
        const module = await import(modulePath);
        expect(module).toBeDefined();
      }
    });
  });
});
