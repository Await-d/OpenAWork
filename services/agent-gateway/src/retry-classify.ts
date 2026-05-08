/**
 * Upstream retry classification helpers.
 *
 * Ports opencode's `session/retry.ts` parsing logic so the v2 path
 * can surface `retry-after` headers, free-tier exhaustion, and
 * provider-overload errors in the `UpstreamErrorDescriptor` chunk
 * that reaches the client. The AI SDK's internal retry loop already
 * honours `retry-after` for transport-level retries; this module is
 * about *post-exhaustion* classification — once AI SDK gives up, we
 * still want the UI to know "retry-after-ms = 4200, message =
 * 'Provider is overloaded'" instead of an opaque "stream failed".
 *
 * The classifier never mutates the error and never throws.
 */

export const RETRY_INITIAL_DELAY_MS = 2_000;
export const RETRY_BACKOFF_FACTOR = 2;
/** Hard cap matching opencode (max 32-bit signed integer for setTimeout). */
export const RETRY_MAX_DELAY_MS = 2_147_483_647;
/** Soft cap when no retry-after header is present. */
export const RETRY_MAX_DELAY_NO_HEADERS_MS = 30_000;

/**
 * Stable user-facing message we use when we detect the OpenCode-style
 * free-tier exhaustion error. Kept verbatim so TUI/web upsell detection
 * still matches.
 */
export const FREE_USAGE_UPSELL_MESSAGE =
  'Free usage exceeded, subscribe to Go https://opencode.ai/go';

export interface UpstreamRetryClassification {
  /** Whether this error class is retryable by upper layers. */
  retryable: boolean;
  /** Short user-facing reason — e.g. "Rate Limited", "Provider is overloaded". */
  message: string;
  /** Suggested wait time before next attempt, in ms. May exceed `RETRY_MAX_DELAY_NO_HEADERS_MS` if the server hinted at it explicitly. */
  retryAfterMs?: number;
  /** Coarse category for telemetry. */
  category:
    | 'rate_limit'
    | 'overloaded'
    | 'free_usage_exhausted'
    | 'transient_5xx'
    | 'context_overflow'
    | 'unknown';
}

function cap(ms: number): number {
  return Math.min(Math.max(0, ms), RETRY_MAX_DELAY_MS);
}

/**
 * Compute an exponential-backoff delay for `attempt` (1-indexed).
 * If `responseHeaders` is supplied, honour `retry-after-ms` /
 * `retry-after` (seconds or HTTP-date) before falling back to
 * exponential backoff.
 *
 * Mirrors opencode's `session/retry.ts:delay`.
 */
export function computeRetryDelayMs(
  attempt: number,
  responseHeaders?: Record<string, string | undefined>,
): number {
  if (responseHeaders) {
    const ms = responseHeaders['retry-after-ms'];
    if (ms) {
      const parsed = Number.parseFloat(ms);
      if (!Number.isNaN(parsed)) return cap(parsed);
    }
    const sec = responseHeaders['retry-after'];
    if (sec) {
      const parsedSeconds = Number.parseFloat(sec);
      if (!Number.isNaN(parsedSeconds)) {
        return cap(Math.ceil(parsedSeconds * 1000));
      }
      const httpDate = Date.parse(sec) - Date.now();
      if (!Number.isNaN(httpDate) && httpDate > 0) return cap(Math.ceil(httpDate));
    }
    return cap(RETRY_INITIAL_DELAY_MS * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1));
  }
  return cap(
    Math.min(
      RETRY_INITIAL_DELAY_MS * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
      RETRY_MAX_DELAY_NO_HEADERS_MS,
    ),
  );
}

interface ClassifyInput {
  message?: string;
  statusCode?: number;
  responseBody?: string;
  responseHeaders?: Record<string, string | undefined>;
  isRetryable?: boolean;
}

