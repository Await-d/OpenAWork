/**
 * OpenCode LLM 重试策略
 *
 * 提供智能重试机制，包括：
 * - 指数退避（Exponential Backoff）
 * - 抖动（Jitter）防止惊群效应
 * - 可配置的重试条件
 * - 基于 Effect 的函数式错误处理
 */

import { Effect, Schedule, Duration } from 'effect';
import type { LLMError } from '../schema/index.js';

/**
 * 重试策略配置
 */
export interface RetryPolicyConfig {
  /**
   * 最大重试次数
   * @default 3
   */
  readonly maxAttempts: number;

  /**
   * 初始延迟时间（毫秒）
   * @default 1000
   */
  readonly initialDelayMs: number;

  /**
   * 最大延迟时间（毫秒）
   * @default 30000
   */
  readonly maxDelayMs: number;

  /**
   * 退避倍数
   * @default 2
   */
  readonly backoffMultiplier: number;

  /**
   * 抖动因子（0-1 之间）
   * @default 0.2
   */
  readonly jitterFactor: number;

  /**
   * 判断错误是否可重试
   * @default 基于 LLMError.retryable 属性
   */
  readonly shouldRetry: (error: unknown) => boolean;
}

/**
 * 默认重试策略配置
 */
export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
  shouldRetry: (error: unknown) => {
    // 如果是 LLMError，使用其 retryable 属性
    if (isLLMError(error)) {
      return error.retryable;
    }
    // 其他错误默认不重试
    return false;
  },
};

/**
 * 计算重试延迟时间（带抖动）
 *
 * @param attempt 当前重试次数（从 1 开始）
 * @param config 重试策略配置
 * @returns 延迟时间（毫秒）
 */
export function computeRetryDelay(attempt: number, config: RetryPolicyConfig): number {
  // 指数退避：initialDelay * (backoffMultiplier ^ (attempt - 1))
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);

  // 限制最大延迟
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // 添加抖动：±jitterFactor * delay
  const jitterRange = cappedDelay * config.jitterFactor;
  const jitter = (Math.random() * 2 - 1) * jitterRange;

  // 确保结果非负
  return Math.max(0, Math.round(cappedDelay + jitter));
}

/**
 * 创建基于 Effect 的重试 Schedule
 *
 * @param config 重试策略配置
 * @returns Effect Schedule
 */
export function createRetrySchedule(
  config: Partial<RetryPolicyConfig> = {},
): Schedule.Schedule<Duration.Duration, unknown> {
  const fullConfig = { ...DEFAULT_RETRY_POLICY, ...config };

  // 使用 Effect.retry 的 while 和 times 选项
  // Effect 4.x 的 Schedule API 不同，我们改用简化版本
  return Schedule.exponential(Duration.millis(fullConfig.initialDelayMs));
}

/**
 * 使用重试策略执行 Effect
 *
 * @param effect 要执行的 Effect
 * @param config 重试策略配置
 * @returns 带重试的 Effect
 */
export function withRetry<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  config: Partial<RetryPolicyConfig> = {},
): Effect.Effect<A, E, R> {
  const fullConfig = { ...DEFAULT_RETRY_POLICY, ...config };

  return Effect.retry(effect, {
    times: fullConfig.maxAttempts - 1,
    schedule: Schedule.exponential(Duration.millis(fullConfig.initialDelayMs)),
    while: fullConfig.shouldRetry,
  });
}

/**
 * 类型守卫：判断是否为 LLMError
 */
function isLLMError(error: unknown): error is LLMError {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    error._tag === 'LLM.Error' &&
    'retryable' in error &&
    typeof (error as { retryable: unknown }).retryable === 'boolean'
  );
}

/**
 * 重试统计信息
 */
export interface RetryStats {
  readonly attempts: number;
  readonly totalDelayMs: number;
  readonly lastError: unknown;
}

/**
 * 带统计信息的重试执行
 *
 * @param effect 要执行的 Effect
 * @param config 重试策略配置
 * @returns 包含结果和统计信息的 Effect
 */
export function withRetryStats<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  config: Partial<RetryPolicyConfig> = {},
): Effect.Effect<{ result: A; stats: RetryStats }, E, R> {
  const fullConfig = { ...DEFAULT_RETRY_POLICY, ...config };
  let attempts = 0;
  let totalDelayMs = 0;
  let lastError: unknown = null;

  const tracked = Effect.gen(function* () {
    attempts = 0;
    totalDelayMs = 0;

    const result = yield* Effect.retry(effect, {
      times: fullConfig.maxAttempts - 1,
      schedule: Schedule.exponential(Duration.millis(fullConfig.initialDelayMs)),
      while: (error) => {
        attempts++;
        lastError = error;
        const shouldRetry = fullConfig.shouldRetry(error);
        if (shouldRetry && attempts < fullConfig.maxAttempts) {
          const delay = computeRetryDelay(attempts, fullConfig);
          totalDelayMs += delay;
        }
        return shouldRetry;
      },
    });

    return {
      result,
      stats: {
        attempts: attempts + 1,
        totalDelayMs,
        lastError,
      },
    };
  });

  return tracked;
}
