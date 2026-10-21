/**
 * 断路器模式（Circuit Breaker）
 *
 * 防止级联失败和雪崩效应：
 * - CLOSED：正常状态，请求通过
 * - OPEN：故障状态，快速失败，不发送请求
 * - HALF_OPEN：恢复测试状态，允许少量请求通过
 */

import { Effect, Ref } from 'effect';

/**
 * 断路器状态
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * 断路器配置
 */
export interface CircuitBreakerConfig {
  /**
   * 失败阈值：连续失败多少次后打开断路器
   * @default 5
   */
  readonly failureThreshold: number;

  /**
   * 成功阈值：在 HALF_OPEN 状态下，连续成功多少次后关闭断路器
   * @default 2
   */
  readonly successThreshold: number;

  /**
   * 超时时间（毫秒）：断路器打开后，多久尝试进入 HALF_OPEN 状态
   * @default 60000 (1分钟)
   */
  readonly timeoutMs: number;

  /**
   * 半开状态下的最大并发请求数
   * @default 1
   */
  readonly halfOpenMaxConcurrency: number;
}

/**
 * 默认断路器配置
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 60000,
  halfOpenMaxConcurrency: 1,
};

/**
 * 断路器状态数据
 */
interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  halfOpenConcurrency: number;
}

/**
 * 断路器错误
 */
export class CircuitBreakerOpenError extends Error {
  readonly _tag = 'CircuitBreakerOpen';

  constructor(message = 'Circuit breaker is OPEN') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * 断路器实例
 *
 * `protect` 只是构造受保护的 Effect，真正执行发生在运行时；
 * `getState` / `reset` / `recordSuccess` / `recordFailure` 同样以 Effect 暴露。
 */
export interface CircuitBreaker {
  readonly protect: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | CircuitBreakerOpenError, R>;
  readonly getState: Effect.Effect<{
    readonly state: CircuitState;
    readonly failureCount: number;
    readonly successCount: number;
    readonly lastFailureTime: number | null;
  }>;
  readonly reset: Effect.Effect<void>;
  readonly recordSuccess: Effect.Effect<void>;
  readonly recordFailure: Effect.Effect<void>;
}

/**
 * 同步创建断路器实例（不经过 Effect 运行时）。
 *
 * 基于 `Ref.makeUnsafe`（Effect 4.0）：Ref 的读写仍以 Effect 暴露，
 * 但实例本身可以同步构造——`createResilientExecutor` 依赖这一点在构造期
 * 建立跨多次运行共享的断路器（若每次运行都重建，失败计数无法累计，
 * 断路器将永远不会打开）。
 *
 * 包外消费者请使用 `createCircuitBreaker`（Effect 包装版）。
 */
export function makeCircuitBreakerUnsafe(
  config: Partial<CircuitBreakerConfig> = {},
): CircuitBreaker {
  const fullConfig: CircuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };

  const initialState: CircuitBreakerState = {
    state: 'CLOSED',
    failureCount: 0,
    successCount: 0,
    lastFailureTime: null,
    halfOpenConcurrency: 0,
  };

  const stateRef = Ref.makeUnsafe<CircuitBreakerState>(initialState);

  /**
   * 检查是否应该从 OPEN 转换到 HALF_OPEN
   */
  const shouldTransitionToHalfOpen = (state: CircuitBreakerState): boolean => {
    if (state.state !== 'OPEN' || state.lastFailureTime === null) {
      return false;
    }
    return Date.now() - state.lastFailureTime >= fullConfig.timeoutMs;
  };

  /**
   * 检查是否可以执行请求
   */
  const canExecute = (state: CircuitBreakerState): boolean => {
    if (state.state === 'CLOSED') {
      return true;
    }

    if (state.state === 'OPEN') {
      return shouldTransitionToHalfOpen(state);
    }

    // HALF_OPEN 状态：检查并发限制
    return state.halfOpenConcurrency < fullConfig.halfOpenMaxConcurrency;
  };

