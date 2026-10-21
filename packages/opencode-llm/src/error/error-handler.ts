/**
 * 统一错误处理器
 *
 * 整合重试、断路器、降级等策略，提供高可用的 LLM 调用
 */

import { Effect } from 'effect';
import type { LLMRequest } from '../schema/index.js';
import type { Model } from '../schema/index.js';
import type { CircuitBreakerOpenError } from './circuit-breaker.js';
import { makeCircuitBreakerUnsafe, type CircuitBreakerConfig } from './circuit-breaker.js';
import { withRetry, type RetryPolicyConfig } from './retry-policy.js';
import type { AllFallbacksFailedError } from './fallback.js';
import { withFallback, type FallbackConfig } from './fallback.js';

/**
 * 错误处理策略
 */
export interface ErrorHandlingStrategy {
  /**
   * 启用重试
   * @default true
   */
  readonly enableRetry?: boolean;

  /**
   * 重试策略配置
   */
  readonly retryConfig?: Partial<RetryPolicyConfig>;

  /**
   * 启用断路器
   * @default true
   */
  readonly enableCircuitBreaker?: boolean;

  /**
   * 断路器配置
   */
  readonly circuitBreakerConfig?: Partial<CircuitBreakerConfig>;

  /**
   * 启用降级
   * @default false
   */
  readonly enableFallback?: boolean;

  /**
   * 降级配置
   */
  readonly fallbackConfig?: FallbackConfig;

  /**
   * 错误转换函数：将特定错误转换为更友好的错误
   */
  readonly transformError?: (error: unknown) => unknown;
}

/**
 * 默认错误处理策略
 */
export const DEFAULT_ERROR_HANDLING_STRATEGY: ErrorHandlingStrategy = {
  enableRetry: true,
  enableCircuitBreaker: true,
  enableFallback: false,
};

/**
 * 执行上下文
 */
export interface ExecutionContext<A, E, R> {
  readonly model: Model;
  readonly request: LLMRequest;
  readonly execute: (model: Model, request: LLMRequest) => Effect.Effect<A, E, R>;
  readonly strategy: ErrorHandlingStrategy;
}

/**
 * 创建带完整错误处理的执行器
 *
 * 按照以下顺序应用策略：
 * 1. 断路器（最外层，快速失败）
 * 2. 降级（次外层，模型级别的容错）
 * 3. 重试（最内层，请求级别的容错）
 *
 * @param context 执行上下文
 * @returns 带完整错误处理的 Effect
 */
export function createResilientExecutor<A, E, R>(
  context: ExecutionContext<A, E, R>,
): Effect.Effect<A, E | CircuitBreakerOpenError | AllFallbacksFailedError, R> {
  const { model, request, execute, strategy } = context;
  const {
    enableRetry = true,
    retryConfig,
    enableCircuitBreaker = true,
    circuitBreakerConfig,
    enableFallback = false,
    fallbackConfig,
  } = { ...DEFAULT_ERROR_HANDLING_STRATEGY, ...strategy };

  // 断路器在 executor 构造期同步创建，跨「同一 executor 的多次运行」共享。
  // 若每次运行都重建，失败计数无法累计，断路器将永远不会打开。
  const circuitBreaker = enableCircuitBreaker
    ? makeCircuitBreakerUnsafe(circuitBreakerConfig)
    : null;

  return Effect.gen(function* () {
    // 层次 3：基础执行（可能带重试）
    // 统一用 Effect.suspend 延迟调用：execute 只在 effect 真正执行时被调用，
    // 构造期不得触发（否则被断路器 / 降级拦截的 effect 仍会调用 execute）。
    const executeWithRetry = (m: Model, req: LLMRequest) => {
      if (!enableRetry) {
        return Effect.suspend(() => execute(m, req));
      }
      return withRetry(
        Effect.suspend(() => execute(m, req)),
        retryConfig,
      );
    };

    // 层次 2：降级
    let effectWithFallback: Effect.Effect<A, E | AllFallbacksFailedError, R>;
    if (enableFallback && fallbackConfig) {
      effectWithFallback = Effect.flatMap(
        withFallback(model, request, executeWithRetry, fallbackConfig),
        (fallbackResult) => Effect.succeed(fallbackResult.result),
      );
    } else {
      effectWithFallback = executeWithRetry(model, request);
    }

    // 层次 1：断路器
    if (circuitBreaker) {
      const result = yield* circuitBreaker.protect(effectWithFallback);
      return result;
    }

    // 执行
    const result = yield* effectWithFallback;

    return result;
  });
}

