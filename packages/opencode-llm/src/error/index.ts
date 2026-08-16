/**
 * OpenCode LLM 错误处理和重试机制
 *
 * 提供完整的错误处理能力：
 * - 智能重试策略（指数退避 + 抖动）
 * - 断路器模式（防止雪崩）
 * - 优雅降级（备用模型）
 * - 统一错误处理器
 */

export {
  createCircuitBreaker,
  CircuitBreakerOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type CircuitBreakerConfig,
  type CircuitState,
  type CircuitBreaker,
} from './circuit-breaker.js';

export {
  withRetry,
  withRetryStats,
  createRetrySchedule,
  computeRetryDelay,
  DEFAULT_RETRY_POLICY,
  type RetryPolicyConfig,
  type RetryStats,
} from './retry-policy.js';

export {
  withFallback,
  createFallbackChain,
  createAdaptiveFallback,
  AllFallbacksFailedError,
  DEFAULT_FALLBACK_CONFIG,
  type FallbackConfig,
  type FallbackResult,
  type FallbackAttempt,
} from './fallback.js';

export {
  createResilientExecutor,
  ErrorClassifier,
  DEFAULT_ERROR_HANDLING_STRATEGY,
  AGGRESSIVE_RETRY_STRATEGY,
  CONSERVATIVE_RETRY_STRATEGY,
  HIGH_AVAILABILITY_STRATEGY,
  FAIL_FAST_STRATEGY,
  type ErrorHandlingStrategy,
  type ExecutionContext,
} from './error-handler.js';
