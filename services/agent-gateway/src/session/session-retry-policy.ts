import { computeRetryDelayMs } from '../provider/retry-classify.js';

export function computeSessionRecoveryRetryDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return 0;
  return computeRetryDelayMs(Math.floor(attempt));
}

export function waitForSessionRecoveryRetry(attempt: number, signal: AbortSignal): Promise<void> {
  const delayMs = computeSessionRecoveryRetryDelayMs(attempt);
  if (delayMs <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      const error = new Error('Session recovery retry aborted');
      error.name = 'AbortError';
      reject(error);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
