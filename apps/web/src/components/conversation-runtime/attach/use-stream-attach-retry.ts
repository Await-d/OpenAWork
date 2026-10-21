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
  /**
   * 静默重试：不展示任何进度横幅。
   *
   * 用于「服务端暂时没有新事件可推」的场景（工具执行 / 长思考）。此时连接本身是
   * 健康的，只是没有数据可收——而 `retryProgress` 是渲染在**错误条**里的（warning
   * 边框 + 循环箭头），挂上去等于把正常等待显示成故障提示。
   */
  silent?: boolean;
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
      // 「静默重试」是工具执行 / 长思考期间的**正常等待**（服务端暂时没有新事件可推），
      // 不是失败。它必须既不受 8 次上限约束，也不参与退避递增——否则一次跑得比较久的
      // bash（输出全部在子进程里累积、执行期间不产生任何 run event）会把计数耗尽，
      // 最终置 `attachRetryExhausted` 并向用户弹出「实时流长时间没有新输出」这类故障提示，
      // 而底层连接其实一直是健康的。
      //
      // 耗尽与退避都只针对**非静默**重试，也就是真正的传输中断。
      if (!input.silent) {
        if (retryAttemptRef.current >= MAX_ATTACH_RETRY_ATTEMPTS) {
          setAttachRetryScheduledSessionId(null);
          setAttachRetryExhausted(true);
          return;
        }
        retryAttemptRef.current += 1;
      }
      deferCountRef.current = 0;
      // 退避**只做一次指数**：调用方（如 `run-session-attach-effect`）传入的 delayMs
      // 已经是「按连续失败次数递增」的序列（silent 1s→10s、disconnect 800ms→30s）。
      //
      // 此前这里又乘了一层 `2 ** (retryAttemptRef.current - 1)`，于是实际延迟是
      // `base(n) × 2^k` 的双指数：断线序列第 6 档 25.6ms 恰好配 `2⁰`，正是用户看到的
      // 「自动重连中 · 约 25.6s 后重试」；再往后直接顶到 30s 封顶而失去区分度。
      // 双指数让「工具执行期间 attach 反复 EOF」这种高频良性抖动在几次之内就顶到上限，
      // 提示条反复挂在界面上。
      //
      // 调用方已按自己的计数给出该退多少，这里只做封顶钳制即可。
      const delayMs = Math.min(MAX_ATTACH_RETRY_DELAY_MS, Math.max(0, input.delayMs));

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
      if (!input.silent) {
        setAttachRetryProgress(input.progressLabel ?? defaultProgressLabel(delayMs));
      }
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
