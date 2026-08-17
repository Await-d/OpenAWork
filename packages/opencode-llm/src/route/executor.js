import { Cause, Context, Effect, Layer, Random } from 'effect';
import { FetchHttpClient, Headers, HttpClient, HttpClientError } from 'effect/unstable/http';
import {
  AuthenticationReason,
  ContentPolicyReason,
  HttpContext,
  HttpRateLimitDetails,
  HttpRequestDetails,
  HttpResponseDetails,
  InvalidRequestReason,
  LLMError,
  ProviderInternalReason,
  QuotaExceededReason,
  RateLimitReason,
  TransportReason,
  UnknownProviderReason,
} from '../schema/index.js';
import { isContextOverflow } from '../provider-error.js';
export class Service extends Context.Service()('@opencode/LLM/RequestExecutor') {}
const BODY_LIMIT = 16_384;
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;
const REDACTED = '<redacted>';
// One source of truth for what counts as a sensitive name across headers,
// URL query keys, and field names embedded inside request/response bodies.
//
// `SENSITIVE_NAME` is used as both a substring matcher (for free-form header
// names like `Authorization` / `X-API-Key`) and as the body-field alternation
// list. `SHORT_QUERY_NAME` covers anchored short keys like `?key=…` / `?sig=…`
// that are too generic to redact substring-style without false positives.
const SENSITIVE_NAME_SOURCE =
  'authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|credential|signature|x-amz-signature';
const SENSITIVE_NAME = new RegExp(SENSITIVE_NAME_SOURCE, 'i');
const SHORT_QUERY_NAME = /^(key|sig)$/i;
const SENSITIVE_BODY_FIELD = new RegExp(`(?:${SENSITIVE_NAME_SOURCE}|key)`, 'i');
const REDACT_JSON_FIELD = new RegExp(
  `("(?:${SENSITIVE_BODY_FIELD.source})"\\s*:\\s*)"[^"]*"`,
  'gi',
);
const REDACT_QUERY_FIELD = new RegExp(`((?:${SENSITIVE_BODY_FIELD.source})=)[^&\\s"]+`, 'gi');
const isSensitiveHeaderName = (name) => SENSITIVE_NAME.test(name);
const isSensitiveQueryName = (name) => isSensitiveHeaderName(name) || SHORT_QUERY_NAME.test(name);
const redactHeaders = (headers, redactedNames) =>
  Object.fromEntries(
    Object.entries(Headers.redact(headers, [...redactedNames, SENSITIVE_NAME])).map(
      ([name, value]) => [name, String(value)],
    ),
  );
const redactUrl = (value) => {
  if (!URL.canParse(value)) return REDACTED;
  const url = new URL(value);
  url.searchParams.forEach((_, key) => {
    if (isSensitiveQueryName(key)) url.searchParams.set(key, REDACTED);
  });
  return url.toString();
};
const normalizedHeaders = (headers) =>
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
const requestId = (headers) => {
  return (
    headers['x-request-id'] ??
    headers['request-id'] ??
    headers['x-amzn-requestid'] ??
    headers['x-amz-request-id'] ??
    headers['x-goog-request-id'] ??
    headers['cf-ray']
  );
};
const retryableStatus = (status) =>
  status === 429 || status === 503 || status === 504 || status === 529;