/**
 * 预设策略：激进重试（用于开发/测试）
 */
export const AGGRESSIVE_RETRY_STRATEGY: ErrorHandlingStrategy = {
  enableRetry: true,
  retryConfig: {
    maxAttempts: 5,
    initialDelayMs: 500,
    maxDelayMs: 10000,
    backoffMultiplier: 1.5,
    jitterFactor: 0.1,
  },
  enableCircuitBreaker: false,
  enableFallback: false,
};

/**
 * 预设策略：保守重试（用于生产环境）
 */
export const CONSERVATIVE_RETRY_STRATEGY: ErrorHandlingStrategy = {
  enableRetry: true,
  retryConfig: {
    maxAttempts: 3,
    initialDelayMs: 2000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterFactor: 0.2,
  },
  enableCircuitBreaker: true,
  circuitBreakerConfig: {
    failureThreshold: 5,
    successThreshold: 2,
    timeoutMs: 60000,
  },
  enableFallback: false,
};

/**
 * 预设策略：高可用（启用所有容错机制）
 */
export const HIGH_AVAILABILITY_STRATEGY: ErrorHandlingStrategy = {
  enableRetry: true,
  retryConfig: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterFactor: 0.2,
  },
  enableCircuitBreaker: true,
  circuitBreakerConfig: {
    failureThreshold: 3,
    successThreshold: 2,
    timeoutMs: 30000,
  },
  enableFallback: true,
};

/**
 * 预设策略：快速失败（不重试，用于延迟敏感场景）
 */
export const FAIL_FAST_STRATEGY: ErrorHandlingStrategy = {
  enableRetry: false,
  enableCircuitBreaker: false,
  enableFallback: false,
};

/**
 * 提取 LLMError 形状错误的 `reason._tag`（失败原因标签）。
 * 非 LLMError 形状的未知错误（普通 Error、null、原始值等）返回 `undefined`。
 */
function reasonTagOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('reason' in error)) {
    return undefined;
  }
  const reason = error.reason;
  if (typeof reason !== 'object' || reason === null || !('_tag' in reason)) {
    return undefined;
  }
  const tag = reason._tag;
  return typeof tag === 'string' ? tag : undefined;
}

/**
 * 错误分类助手
 */
export const ErrorClassifier = {
  /**
   * 是否为网络错误
   */
  isNetworkError: (error: unknown): boolean => reasonTagOf(error) === 'Transport',

  /**
   * 是否为速率限制错误
   */
  isRateLimitError: (error: unknown): boolean => reasonTagOf(error) === 'RateLimit',

  /**
   * 是否为认证错误
   */
  isAuthenticationError: (error: unknown): boolean => reasonTagOf(error) === 'Authentication',

  /**
   * 是否为上下文溢出错误
   */
  isContextOverflowError: (error: unknown): boolean => {
    if (typeof error !== 'object' || error === null || !('reason' in error)) {
      return false;
    }
    const reason = error.reason;
    if (typeof reason !== 'object' || reason === null) {
      return false;
    }
    const { _tag, classification } = reason as { _tag?: unknown; classification?: unknown };
    return _tag === 'InvalidRequest' && classification === 'context-overflow';
  },

  /**
   * 是否为可重试错误
   */
  isRetryable: (error: unknown): boolean => {
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

  /**
   * 获取重试延迟时间（如果错误中包含）
   */
  getRetryAfterMs: (error: unknown): number | undefined => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'retryAfterMs' in error &&
      typeof error.retryAfterMs === 'number'
    ) {
      return (error as { retryAfterMs: number }).retryAfterMs;
    }
    return undefined;
  },
};
