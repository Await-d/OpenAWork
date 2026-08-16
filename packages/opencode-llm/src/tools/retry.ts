/**
 * 工具调用重试和降级策略
 *
 * 提供工具调用失败时的重试逻辑和降级策略
 */

/**
 * 重试策略类型
 */
export type RetryStrategy = 'exponential' | 'linear' | 'fixed' | 'none';

/**
 * 降级策略
 */
export interface FallbackStrategy {
  /** 是否启用降级 */
  enabled: boolean;
  /** 降级工具映射：原工具名 -> 降级工具名 */
  toolMapping?: Record<string, string>;
  /** 默认降级行为 */
  defaultBehavior?: 'error' | 'skip' | 'mock';
  /** Mock 响应生成器 */
  mockGenerator?: (toolName: string, input: unknown) => unknown;
}

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试策略 */
  strategy?: RetryStrategy;
  /** 基础延迟时间（毫秒） */
  baseDelayMs?: number;
  /** 最大延迟时间（毫秒） */
  maxDelayMs?: number;
  /** 指数退避的倍数 */
  backoffMultiplier?: number;
  /** 可重试的错误类型 */
  retryableErrors?: string[];
  /** 是否启用抖动（jitter） */
  enableJitter?: boolean;
  /** 降级策略 */
  fallback?: FallbackStrategy;
  /** 是否启用日志 */
  enableLogging?: boolean;
}

/**
 * 重试上下文
 */
export interface RetryContext {
  /** 当前重试次数 */
  attempt: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 工具名称 */
  toolName: string;
  /** 工具输入 */
  input: unknown;
  /** 上次错误 */
  lastError?: Error;
  /** 累计延迟时间 */
  totalDelayMs: number;
}

/**
 * 重试结果
 */
export interface RetryResult<T> {
  /** 是否成功 */
  success: boolean;
  /** 结果数据 */
  data?: T;
  /** 错误信息 */
  error?: Error;
  /** 实际重试次数 */
  attempts: number;
  /** 总耗时（毫秒） */
  totalMs: number;
  /** 是否使用了降级 */
  usedFallback: boolean;
}

/**
 * 工具调用重试器
 */
export class ToolCallRetry {
  private readonly config: Required<Omit<RetryConfig, 'fallback'>> & {
    fallback: FallbackStrategy;
  };

