import { parseContextLimitError } from '../compaction/context-window-resolver.js';

/**
 * Upstream retry classification helpers.
 *
 * Ports opencode's `session/retry.ts` parsing logic so the v2 path
 * can surface `retry-after` headers, free-tier exhaustion, and
 * provider-overload errors in the `UpstreamErrorDescriptor` chunk
 * that reaches the client. The native client retry loop already
 * honours `retry-after` for transport-level retries; this module is
 * about *post-exhaustion* classification — once the client gives up, we
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
    | 'network'
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
  /** Node/undici transport error code (e.g. `ECONNRESET`, `UND_ERR_SOCKET`). */
  errorCode?: string;
}

function readResponseHeaders(error: unknown): Record<string, string | undefined> | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const obj = error as Record<string, unknown>;
  // A common upstream call-error shape: error.responseHeaders.
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
    errorCode: readErrorCode(error),
  };
}

/**
 * Known transport-level error codes from Node's `net`/`dns` layers and
 * undici's fetch stack. These indicate the upstream connection failed
 * or dropped — not an application-level rejection — so the request can
 * safely be retried.
 */
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Pull a transport error code off the error or its `cause` chain.
 * undici wraps the original `code` under `error.cause.code` (e.g.
 * `TypeError: fetch failed` → `cause.code = 'ECONNRESET'`), so we walk
 * a couple of levels rather than only reading the top-level `code`.
 */
function readErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as Record<string, unknown>)['code'];
    if (typeof code === 'string' && code.length > 0) {
      return code;
    }
    current = (current as Record<string, unknown>)['cause'];
  }
  return undefined;
}

/**
 * Unambiguous transport failure detected via Node/undici error code.
 * Safe to check first because a real `ECONNRESET` / `ETIMEDOUT` can
 * never also be an application-level rate-limit or overload.
 */
function hasNetworkErrorCode(info: ClassifyInput): boolean {
  return info.errorCode !== undefined && NETWORK_ERROR_CODES.has(info.errorCode);
}

/**
 * Fallback message-based detection for when undici drops the original
 * `code` during error wrapping (e.g. `TypeError: fetch failed`,
 * `terminated`, `socket hang up`). Checked only after rate-limit /
 * overload phrasing so broad words like "timeout" don't steal a more
 * specific category.
 */
function hasNetworkErrorMessage(info: ClassifyInput): boolean {
  const lower = (info.message ?? '').toLowerCase();
  if (lower.length === 0) {
    return false;
  }
  return (
    lower.includes('fetch failed') ||
    lower.includes('socket hang up') ||
    lower.includes('network error') ||
    lower.includes('connection error') ||
    lower.includes('connection reset') ||
    lower.includes('connection refused') ||
    lower.includes('connection closed') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('client network socket disconnected') ||
    lower.includes('terminated') ||
    lower.includes('request timed out') ||
    lower.includes('timed out') ||
    lower.includes('timeout')
  );
}

function buildNetworkClassification(info: ClassifyInput): UpstreamRetryClassification {
  return {
    retryable: true,
    category: 'network',
    message: 'Network connection error, retrying',
    retryAfterMs: computeRetryDelayMs(1, info.responseHeaders),
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

  // Transport-level connection failures detected via error code take
  // precedence: a real socket/DNS/timeout failure is unambiguous and
  // always retryable, and the upstream never attached an HTTP status.
  if (status === undefined && hasNetworkErrorCode(info)) {
    return buildNetworkClassification(info);
  }

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
      // Anthropic mid-stream overload events arrive as
      // `{ "type": "error", "error": { "type": "server_is_overloaded" | "overloaded_error", ... } }`.
      // The lowercase substring check above already catches the rendered JSON
      // string, but recognising the structured shape here keeps the category
      // stable even if upstream stops including the literal "overloaded" word
      // in the rendered message. Mirrors opencode #25888.
      if (
        json.type === 'error' &&
        typeof json.error?.type === 'string' &&
        /(?:^|_)overloaded(?:_|$)/i.test(json.error.type)
      ) {
        return {
          retryable: true,
          category: 'overloaded',
          message: 'Provider is overloaded',
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

  // Context-length / prompt-too-long errors. These are never retried
  // by the native client (isRetryable=false), but the compaction recovery layer
  // in `stream.ts` needs a stable `overflow: true` signal on the round
  // result to trigger `triggerOverflowCompaction`. We classify them
  // here so the upstreamError descriptor also carries a meaningful category.
  if (parseContextLimitError(error) !== null) {
    return {
      retryable: false,
      category: 'context_overflow',
      message: info.message ?? '上下文长度超出模型限制，正在自动压缩会话历史…',
    };
  }

  // Fallback: undici frequently rethrows transport failures as
  // `TypeError: fetch failed` with the original `code` buried (or lost)
  // on the cause chain. Checked after rate-limit / overload phrasing so
  // those keep their more specific category.
  if (hasNetworkErrorMessage(info)) {
    return buildNetworkClassification(info);
  }

  return {
    retryable: info.isRetryable ?? false,
    category: 'unknown',
    message: info.message ?? 'Upstream error',
  };
}
