import { describe, it, expect, vi } from 'vitest';
import { Cause, Effect, Exit } from 'effect';
import {
  withFallback,
  createFallbackChain,
  createAdaptiveFallback,
  AllFallbacksFailedError,
  type FallbackConfig,
} from './fallback.js';
import { LLMError, RateLimitReason, InvalidRequestReason } from '../schema/index.js';
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

describe('withFallback', () => {
  it('主模型成功应该不降级', async () => {
    const primaryModel = createMockModel('primary');
    const fallbackModel = createMockModel('fallback');
    const request = createMockRequest();

    const execute = vi.fn((model: Model) => Effect.succeed(`result-${model.modelId}`));

    const config: FallbackConfig = {
      fallbackModels: [fallbackModel],
      shouldFallback: () => true,
    };

    const program = withFallback(primaryModel, request, execute, config);
    const result = await Effect.runPromise(program);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.result).toBe('result-primary');
    expect(result.usedModel.modelId).toBe('primary');
    expect(result.primaryFailed).toBe(false);
    expect(result.fallbackHistory).toHaveLength(0);
  });

  it('主模型失败应该降级到备用模型', async () => {
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
              message: 'Rate limit exceeded',
            }),
          }),
        );
      }
      return Effect.succeed(`result-${model.modelId}`);
    });

    const config: FallbackConfig = {
      fallbackModels: [fallbackModel],
      shouldFallback: () => true,
    };

    const program = withFallback(primaryModel, request, execute, config);
    const result = await Effect.runPromise(program);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.result).toBe('result-fallback');
    expect(result.usedModel.modelId).toBe('fallback');
    expect(result.primaryFailed).toBe(true);
    expect(result.fallbackHistory).toHaveLength(1);
    expect(result.fallbackHistory[0]?.model.modelId).toBe('primary');
  });

  it('多级降级应该按顺序尝试', async () => {
    const primaryModel = createMockModel('primary');
    const fallback1 = createMockModel('fallback1');
    const fallback2 = createMockModel('fallback2');
    const request = createMockRequest();

    const execute = vi.fn((model: Model) => {
      if (model.modelId === 'primary' || model.modelId === 'fallback1') {
        return Effect.fail(new Error(`${model.modelId} failed`));
      }
      return Effect.succeed(`result-${model.modelId}`);
    });

    const config: FallbackConfig = {
      fallbackModels: [fallback1, fallback2],
      shouldFallback: () => true,
    };

    const program = withFallback(primaryModel, request, execute, config);
    const result = await Effect.runPromise(program);

    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.result).toBe('result-fallback2');
    expect(result.usedModel.modelId).toBe('fallback2');
    expect(result.fallbackHistory).toHaveLength(2);
  });

  it('所有模型失败应该抛出 AllFallbacksFailedError', async () => {
    const primaryModel = createMockModel('primary');
    const fallbackModel = createMockModel('fallback');
    const request = createMockRequest();

    const execute = vi.fn(() => Effect.fail(new Error('All failed')));

    const config: FallbackConfig = {
      fallbackModels: [fallbackModel],
      shouldFallback: () => true,
    };

    const program = withFallback(primaryModel, request, execute, config);
    const exit = await Effect.runPromiseExit(program);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(AllFallbacksFailedError);
      if (!(error instanceof AllFallbacksFailedError)) return;
      expect(error.attempts).toHaveLength(2);
    }
  });

  it('不可降级错误应该立即失败', async () => {
    const primaryModel = createMockModel('primary');
    const fallbackModel = createMockModel('fallback');
    const request = createMockRequest();

    const error = new LLMError({
      module: 'test',
      method: 'nofallback',
      reason: new InvalidRequestReason({ message: 'Invalid request' }),
    });

    const execute = vi.fn(() => Effect.fail(error));

    const config: FallbackConfig = {
      fallbackModels: [fallbackModel],
      shouldFallback: () => false,
    };

    const program = withFallback(primaryModel, request, execute, config);
    const exit = await Effect.runPromiseExit(program);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('transformRequest 应该修改降级请求', async () => {
    const primaryModel = createMockModel('primary');
    const fallbackModel = createMockModel('fallback');
    const request = createMockRequest();

    const execute = vi.fn((model: Model, req: LLMRequest) => {
      if (model.modelId === 'primary') {
        return Effect.fail(new Error('Primary failed'));
      }
      return Effect.succeed(req);
    });

    const transformRequest = vi.fn((req: LLMRequest, model: Model) => ({
      ...req,
      model,
    }));

    const config: FallbackConfig = {
      fallbackModels: [fallbackModel],
      shouldFallback: () => true,
      transformRequest,
    };

    const program = withFallback(primaryModel, request, execute, config);
    const result = await Effect.runPromise(program);

    expect(transformRequest).toHaveBeenCalledWith(request, fallbackModel);
    expect(result.result.model.modelId).toBe('fallback');
  });
});

describe('createFallbackChain', () => {
  it('应该创建降级链', async () => {
    const models = [createMockModel('m1'), createMockModel('m2'), createMockModel('m3')];
    const request = createMockRequest();

    const execute = vi.fn((model: Model) => {
      if (model.modelId === 'm1') {
        return Effect.fail(new Error('m1 failed'));
      }
      return Effect.succeed(`result-${model.modelId}`);
    });

    const chain = createFallbackChain({
      models,
      execute,
      config: {
        shouldFallback: () => true,
      },
    });

    const result = await Effect.runPromise(chain.execute(request));

    expect(result.result).toBe('result-m2');
    expect(result.usedModel.modelId).toBe('m2');
  });

  it('空模型列表应该抛出错误', () => {
    expect(() =>
      createFallbackChain({
        models: [],
        execute: () => Effect.succeed('test'),
      }),
    ).toThrow('FallbackChain requires at least one model');
  });
});

describe('createAdaptiveFallback', () => {
  it('应该根据错误类型选择降级策略', () => {
    const contextOverflowModel = createMockModel('small-context');
    const rateLimitModel = createMockModel('alternative');
    const defaultModel = createMockModel('default');

    const strategy = createAdaptiveFallback({
      contextOverflow: [contextOverflowModel],
      rateLimit: [rateLimitModel],
      default: [defaultModel],
    });

    // Context overflow error
    const contextError = new LLMError({
      module: 'test',
      method: 'adaptive',
      reason: new InvalidRequestReason({
        message: 'Context overflow',
        classification: 'context-overflow',
      }),
    });

    const contextModels = strategy(contextError);
    expect(contextModels).toEqual([contextOverflowModel]);

    // Rate limit error
    const rateError = new LLMError({
      module: 'test',
      method: 'adaptive',
      reason: new RateLimitReason({
        message: 'Rate limit',
      }),
    });

    const rateModels = strategy(rateError);
    expect(rateModels).toEqual([rateLimitModel]);

    // Unknown error
    const unknownError = new Error('Unknown');
    const defaultModels = strategy(unknownError);
    expect(defaultModels).toEqual([defaultModel]);
  });
});
