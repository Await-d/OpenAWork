import { useCallback, useEffect, useRef, useState } from 'react';

interface ScheduleStreamAttachRetryInput {
  beforeRetry?: () => boolean | void;
  delayMs: number;
}

export interface StreamAttachRetryReturn {
  attachRetryNonce: number;
  cancelAttachRetry: () => void;
  scheduleAttachRetry: (input: ScheduleStreamAttachRetryInput) => void;
}

export function useStreamAttachRetry(): StreamAttachRetryReturn {
  const timeoutRef = useRef<number | null>(null);
  const [attachRetryNonce, setAttachRetryNonce] = useState(0);

  const cancelAttachRetry = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const scheduleAttachRetry = useCallback(
    (input: ScheduleStreamAttachRetryInput) => {
      cancelAttachRetry();
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
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

  return { attachRetryNonce, cancelAttachRetry, scheduleAttachRetry };
}
