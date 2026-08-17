import { Schema } from "effect";
export declare const ProviderFailureClassification: Schema.Literal<"context-overflow">;
export type ProviderFailureClassification = typeof ProviderFailureClassification.Type;
declare const HttpRequestDetails_base: Schema.Class<HttpRequestDetails, Schema.Struct<{
    readonly method: Schema.String;
    readonly url: Schema.String;
    readonly headers: Schema.$Record<Schema.String, Schema.String>;
}>, {}>;
export declare class HttpRequestDetails extends HttpRequestDetails_base {
}
declare const HttpResponseDetails_base: Schema.Class<HttpResponseDetails, Schema.Struct<{
    readonly status: Schema.Number;
    readonly headers: Schema.$Record<Schema.String, Schema.String>;
}>, {}>;
export declare class HttpResponseDetails extends HttpResponseDetails_base {
}
declare const HttpRateLimitDetails_base: Schema.Class<HttpRateLimitDetails, Schema.Struct<{
    readonly retryAfterMs: Schema.optional<Schema.Number>;
    readonly limit: Schema.optional<Schema.$Record<Schema.String, Schema.String>>;
    readonly remaining: Schema.optional<Schema.$Record<Schema.String, Schema.String>>;
    readonly reset: Schema.optional<Schema.$Record<Schema.String, Schema.String>>;
}>, {}>;
export declare class HttpRateLimitDetails extends HttpRateLimitDetails_base {
}
declare const HttpContext_base: Schema.Class<HttpContext, Schema.Struct<{
    readonly request: typeof HttpRequestDetails;
    readonly response: Schema.optional<typeof HttpResponseDetails>;
    readonly body: Schema.optional<Schema.String>;
    readonly bodyTruncated: Schema.optional<Schema.Boolean>;
    readonly requestId: Schema.optional<Schema.String>;
    readonly rateLimit: Schema.optional<typeof HttpRateLimitDetails>;
}>, {}>;
export declare class HttpContext extends HttpContext_base {
}
declare const InvalidRequestReason_base: Schema.Class<InvalidRequestReason, Schema.Struct<{
    readonly _tag: Schema.tag<"InvalidRequest">;
    readonly message: Schema.String;
    readonly parameter: Schema.optional<Schema.String>;
    readonly classification: Schema.optional<Schema.Literal<"context-overflow">>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    readonly http: Schema.optional<typeof HttpContext>;
}>, {}>;
export declare class InvalidRequestReason extends InvalidRequestReason_base {
    get retryable(): boolean;
}
declare const NoRouteReason_base: Schema.Class<NoRouteReason, Schema.Struct<{
    readonly _tag: Schema.tag<"NoRoute">;
    readonly route: Schema.String;
    readonly provider: Schema.brand<Schema.String, "LLM.ProviderID">;
    readonly model: Schema.brand<Schema.String, "LLM.ModelID">;
}>, {}>;
export declare class NoRouteReason extends NoRouteReason_base {
    get retryable(): boolean;
    get message(): string;
}
declare const AuthenticationReason_base: Schema.Class<AuthenticationReason, Schema.Struct<{
    readonly _tag: Schema.tag<"Authentication">;
    readonly message: Schema.String;
    readonly kind: Schema.Literals<readonly ["missing", "invalid", "expired", "insufficient-permissions", "unknown"]>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    readonly http: Schema.optional<typeof HttpContext>;
}>, {}>;
export declare class AuthenticationReason extends AuthenticationReason_base {
    get retryable(): boolean;
}
declare const RateLimitReason_base: Schema.Class<RateLimitReason, Schema.Struct<{
    readonly _tag: Schema.tag<"RateLimit">;
    readonly message: Schema.String;
    readonly retryAfterMs: Schema.optional<Schema.Number>;
    readonly rateLimit: Schema.optional<typeof HttpRateLimitDetails>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    readonly http: Schema.optional<typeof HttpContext>;
}>, {}>;
export declare class RateLimitReason extends RateLimitReason_base {
    get retryable(): boolean;
}
declare const QuotaExceededReason_base: Schema.Class<QuotaExceededReason, Schema.Struct<{
    readonly _tag: Schema.tag<"QuotaExceeded">;
    readonly message: Schema.String;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    readonly http: Schema.optional<typeof HttpContext>;
}>, {}>;
export declare class QuotaExceededReason extends QuotaExceededReason_base {
    get retryable(): boolean;
}
declare const ContentPolicyReason_base: Schema.Class<ContentPolicyReason, Schema.Struct<{
    readonly _tag: Schema.tag<"ContentPolicy">;
    readonly message: Schema.String;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    readonly http: Schema.optional<typeof HttpContext>;
}>, {}>;
export declare class ContentPolicyReason extends ContentPolicyReason_base {
    get retryable(): boolean;
}
declare const ProviderInternalReason_base: Schema.Class<ProviderInternalReason, Schema.Struct<{
    readonly _tag: Schema.tag<"ProviderInternal">;
    readonly message: Schema.String;
    readonly status: Schema.Number;
    readonly retryAfterMs: Schema.optional<Schema.Number>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    readonly http: Schema.optional<typeof HttpContext>;
}>, {}>;
export declare class ProviderInternalReason extends ProviderInternalReason_base {
    get retryable(): boolean;
}
declare const TransportReason_base: Schema.Class<TransportReason, Schema.Struct<{
    readonly _tag: Schema.tag<"Transport">;
    readonly message: Schema.String;
    readonly kind: Schema.optional<Schema.String>;
    readonly url: Schema.optional<Schema.String>;
    readonly http: Schema.optional<typeof HttpContext>;
}>, {}>;
export declare class TransportReason extends TransportReason_base {
    get retryable(): boolean;
}
declare const InvalidProviderOutputReason_base: Schema.Class<InvalidProviderOutputReason, Schema.Struct<{
    readonly _tag: Schema.tag<"InvalidProviderOutput">;
    readonly message: Schema.String;
    readonly route: Schema.optional<Schema.String>;
    readonly raw: Schema.optional<Schema.String>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
}>, {}>;
export declare class InvalidProviderOutputReason extends InvalidProviderOutputReason_base {
    get retryable(): boolean;
}
declare const UnknownProviderReason_base: Schema.Class<UnknownProviderReason, Schema.Struct<{
    readonly _tag: Schema.tag<"UnknownProvider">;
    readonly message: Schema.String;
    readonly status: Schema.optional<Schema.Number>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    readonly http: Schema.optional<typeof HttpContext>;
}>, {}>;
export declare class UnknownProviderReason extends UnknownProviderReason_base {
    get retryable(): boolean;
}
export declare const LLMErrorReason: Schema.toTaggedUnion<"_tag", readonly [typeof InvalidRequestReason, typeof NoRouteReason, typeof AuthenticationReason, typeof RateLimitReason, typeof QuotaExceededReason, typeof ContentPolicyReason, typeof ProviderInternalReason, typeof TransportReason, typeof InvalidProviderOutputReason, typeof UnknownProviderReason]>;
export type LLMErrorReason = Schema.Schema.Type<typeof LLMErrorReason>;
declare const LLMError_base: Schema.Class<LLMError, Schema.TaggedStruct<"LLM.Error", {
    readonly module: Schema.String;
    readonly method: Schema.String;
    readonly reason: Schema.toTaggedUnion<"_tag", readonly [typeof InvalidRequestReason, typeof NoRouteReason, typeof AuthenticationReason, typeof RateLimitReason, typeof QuotaExceededReason, typeof ContentPolicyReason, typeof ProviderInternalReason, typeof TransportReason, typeof InvalidProviderOutputReason, typeof UnknownProviderReason]>;
}>, import("effect/Cause").YieldableError>;
export declare class LLMError extends LLMError_base {
    readonly cause: InvalidRequestReason | NoRouteReason | AuthenticationReason | RateLimitReason | QuotaExceededReason | ContentPolicyReason | ProviderInternalReason | TransportReason | InvalidProviderOutputReason | UnknownProviderReason;
    get retryable(): boolean;
    get retryAfterMs(): number | undefined;
    get message(): string;
}
declare const ToolFailure_base: Schema.Class<ToolFailure, Schema.TaggedStruct<"LLM.ToolFailure", {
    readonly message: Schema.String;
    readonly error: Schema.optional<Schema.Defect>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
}>, import("effect/Cause").YieldableError>;
/**
 * Failure type for tool execute handlers. Handlers must map their internal
 * errors to this shape; the runtime catches `ToolFailure`s and surfaces them
 * as `tool-error` events plus a `tool-result` of `type: "error"` so the model
 * can self-correct.
 *
 * Anything thrown or yielded by a handler that is not a `ToolFailure` is
 * treated as a defect and fails the stream.
 */
export declare class ToolFailure extends ToolFailure_base {
}
export {};
//# sourceMappingURL=errors.d.ts.map