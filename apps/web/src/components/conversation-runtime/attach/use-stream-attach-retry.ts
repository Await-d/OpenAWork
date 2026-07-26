import { useCallback, useEffect, useRef, useState } from 'react';

interface ScheduleStreamAttachRetryInput {
  beforeRetry?: () => boolean | void;
  delayMs: number;
  /**
   * Optional human-readable label shown while waiting for the retry
   * (e.g. "自动重连中 · 约 1.5s 后重试…"). Defaults to a generic message
   * derived from delayMs.
   */
  progressLabel?: string;
}

export interface StreamAttachRetryReturn {
  attachRetryNonce: number;
  /**
   * Non-null while a scheduled attach retry is pending. Surfaced in the
   * stream-error bar so users can see exponential-backoff reconnects
   * instead of a silent freeze.
   */
  attachRetryProgress: string | null;
  cancelAttachRetry: () => void;
  scheduleAttachRetry: (input: ScheduleStreamAttachRetryInput) => void;
}

function defaultProgressLabel(delayMs: number): string {
  const seconds = Math.max(0.1, Math.round(delayMs / 100) / 10);
  return `自动重连中 · 约 ${seconds}s 后重试…`;
}

export function useStreamAttachRetry(): StreamAttachRetryReturn {
  const timeoutRef = useRef<number | null>(null);
  const [attachRetryNonce, setAttachRetryNonce] = useState(0);
  const [attachRetryProgress, setAttachRetryProgress] = useState<string | null>(null);

  const cancelAttachRetry = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setAttachRetryProgress(null);
  }, []);

  const scheduleAttachRetry = useCallback(
    (input: ScheduleStreamAttachRetryInput) => {
      cancelAttachRetry();
      setAttachRetryProgress(input.progressLabel ?? defaultProgressLabel(input.delayMs));
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        setAttachRetryProgress(null);
        if (input.beforeRetry?.() === false) {
          return;
        }
        setAttachRetryNonce((current) => current + 1);
      }, input.delayMs);
    },
    [cancelAttachRetry],
  );

  useEffect(() => {
    return () => {
      cancelAttachRetry();
    };
  }, [cancelAttachRetry]);

  return { attachRetryNonce, attachRetryProgress, cancelAttachRetry, scheduleAttachRetry };
}
