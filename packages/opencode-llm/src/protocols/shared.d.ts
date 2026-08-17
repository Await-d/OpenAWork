import { Buffer } from 'node:buffer';
import { Effect, Schema, Stream } from 'effect';
import { Headers, HttpClientRequest } from 'effect/unstable/http';
import {
  LLMError,
  type ContentPart,
  type LLMRequest,
  type ToolFileContent,
  type ToolResultPart,
} from '../schema/index.js';
import { isRecord } from '../utils/record.js';
export { isRecord };
export declare const Json: Schema.fromJsonString<Schema.Unknown>;
export declare const decodeJson: (
  input: unknown,
  options?: import('effect/SchemaAST').ParseOptions,
) => unknown;
export declare const encodeJson: (
  input: unknown,
  options?: import('effect/SchemaAST').ParseOptions,
) => string;
export declare const JsonObject: Schema.$Record<Schema.String, Schema.Unknown>;
export declare const optionalArray: <const S extends Schema.Top>(
  schema: S,
) => Schema.optional<Schema.$Array<S>>;
export declare const optionalNull: <const S extends Schema.Top>(
  schema: S,
) => Schema.optional<Schema.NullOr<S>>;
/**
 * Streaming tool-call accumulator. Adapters that build a tool call across
 * multiple `tool-input-delta` chunks store the partial JSON input string here
 * and finalize it with `parseToolInput` once the call completes.
 */
export interface ToolAccumulator {
  readonly id: string;
  readonly name: string;
  readonly input: string;
}
/**
 * `Usage.totalTokens` policy shared by every route. Honors a provider-
 * supplied total; otherwise falls back to `inputTokens + outputTokens` only
 * when at least one is defined. Returns `undefined` when neither input nor
 * output is known so routes don't publish a misleading `0`.
 *
 * Under the additive `LLM.Usage` contract, `inputTokens` and `outputTokens`
 * are the non-cached input and visible output only. The provider-supplied
 * `total` is the source of truth when present; the computed fallback
 * under-counts cache and reasoning by design and exists mainly so
 * Anthropic-style providers (which don't surface a total) still get a
 * sensible aggregate on the input + output axes.
 */
export declare const totalTokens: (
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  total: number | undefined,
) => number | undefined;
/**
 * Subtract `subtrahend` from `total`, clamping to zero if the provider
 * reports a non-sensical breakdown (e.g. `cached_tokens > prompt_tokens`).
 * Used by protocol mappers when deriving a non-overlapping breakdown field
 * from a provider's inclusive total — `nonCachedInputTokens` from
 * `inputTokens - cacheReadInputTokens - cacheWriteInputTokens`.
 *
 * If `total` is `undefined`, returns `undefined` (we don't fabricate
 * counts). If `subtrahend` is `undefined`, returns `total` unchanged. The
 * provider-native breakdown stays available on `Usage.native` for debugging.
 */
export declare const subtractTokens: (
  total: number | undefined,
  subtrahend: number | undefined,
) => number | undefined;
/**
 * Sum a list of optional token counts, returning `undefined` only when
 * every value is `undefined` (so we don't fabricate a `0`). Used by
 * protocol mappers to derive the inclusive `inputTokens` total from a
 * provider that natively reports a non-overlapping breakdown
 * (e.g. Anthropic, whose `input_tokens` is already non-cached only).
 */
export declare const sumTokens: (
  ...values: ReadonlyArray<number | undefined>
) => number | undefined;
export declare const eventError: (route: string, message: string, raw?: string) => LLMError;
export declare const parseJson: (
  route: string,
  input: string,
  message: string,
) => Effect.Effect<unknown, LLMError, never>;
/**
 * Join the `text` field of a list of parts with newlines. Used by routes
 * that flatten system / message content arrays into a single provider string
 * (OpenAI Chat `system` content, OpenAI Responses `system` content, Gemini
 * `systemInstruction.parts[].text`).
 */
export declare const joinText: (
  parts: ReadonlyArray<{
    readonly text: string;
  }>,
) => string;
/**
 * Stable fallback representation for chronological `Message.system(...)`
 * updates on routes that do not support that privileged role natively. The
 * wrapper remains visibly lower-authority user text, preserves the original
 * temporal position, and XML-escapes content so it cannot close the wrapper.
 */
export declare const wrapSystemUpdate: (
  parts: ReadonlyArray<{
    readonly text: string;
  }>,
) => string;
/**
 * Chronological system updates deliberately accept text only. Do not insert
 * raw retrieved, tool, or web content into privileged updates: keep untrusted
 * data in ordinary user/tool messages instead.
 */
export declare const systemUpdateText: (
  route: string,
  message: import('../schema/messages.js').Message,
) => Effect.Effect<
  {
    readonly type: 'text';
    readonly text: string;
    readonly cache?: import('../schema/options.js').CacheHint | undefined;
    readonly metadata?:
      | {
          readonly [x: string]: unknown;
        }
      | undefined;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  }[],
  LLMError,
  never
>;
/** Lower an unsupported privileged update into visible, in-order user text. */
export declare const wrappedSystemUpdate: (
  route: string,
  message: import('../schema/messages.js').Message,
) => Effect.Effect<
  {
    type: 'text';
    text: string;
    cache: import('../schema/options.js').CacheHint | undefined;
  },
  LLMError,
  never
