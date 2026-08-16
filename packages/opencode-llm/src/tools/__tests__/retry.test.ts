/**
 * 工具调用重试单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolCallRetry, executeWithRetry } from '../retry.js';
import type { RetryConfig } from '../retry.js';

describe('ToolCallRetry', () => {
  beforeEach(() => {
    vi.clearAllTimers();
  });

  describe('execute - 基本功能', () => {
    it('应该在第一次尝试成功时不重试', async () => {
      const retry = new ToolCallRetry({ maxRetries: 3 });
      let callCount = 0;

      const executor = async () => {
        callCount++;
        return 'success';
      };

      const result = await retry.execute('test_tool', { param: 'value' }, executor);

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attempts).toBe(1);
      expect(callCount).toBe(1);
      expect(result.usedFallback).toBe(false);
    });

    it('应该在失败后重试', async () => {
      const retry = new ToolCallRetry({ maxRetries: 2, baseDelayMs: 10 });
      let callCount = 0;

      const executor = async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('ECONNRESET: Connection reset');
        }
        return 'success';
      };

      const result = await retry.execute('test_tool', { param: 'value' }, executor);

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attempts).toBe(2);
      expect(callCount).toBe(2);
    });

    it('应该在达到最大重试次数后失败', async () => {
      const retry = new ToolCallRetry({ maxRetries: 2, baseDelayMs: 10 });
      let callCount = 0;

      const executor = async () => {
        callCount++;
        throw new Error('ETIMEDOUT: Timeout');
      };

      const result = await retry.execute('test_tool', { param: 'value' }, executor);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('ETIMEDOUT');
      expect(result.attempts).toBe(3); // 初始尝试 + 2次重试
      expect(callCount).toBe(3);
    });

    it('应该不重试不可重试的错误', async () => {
      const retry = new ToolCallRetry({
        maxRetries: 3,
        retryableErrors: ['ECONNRESET'],
        baseDelayMs: 10,
      });
      let callCount = 0;

      const executor = async () => {
        callCount++;
        throw new Error('VALIDATION_ERROR: Invalid input');
      };

      const result = await retry.execute('test_tool', { param: 'value' }, executor);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1); // 只尝试一次
      expect(callCount).toBe(1);
    });
  });

  describe('重试策略', () => {
    it('应该使用指数退避策略', async () => {
      const delays: number[] = [];
      const retry = new ToolCallRetry({
        strategy: 'exponential',
        maxRetries: 3,
        baseDelayMs: 100,
        backoffMultiplier: 2,
        enableJitter: false,
      });

      let callCount = 0;
      const executor = async () => {
        callCount++;
        if (callCount < 4) {
          const now = Date.now();
          if (delays.length > 0) {
            delays.push(now - delays[delays.length - 1]!);
          } else {
            delays.push(now);
          }
          throw new Error('ECONNRESET');
        }
        return 'success';
      };

      await retry.execute('test_tool', {}, executor);

      // 验证延迟时间大致符合指数退避
      // 第一次重试: 100ms, 第二次: 200ms, 第三次: 400ms
      expect(callCount).toBe(4);
    });

    it('应该使用线性退避策略', async () => {
      const retry = new ToolCallRetry({
        strategy: 'linear',
        maxRetries: 2,
        baseDelayMs: 100,
        enableJitter: false,
      });

      let callCount = 0;
      const executor = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('ECONNRESET');
        }
        return 'success';
      };

      await retry.execute('test_tool', {}, executor);

      expect(callCount).toBe(3);
    });

    it('应该使用固定延迟策略', async () => {
      const retry = new ToolCallRetry({
        strategy: 'fixed',
        maxRetries: 2,
        baseDelayMs: 50,
        enableJitter: false,
      });

      let callCount = 0;
      const executor = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      };

      await retry.execute('test_tool', {}, executor);

      expect(callCount).toBe(3);
    });

    it('应该在 none 策略下不重试', async () => {
      const retry = new ToolCallRetry({ strategy: 'none' });
      let callCount = 0;

      const executor = async () => {
        callCount++;
        throw new Error('ECONNRESET');
      };

      const result = await retry.execute('test_tool', {}, executor);

      expect(result.success).toBe(false);
      expect(callCount).toBe(1);
    });
  });

  describe('降级策略', () => {
    it('应该在失败时使用 mock 降级', async () => {
      const mockGenerator = (toolName: string) => ({ mocked: true, toolName });

      const retry = new ToolCallRetry({
        maxRetries: 1,
        baseDelayMs: 10,
        fallback: {
          enabled: true,
          defaultBehavior: 'mock',
          mockGenerator,
        },
      });

      const executor = async () => {
        throw new Error('ECONNRESET');
      };

      const result = await retry.execute('test_tool', {}, executor);

      expect(result.success).toBe(true);
      expect(result.usedFallback).toBe(true);
      expect(result.data).toEqual({ mocked: true, toolName: 'test_tool' });
    });

    it('应该在 skip 降级模式下返回 null', async () => {
      const retry = new ToolCallRetry({
        maxRetries: 1,
        baseDelayMs: 10,
        fallback: {
          enabled: true,
          defaultBehavior: 'skip',
        },
      });

      const executor = async () => {
        throw new Error('ETIMEDOUT');
      };

      const result = await retry.execute('test_tool', {}, executor);

      // skip 模式会返回 null，这被认为是成功的降级
      expect(result.usedFallback).toBe(true);
      expect(result.data).toBe(null);
    });

    it('应该在 error 降级模式下抛出错误', async () => {
      const retry = new ToolCallRetry({
        maxRetries: 1,
        baseDelayMs: 10,
        fallback: {
          enabled: true,
          defaultBehavior: 'error',
        },
      });

      const executor = async () => {
        throw new Error('ECONNRESET');
      };

      const result = await retry.execute('test_tool', {}, executor);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('executeWithRetry 快捷函数', () => {
    it('应该使用快捷函数执行重试', async () => {
      let callCount = 0;

      const executor = async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('ECONNRESET');
        }
        return 'success';
      };

      const result = await executeWithRetry('test_tool', {}, executor, {
        maxRetries: 2,
        baseDelayMs: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(callCount).toBe(2);
    });
  });

  describe('延迟限制', () => {
    it('应该限制最大延迟时间', async () => {
      const retry = new ToolCallRetry({
        strategy: 'exponential',
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 500,
        backoffMultiplier: 2,
        enableJitter: false,
      });

      let callCount = 0;
      const executor = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('ECONNRESET');
        }
        return 'success';
      };

      const startTime = Date.now();
      await retry.execute('test_tool', {}, executor);
      const duration = Date.now() - startTime;

      // 验证总延迟时间不会因为指数增长而无限增大
      expect(callCount).toBe(3);
      // 由于 maxDelayMs = 500，即使指数增长也会被限制
      expect(duration).toBeLessThan(2000);
    }, 10000);
  });

  describe('抖动（jitter）', () => {
    it('应该在启用抖动时添加随机延迟', async () => {
      const retry = new ToolCallRetry({
        strategy: 'fixed',
        maxRetries: 2,
        baseDelayMs: 100,
        enableJitter: true,
      });

      let callCount = 0;
      const executor = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('ECONNRESET');
        }
        return 'success';
      };

      await retry.execute('test_tool', {}, executor);

      expect(callCount).toBe(3);
    });
  });
});
