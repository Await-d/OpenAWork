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

// ─── 面向用户的上游错误说明 ───────────────────────────────────────────────

export interface UpstreamErrorUserDescription {
  /** 中文说明（现象 / 上游原话 / 建议三段），可直接写入用户可见文本。 */
  message: string;
  category: UpstreamRetryClassification['category'];
  /** `false` 表示配置 / 权限类问题，重试不会恢复——调用方不得再提示「稍后重试」。 */
  retryable: boolean;
  status?: number;
}

const USER_DETAIL_MAX_LENGTH = 300;

/**
 * 状态码在 `LLM.Error` 上位于 `reason.status` 或 `reason.http.response.status`；
 * 同时兼容 SDK 常见的扁平形态。
 */
function readErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const obj = error as Record<string, unknown>;
  const reason = asRecord(obj['reason']);
  const fromReason = reason?.['status'];
  const fromHttp = asRecord(asRecord(reason?.['http'])?.['response'])?.['status'];
  const flatHttp = asRecord(asRecord(obj['http'])?.['response'])?.['status'];
  for (const candidate of [
    fromReason,
    fromHttp,
    flatHttp,
    obj['statusCode'],
    obj['status'],
    obj['httpStatus'],
  ]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * 读 `LLM.Error.reason` 上的字符串字段：`_tag`（reason 类型）或 `kind`
 * （Authentication 的 `invalid` / `insufficient-permissions` / `expired` / `missing`）。
 */
function readReasonField(error: unknown, key: string): string | undefined {
  const value = asRecord(asRecord(error)?.['reason'])?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** `LLM.Error.retryable` 是语义化 getter（403=false / 429=true / 5xx=true），优先于纯文本分类。 */
function readErrorRetryable(error: unknown): boolean | undefined {
  const direct = asRecord(error)?.['retryable'];
  if (typeof direct === 'boolean') return direct;
  const nested = asRecord(asRecord(error)?.['reason'])?.['retryable'];
  return typeof nested === 'boolean' ? nested : undefined;
}

/**
 * 上游错误 message 形如 `RequestExecutor.execute: Provider request failed with
 * HTTP 403: <上游 body>`（body 在构造时已脱敏）。剥掉两层包装，只留给用户看的原因。
 */
function extractUpstreamDetail(rawMessage: string): string | null {
  const withoutModulePrefix = rawMessage.replace(/^[A-Za-z_$][\w$]*\.[\w$]+:\s*/, '');
  if (/^Provider request failed with HTTP \d+$/.test(withoutModulePrefix.trim())) {
    return null;
  }
  const detail = withoutModulePrefix
    .replace(/^Provider request failed with HTTP \d+:\s*/, '')
    .trim();
  if (detail.length === 0) return null;
  return detail.length > USER_DETAIL_MAX_LENGTH
    ? `${detail.slice(0, USER_DETAIL_MAX_LENGTH)}…`
    : detail;
}

function buildUserDescription(input: {
  summary: string;
  action: string;
  classification: UpstreamRetryClassification;
  retryable: boolean;
  status: number | undefined;
  detail: string | null;
}): UpstreamErrorUserDescription {
  const lines = [`**原因**：${input.summary}`];
  if (input.detail) {
    lines.push(`**上游返回**：${input.detail}`);
  }
  lines.push(`**建议**：${input.action}`);
  return {
    message: lines.join('\n'),
    category: input.classification.category,
    retryable: input.retryable,
    ...(input.status !== undefined ? { status: input.status } : {}),
  };
}

/**
 * 把上游错误翻译成「现象 + 上游原话 + 建议」的中文说明，替代调用方各自写死的
 * 「请稍后重试」——对 401/403 这类配置类错误，后者会让用户反复重试却看不到原因。
 * 永不抛出。判据优先级：reason tag → HTTP 状态码 → `classifyUpstreamError` 的 category。
 */
export function describeUpstreamErrorForUser(error: unknown): UpstreamErrorUserDescription {
  const classification = classifyUpstreamError(error);
  const status = readErrorStatus(error);
  const tag = readReasonField(error, '_tag');
  const authKind = readReasonField(error, 'kind');
  const retryable = readErrorRetryable(error) ?? classification.retryable;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const detail = extractUpstreamDetail(rawMessage);
  const base = { classification, retryable, status, detail };

  if (classification.category === 'free_usage_exhausted') {
    return buildUserDescription({
      ...base,
      summary: '该平台的免费额度已用尽。',
      action: '订阅或切换平台后重试（重试当前模型不会恢复）。',
    });
  }

  if (classification.category === 'context_overflow') {
    return buildUserDescription({
      ...base,
      summary: '请求上下文超出模型的长度限制。',
      action: '压缩或清理会话上下文后重试。',
    });
  }

  if (tag === 'Authentication' || status === 401 || status === 403) {
    if (authKind === 'insufficient-permissions' || status === 403) {
      return buildUserDescription({
        ...base,
        summary: '上游拒绝访问该模型（HTTP 403）：账号无权访问，或该模型的节点上游不可用。',
        action:
          '请在「设置 → 提供商」核对该平台的账号 / 节点配置，或改用其它可用模型后重试（重试不会恢复）。',
      });
    }
    return buildUserDescription({
      ...base,
      summary:
        status === undefined
          ? '上游判定凭证无效或未授权。'
          : `上游判定凭证无效或未授权（HTTP ${status}）。`,
      action: '请在「设置 → 提供商」重新配置该平台的 API Key（重试不会恢复）。',
    });
  }

  if (tag === 'QuotaExceeded' || tag === 'RateLimit' || classification.category === 'rate_limit') {
    const isQuota = tag === 'QuotaExceeded';
    return buildUserDescription({
      ...base,
      summary: isQuota
        ? '该模型的额度已用尽。'
        : `上游限流：请求过于频繁${status !== undefined ? `（HTTP ${status}）` : ''}。`,
      action: isQuota ? '请更换模型或等待额度重置。' : '稍后重试；持续出现请检查该平台的限流额度。',
    });
  }

  if (
    classification.category === 'overloaded' ||
    tag === 'ProviderInternal' ||
    classification.category === 'transient_5xx' ||
    (status !== undefined && status >= 500)
  ) {
    return buildUserDescription({
      ...base,
      summary:
        status !== undefined && status >= 500
          ? `上游模型服务异常（HTTP ${status}）。`
          : '上游模型服务当前负载过高。',
      action: '这属于瞬时故障，稍后重试通常可以恢复。',
    });
  }

  if (tag === 'Transport' || classification.category === 'network') {
    return buildUserDescription({
      ...base,
      summary: '与上游的连接失败或超时。',
      action: '请检查网络与 Base URL 是否可达后重试。',
    });
  }

  if (tag === 'NoRoute') {
    return buildUserDescription({
      ...base,
      summary: '没有可用的上游路由。',
      action: '请检查该平台的 Base URL 与模型名是否正确（重试不会恢复）。',
    });
  }

  if (tag === 'InvalidRequest' || tag === 'InvalidProviderOutput') {
    return buildUserDescription({
      ...base,
      summary: status !== undefined ? `上游判定请求非法（HTTP ${status}）。` : '上游判定请求非法。',
      action: '多为 Base URL 与「上游协议」不匹配，或该平台不支持此模型名，请核对配置。',
    });
  }

  if (tag === 'ContentPolicy') {
    return buildUserDescription({
      ...base,
      summary: '请求被上游的内容安全策略拦截。',
      action: '调整输入内容后重试。',
    });
  }

  return buildUserDescription({
    ...base,
    summary: status !== undefined ? `上游调用失败（HTTP ${status}）。` : '上游调用失败。',
    action: retryable ? '稍后重试。' : '请检查该平台的服务商配置或改用其它模型后重试。',
  });
}
