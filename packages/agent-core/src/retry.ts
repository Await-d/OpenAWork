export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
  isRetryable: (error: unknown) => boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
  isRetryable: () => true,
};

export function computeDelay(attempt: number, options: RetryOptions): number {
  const base = Math.min(
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1),
    options.maxDelayMs,
  );
  const jitter = base * options.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

export class RetryAbortedError extends Error {
  constructor() {
    super('Retry aborted by signal');
    this.name = 'RetryAbortedError';
  }
}

export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastError: unknown;

  constructor(attempts: number, lastError: unknown) {
    super(`Exhausted ${attempts} retry attempts`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export async function withRetry<T>(
  fn: (attempt: number, signal: AbortSignal) => Promise<T>,
  options: Partial<RetryOptions> = {},
  signal?: AbortSignal,
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new RetryAbortedError();
    }

    try {
      return await fn(attempt, signal ?? new AbortController().signal);
    } catch (error) {
      lastError = error;

      if (signal?.aborted) {
        throw new RetryAbortedError();
      }

      if (attempt === opts.maxAttempts || !opts.isRetryable(error)) {
        break;
      }

      const delayMs = computeDelay(attempt, opts);
      await sleep(delayMs, signal);
    }
  }

  throw new RetryExhaustedError(opts.maxAttempts, lastError);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new RetryAbortedError());
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function createCancellableTask<T>(fn: (signal: AbortSignal) => Promise<T>): {
  promise: Promise<T>;
  cancel: () => void;
} {
  const controller = new AbortController();
  const promise = fn(controller.signal);
  return {
    promise,
    cancel: () => controller.abort(),
  };
}
