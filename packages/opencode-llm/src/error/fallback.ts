/**
 * 优雅降级（Graceful Fallback）
 *
 * 当主模型失败时，自动切换到备用模型，确保服务可用性：
 * - 支持多级降级链
 * - 保留原始请求上下文
 * - 记录降级历史
 */

import { Cause, Effect, Option } from 'effect';
import type { LLMRequest } from '../schema/index.js';
import type { Model } from '../schema/index.js';

/**
 * 降级策略配置
 */
export interface FallbackConfig {
  /**
   * 备用模型列表（按优先级排序）
   */
  readonly fallbackModels: ReadonlyArray<Model>;

  /**
   * 判断错误是否应该触发降级
   * @default 所有可重试的错误都触发降级
   */
  readonly shouldFallback: (error: unknown) => boolean;

  /**
   * 降级时是否修改请求参数
   * @default 保持原始参数
   */
  readonly transformRequest?: (request: LLMRequest, fallbackModel: Model) => LLMRequest;
}

/**
 * 默认降级配置
 */
export const DEFAULT_FALLBACK_CONFIG: Partial<FallbackConfig> = {
  shouldFallback: (error: unknown) => {
    // 检查是否为可重试的 LLM 错误
    if (
      typeof error === 'object' &&
      error !== null &&
      'retryable' in error &&
      typeof error.retryable === 'boolean'
    ) {
      return (error as { retryable: boolean }).retryable;
    }
    return false;
  },
};

/**
 * 降级历史记录
 */
export interface FallbackAttempt {
  readonly model: Model;
  readonly error: unknown;
  readonly attemptedAt: number;
}

/**
 * 降级结果
 */
export interface FallbackResult<A> {
  readonly result: A;
  readonly usedModel: Model;
  readonly fallbackHistory: ReadonlyArray<FallbackAttempt>;
  readonly primaryFailed: boolean;
}

/**
 * 所有降级选项都失败的错误
 */
export class AllFallbacksFailedError extends Error {
  readonly _tag = 'AllFallbacksFailed';
  readonly attempts: ReadonlyArray<FallbackAttempt>;

  constructor(attempts: ReadonlyArray<FallbackAttempt>) {
    const lastError = attempts.length > 0 ? attempts[attempts.length - 1]?.error : undefined;
    super(
      `All fallback models failed. Tried ${attempts.length} model(s). Last error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
    this.name = 'AllFallbacksFailedError';
    this.attempts = attempts;
  }
}

/**
 * 使用降级策略执行 Effect
 *
 * @param primaryModel 主模型
 * @param request LLM 请求
 * @param execute 执行函数
 * @param config 降级配置
 * @returns 带降级的 Effect
 */
export function withFallback<A, E, R>(
  primaryModel: Model,
  request: LLMRequest,
  execute: (model: Model, request: LLMRequest) => Effect.Effect<A, E, R>,
  config: FallbackConfig,
): Effect.Effect<FallbackResult<A>, AllFallbacksFailedError | E, R> {
  const { fallbackModels, shouldFallback, transformRequest } = {
    ...DEFAULT_FALLBACK_CONFIG,
    ...config,
  };

  return Effect.gen(function* () {
    const history: FallbackAttempt[] = [];

    // 构建模型列表：主模型 + 备用模型
    const models = [primaryModel, ...fallbackModels];

    // 尝试每个模型
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      if (!model) continue;

      // 如果有 transformRequest，使用转换后的请求
      const effectiveRequest =
        transformRequest && i > 0 ? transformRequest(request, model) : request;

      // 尝试执行，使用 exit 代替 either
      const exit = yield* Effect.exit(execute(model, effectiveRequest));

      if (exit._tag === 'Success') {
        // 成功
        return {
          result: exit.value,
          usedModel: model,
          fallbackHistory: history,
          primaryFailed: i > 0,
        };
      }

      // 失败：记录历史
      const error = Option.getOrElse(
        Cause.findErrorOption(exit.cause),
        () => new AllFallbacksFailedError(history),
      );
      history.push({
        model,
        error,
        attemptedAt: Date.now(),
      });

      // 检查是否应该继续降级
      const isLastModel = i === models.length - 1;
      if (isLastModel || !shouldFallback(error)) {
        // 最后一个模型失败，或错误不应该触发降级
        // 如果是主模型的非降级错误，直接抛出原始错误
        if (i === 0 && !shouldFallback(error)) {
          return yield* Effect.fail(error);
        }
        // 否则抛出所有降级失败错误
        return yield* Effect.fail(new AllFallbacksFailedError(history));
      }

      // 继续尝试下一个模型
    }

    // 理论上不会到达这里，但为了类型安全
    return yield* Effect.fail(new AllFallbacksFailedError(history));
  });
}

/**
 * 创建降级链
 *
 * 提供更简洁的 API，自动处理模型切换逻辑
 *
 * @example
 * ```ts
 * const chain = createFallbackChain({
 *   models: [primaryModel, fallback1, fallback2],
 *   execute: (model, request) => LLM.generate(request),
 * })
 *
 * const result = await Effect.runPromise(
 *   chain.execute(request)
 * )
 * ```
 */
export function createFallbackChain<A, E, R>(options: {
  readonly models: ReadonlyArray<Model>;
  readonly execute: (model: Model, request: LLMRequest) => Effect.Effect<A, E, R>;
  readonly config?: Partial<Omit<FallbackConfig, 'fallbackModels'>>;
}) {
  const { models, execute, config = {} } = options;

  if (models.length === 0) {
    throw new Error('FallbackChain requires at least one model');
  }

  const [primaryModel, ...fallbackModels] = models;

  return {
    execute: (request: LLMRequest) =>
      withFallback(primaryModel!, request, execute, {
        ...config,
        fallbackModels,
      } as FallbackConfig),

    models,
  };
}

/**
 * 降级策略：根据错误类型选择不同的备用模型
 *
 * @example
 * ```ts
 * const strategy = createAdaptiveFallback({
 *   contextOverflow: [smallContextModel],
 *   rateLimit: [alternativeProviderModel],
 *   default: [generalFallbackModel],
 * })
 * ```
 */
export function createAdaptiveFallback(strategies: {
  readonly contextOverflow?: ReadonlyArray<Model>;
  readonly rateLimit?: ReadonlyArray<Model>;
  readonly authentication?: ReadonlyArray<Model>;
  readonly default: ReadonlyArray<Model>;
}): (error: unknown) => ReadonlyArray<Model> {
  return (error: unknown) => {
    // 检查错误类型
    if (
      typeof error === 'object' &&
      error !== null &&
      'reason' in error &&
      typeof error.reason === 'object' &&
      (error as { reason: { _tag?: unknown } }).reason !== null
    ) {
      const reason = (error as { reason: { _tag?: string } }).reason;
      const tag = reason._tag;

      switch (tag) {
        case 'InvalidRequest':
          // 检查是否为 context-overflow
          if ('classification' in reason && reason.classification === 'context-overflow') {
            return strategies.contextOverflow ?? strategies.default;
          }
          break;
        case 'RateLimit':
          return strategies.rateLimit ?? strategies.default;
        case 'Authentication':
          return strategies.authentication ?? strategies.default;
      }
    }

    return strategies.default;
  };
}
