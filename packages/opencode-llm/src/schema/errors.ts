import { Schema } from 'effect';
import { ModelID, ProviderID, ProviderMetadata, RouteID } from './ids.js';

export const ProviderFailureClassification = Schema.Literals([
  'context-overflow',
  'payload-too-large',
]);
export type ProviderFailureClassification = typeof ProviderFailureClassification.Type;

export class HttpRequestDetails extends Schema.Class<HttpRequestDetails>('LLM.HttpRequestDetails')({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpResponseDetails extends Schema.Class<HttpResponseDetails>(
  'LLM.HttpResponseDetails',
)({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
}) {}

export class HttpRateLimitDetails extends Schema.Class<HttpRateLimitDetails>(
  'LLM.HttpRateLimitDetails',
)({
  retryAfterMs: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  remaining: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  reset: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class HttpContext extends Schema.Class<HttpContext>('LLM.HttpContext')({
  request: HttpRequestDetails,
  response: Schema.optional(HttpResponseDetails),
  body: Schema.optional(Schema.String),
  bodyTruncated: Schema.optional(Schema.Boolean),
  requestId: Schema.optional(Schema.String),
  rateLimit: Schema.optional(HttpRateLimitDetails),
}) {}

export class InvalidRequestReason extends Schema.Class<InvalidRequestReason>(
  'LLM.Error.InvalidRequest',
)({
  _tag: Schema.tag('InvalidRequest'),
  message: Schema.String,
  parameter: Schema.optional(Schema.String),
  classification: Schema.optional(ProviderFailureClassification),
  // Underlying exception, when the failure was caused by one (e.g. a Schema
  // decode error). Kept so diagnostics can distinguish a syntax error from a
  // shape mismatch instead of collapsing both into the message.
  cause: Schema.optional(Schema.Defect({ includeStack: true })),
  // Preserve the complete original response or triggering event before decoding narrows it.
  body: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false;
  }
}

export class NoRouteReason extends Schema.Class<NoRouteReason>('LLM.Error.NoRoute')({
  _tag: Schema.tag('NoRoute'),
  route: RouteID,
  provider: ProviderID,
  model: ModelID,
}) {
  get retryable() {
    return false;
  }

  get message() {
    return `No LLM route for ${this.provider}/${this.model} using ${this.route}`;
  }
}

export class AuthenticationReason extends Schema.Class<AuthenticationReason>(
  'LLM.Error.Authentication',
)({
  _tag: Schema.tag('Authentication'),
  message: Schema.String,
  kind: Schema.Literals(['missing', 'invalid', 'expired', 'insufficient-permissions', 'unknown']),
  // Preserve the complete original response or triggering event before decoding narrows it.
  body: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false;
  }
}

export class RateLimitReason extends Schema.Class<RateLimitReason>('LLM.Error.RateLimit')({
  _tag: Schema.tag('RateLimit'),
  message: Schema.String,
  retryAfterMs: Schema.optional(Schema.Number),
  rateLimit: Schema.optional(HttpRateLimitDetails),
  // Preserve the complete original response or triggering event before decoding narrows it.
  body: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return true;
  }
}

export class QuotaExceededReason extends Schema.Class<QuotaExceededReason>(
  'LLM.Error.QuotaExceeded',
)({
  _tag: Schema.tag('QuotaExceeded'),
  message: Schema.String,
  // Preserve the complete original response or triggering event before decoding narrows it.
  body: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false;
  }
}

export class ContentPolicyReason extends Schema.Class<ContentPolicyReason>(
  'LLM.Error.ContentPolicy',
)({
  _tag: Schema.tag('ContentPolicy'),
  message: Schema.String,
  // Preserve the complete original response or triggering event before decoding narrows it.
  body: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false;
  }
}

export class ProviderInternalReason extends Schema.Class<ProviderInternalReason>(
  'LLM.Error.ProviderInternal',
)({
  _tag: Schema.tag('ProviderInternal'),
  message: Schema.String,
  status: Schema.Number,
  retryAfterMs: Schema.optional(Schema.Number),
  // Preserve the complete original response or triggering event before decoding narrows it.
  body: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return true;
  }
}

/** 传输载体（对齐上游 `TransportError.transport`）。 */
export const TransportType = Schema.Literals(['http', 'websocket']);
export type TransportType = Schema.Schema.Type<typeof TransportType>;

/** 传输阶段（对齐上游 `TransportError.operation`）。 */
export const TransportOperation = Schema.Literals(['request', 'read', 'write']);
export type TransportOperation = Schema.Schema.Type<typeof TransportOperation>;

export class TransportReason extends Schema.Class<TransportReason>('LLM.Error.Transport')({
  _tag: Schema.tag('Transport'),
  message: Schema.String,
  kind: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  http: Schema.optional(HttpContext),
  // 传输维度：区分「连接阶段」与「读/写阶段」的失败，便于上层按阶段决定重试。
  transport: Schema.optional(TransportType),
  operation: Schema.optional(TransportOperation),
  code: Schema.optional(Schema.String),
}) {
  /**
   * 只有**连接/响应头阶段**（`operation === 'request'`）的传输失败可重试。
   *
   * 判据是「上游有没有投递」而不是「是不是网络错」——与上游 `packages/ai` 的
   * `delivery: not-sent` / `recovery: retry-connect` 语义一致：
   *
   * - `'request'`：`http.ts` 的响应头超时、`executor.ts` 的 `toHttpError` 连接阶段失败
   *   （ECONNREFUSED / DNS / TLS / 客户端自身超时）。此刻一个字节都还没吐出来，
   *   重试不会重复输出，也不会让用户白等一轮 —— 这正是「上游真的挂了」要自动重试的场景。
   * - `'read'`：分片静默（默认 15 分钟）与整次预算到顶。流已经吐了一半，重试会产生
   *   重复内容；即使是「干净」的静默，重试也只是再等一个同样长的窗口，故不重试。
   * - `'write'` 与**缺失 `operation`**（websocket 连接/收发失败、`httpStreamError` 的
   *   流读取失败、「本轮输出可能不完整」那类不明阶段失败）一律不重试：阶段未知就按
   *   「可能已投递」的保守假设处理。
   *
   * 重试上限由调用方决定（`executor.ts` 的 `MAX_RETRIES`，连接阶段共 3 次尝试）。
   */
  get retryable() {
    return this.operation === 'request';
  }
}

export class InvalidProviderOutputReason extends Schema.Class<InvalidProviderOutputReason>(
  'LLM.Error.InvalidProviderOutput',
)({
  _tag: Schema.tag('InvalidProviderOutput'),
  message: Schema.String,
  route: Schema.optional(Schema.String),
  raw: Schema.optional(Schema.String),
  // `incomplete-stream` marks a response that ended before its terminal event,
  // so callers can tell "provider got cut off" apart from a malformed payload
  // and decide whether to continue or retry.
  classification: Schema.optional(Schema.Literals(['incomplete-stream'])),
  // Underlying exception from the JSON/Schema decode that failed.
  cause: Schema.optional(Schema.Defect({ includeStack: true })),
  // Preserve the complete original response or triggering event before decoding narrows it.
  body: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {
  get retryable() {
    return false;
  }
}

export class UnknownProviderReason extends Schema.Class<UnknownProviderReason>(
  'LLM.Error.UnknownProvider',
)({
  _tag: Schema.tag('UnknownProvider'),
  message: Schema.String,
  status: Schema.optional(Schema.Number),
  // Preserve the complete original response or triggering event before decoding narrows it.
  body: Schema.optional(Schema.String),
  providerMetadata: Schema.optional(ProviderMetadata),
  http: Schema.optional(HttpContext),
}) {
  get retryable() {
    return false;
  }
}

export const LLMErrorReason = Schema.Union([
  InvalidRequestReason,
  NoRouteReason,
  AuthenticationReason,
  RateLimitReason,
  QuotaExceededReason,
  ContentPolicyReason,
  ProviderInternalReason,
  TransportReason,
  InvalidProviderOutputReason,
  UnknownProviderReason,
]).pipe(Schema.toTaggedUnion('_tag'));
export type LLMErrorReason = Schema.Schema.Type<typeof LLMErrorReason>;

export class LLMError extends Schema.TaggedError<LLMError>()('LLM.Error', {
  module: Schema.String,
  method: Schema.String,
  reason: LLMErrorReason,
}) {
  override readonly cause = this.reason;

  get retryable() {
    return this.reason.retryable;
  }

  get retryAfterMs() {
    return 'retryAfterMs' in this.reason ? this.reason.retryAfterMs : undefined;
  }

  override get message() {
    return `${this.module}.${this.method}: ${this.reason.message}`;
  }
}

/**
 * Failure type for tool execute handlers. Handlers must map their internal
 * errors to this shape; the runtime catches `ToolFailure`s and surfaces them
 * as `tool-error` events plus a `tool-result` of `type: "error"` so the model
 * can self-correct.
 *
 * Anything thrown or yielded by a handler that is not a `ToolFailure` is
 * treated as a defect and fails the stream.
 */
export class ToolFailure extends Schema.TaggedError<ToolFailure>()('LLM.ToolFailure', {
  message: Schema.String,
  error: Schema.optional(Schema.Defect()),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