  /**
   * 记录成功
   */
  const recordSuccess = Effect.gen(function* () {
    yield* Ref.update(stateRef, (state) => {
      if (state.state === 'HALF_OPEN') {
        const newSuccessCount = state.successCount + 1;
        if (newSuccessCount >= fullConfig.successThreshold) {
          // 关闭断路器
          return {
            ...initialState,
            state: 'CLOSED' as const,
          };
        }
        return {
          ...state,
          successCount: newSuccessCount,
          halfOpenConcurrency: Math.max(0, state.halfOpenConcurrency - 1),
        };
      }

      if (state.state === 'CLOSED') {
        // 重置失败计数
        return {
          ...state,
          failureCount: 0,
        };
      }

      return state;
    });
  });

  /**
   * 记录失败
   */
  const recordFailure = Effect.gen(function* () {
    yield* Ref.update(stateRef, (state) => {
      const newFailureCount = state.failureCount + 1;

      if (state.state === 'HALF_OPEN') {
        // HALF_OPEN 状态下失败，立即打开断路器
        return {
          ...state,
          state: 'OPEN' as const,
          failureCount: newFailureCount,
          successCount: 0,
          lastFailureTime: Date.now(),
          halfOpenConcurrency: 0,
        };
      }

      if (state.state === 'CLOSED' && newFailureCount >= fullConfig.failureThreshold) {
        // 达到失败阈值，打开断路器
        return {
          ...state,
          state: 'OPEN' as const,
          failureCount: newFailureCount,
          lastFailureTime: Date.now(),
        };
      }

      return {
        ...state,
        failureCount: newFailureCount,
        halfOpenConcurrency:
          state.state === 'CLOSED' || state.state === 'OPEN'
            ? state.halfOpenConcurrency
            : Math.max(0, state.halfOpenConcurrency - 1),
      };
    });
  });

  /**
   * 进入半开状态
   */
  const enterHalfOpen = Effect.gen(function* () {
    yield* Ref.update(stateRef, (state) => {
      if (state.state === 'OPEN' && shouldTransitionToHalfOpen(state)) {
        return {
          ...state,
          state: 'HALF_OPEN' as const,
          successCount: 0,
          failureCount: 0,
        };
      }
      return state;
    });
  });

  /**
   * 增加半开并发计数
   */
  const incrementHalfOpenConcurrency = Effect.gen(function* () {
    yield* Ref.update(stateRef, (state) => {
      if (state.state === 'HALF_OPEN') {
        return {
          ...state,
          halfOpenConcurrency: state.halfOpenConcurrency + 1,
        };
      }
      return state;
    });
  });

  /**
   * 使用断路器保护 Effect
   */
  const protect = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | CircuitBreakerOpenError, R> => {
    return Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);

      // 检查是否应该转换到 HALF_OPEN
      if (shouldTransitionToHalfOpen(state)) {
        yield* enterHalfOpen;
      }

      const currentState = yield* Ref.get(stateRef);

      // 检查是否可以执行
      if (!canExecute(currentState)) {
        return yield* Effect.fail(new CircuitBreakerOpenError());
      }

      // 如果是 HALF_OPEN，增加并发计数
      if (currentState.state === 'HALF_OPEN') {
        yield* incrementHalfOpenConcurrency;
      }

      return yield* Effect.matchEffect(effect, {
        onSuccess: (result) => Effect.as(recordSuccess, result),
        onFailure: (error) =>
          Effect.gen(function* () {
            yield* recordFailure;
            return yield* Effect.fail(error);
          }),
      });
    });
  };

  /**
   * 获取当前状态
   */
  const getState = Effect.map(Ref.get(stateRef), (state) => ({
    state: state.state,
    failureCount: state.failureCount,
    successCount: state.successCount,
    lastFailureTime: state.lastFailureTime,
  }));

  /**
   * 重置断路器（写入克隆，避免与初始快照共享可变引用）
   */
  const reset = Ref.set(stateRef, { ...initialState });

  return {
    protect,
    getState,
    reset,
    recordSuccess,
    recordFailure,
  };
}

/**
 * 创建断路器（Effect 包装，自动继承调用方运行时）
 */
export function createCircuitBreaker(
  config: Partial<CircuitBreakerConfig> = {},
): Effect.Effect<CircuitBreaker> {
  return Effect.sync(() => makeCircuitBreakerUnsafe(config));
}
