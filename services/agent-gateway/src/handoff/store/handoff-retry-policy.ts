/**
 * handoff 失败重试策略（2026-11-03 从 handoff-store.ts 拆出）。
 *
 * 纯常量 + 纯函数：不触 DB。handoff-store.ts 保留再导出，既有 import 不受影响。
 */

export const UNRECOVERABLE_FAILED_HANDOFF_REASON_PREFIXES = [
  'Architecture Review 未通过',
  'Constitution Check 硬门禁未通过',
  'Spec Review 未通过',
  'quality-review-degraded-summary-failed:',
  'heartbeat-timeout-max-retry-exceeded',
] as const;

export const UNRECOVERABLE_FAILED_HANDOFF_REASON_SUBSTRINGS = ['需要用户介入'] as const;
const AUTO_RETRY_BASE_DELAY_MS = 10_000;
const AUTO_RETRY_MAX_DELAY_MS = 60_000;

/** 失败派发的重试预算：原因层面可恢复、但实际注定失败的派发必须在有限次重试后收敛，否则会无限重试并持续消耗额度。 */
export const MAX_FAILED_HANDOFF_RETRY_COUNT = 3;

export function normalizeAvailableAtMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.max(0, Math.floor(value));
  return normalized > 0 ? normalized : null;
}

export function computeAutoRetryDelayMs(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    AUTO_RETRY_BASE_DELAY_MS * Math.pow(2, normalizedAttempt - 1),
    AUTO_RETRY_MAX_DELAY_MS,
  );
}

export function computeAutoRetryAvailableAtMs(attempt: number, nowMs = Date.now()): number {
  return nowMs + computeAutoRetryDelayMs(attempt);
}
