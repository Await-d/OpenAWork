export interface SequentialPollingController {
  cancel: () => void;
}

export interface SequentialPollingOptions {
  initialDelayMs?: number;
  intervalMs: number;
  run: (signal: AbortSignal) => Promise<void>;
}

export function startSequentialPolling(
  options: SequentialPollingOptions,
): SequentialPollingController {
  let cancelled = false;
  let activeController: AbortController | null = null;
  let timeoutId: number | null = null;

  const clearScheduledRun = () => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const scheduleNext = () => {
    if (cancelled) {
      return;
    }

    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      void execute();
    }, options.intervalMs);
  };

  const execute = async () => {
    if (cancelled) {
      return;
    }

    const controller = new AbortController();
    activeController = controller;

    try {
      await options.run(controller.signal);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        throw error;
      }
    } finally {
      if (activeController === controller) {
        activeController = null;
      }

      scheduleNext();
    }
  };

  if ((options.initialDelayMs ?? 0) > 0) {
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      void execute();
    }, options.initialDelayMs ?? 0);
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
