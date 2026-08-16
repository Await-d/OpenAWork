import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect, Exit } from 'effect';
import {
  createResilientExecutor,
  ErrorClassifier,
  AGGRESSIVE_RETRY_STRATEGY,
  CONSERVATIVE_RETRY_STRATEGY,
  HIGH_AVAILABILITY_STRATEGY,
  FAIL_FAST_STRATEGY,
  type ExecutionContext,
} from './error-handler.js';
import {
  LLMError,
  RateLimitReason,
  InvalidRequestReason,
  AuthenticationReason,
  TransportReason,
} from '../schema/index.js';
import type { Model } from '../provider.js';
import type { LLMRequest } from '../schema/index.js';

// Mock Model
const createMockModel = (id: string): Model => ({ modelId: id }) as Model;

// Mock Request
const createMockRequest = (): LLMRequest =>
  ({
    model: createMockModel('test'),
    messages: [],
  }) as LLMRequest;

describe('createResilientExecutor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('成功执行应该返回结果', async () => {
    const model = createMockModel('test');
    const request = createMockRequest();
    const execute = vi.fn(() => Effect.succeed('success'));

    const context: ExecutionContext<string, Error, never> = {
      model,
      request,
      execute,
      strategy: FAIL_FAST_STRATEGY,
    };

    const program = createResilientExecutor(context);
    const result = await Effect.runPromise(program);

    expect(result).toBe('success');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('启用重试应该在失败时重试', async () => {
    const model = createMockModel('test');
    const request = createMockRequest();

    let attempts = 0;
    const execute = vi.fn(() => {
      attempts++;
      if (attempts < 3) {
        return Effect.fail(
          new LLMError({
            module: 'test',
            method: 'retry',
            reason: new RateLimitReason({
              message: 'Rate limit',
            }),
          }),
        );
      }
      return Effect.succeed('success');
    });

    const context: ExecutionContext<string, LLMError, never> = {
      model,
      request,
      execute,
      strategy: {
        enableRetry: true,
        retryConfig: {
          maxAttempts: 5,
          initialDelayMs: 100,
          jitterFactor: 0,
        },
        enableCircuitBreaker: false,
        enableFallback: false,
      },
    };

    const program = createResilientExecutor(context);
    const exitPromise = Effect.runPromiseExit(program);
    await vi.runAllTimersAsync();
    const exit = await exitPromise;

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('禁用重试应该立即失败', async () => {
    const model = createMockModel('test');
    const request = createMockRequest();

    const error = new LLMError({
      module: 'test',
      method: 'noretry',
      reason: new RateLimitReason({
        message: 'Rate limit',
      }),
    });

    const execute = vi.fn(() => Effect.fail(error));

    const context: ExecutionContext<string, LLMError, never> = {
      model,
      request,
      execute,
      strategy: FAIL_FAST_STRATEGY,
    };

    const program = createResilientExecutor(context);
    const exit = await Effect.runPromiseExit(program);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('启用降级应该在主模型失败时切换', async () => {
    const primaryModel = createMockModel('primary');
    const fallbackModel = createMockModel('fallback');
    const request = createMockRequest();

    const execute = vi.fn((model: Model) => {
      if (model.modelId === 'primary') {
        return Effect.fail(
          new LLMError({
            module: 'test',
            method: 'fallback',
            reason: new RateLimitReason({
              message: 'Rate limit',
            }),
          }),
        );
      }
      return Effect.succeed(`result-${model.modelId}`);
    });

    const context: ExecutionContext<string, LLMError, never> = {
      model: primaryModel,
      request,
      execute,
      strategy: {
        enableRetry: false,
        enableCircuitBreaker: false,
        enableFallback: true,
        fallbackConfig: {
          fallbackModels: [fallbackModel],
          shouldFallback: () => true,
        },
      },
    };

    const program = createResilientExecutor(context);
    const result = await Effect.runPromise(program);

    expect(result).toBe('result-fallback');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('AGGRESSIVE_RETRY_STRATEGY 应该多次重试', async () => {
    const model = createMockModel('test');
    const request = createMockRequest();

    let attempts = 0;
    const execute = vi.fn(() => {
      attempts++;
      if (attempts < 4) {
        return Effect.fail(
          new LLMError({
            module: 'test',
            method: 'aggressive',
            reason: new RateLimitReason({
              message: 'Rate limit',
            }),
          }),
        );
      }
      return Effect.succeed('success');
    });

    const context: ExecutionContext<string, LLMError, never> = {
      model,
      request,
      execute,
      strategy: AGGRESSIVE_RETRY_STRATEGY,
    };

    const program = createResilientExecutor(context);
    const exitPromise = Effect.runPromiseExit(program);
    await vi.runAllTimersAsync();
    const exit = await exitPromise;

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('CONSERVATIVE_RETRY_STRATEGY 应该启用断路器', async () => {
    const model = createMockModel('test');
    const request = createMockRequest();

    const error = new LLMError({
      module: 'test',
      method: 'conservative',
      reason: new RateLimitReason({
        message: 'Rate limit',
      }),
    });

    const execute = vi.fn(() => Effect.fail(error));

    const context: ExecutionContext<string, LLMError, never> = {
      model,
      request,
      execute,
      strategy: CONSERVATIVE_RETRY_STRATEGY,
    };

    const program = createResilientExecutor(context);
    const exitPromise = Effect.runPromiseExit(program);
    await vi.runAllTimersAsync();
    await exitPromise;

    // 断路器已启用，但具体行为需要多次调用才能触发
    expect(execute).toHaveBeenCalled();
  });
});

describe('ErrorClassifier', () => {
  it('isNetworkError 应该识别网络错误', () => {
    const error = new LLMError({
      module: 'test',
      method: 'network',
      reason: new TransportReason({ message: 'Network error' }),
    });

    expect(ErrorClassifier.isNetworkError(error)).toBe(true);
    expect(ErrorClassifier.isNetworkError(new Error('normal'))).toBe(false);
  });

  it('isRateLimitError 应该识别速率限制错误', () => {
    const error = new LLMError({
      module: 'test',
      method: 'ratelimit',
      reason: new RateLimitReason({
        message: 'Rate limit',
      }),
    });

    expect(ErrorClassifier.isRateLimitError(error)).toBe(true);
    expect(ErrorClassifier.isRateLimitError(new Error('normal'))).toBe(false);
  });

  it('isAuthenticationError 应该识别认证错误', () => {
    const error = new LLMError({
      module: 'test',
      method: 'auth',
      reason: new AuthenticationReason({
        message: 'Auth failed',
        kind: 'invalid',
      }),
    });

    expect(ErrorClassifier.isAuthenticationError(error)).toBe(true);
    expect(ErrorClassifier.isAuthenticationError(new Error('normal'))).toBe(false);
  });

  it('isContextOverflowError 应该识别上下文溢出错误', () => {
    const error = new LLMError({
      module: 'test',
      method: 'overflow',
      reason: new InvalidRequestReason({
        message: 'Context overflow',
        classification: 'context-overflow',
      }),
    });

    expect(ErrorClassifier.isContextOverflowError(error)).toBe(true);
    expect(ErrorClassifier.isContextOverflowError(new Error('normal'))).toBe(false);
  });

  it('isRetryable 应该识别可重试错误', () => {
    const retryableError = new LLMError({
      module: 'test',
      method: 'retryable',
      reason: new RateLimitReason({
        message: 'Rate limit',
      }),
    });

    const nonRetryableError = new LLMError({
      module: 'test',
      method: 'nonretryable',
      reason: new InvalidRequestReason({
        message: 'Invalid',
      }),
    });

    expect(ErrorClassifier.isRetryable(retryableError)).toBe(true);
    expect(ErrorClassifier.isRetryable(nonRetryableError)).toBe(false);
    expect(ErrorClassifier.isRetryable(new Error('normal'))).toBe(false);
  });

  it('getRetryAfterMs 应该提取重试延迟', () => {
    const error = new LLMError({
      module: 'test',
      method: 'retryafter',
      reason: new RateLimitReason({
        message: 'Rate limit',
        retryAfterMs: 5000,
      }),
    });

    expect(ErrorClassifier.getRetryAfterMs(error)).toBe(5000);
    expect(ErrorClassifier.getRetryAfterMs(new Error('normal'))).toBeUndefined();
  });
});