function readResponseHeaders(error: unknown): Record<string, string | undefined> | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const obj = error as Record<string, unknown>;
  // AI SDK APICallError shape: error.responseHeaders
  if (obj['responseHeaders'] && typeof obj['responseHeaders'] === 'object') {
    return obj['responseHeaders'] as Record<string, string | undefined>;
  }
  // Some SDKs nest under data
  const data = obj['data'] as Record<string, unknown> | undefined;
  if (data && typeof data['responseHeaders'] === 'object') {
    return data['responseHeaders'] as Record<string, string | undefined>;
  }
  return undefined;
}

function readClassifyInput(error: unknown): ClassifyInput {
  if (!error || typeof error !== 'object') {
    return { message: typeof error === 'string' ? error : String(error) };
  }
  const obj = error as Record<string, unknown>;
  const data = (obj['data'] as Record<string, unknown> | undefined) ?? obj;
  return {
    message: typeof obj['message'] === 'string' ? obj['message'] : undefined,
    statusCode: typeof data['statusCode'] === 'number' ? data['statusCode'] : undefined,
    responseBody: typeof data['responseBody'] === 'string' ? data['responseBody'] : undefined,
    responseHeaders: readResponseHeaders(error),
    isRetryable: typeof data['isRetryable'] === 'boolean' ? data['isRetryable'] : undefined,
  };
}

/**
 * Classify an upstream error into a stable retry category.
 *
 * Returns `undefined` for context-overflow errors — those must never
 * be retried by the caller.
 *
 * Mirrors opencode's `session/retry.ts:retryable`.
 */
export function classifyUpstreamError(error: unknown): UpstreamRetryClassification {
  const info = readClassifyInput(error);
  const status = info.statusCode;

  // 5xx are always transient regardless of SDK isRetryable flag.
  if (status !== undefined && status >= 500) {
    return {
      retryable: true,
      category: 'transient_5xx',
      message: info.message ?? `Provider returned ${status}`,
      retryAfterMs: computeRetryDelayMs(1, info.responseHeaders),
    };
  }

  if (info.responseBody?.includes('FreeUsageLimitError')) {
    return {
      retryable: false,
      category: 'free_usage_exhausted',
      message: FREE_USAGE_UPSELL_MESSAGE,
    };
  }

  const msg = info.message ?? '';
  const lower = msg.toLowerCase();
  if (
    lower.includes('overloaded') ||
    lower.includes('exhausted') ||
    lower.includes('unavailable')
  ) {
    return {
      retryable: true,
      category: 'overloaded',
      message: 'Provider is overloaded',
      retryAfterMs: computeRetryDelayMs(1, info.responseHeaders),
    };
  }

  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('rate increased too quickly') ||
    status === 429
  ) {
    return {
      retryable: true,
      category: 'rate_limit',
      message: msg || 'Rate Limited',
      retryAfterMs: computeRetryDelayMs(1, info.responseHeaders),
    };
  }

  // Try to peel structured Anthropic / OpenAI-compat error envelopes
  // out of the message string when the SDK gave us nothing better.
  if (msg.startsWith('{')) {
    try {
      const json = JSON.parse(msg) as {
        type?: string;
        error?: { type?: string; code?: string };
        code?: string;
      };
      if (json.type === 'error' && json.error?.type === 'too_many_requests') {
        return {
          retryable: true,
          category: 'rate_limit',
          message: 'Too Many Requests',
          retryAfterMs: computeRetryDelayMs(1, info.responseHeaders),
        };
      }
      if (typeof json.code === 'string' && /(exhausted|unavailable)/i.test(json.code)) {
        return {
          retryable: true,
          category: 'overloaded',
          message: 'Provider is overloaded',
          retryAfterMs: computeRetryDelayMs(1, info.responseHeaders),
        };
      }
      if (
        json.type === 'error' &&
        typeof json.error?.code === 'string' &&
        json.error.code.includes('rate_limit')
      ) {
        return {
          retryable: true,
          category: 'rate_limit',
          message: 'Rate Limited',
          retryAfterMs: computeRetryDelayMs(1, info.responseHeaders),
        };
      }
    } catch {
      /* fall through */
    }
  }

  return {
    retryable: info.isRetryable ?? false,
    category: 'unknown',
    message: info.message ?? 'Upstream error',
  };
}
