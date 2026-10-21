import { recordClientError } from '../../../utils/log/error-capture.js';

export interface SequentialPollingController {
  cancel: () => void;
}

/**
 * 连续失败时的默认最大间隔。1s/3s 这类高频轮询在网关卡顿期间若不做退避，会以
 * 秒级节奏持续重发：既把「一批接口一起报错」拖成持续风暴（用户看到的就是后续
 * 接口一直跟着报错），也让已经过载的网关雪上加霜。退避只在失败时生效，任意一次
 * 成功立即复位到 `intervalMs`，因此正常情况下不影响轮询节奏。
 */
export const DEFAULT_SEQUENTIAL_POLLING_MAX_BACKOFF_MS = 15_000;

export interface SequentialPollingOptions {
  initialDelayMs?: number;
  intervalMs: number;
  /**
   * 连续失败时的最大间隔（ms），默认 15s；设为 <= `intervalMs` 可关闭退避。
   */
  maxBackoffMs?: number;
  run: (signal: AbortSignal) => Promise<void>;
}

export function startSequentialPolling(
  options: SequentialPollingOptions,
): SequentialPollingController {
  let cancelled = false;
  let activeController: AbortController | null = null;
  let timeoutId: number | null = null;
  let consecutiveFailureCount = 0;

  const clearScheduledRun = () => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const scheduleNext = (delayMs: number) => {
    if (cancelled) {
      return;
    }

    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      void execute();
    }, delayMs);
  };

  const resolveNextDelayMs = (): number => {
    const baseIntervalMs = options.intervalMs;
    const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_SEQUENTIAL_POLLING_MAX_BACKOFF_MS;
    if (consecutiveFailureCount === 0 || maxBackoffMs <= baseIntervalMs) {
      return baseIntervalMs;
    }
    const multiplier = 2 ** Math.min(consecutiveFailureCount - 1, 16);
    return Math.min(maxBackoffMs, baseIntervalMs * multiplier);
  };

  const execute = async () => {
    if (cancelled) {
      return;
    }

    const controller = new AbortController();
    activeController = controller;
    let runFailed = false;

    try {
      await options.run(controller.signal);
    } catch (error) {
      // `execute` 由 `void execute()` 触发：非取消失败若继续向上抛，只会变成
      // unhandled rejection（`finally` 里的排程已经保证下一拍照常进行）。这里
      // 吞掉并计入失败次数，由退避节奏承担重试策略。
      const pollingRunWasCancelled = controller.signal.aborted;
      const receivedAbortError = error instanceof DOMException && error.name === 'AbortError';
      if (!pollingRunWasCancelled && !receivedAbortError) {
        runFailed = true;
        // 失败不能再向上抛（否则只会变成 unhandled rejection），但也不能凭空消失：
        // 旧实现靠 unhandled rejection 进入全局错误捕获，这里改走显式诊断记录，
        // 保住同一份可观测性，并额外带上轮询上下文便于定位。
        recordClientError(error, {
          poller: 'sequential-polling',
          intervalMs: String(options.intervalMs),
        });
      }
    } finally {
      if (activeController === controller) {
        activeController = null;
      }

      consecutiveFailureCount = runFailed ? consecutiveFailureCount + 1 : 0;
      scheduleNext(resolveNextDelayMs());
    }
  };

  const initialDelayMs = options.initialDelayMs ?? 0;
  if (initialDelayMs > 0) {
    scheduleNext(initialDelayMs);
  } else {
    void execute();
  }

  return {
    cancel: () => {
      cancelled = true;
      clearScheduledRun();
      activeController?.abort();
      activeController = null;
    },
  };
}