  constructor(config: RetryConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      strategy: config.strategy ?? 'exponential',
      baseDelayMs: config.baseDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 30000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      retryableErrors: config.retryableErrors ?? [
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
        'RATE_LIMIT',
        'SERVICE_UNAVAILABLE',
      ],
      enableJitter: config.enableJitter ?? true,
      fallback: {
        enabled: config.fallback?.enabled ?? false,
        toolMapping: config.fallback?.toolMapping ?? {},
        defaultBehavior: config.fallback?.defaultBehavior ?? 'error',
        mockGenerator: config.fallback?.mockGenerator,
      },
      enableLogging: config.enableLogging ?? false,
    };
  }

  /**
   * 执行带重试的工具调用
   */
  async execute<T>(
    toolName: string,
    input: unknown,
    executor: (input: unknown) => Promise<T>,
  ): Promise<RetryResult<T>> {
    const startTime = Date.now();
    let attempts = 0;
    let lastError: Error | undefined;
    let totalDelayMs = 0;

    // 如果不允许重试，直接执行
    if (this.config.strategy === 'none' || this.config.maxRetries === 0) {
      try {
        const data = await executor(input);
        return {
          success: true,
          data,
          attempts: 1,
          totalMs: Date.now() - startTime,
          usedFallback: false,
        };
      } catch (error) {
        return this.handleFinalFailure(
          toolName,
          input,
          error instanceof Error ? error : new Error(String(error)),
          1,
          Date.now() - startTime,
        );
      }
    }

    // 执行重试循环
    while (attempts <= this.config.maxRetries) {
      attempts++;

      const context: RetryContext = {
        attempt: attempts,
        maxRetries: this.config.maxRetries,
        toolName,
        input,
        lastError,
        totalDelayMs,
      };

      try {
        if (this.config.enableLogging) {
          this.log('attempt', { toolName, attempt: attempts, maxRetries: this.config.maxRetries });
        }

        const data = await executor(input);

        if (this.config.enableLogging) {
          this.log('success', { toolName, attempts });
        }

        return {
          success: true,
          data,
          attempts,
          totalMs: Date.now() - startTime,
          usedFallback: false,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        lastError = err;

        if (this.config.enableLogging) {
          this.log('error', {
            toolName,
            attempt: attempts,
            error: err.message,
            retryable: this.isRetryable(err),
          });
        }

        // 检查是否可重试
        if (!this.isRetryable(err) || attempts > this.config.maxRetries) {
          return this.handleFinalFailure(toolName, input, err, attempts, Date.now() - startTime);
        }

        // 计算延迟时间并等待
        const delayMs = this.calculateDelay(context);
        totalDelayMs += delayMs;

        if (this.config.enableLogging) {
          this.log('retry', { toolName, attempt: attempts, delayMs });
        }

        await this.delay(delayMs);
      }
    }

    // 理论上不会到达这里，但为了类型安全
    return this.handleFinalFailure(
      toolName,
      input,
      lastError ?? new Error('Unknown error'),
      attempts,
      Date.now() - startTime,
    );
  }

  /**
   * 处理最终失败（重试耗尽后）
   */
  private async handleFinalFailure<T>(
    toolName: string,
    input: unknown,
    error: Error,
    attempts: number,
    totalMs: number,
  ): Promise<RetryResult<T>> {
    if (this.config.enableLogging) {
      this.log('final-failure', { toolName, attempts, error: error.message });
    }

    // 尝试降级策略
    if (this.config.fallback.enabled) {
      try {
        const fallbackResult = await this.tryFallback<T>(toolName, input, error);
        // fallbackResult 可以是 null（skip 模式），这也算成功的降级
        return {
          success: true,
          data: fallbackResult as T | undefined,
          error: undefined,
          attempts,
          totalMs,
          usedFallback: true,
        };
      } catch (fallbackError) {
        // 降级策略也失败了（例如 'error' 模式抛出异常）
        return {
          success: false,
          error: fallbackError instanceof Error ? fallbackError : error,
          attempts,
          totalMs,
          usedFallback: false,
        };
      }
    }

    return {
      success: false,
      error,
      attempts,
      totalMs,
      usedFallback: false,
    };
  }

  /**
   * 尝试降级策略
   */
  private async tryFallback<T>(
    toolName: string,
    input: unknown,
    originalError: Error,
  ): Promise<T | null> {
    const { toolMapping, defaultBehavior, mockGenerator } = this.config.fallback;

    // 检查是否有工具映射
    const fallbackToolName = toolMapping?.[toolName];
    if (fallbackToolName) {
      if (this.config.enableLogging) {
        this.log('fallback-tool', { from: toolName, to: fallbackToolName });
      }
      // 这里返回 null，因为实际的降级工具调用应该由外部处理
      return null;
    }

    // 根据默认行为处理
    switch (defaultBehavior) {
      case 'error':
        throw originalError;

      case 'skip':
        if (this.config.enableLogging) {
          this.log('fallback-skip', { toolName });
        }
        return null;

      case 'mock':
        if (mockGenerator) {
          if (this.config.enableLogging) {
            this.log('fallback-mock', { toolName });
          }
          return mockGenerator(toolName, input) as T;
        }
        return null;

      default:
        return null;
    }
  }

  /**
   * 判断错误是否可重试
   */
  private isRetryable(error: Error): boolean {
    // 检查错误消息是否包含可重试的关键字
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    return this.config.retryableErrors.some((keyword) => {
      const lower = keyword.toLowerCase();
      return message.includes(lower) || name.includes(lower);
    });
  }

  /**
   * 计算重试延迟时间
   */
  private calculateDelay(context: RetryContext): number {
    let delayMs: number;

    switch (this.config.strategy) {
      case 'exponential':
        delayMs =
          this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, context.attempt - 1);
        break;

      case 'linear':
        delayMs = this.config.baseDelayMs * context.attempt;
        break;

      case 'fixed':
        delayMs = this.config.baseDelayMs;
        break;

      default:
        delayMs = this.config.baseDelayMs;
    }

    // 限制最大延迟
    delayMs = Math.min(delayMs, this.config.maxDelayMs);

    // 添加抖动（jitter）
    if (this.config.enableJitter) {
      const jitter = Math.random() * 0.3 * delayMs; // ±30% 抖动
      delayMs = delayMs + jitter - 0.15 * delayMs;
    }

    return Math.floor(delayMs);
  }

  /**
   * 延迟执行
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 记录日志
   */
  private log(action: string, data: unknown): void {
    if (this.config.enableLogging) {
      console.log(`[ToolCallRetry:${action}]`, data);
    }
  }
}

/**
 * 创建默认的重试器实例
 */
export function createToolCallRetry(config?: RetryConfig): ToolCallRetry {
  return new ToolCallRetry(config);
}

/**
 * 快捷函数：执行带重试的工具调用
 */
export async function executeWithRetry<T>(
  toolName: string,
  input: unknown,
  executor: (input: unknown) => Promise<T>,
  config?: RetryConfig,
): Promise<RetryResult<T>> {
  const retry = new ToolCallRetry(config);
  return retry.execute(toolName, input, executor);
}