>;
/**
 * Parse the streamed JSON input of a tool call. Treats an empty string as
 * `"{}"` — providers occasionally finish a tool call without ever emitting
 * input deltas (e.g. zero-arg tools). The error message is uniform across
 * routes: `Invalid JSON input for <route> tool call <name>`.
 */
export declare const parseToolInput: (
  route: string,
  name: string,
  raw: string,
) => Effect.Effect<unknown, LLMError, never>;
export declare const IMAGE_MIMES: readonly ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export declare const VIDEO_MIMES: readonly ['video/mp4', 'video/webm', 'video/quicktime'];
export declare const AUDIO_MIMES: readonly [
  'audio/wav',
  'audio/mp3',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
];
export declare const MEDIA_MIMES: readonly [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/wav',
  'audio/mp3',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
];
export declare const MAX_MEDIA_ENCODED_BYTES: number;
export declare const MAX_MEDIA_DECODED_BYTES: number;
export interface ValidatedMedia {
  readonly mime: string;
  readonly base64: string;
  readonly dataUrl: string;
  readonly bytes: Uint8Array;
}
export declare const validateMedia: (
  route: string,
  part: {
    readonly type: 'media';
    readonly mediaType: string;
    readonly data: string | Uint8Array<ArrayBufferLike>;
    readonly filename?: string | undefined;
    readonly metadata?:
      | {
          readonly [x: string]: unknown;
        }
      | undefined;
  },
  supportedMimes: ReadonlySet<string>,
) => Effect.Effect<
  {
    mime: string;
    base64: string;
    dataUrl: string;
    bytes: Buffer<ArrayBuffer>;
  },
  LLMError,
  never
>;
export declare const validateToolFile: (
  route: string,
  part: ToolFileContent,
  supportedMimes: ReadonlySet<string>,
) => Effect.Effect<
  {
    mime: string;
    base64: string;
    dataUrl: string;
    bytes: Buffer<ArrayBuffer>;
  },
  LLMError,
  never
>;
export declare const trimBaseUrl: (value: string) => string;
export declare const isAnthropicOfficialBaseUrl: (value: string | undefined) => boolean;
export declare const supportsAnthropicContextManagement: (request: LLMRequest) => boolean;
export declare const toolResultText: (part: ToolResultPart) => string;
export declare const errorText: (error: unknown) => string;
/**
 * `framing` step for Server-Sent Events. Decodes UTF-8, runs the SSE channel
 * decoder, and drops empty / `[DONE]` keep-alive events so the downstream
 * `decodeChunk` sees one JSON string per element. The SSE channel emits a
 * `Retry` control event on its error channel; we drop it here (we don't
 * implement client-driven retries) so the public error channel stays
 * `LLMError`.
 */
export declare const sseFraming: (
  bytes: Stream.Stream<Uint8Array, LLMError>,
) => Stream.Stream<string, LLMError>;
/**
 * Canonical invalid-request constructor. Lift one-line `const invalid =
 * (message) => invalidRequest(message)` aliases out of every
 * route so the error constructor lives in one place. If we ever extend
 * `InvalidRequestReason` with route context or trace metadata, the change
 * lands here.
 */
export declare const invalidRequest: (message: string) => LLMError;
export declare const matchToolChoice: <Auto, None, Required, Tool>(
  route: string,
  toolChoice: NonNullable<LLMRequest['toolChoice']>,
  cases: {
    readonly auto: () => Auto;
    readonly none: () => None;
    readonly required: () => Required;
    readonly tool: (name: string) => Tool;
  },
) => Effect.Effect<Auto | None | Required | Tool, LLMError, never>;
type ContentType = ContentPart['type'];
export declare const supportsContent: <const Type extends ContentType>(
  part: ContentPart,
  types: ReadonlyArray<Type>,
) => part is Extract<
  ContentPart,
  {
    readonly type: Type;
  }
>;
export declare const unsupportedContent: (
  route: string,
  role: LLMRequest['messages'][number]['role'],
  types: ReadonlyArray<ContentType>,
) => LLMError;
/**
 * Build a `validate` step from a Schema decoder. Replaces the per-route
 * lambda body `(payload) => decode(payload).pipe(Effect.mapError((e) =>
 * invalid(e.message)))`. Any decode error is translated into
 * `LLMError` carrying the original parse-error message.
 */
export declare const validateWith: <
  A,
  I,
  E extends {
    readonly message: string;
  },
>(
  decode: (input: I) => Effect.Effect<A, E>,
) => (payload: I) => Effect.Effect<A, LLMError, never>;
/**
 * Build an HTTP POST with a JSON body. Sets `content-type: application/json`
 * automatically after caller-supplied headers so routes cannot accidentally
 * send JSON with a stale content type. The body is passed pre-encoded so
 * routes can choose between
 * `Schema.encodeSync(payload)` and `ProviderShared.encodeJson(payload)`.
 */
export declare const jsonPost: (input: {
  readonly url: string;
  readonly body: string;
  readonly headers?: Headers.Input;
}) => HttpClientRequest.HttpClientRequest;
export * as ProviderShared from './shared.js';
//# sourceMappingURL=shared.d.ts.map
