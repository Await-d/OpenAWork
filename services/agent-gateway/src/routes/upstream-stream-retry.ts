import { RetryExhaustedError, withRetry } from '@openAwork/agent-core';
import type { RetryOptions } from '@openAwork/agent-core';
import { readUpstreamError } from './upstream-error.js';

const RETRYABLE_UPSTREAM_STATUSES = new Set([500, 502, 503, 504]);

const DEFAULT_UPSTREAM_STREAM_RETRY_OPTIONS: Omit<RetryOptions, 'isRetryable'> = {
  maxAttempts: 4,
  initialDelayMs: 250,
  maxDelayMs: 1000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
};

type UpstreamStreamRetryOverrides = Partial<Omit<RetryOptions, 'isRetryable'>>;

class RetryableUpstreamStatusError extends Error {
  readonly response: Response;

  constructor(response: Response) {
    super(`Retryable upstream status: ${response.status}`);
    this.name = 'RetryableUpstreamStatusError';
    this.response = response;
  }
}

class RetryableUpstreamBodyMissingError extends Error {
  readonly response: Response;

  constructor(response: Response) {
    super('Retryable upstream response body missing');
    this.name = 'RetryableUpstreamBodyMissingError';
    this.response = response;
  }
}

export function isRetryableUpstreamStatus(status: number): boolean {
  return RETRYABLE_UPSTREAM_STATUSES.has(status);
}

export async function fetchUpstreamStreamWithRetry(input: {
  url: string;
  init: RequestInit;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  requireResponseBody?: boolean;
  retryOptions?: UpstreamStreamRetryOverrides;
}): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const retryOptions: RetryOptions = {
    ...DEFAULT_UPSTREAM_STREAM_RETRY_OPTIONS,
    ...input.retryOptions,
    isRetryable: (error) => {
      if (error instanceof RetryableUpstreamStatusError) {
        return true;
      }

      if (error instanceof RetryableUpstreamBodyMissingError) {
        return true;
      }

      return error instanceof TypeError;
    },
  };

  try {
    return await withRetry(
      async (attempt, signal) => {
        const response = await fetchImpl(input.url, {
          ...input.init,
          signal,
        });

        if (
          attempt < retryOptions.maxAttempts &&
          (isRetryableUpstreamStatus(response.status) ||
            (await isRetryableRateLimitResponse(response)))
        ) {
          await cancelResponseBody(response);
          throw new RetryableUpstreamStatusError(response);
        }

        if (
          input.requireResponseBody === true &&
          !response.body &&
          attempt < retryOptions.maxAttempts
        ) {
          throw new RetryableUpstreamBodyMissingError(response);
        }

        return response;
      },
      retryOptions,
      input.signal,
    );
  } catch (error) {
    if (error instanceof RetryableUpstreamStatusError) {
      return error.response;
    }

    if (error instanceof RetryableUpstreamBodyMissingError) {
      return error.response;
    }

    if (error instanceof RetryExhaustedError) {
      if (error.lastError instanceof RetryableUpstreamStatusError) {
        return error.lastError.response;
      }

      if (error.lastError instanceof RetryableUpstreamBodyMissingError) {
        return error.lastError.response;
      }

      if (error.lastError instanceof Error) {
        throw error.lastError;
      }
    }

    throw error;
  }
}

async function isRetryableRateLimitResponse(response: Response): Promise<boolean> {
  if (response.status !== 429) {
    return false;
  }

  const upstreamError = await readUpstreamError(response.clone());
  return upstreamError.code === 'RATE_LIMIT';
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    return;
  }
}
