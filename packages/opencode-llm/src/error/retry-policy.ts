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
 * 对延迟应用封顶与抖动（computeRetryDelay 与 createRetrySchedule 共用的唯一公式，
 * 保证「推算的统计值」与「Schedule 实际等待」来自同一策略）
 *
 * @param delayMs 指数退避的原始延迟（毫秒）
 * @param config 重试策略配置
 * @returns 封顶并抖动后的延迟（毫秒，非负整数）
 */
function applyCapAndJitter(delayMs: number, config: RetryPolicyConfig): number {
  // 限制最大延迟
  const cappedDelay = Math.min(delayMs, config.maxDelayMs);

  // 添加抖动：±jitterFactor * delay
  const jitterRange = cappedDelay * config.jitterFactor;
  const jitter = (Math.random() * 2 - 1) * jitterRange;

  // 确保结果非负
  return Math.max(0, Math.round(cappedDelay + jitter));
}

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
  return applyCapAndJitter(exponentialDelay, config);
}

/**
 * 创建基于 Effect 的重试 Schedule
 *
 * 与 `computeRetryDelay` 使用同一套退避策略：
 * - `backoffMultiplier` → `Schedule.exponential` 的倍增因子
 * - `maxDelayMs` / `jitterFactor` → `Schedule.modifyDelay` 封顶与抖动
 *
 * @param config 重试策略配置
 * @returns Effect Schedule（每次重试输出等待时长）
 */
export function createRetrySchedule(
  config: Partial<RetryPolicyConfig> = {},
): Schedule.Schedule<Duration.Duration, unknown> {
  const fullConfig = { ...DEFAULT_RETRY_POLICY, ...config };

  return Schedule.exponential(
    Duration.millis(fullConfig.initialDelayMs),
    fullConfig.backoffMultiplier,
  ).pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(Duration.millis(applyCapAndJitter(Duration.toMillis(duration), fullConfig))),
    ),
  );
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
    schedule: createRetrySchedule(fullConfig),
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
 * 统计口径：
 * - `attempts`：总尝试次数（首次执行 + 所有重试）
 * - `totalDelayMs`：按同一重试策略推算的累计等待（与 `createRetrySchedule` 同一公式，
 *   抖动为独立随机采样，`jitterFactor = 0` 时与实际等待逐毫秒一致）
 * - `lastError`：最后一次失败原因（全部成功时为 `null`）
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

  return Effect.gen(function* () {
    // 统计状态放在每次运行内部：同一 Effect 实例被多次 / 并发运行时互不污染
    let retries = 0;
    let totalDelayMs = 0;
    let lastError: unknown = null;

    const result = yield* Effect.retry(effect, {
      times: fullConfig.maxAttempts - 1,
      schedule: createRetrySchedule(fullConfig),
      while: (error) => {
        lastError = error;
        // 重试额度用尽或错误不可重试 → 停止（与 times 上限判定保持一致）
        if (retries >= fullConfig.maxAttempts - 1) return false;
        if (!fullConfig.shouldRetry(error)) return false;
        retries += 1;
        totalDelayMs += computeRetryDelay(retries, fullConfig);
        return true;
      },
    });

    return {
      result,
      stats: {
        attempts: retries + 1,
        totalDelayMs,
        lastError,
      },
    };
  });
}