const retryAfterMs = (headers) => {
  const millis = Number(headers['retry-after-ms']);
  if (Number.isFinite(millis)) return Math.max(0, millis);
  const value = headers['retry-after'];
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
};
const addRateLimitValue = (target, key, value) => {
  if (key.length > 0) target[key] = value;
};
const rateLimitDetails = (headers, retryAfter) => {
  const limit = {};
  const remaining = {};
  const reset = {};
  Object.entries(headers).forEach(([name, value]) => {
    const openaiLimit = /^x-ratelimit-limit-(.+)$/.exec(name)?.[1];
    if (openaiLimit) return addRateLimitValue(limit, openaiLimit, value);
    const openaiRemaining = /^x-ratelimit-remaining-(.+)$/.exec(name)?.[1];
    if (openaiRemaining) return addRateLimitValue(remaining, openaiRemaining, value);
    const openaiReset = /^x-ratelimit-reset-(.+)$/.exec(name)?.[1];
    if (openaiReset) return addRateLimitValue(reset, openaiReset, value);
    const anthropic = /^anthropic-ratelimit-(.+)-(limit|remaining|reset)$/.exec(name);
    if (!anthropic) return;
    if (anthropic[2] === 'limit') return addRateLimitValue(limit, anthropic[1], value);
    if (anthropic[2] === 'remaining') return addRateLimitValue(remaining, anthropic[1], value);
    return addRateLimitValue(reset, anthropic[1], value);
  });
  if (
    retryAfter === undefined &&
    Object.keys(limit).length === 0 &&
    Object.keys(remaining).length === 0 &&
    Object.keys(reset).length === 0
  )
    return undefined;
  return new HttpRateLimitDetails({
    retryAfterMs: retryAfter,
    limit: Object.keys(limit).length === 0 ? undefined : limit,
    remaining: Object.keys(remaining).length === 0 ? undefined : remaining,
    reset: Object.keys(reset).length === 0 ? undefined : reset,
  });
};
const requestDetails = (request, redactedNames) =>
  new HttpRequestDetails({
    method: request.method,
    url: redactUrl(request.url),
    headers: redactHeaders(request.headers, redactedNames),
  });
const responseDetails = (response, redactedNames) =>
  new HttpResponseDetails({
    status: response.status,
    headers: redactHeaders(response.headers, redactedNames),
  });
const secretValues = (request) => {
  const values = new Set();
  const add = (value) => {
    if (value.length < 4) return;
    values.add(value);
    values.add(encodeURIComponent(value));
  };
  Object.entries(request.headers).forEach(([name, value]) => {
    if (!isSensitiveHeaderName(name)) return;
    add(value);
    const bearer = /^Bearer\s+(.+)$/i.exec(value)?.[1];
    if (bearer) add(bearer);
  });
  if (!URL.canParse(request.url)) return values;
  new URL(request.url).searchParams.forEach((value, key) => {
    if (isSensitiveQueryName(key)) add(value);
  });
  return values;
};
// Two passes: structural (redact `"name": "value"` and `name=value` patterns
// for any field name that looks sensitive) plus literal (replace any actual
// secret values we sent in the request, in case the response echoes one back).
const redactBody = (body, request) =>
  Array.from(secretValues(request)).reduce(
    (text, secret) => text.split(secret).join(REDACTED),
    body.replace(REDACT_JSON_FIELD, `$1"${REDACTED}"`).replace(REDACT_QUERY_FIELD, `$1${REDACTED}`),
  );
const responseBody = (body, request) => {
  if (body === undefined) return {};
  const redacted = redactBody(body, request);
  if (redacted.length <= BODY_LIMIT) return { body: redacted };
  return { body: redacted.slice(0, BODY_LIMIT), bodyTruncated: true };
};
const providerMessage = (status, body) => {
  if (body.body && body.body.length <= 500)
    return `Provider request failed with HTTP ${status}: ${body.body}`;
  return `Provider request failed with HTTP ${status}`;
};
const responseHttp = (input) =>
  new HttpContext({
    request: requestDetails(input.request, input.redactedNames),
    response: responseDetails(input.response, input.redactedNames),
    ...input.body,
    requestId: input.requestId,
    rateLimit: input.rateLimit,
  });
