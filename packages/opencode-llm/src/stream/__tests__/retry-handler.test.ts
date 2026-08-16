/**
 * 重试处理器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Effect } from 'effect';
import { RetryHandler } from '../retry-handler.js';

describe('RetryHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('基本功能', () => {
    it('应该在成功时直接返回结果', async () => {
      const handler = new RetryHandler({ maxRetries: 3 });
      const fn = vi.fn().mockResolvedValue('success');

      const result = await Effect.runPromise(handler.execute(fn));

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(handler.getAttempt()).toBe(0);
    });

    it('应该在失败后重试', async () => {
      const handler = new RetryHandler({
        maxRetries: 3,
        baseDelay: 10,
        maxDelay: 100,
      });

      let callCount = 0;
      const fn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Network timeout'));
        }
        return Promise.resolve('success');
      });

      const result = await Effect.runPromise(handler.execute(fn));

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(handler.getAttempt()).toBe(0); // 成功后重置
    });

    it('应该在达到最大重试次数后失败', async () => {
      const handler = new RetryHandler({
        maxRetries: 2,
        baseDelay: 10,
        maxDelay: 100,
      });

      const fn = vi.fn().mockRejectedValue(new Error('Network timeout'));

      await expect(Effect.runPromise(handler.execute(fn))).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(3); // 初始 + 2 次重试
    });
  });

  describe('重试策略', () => {
    it('应该只重试可重试的错误', async () => {
      const handler = new RetryHandler({
        maxRetries: 3,
        baseDelay: 10,
      });

      const fn = vi.fn().mockRejectedValue(new Error('Invalid request'));

      await expect(Effect.runPromise(handler.execute(fn))).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1); // 不应该重试
    });

    it('应该使用自定义重试判断', async () => {
      const shouldRetry = vi.fn().mockReturnValue(true);
      const handler = new RetryHandler({
        maxRetries: 2,
        baseDelay: 10,
        shouldRetry,
      });

      let callCount = 0;
      const fn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          return Promise.reject(new Error('Custom error'));
        }
        return Promise.resolve('success');
      });

      const result = await Effect.runPromise(handler.execute(fn));

      expect(result).toBe('success');
      expect(shouldRetry).toHaveBeenCalled();
    });
  });

  describe('延迟策略', () => {
    it('应该应用指数退避', async () => {
      const delays: number[] = [];
      const handler = new RetryHandler({
        maxRetries: 3,
        baseDelay: 100,
        maxDelay: 1000,
        jitter: false,
        onRetry: (_, __, delayMs) => delays.push(delayMs),
      });

      let callCount = 0;
      const fn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 4) {
          return Promise.reject(new Error('Network timeout'));
        }
        return Promise.resolve('success');
      });

      await Effect.runPromise(handler.execute(fn));

      expect(delays).toHaveLength(3);
      expect(delays[0]).toBe(100); // 2^0 * 100
      expect(delays[1]).toBe(200); // 2^1 * 100
      expect(delays[2]).toBe(400); // 2^2 * 100
    });

    it('应该尊重最大延迟限制', async () => {
      const delays: number[] = [];
      const handler = new RetryHandler({
        maxRetries: 5,
        baseDelay: 10,
        maxDelay: 30,
        jitter: false,
        onRetry: (_, __, delayMs) => delays.push(delayMs),
      });

      let callCount = 0;
      const fn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 6) {
          return Promise.reject(new Error('Network timeout'));
        }
        return Promise.resolve('success');
      });

      await Effect.runPromise(handler.execute(fn));

      // 所有延迟都不应该超过 maxDelay
      delays.forEach((delay) => {
        expect(delay).toBeLessThanOrEqual(3000);
      });
    });
  });

  describe('回调', () => {
    it('应该在重试前调用 onRetry', async () => {
      const onRetry = vi.fn();
      const handler = new RetryHandler({
        maxRetries: 2,
        baseDelay: 10,
        onRetry,
      });

      let callCount = 0;
      const fn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Network timeout'));
        }
        return Promise.resolve('success');
      });

      await Effect.runPromise(handler.execute(fn));

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(Number),
        expect.any(Number),
      );
    });
  });

  describe('超时', () => {
    it('应该在超时后失败', async () => {
      const handler = new RetryHandler({
        maxRetries: 3,
        timeout: 50,
      });

      const fn = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve('success'), 100)),
        );

      await expect(Effect.runPromise(handler.executeWithTimeout(fn))).rejects.toThrow(/timed out/i);
    });

    it('应该在超时前成功', async () => {
      const handler = new RetryHandler({
        maxRetries: 3,
        timeout: 100,
      });

      const fn = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve('success'), 20)),
        );

      const result = await Effect.runPromise(handler.executeWithTimeout(fn));
      expect(result).toBe('success');
    });
  });

  describe('状态管理', () => {
    it('应该跟踪重试次数', async () => {
      const handler = new RetryHandler({
        maxRetries: 3,
        baseDelay: 10,
      });

      let callCount = 0;
      const fn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Network timeout'));
        }
        return Promise.resolve('success');
      });

      await Effect.runPromise(handler.execute(fn));
      expect(handler.getAttempt()).toBe(0); // 成功后重置
    });

    it('应该记录最后一次错误', async () => {
      const handler = new RetryHandler({
        maxRetries: 1,
        baseDelay: 10,
      });

      const error = new Error('Network timeout');
      const fn = vi.fn().mockRejectedValue(error);

      try {
        await Effect.runPromise(handler.execute(fn));
      } catch {
        // 预期的错误
      }

      expect(handler.getLastError()).toBe(error);
    });

    it('应该正确重置状态', async () => {
      const handler = new RetryHandler({
        maxRetries: 3,
        baseDelay: 10,
      });

      const fn = vi.fn().mockRejectedValue(new Error('Network timeout'));

      try {
        await Effect.runPromise(handler.execute(fn));
      } catch {
        // 预期的错误
      }

      handler.reset();
      expect(handler.getAttempt()).toBe(0);
      expect(handler.getTotalDelay()).toBe(0);
    });
  });

  describe('静态方法', () => {
    it('应该通过 wrap 方法创建处理器', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await Effect.runPromise(RetryHandler.wrap(fn, { maxRetries: 3 }));

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
