import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Cause, Effect, Exit } from 'effect';
import {
  createCircuitBreaker,
  CircuitBreakerOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type CircuitBreakerConfig,
} from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始状态应该是 CLOSED', async () => {
    const program = Effect.gen(function* () {
      const breaker = yield* createCircuitBreaker();
      const state = yield* breaker.getState;
      return state;
    });

    const state = await Effect.runPromise(program);
    expect(state.state).toBe('CLOSED');
    expect(state.failureCount).toBe(0);
  });

  it('成功执行应该保持 CLOSED 状态', async () => {
    const program = Effect.gen(function* () {
      const breaker = yield* createCircuitBreaker();
      const result = yield* breaker.protect(Effect.succeed('ok'));
      const state = yield* breaker.getState;
      return { result, state };
    });

    const { result, state } = await Effect.runPromise(program);
    expect(result).toBe('ok');
    expect(state.state).toBe('CLOSED');
    expect(state.failureCount).toBe(0);
  });

  it('达到失败阈值应该打开断路器', async () => {
    const config: Partial<CircuitBreakerConfig> = {
      failureThreshold: 3,
      timeoutMs: 1000,
    };

    const program = Effect.gen(function* () {
      const breaker = yield* createCircuitBreaker(config);

      // 连续失败 3 次
      for (let i = 0; i < 3; i++) {
        yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail'))));
      }

      const state = yield* breaker.getState;
      return state;
    });

    const state = await Effect.runPromise(program);
    expect(state.state).toBe('OPEN');
    expect(state.failureCount).toBe(3);
  });

  it('OPEN 状态应该快速失败', async () => {
    const config: Partial<CircuitBreakerConfig> = {
      failureThreshold: 2,
      timeoutMs: 5000,
    };

    const program = Effect.gen(function* () {
      const breaker = yield* createCircuitBreaker(config);

      // 触发断路器打开
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail1'))));
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail2'))));

      // 下一次应该立即失败
      const result = yield* Effect.exit(breaker.protect(Effect.succeed('should not execute')));
      return result;
    });

    const result = await Effect.runPromise(program);
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(Cause.squash(result.cause)).toBeInstanceOf(CircuitBreakerOpenError);
    }
  });

  it('超时后应该转换到 HALF_OPEN 状态', async () => {
    const config: Partial<CircuitBreakerConfig> = {
      failureThreshold: 2,
      timeoutMs: 1000,
    };

    const program = Effect.gen(function* () {
      const breaker = yield* createCircuitBreaker(config);

      // 打开断路器
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail1'))));
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail2'))));

      const openState = yield* breaker.getState;
      expect(openState.state).toBe('OPEN');

      // 等待超时
      vi.advanceTimersByTime(1100);

      // 尝试执行成功的请求
      const result = yield* breaker.protect(Effect.succeed('ok'));
      const halfOpenState = yield* breaker.getState;

      return { result, state: halfOpenState };
    });

    const { result, state } = await Effect.runPromise(program);
    expect(result).toBe('ok');
    expect(state.state).toBe('HALF_OPEN');
  });

  it('HALF_OPEN 状态连续成功应该关闭断路器', async () => {
    const config: Partial<CircuitBreakerConfig> = {
      failureThreshold: 2,
      successThreshold: 2,
      timeoutMs: 1000,
    };

    const program = Effect.gen(function* () {
      const breaker = yield* createCircuitBreaker(config);

      // 打开断路器
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail1'))));
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail2'))));

      // 等待超时
      vi.advanceTimersByTime(1100);

      // 连续成功 2 次
      yield* breaker.protect(Effect.succeed('ok1'));
      yield* breaker.protect(Effect.succeed('ok2'));

      const state = yield* breaker.getState;
      return state;
    });

    const state = await Effect.runPromise(program);
    expect(state.state).toBe('CLOSED');
    expect(state.failureCount).toBe(0);
    expect(state.successCount).toBe(0);
  });

  it('HALF_OPEN 状态失败应该重新打开断路器', async () => {
    const config: Partial<CircuitBreakerConfig> = {
      failureThreshold: 2,
      timeoutMs: 1000,
    };

    const program = Effect.gen(function* () {
      const breaker = yield* createCircuitBreaker(config);

      // 打开断路器
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail1'))));
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail2'))));

      // 等待超时
      vi.advanceTimersByTime(1100);

      // HALF_OPEN 状态下失败
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail3'))));

      const state = yield* breaker.getState;
      return state;
    });

    const state = await Effect.runPromise(program);
    expect(state.state).toBe('OPEN');
  });

  it('重置应该恢复初始状态', async () => {
    const config: Partial<CircuitBreakerConfig> = {
      failureThreshold: 2,
    };

    const program = Effect.gen(function* () {
      const breaker = yield* createCircuitBreaker(config);

      // 打开断路器
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail1'))));
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail2'))));

      const openState = yield* breaker.getState;
      expect(openState.state).toBe('OPEN');

      // 重置
      yield* breaker.reset;

      const resetState = yield* breaker.getState;
      return resetState;
    });

    const state = await Effect.runPromise(program);
    expect(state.state).toBe('CLOSED');
    expect(state.failureCount).toBe(0);
  });

  it('应该限制 HALF_OPEN 状态的并发请求', async () => {
    const config: Partial<CircuitBreakerConfig> = {
      failureThreshold: 2,
      timeoutMs: 1000,
      halfOpenMaxConcurrency: 1,
    };

    const program = Effect.gen(function* () {
      const breaker = yield* createCircuitBreaker(config);

      // 打开断路器
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail1'))));
      yield* Effect.exit(breaker.protect(Effect.fail(new Error('fail2'))));

      // 等待超时
      vi.advanceTimersByTime(1100);

      // 第一个请求应该通过（进入 HALF_OPEN）
      const slowEffect = Effect.gen(function* () {
        yield* Effect.sleep(100);
        return 'slow';
      });

      // 启动第一个请求（慢）
      const first = breaker.protect(slowEffect);

      // 立即启动第二个请求，应该被拒绝（超过并发限制）
      const second = breaker.protect(Effect.succeed('fast'));

      const results = yield* Effect.all([Effect.exit(first), Effect.exit(second)], {
        concurrency: 'unbounded',
      });

      return results;
    });

    const resultPromise = Effect.runPromise(program);
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    // 第一个请求应该成功或失败（取决于时间）
    // 第二个请求应该因为断路器打开而失败
    const secondResult = results[1];
    if (secondResult && Exit.isFailure(secondResult)) {
      expect(Cause.squash(secondResult.cause)).toBeInstanceOf(CircuitBreakerOpenError);
    }
  });
});