const statusReason = (input) => {
  const body = input.http.body ?? '';
  if (/content[-_\s]?policy|content_filter|safety/i.test(body)) {
    return new ContentPolicyReason({ message: input.message, http: input.http });
  }
  if (input.status === 401) {
    return new AuthenticationReason({ message: input.message, kind: 'invalid', http: input.http });
  }
  if (input.status === 403) {
    return new AuthenticationReason({
      message: input.message,
      kind: 'insufficient-permissions',
      http: input.http,
    });
  }
  if (input.status === 429) {
    if (/insufficient[-_\s]?quota|quota[-_\s]?exceeded/i.test(body)) {
      return new QuotaExceededReason({ message: input.message, http: input.http });
    }
    return new RateLimitReason({
      message: input.message,
      retryAfterMs: input.retryAfterMs,
      rateLimit: input.rateLimit,
      http: input.http,
    });
  }
  if (
    input.status === 400 ||
    input.status === 404 ||
    input.status === 409 ||
    input.status === 413 ||
    input.status === 422
  ) {
    return new InvalidRequestReason({
      message: input.message,
      classification: isContextOverflow(body) ? 'context-overflow' : undefined,
      http: input.http,
    });
  }
  if (input.status >= 500 || retryableStatus(input.status)) {
    return new ProviderInternalReason({
      message: input.message,
      status: input.status,
      retryAfterMs: input.retryAfterMs,
      http: input.http,
    });
  }
  return new UnknownProviderReason({
    message: input.message,
    status: input.status,
    http: input.http,
  });
};
const statusError = (request, redactedNames) => (response) =>
  Effect.gen(function* () {
    if (response.status < 400) return response;
    const body = yield* response.text.pipe(Effect.catch(() => Effect.void));
    const headers = normalizedHeaders(response.headers);
    const retryAfter = retryAfterMs(headers);
    const rateLimit = rateLimitDetails(headers, retryAfter);
    const details = responseBody(body, request);
    return yield* new LLMError({
      module: 'RequestExecutor',
      method: 'execute',
      reason: statusReason({
        status: response.status,
        message: providerMessage(response.status, details),
        retryAfterMs: retryAfter,
        rateLimit,
        http: responseHttp({
          request,
          response,
          redactedNames,
          body: details,
          requestId: requestId(headers),
          rateLimit,
        }),
      }),
    });
  });
const toHttpError = (redactedNames) => (error) => {
  const transportError = (input) =>
    new LLMError({
      module: 'RequestExecutor',
      method: 'execute',
      reason: new TransportReason({
        message: input.message,
        kind: input.kind,
        url: input.request ? redactUrl(input.request.url) : undefined,
        http: input.request
          ? new HttpContext({ request: requestDetails(input.request, redactedNames) })
          : undefined,
      }),
    });
  if (Cause.isTimeoutError(error)) {
    return transportError({ message: error.message, kind: 'Timeout' });
  }
  if (!HttpClientError.isHttpClientError(error)) {
    return transportError({ message: 'HTTP transport failed' });
  }
  const request = 'request' in error ? error.request : undefined;
  if (error.reason._tag === 'TransportError') {
    return transportError({
      message: error.reason.description ?? 'HTTP transport failed',
      kind: error.reason._tag,
      request,
    });
  }
  return transportError({
    message: `HTTP transport failed: ${error.reason._tag}`,
    kind: error.reason._tag,
    request,
  });
};
const retryDelay = (error, attempt) => {
  if (error.retryAfterMs !== undefined)
    return Effect.succeed(Math.min(error.retryAfterMs, MAX_DELAY_MS));
  return Random.nextBetween(
    Math.min(BASE_DELAY_MS * 2 ** attempt * 0.8, MAX_DELAY_MS),
    Math.min(BASE_DELAY_MS * 2 ** attempt * 1.2, MAX_DELAY_MS),
  ).pipe(Effect.map((delay) => Math.round(delay)));
};
const retryStatusFailures = (effect, retries = MAX_RETRIES, attempt = 0) =>
  Effect.catchTag(effect, 'LLM.Error', (error) => {
    if (!error.retryable || retries <= 0) return Effect.fail(error);
    return retryDelay(error, attempt).pipe(
      Effect.flatMap((delay) => Effect.sleep(delay)),
      Effect.flatMap(() => retryStatusFailures(effect, retries - 1, attempt + 1)),
    );
  });
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const executeOnce = (request) =>
      Effect.gen(function* () {
        const redactedNames = yield* Headers.CurrentRedactedNames;
        return yield* http
          .execute(request)
          .pipe(
            Effect.mapError(toHttpError(redactedNames)),
            Effect.flatMap(statusError(request, redactedNames)),
          );
      });
    return Service.of({
      execute: (request) => retryStatusFailures(executeOnce(request)),
    });
  }),
);
export const fetchLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'error' })),
);
export * as RequestExecutor from './executor.js';
//# sourceMappingURL=executor.js.map
