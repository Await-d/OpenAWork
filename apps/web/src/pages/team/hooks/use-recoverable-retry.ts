import { useCallback, useEffect, useRef, useState } from 'react';

export interface RecoverableRetryScheduleInput {
  computeDelay: (attempt: number) => number;
  onRetry: () => void;
  retryable: boolean;
}

export interface RecoverableRetryController {
  clearRetry: () => void;
  getAttempt: () => number;
  nextRetryAtMs: number | null;
  resetRetry: () => void;
  scheduleRetry: (input: RecoverableRetryScheduleInput) => number | null;
}

export function useRecoverableRetryController(): RecoverableRetryController {
  const [nextRetryAtMs, setNextRetryAtMs] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const nextRetryAtRef = useRef<number | null>(null);

  const clearRetry = useCallback(() => {
    if (timerRef.current !== null) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    nextRetryAtRef.current = null;
    setNextRetryAtMs(null);
  }, []);

  const resetRetry = useCallback(() => {
    attemptRef.current = 0;
    clearRetry();
  }, [clearRetry]);

  const scheduleRetry = useCallback(
    (input: RecoverableRetryScheduleInput) => {
      if (!input.retryable) {
        resetRetry();
        return null;
      }

      if (timerRef.current !== null) {
        return nextRetryAtRef.current;
      }

      const delay = input.computeDelay(attemptRef.current);
      const retryAtMs = Date.now() + delay;
      attemptRef.current += 1;
      nextRetryAtRef.current = retryAtMs;
      setNextRetryAtMs(retryAtMs);
      timerRef.current = globalThis.setTimeout(() => {
        timerRef.current = null;
        nextRetryAtRef.current = null;
        setNextRetryAtMs(null);
        input.onRetry();
      }, delay);
      return retryAtMs;
    },
    [resetRetry],
  );

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  return {
    clearRetry,
    getAttempt: () => attemptRef.current,
    nextRetryAtMs,
    resetRetry,
    scheduleRetry,
  };
}
