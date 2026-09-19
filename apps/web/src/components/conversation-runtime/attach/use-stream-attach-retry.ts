import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachRetryVerdict } from './attach-stream-eligibility.js';

export interface ScheduleStreamAttachRetryInput {
  beforeRetry?: () => AttachRetryVerdict | boolean | void;
  delayMs: number;
  /**
   * Optional human-readable label shown while waiting for the retry
   * (e.g. "自动重连中 · 约 1.5s 后重试…"). Defaults to a generic message
   * derived from delayMs.
   */
  progressLabel?: string;
  /** 本次重试归属的会话；定时器触发时若会话已切换则由 beforeRetry 裁决放弃。 */
  sessionId: string;
}

export const MAX_ATTACH_RETRY_ATTEMPTS = 8;

/** 'defer' 的重新排期上限，超过后按 abort 处理，保证重试有界。 */
export const MAX_ATTACH_RETRY_DEFERS = 10;

const MAX_ATTACH_RETRY_DELAY_MS = 30_000;

export interface StreamAttachRetryReturn {
  /** 重试次数耗尽后为 true；cancelAttachRetry 会重置。 */
  attachRetryExhausted: boolean;
  attachRetryNonce: number;
  /**
   * Non-null while a scheduled attach retry is pending. Surfaced in the
   * stream-error bar so users can see exponential-backoff reconnects
   * instead of a silent freeze.
   */
  attachRetryProgress: string | null;
  /** 待触发的重试所属会话 id；无待触发重试时为 null。 */
  attachRetryScheduledSessionId: string | null;
  cancelAttachRetry: () => void;
  scheduleAttachRetry: (input: ScheduleStreamAttachRetryInput) => void;
}

function defaultProgressLabel(delayMs: number): string {
  const seconds = Math.max(0.1, Math.round(delayMs / 100) / 10);
  return `自动重连中 · 约 ${seconds}s 后重试…`;
}

function normalizeRetryVerdict(verdict: AttachRetryVerdict | boolean | void): AttachRetryVerdict {
  if (verdict === true || verdict === undefined) {
    return 'proceed';
  }
  if (verdict === false) {
    return 'defer';
  }
  return verdict;
}

export function useStreamAttachRetry(): StreamAttachRetryReturn {
  const timeoutRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const deferCountRef = useRef(0);
  const [attachRetryExhausted, setAttachRetryExhausted] = useState(false);
  const [attachRetryNonce, setAttachRetryNonce] = useState(0);
  const [attachRetryProgress, setAttachRetryProgress] = useState<string | null>(null);
  const [attachRetryScheduledSessionId, setAttachRetryScheduledSessionId] = useState<string | null>(
    null,
  );

  const clearPendingRetry = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setAttachRetryProgress(null);
  }, []);

  const cancelAttachRetry = useCallback(() => {
    clearPendingRetry();
    retryAttemptRef.current = 0;
    deferCountRef.current = 0;
    setAttachRetryScheduledSessionId(null);
    setAttachRetryExhausted(false);
  }, [clearPendingRetry]);

  const scheduleAttachRetry = useCallback(
    (input: ScheduleStreamAttachRetryInput) => {
      clearPendingRetry();
      if (retryAttemptRef.current >= MAX_ATTACH_RETRY_ATTEMPTS) {
        setAttachRetryScheduledSessionId(null);
        setAttachRetryExhausted(true);
        return;
      }

      retryAttemptRef.current += 1;
      deferCountRef.current = 0;
      const delayMs = Math.min(
        MAX_ATTACH_RETRY_DELAY_MS,
        Math.max(0, input.delayMs) * 2 ** (retryAttemptRef.current - 1),
      );

      const armTimer = () => {
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          const verdict = normalizeRetryVerdict(input.beforeRetry?.());
          if (verdict === 'abort') {
            cancelAttachRetry();
            return;
          }
          if (verdict === 'defer') {
            if (deferCountRef.current >= MAX_ATTACH_RETRY_DEFERS) {
              cancelAttachRetry();
              return;
            }
            deferCountRef.current += 1;
            armTimer();
            return;
          }
          setAttachRetryProgress(null);
          setAttachRetryScheduledSessionId(null);
          setAttachRetryNonce((current) => current + 1);
        }, delayMs);
      };

      setAttachRetryScheduledSessionId(input.sessionId);
      setAttachRetryProgress(input.progressLabel ?? defaultProgressLabel(delayMs));
      armTimer();
    },
    [cancelAttachRetry, clearPendingRetry],
  );

  useEffect(() => {
    return () => {
      cancelAttachRetry();
    };
  }, [cancelAttachRetry]);

  return {
    attachRetryExhausted,
    attachRetryNonce,
    attachRetryProgress,
    attachRetryScheduledSessionId,
    cancelAttachRetry,
    scheduleAttachRetry,
  };
}
