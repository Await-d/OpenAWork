export interface ExponentialRetryDelayInput {
  attempt: number;
  baseMs: number;
  maxMs: number;
}

export function computeExponentialRetryDelay(input: ExponentialRetryDelayInput): number {
  const safeAttempt = Math.max(0, input.attempt);
  return Math.min(input.baseMs * 2 ** safeAttempt, input.maxMs);
}

export interface RecoverableLoadErrorInput {
  baseMessage?: string | null;
  hasRetainedData: boolean;
  nextRetryAtMs?: number | null;
  retainedDataLabel: string;
  retryable: boolean;
}

export function formatRecoverableLoadError(input: RecoverableLoadErrorInput): string {
  const base = input.baseMessage?.trim() || '加载失败。';
  if (!input.retryable) {
    return base;
  }
  const retryHint = input.retryable
    ? input.nextRetryAtMs
      ? `系统将于 ${new Date(input.nextRetryAtMs).toLocaleTimeString()} 自动重试。`
      : '网络恢复后会自动重试。'
    : '';
  const retainedHint = input.hasRetainedData
    ? `当前继续展示最近一次成功${input.retainedDataLabel}。`
    : '';
  return [base, retryHint, retainedHint].filter((part) => part.length > 0).join(' ');
}
