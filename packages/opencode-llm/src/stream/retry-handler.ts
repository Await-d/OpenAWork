/**
 * 错误重试处理器
 *
 * 提供网络中断、超时等场景的自动重试功能，支持指数退避策略。
 */

import { Effect, Option } from 'effect';
import { LLMError } from '../schema/index.js';
import { calculateBackoff, isRetryableError, streamError } from './utils.js';

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 基础延迟时间（毫秒） */
  baseDelay: number;
  /** 最大延迟时间（毫秒） */
  maxDelay: number;
  /** 是否添加随机抖动 */
  jitter: boolean;
  /** 超时时间（毫秒） */
  timeout: number;
  /** 自定义重试判断函数 */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** 重试前的回调 */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: true,
  timeout: 60000,
};

/**
 * 重试状态
 */
interface RetryState {
  /** 当前重试次数 */
  attempt: number;
  /** 最后一次错误 */
  lastError?: unknown;
  /** 总延迟时间 */
  totalDelay: number;
}

/**
 * 重试处理器
 */
export class RetryHandler {
  private config: RetryConfig;
  private state: RetryState;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      ...DEFAULT_RETRY_CONFIG,
      ...config,
    };

    this.state = {
      attempt: 0,
      totalDelay: 0,
    };
  }

  /**
   * 执行带重试的操作
   */
  public execute<T>(fn: () => Promise<T>): Effect.Effect<T, LLMError, never> {
    const attemptOnce = (): Effect.Effect<T, LLMError, never> =>
      Effect.tryPromise({
        try: () => fn(),
        catch: (error) => {
          this.state.lastError = error;
          if (error instanceof LLMError) return error;
          return streamError(
            `Operation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      });

    const retryLogic = (error: LLMError): Effect.Effect<T, LLMError, never> => {
      // 检查是否应该重试
      const shouldRetryFn = this.config.shouldRetry ?? isRetryableError;
      if (!shouldRetryFn(error, this.state.attempt)) {
        return Effect.fail(error);
      }

      // 检查是否达到最大重试次数
      if (this.state.attempt >= this.config.maxRetries) {
        return Effect.fail(
          streamError(`Operation failed after ${this.state.attempt} retries: ${error.message}`),
        );
      }

      // 计算延迟时间
      const delayMs = calculateBackoff(
        this.state.attempt,
        this.config.baseDelay,
        this.config.maxDelay,
        this.config.jitter,
      );

      // 调用重试回调
      if (this.config.onRetry) {
        this.config.onRetry(error, this.state.attempt + 1, delayMs);
      }

      // 等待后重试
      this.state.attempt++;
      this.state.totalDelay += delayMs;

      return Effect.sleep(`${delayMs} millis`).pipe(Effect.flatMap(() => this.execute(fn)));
    };

    return Effect.matchEffect(attemptOnce(), {
      onSuccess: (result) =>
        Effect.sync(() => {
          this.reset();
          return result;
        }),
      onFailure: retryLogic,
    });
  }

  /**
   * 执行带超时的操作
   */
  public executeWithTimeout<T>(fn: () => Promise<T>): Effect.Effect<T, LLMError, never> {
    if (!this.config.timeout || this.config.timeout <= 0) {
      return this.execute(fn);
    }

    return this.execute(fn).pipe(
      Effect.timeoutOption(`${this.config.timeout} millis`),
      Effect.flatMap((option) =>
        Option.isSome(option)
          ? Effect.succeed(option.value)
          : Effect.fail(streamError(`Operation timed out after ${this.config.timeout}ms`)),
      ),
    );
  }

  /**
   * 重置重试状态
   */
  public reset(): void {
    this.state = {
      attempt: 0,
      totalDelay: 0,
    };
  }

  /**
   * 获取当前重试次数
   */
  public getAttempt(): number {
    return this.state.attempt;
  }

  /**
   * 获取总延迟时间
   */
  public getTotalDelay(): number {
    return this.state.totalDelay;
  }

  /**
   * 获取最后一次错误
   */
  public getLastError(): unknown {
    return this.state.lastError;
  }

  /**
   * 创建一个带重试的函数包装器
   */
  public static wrap<T>(
    fn: () => Promise<T>,
    config?: Partial<RetryConfig>,
  ): Effect.Effect<T, LLMError, never> {
    const handler = new RetryHandler(config);
    return handler.executeWithTimeout(fn);
  }
}
