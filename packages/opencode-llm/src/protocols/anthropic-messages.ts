import { Effect, Schema } from 'effect';
import { Route } from '../route/client.js';
import { Auth } from '../route/auth.js';
import { Endpoint } from '../route/endpoint.js';
import { Framing } from '../route/framing.js';
import { Protocol } from '../route/protocol.js';
import {
  AnthropicContextManagement,
  LLMEvent,
  Usage,
  type CacheHint,
  type FinishReason,
  type JsonSchema,
  type LLMError,
  type LLMRequest,
  type MediaPart,
  type ProviderMetadata,
  type ToolCallPart,
  type ToolDefinition,
  type ToolContent,
  type ToolResultPart,
} from '../schema/index.js';
import { JsonObject, optionalArray, optionalNull, ProviderShared } from './shared.js';
import { isContextOverflow } from '../provider-error.js';
import { effortUpdate, resolveEffortUpdates } from '../effort-updates.js';
import * as Cache from './utils/cache.js';
import { Lifecycle } from './utils/lifecycle.js';
import { ToolSchemaProjection } from './utils/tool-schema.js';
import { ToolStream } from './utils/tool-stream.js';

const ADAPTER = 'anthropic-messages';
export const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
export const PATH = '/messages';
// 对齐参考库：`Message.effort()` 标记未给出目标强度时的默认值。
const DEFAULT_EFFORT = 'high';

// =============================================================================
// Request Body Schema
// =============================================================================
const AnthropicCacheControl = Schema.Struct({
  type: Schema.tag('ephemeral'),
  ttl: Schema.optional(Schema.Literals(['5m', '1h'])),
});

// SDK: MessageCreateParamsBase.service_tier {auto | standard_only}；按参考库的
// knownString 语义接受任意字符串（已知值仅用于提示），不做闭集校验。
const AnthropicServiceTier = Schema.String;

// SDK OutputConfig {effort?: "low"|"medium"|"high"|"xhigh"|"max"|null, format?}
const AnthropicJsonOutputFormat = Schema.Struct({
  type: Schema.Literal('json_schema'),
  schema: JsonObject,
});
const AnthropicOutputConfig = Schema.Struct({
  effort: Schema.optional(Schema.String),
  format: Schema.optional(Schema.NullOr(AnthropicJsonOutputFormat)),
});

// SDK Metadata {user_id?: string|null}
const AnthropicMetadata = Schema.Struct({ user_id: optionalNull(Schema.String) });

// SDK MessageCreateParamsContainer: ContainerParams|string; ContainerParams {id?, skills?}
const AnthropicContainer = Schema.Union([
  Schema.String,
  Schema.Struct({
    id: optionalNull(Schema.String),
    skills: optionalNull(Schema.Array(JsonObject)),
  }),
]);

const AnthropicTextBlock = Schema.Struct({
  type: Schema.tag('text'),
  text: Schema.String,
  cache_control: Schema.optional(AnthropicCacheControl),
});
type AnthropicTextBlock = Schema.Schema.Type<typeof AnthropicTextBlock>;

// SDK: ImageBlockParam {source: Base64|URL|File, cache_control, transformations}
const AnthropicBase64ImageSource = Schema.Struct({
  type: Schema.tag('base64'),
  media_type: Schema.String,
  data: Schema.String,
});
const AnthropicURLImageSource = Schema.Struct({ type: Schema.tag('url'), url: Schema.String });
const AnthropicFileImageSource = Schema.Struct({
  type: Schema.tag('file'),
  file_id: Schema.String,
});
const AnthropicImageSource = Schema.Union([
  AnthropicBase64ImageSource,
  AnthropicURLImageSource,
  AnthropicFileImageSource,
]);
const AnthropicImageTransformations = Schema.Struct({
  oversized_image: Schema.optional(Schema.Literals(['downsize', 'error'])),
});

const AnthropicImageBlock = Schema.Struct({
  type: Schema.tag('image'),
  source: AnthropicImageSource,
  cache_control: Schema.optional(AnthropicCacheControl),
  transformations: Schema.optional(AnthropicImageTransformations),
});
type AnthropicImageBlock = Schema.Schema.Type<typeof AnthropicImageBlock>;

// SDK: DocumentBlockParam {source: Base64PDF|PlainText|URLPDF|FileDocument, cache_control, citations, context, title}
const AnthropicBase64PDFSource = Schema.Struct({
  type: Schema.tag('base64'),
  media_type: Schema.Literal('application/pdf'),
  data: Schema.String,
});
const AnthropicPlainTextSource = Schema.Struct({
  type: Schema.tag('text'),
  media_type: Schema.Literal('text/plain'),
  data: Schema.String,
});
const AnthropicURLPDFSource = Schema.Struct({ type: Schema.tag('url'), url: Schema.String });
const AnthropicFileDocumentSource = Schema.Struct({
  type: Schema.tag('file'),
  file_id: Schema.String,
});
const AnthropicDocumentSource = Schema.Union([
  AnthropicBase64PDFSource,
  AnthropicPlainTextSource,
  AnthropicURLPDFSource,
  AnthropicFileDocumentSource,
]);

const AnthropicDocumentBlock = Schema.Struct({
  type: Schema.tag('document'),
  source: AnthropicDocumentSource,
  cache_control: Schema.optional(AnthropicCacheControl),
  title: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
  citations: Schema.optional(Schema.Struct({ enabled: Schema.Boolean })),
});
type AnthropicDocumentBlock = Schema.Schema.Type<typeof AnthropicDocumentBlock>;

const AnthropicThinkingBlock = Schema.Struct({
  type: Schema.tag('thinking'),
  thinking: Schema.String,
  signature: Schema.optional(Schema.String),
  cache_control: Schema.optional(AnthropicCacheControl),
});

const AnthropicToolUseBlock = Schema.Struct({
  type: Schema.tag('tool_use'),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
});
type AnthropicToolUseBlock = Schema.Schema.Type<typeof AnthropicToolUseBlock>;

const AnthropicServerToolUseBlock = Schema.Struct({
  type: Schema.tag('server_tool_use'),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
});
type AnthropicServerToolUseBlock = Schema.Schema.Type<typeof AnthropicServerToolUseBlock>;

// Server tool result blocks: web_search_tool_result, code_execution_tool_result,
// and web_fetch_tool_result. The provider executes the tool and inlines the
// structured result into the assistant turn — there is no client tool_result
// round-trip. We round-trip the structured `content` payload as opaque JSON so
// the next request can echo it back when continuing the conversation.
const AnthropicServerToolResultType = Schema.Literals([
  'web_search_tool_result',
  'code_execution_tool_result',
  'web_fetch_tool_result',
]);
type AnthropicServerToolResultType = Schema.Schema.Type<typeof AnthropicServerToolResultType>;

// Safety-filtered thinking arrives as an opaque encrypted `data` payload with
// no visible text. It must round-trip verbatim so multi-turn thinking + tool
// use conversations keep their reasoning continuity.
const AnthropicRedactedThinkingBlock = Schema.Struct({
  type: Schema.tag('redacted_thinking'),
  data: Schema.String,
  cache_control: Schema.optional(AnthropicCacheControl),
});
type AnthropicRedactedThinkingBlock = Schema.Schema.Type<typeof AnthropicRedactedThinkingBlock>;

const AnthropicServerToolResultBlock = Schema.Struct({
  type: AnthropicServerToolResultType,
  tool_use_id: Schema.String,
  content: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
});
type AnthropicServerToolResultBlock = Schema.Schema.Type<typeof AnthropicServerToolResultBlock>;

// Anthropic accepts either a plain string or an ordered array of text/image/
// document blocks inside `tool_result.content`. The array form is required when
// a tool returns media bytes (screenshot, PDF, etc.) so they can be passed to
// the model as proper content blocks instead of being JSON-stringified into the
// prompt — which silently inflates context by megabytes and can push the
// conversation over the model's token limit.
const AnthropicToolResultContent = Schema.Union([
  AnthropicTextBlock,
  AnthropicImageBlock,
  AnthropicDocumentBlock,
]);

const AnthropicToolResultBlock = Schema.Struct({
  type: Schema.tag('tool_result'),
  tool_use_id: Schema.String,
  content: Schema.Union([Schema.String, Schema.Array(AnthropicToolResultContent)]),
  is_error: Schema.optional(Schema.Boolean),
  cache_control: Schema.optional(AnthropicCacheControl),
});

const AnthropicUserBlock = Schema.Union([
  AnthropicTextBlock,
  AnthropicImageBlock,
  AnthropicDocumentBlock,
  AnthropicToolResultBlock,
]);
type AnthropicUserBlock = Schema.Schema.Type<typeof AnthropicUserBlock>;
const AnthropicAssistantBlock = Schema.Union([
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicRedactedThinkingBlock,
  AnthropicToolUseBlock,
  AnthropicServerToolUseBlock,
  AnthropicServerToolResultBlock,
]);
type AnthropicAssistantBlock = Schema.Schema.Type<typeof AnthropicAssistantBlock>;
type AnthropicToolResultBlock = Schema.Schema.Type<typeof AnthropicToolResultBlock>;

const AnthropicMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal('user'), content: Schema.Array(AnthropicUserBlock) }),
  Schema.Struct({
    role: Schema.Literal('assistant'),
    content: Schema.Array(AnthropicAssistantBlock),
  }),
  Schema.Struct({
    role: Schema.Literal('system'),
    content: Schema.Array(AnthropicTextBlock),
    // 对齐参考库：时序 effort 更新的原生形态（content 为空 + output_config）。
    output_config: Schema.optional(Schema.Struct({ effort: Schema.String })),
  }),
]).pipe(Schema.toTaggedUnion('role'));
type AnthropicMessage = Schema.Schema.Type<typeof AnthropicMessage>;

const AnthropicTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  input_schema: JsonObject,
  cache_control: Schema.optional(AnthropicCacheControl),
});
type AnthropicTool = Schema.Schema.Type<typeof AnthropicTool>;

const AnthropicToolChoice = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(['auto', 'any']),
    disable_parallel_tool_use: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.tag('tool'),
    name: Schema.String,
    disable_parallel_tool_use: Schema.optional(Schema.Boolean),
  }),
]);

const AnthropicThinkingDisplay = Schema.Literals(['summarized', 'omitted']);

// SDK ThinkingBlockBinding {prefix_mismatch_behavior?: "error"|"drop_block"}
const AnthropicThinkingBlockBinding = Schema.Struct({
  prefix_mismatch_behavior: Schema.optional(Schema.Literals(['error', 'drop_block'])),
});

const AnthropicThinking = Schema.Union([
  Schema.Struct({
    type: Schema.tag('enabled'),
    budget_tokens: Schema.Number,
    display: Schema.optional(AnthropicThinkingDisplay),
    block_binding: Schema.optional(AnthropicThinkingBlockBinding),
  }),
  // 对齐参考库：adaptive 思考由模型自行决定预算（无需 budget_tokens）。
  Schema.Struct({
    type: Schema.tag('adaptive'),
    display: Schema.optional(AnthropicThinkingDisplay),
    block_binding: Schema.optional(AnthropicThinkingBlockBinding),
  }),
  Schema.Struct({ type: Schema.tag('disabled') }),
]);

const AnthropicBodyFields = {
  model: Schema.String,
  system: optionalArray(AnthropicTextBlock),
  messages: Schema.Array(AnthropicMessage),
  tools: optionalArray(AnthropicTool),
  tool_choice: Schema.optional(AnthropicToolChoice),
  stream: Schema.Literal(true),
  max_tokens: Schema.Number,
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  top_k: Schema.optional(Schema.Number),
  stop_sequences: optionalArray(Schema.String),
  thinking: Schema.optional(AnthropicThinking),
  context_management: Schema.optional(AnthropicContextManagement),
  // SDK 顶层透传（对齐参考库）：output_config / cache_control / container /
  // inference_geo / metadata / service_tier，全部来自 providerOptions。
  output_config: Schema.optional(AnthropicOutputConfig),
  cache_control: Schema.optional(AnthropicCacheControl),
  container: Schema.optional(Schema.NullOr(AnthropicContainer)),
  inference_geo: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(AnthropicMetadata),
  service_tier: Schema.optional(AnthropicServiceTier),
};
const AnthropicMessagesBody = Schema.Struct(AnthropicBodyFields);
export type AnthropicMessagesBody = Schema.Schema.Type<typeof AnthropicMessagesBody>;

const AnthropicUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  cache_creation_input_tokens: optionalNull(Schema.Number),
  cache_read_input_tokens: optionalNull(Schema.Number),
});
type AnthropicUsage = Schema.Schema.Type<typeof AnthropicUsage>;

const AnthropicStreamBlock = Schema.Struct({
  type: Schema.String,
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
  input: Schema.optional(Schema.Unknown),
  // *_tool_result blocks arrive whole as content_block_start (no streaming
  // delta) with the structured payload in `content` and the originating
  // server_tool_use id in `tool_use_id`.
  tool_use_id: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Unknown),
  // `redacted_thinking` blocks arrive whole with the opaque safety-filtered
  // payload in `data`.
  data: Schema.optional(Schema.String),
});

const AnthropicStreamDelta = Schema.Struct({
  type: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  partial_json: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
  stop_reason: optionalNull(Schema.String),
  stop_sequence: optionalNull(Schema.String),
});

const AnthropicEvent = Schema.Struct({
  type: Schema.String,
  index: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.Struct({ usage: Schema.optional(AnthropicUsage) })),
  content_block: Schema.optional(AnthropicStreamBlock),
  delta: Schema.optional(AnthropicStreamDelta),
  usage: Schema.optional(AnthropicUsage),
  // `type` and `message` are both required per Anthropic's spec, but
  // OpenAI-compatible proxies and gateway translations occasionally drop one
  // or the other; mark them optional so a partial payload still parses and
  // the parser can fall back to whichever field is populated.
  error: Schema.optional(
    Schema.Struct({
      type: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
    }),
  ),
});
type AnthropicEvent = Schema.Schema.Type<typeof AnthropicEvent>;

interface ParserState {
  readonly tools: ToolStream.State<number>;
  readonly usage?: Usage;
  readonly lifecycle: Lifecycle.State;
  // Anthropic splits the terminal signal across two events: `message_delta`
  // carries `stop_reason` (and the authoritative usage), while `message_stop`
  // is an empty payload. Hold the reason so `message_stop` can emit exactly one
  // `finish`, and flush any tool call whose `content_block_stop` was lost when
  // the turn was truncated.
  readonly pendingFinish:
    | { readonly reason: FinishReason; readonly raw?: string; readonly stopSequence?: string }
    | undefined;
  // Thinking signatures keyed by content-block index, so a signature delivered
  // on `content_block_start` (or a `signature_delta`) is attached when the
  // block closes rather than lost if no `signature_delta` follows.
  readonly reasoningSignatures: Readonly<Record<number, string>>;
  readonly finished: boolean;
}

const invalid = ProviderShared.invalidRequest;

// =============================================================================
// Request Lowering
// =============================================================================
// Anthropic accepts at most 4 explicit cache_control breakpoints per request,
// across `tools`, `system`, and `messages`. Beyond the cap the API returns a
// 400 — so the lowering layer counts emitted markers and silently drops any
// that exceed it.
const ANTHROPIC_BREAKPOINT_CAP = 4;

const EPHEMERAL_5M = { type: 'ephemeral' as const };
const EPHEMERAL_1H = { type: 'ephemeral' as const, ttl: '1h' as const };

const cacheControl = (breakpoints: Cache.Breakpoints, cache: CacheHint | undefined) => {
  if (cache?.type !== 'ephemeral' && cache?.type !== 'persistent') return undefined;
  if (breakpoints.remaining <= 0) {
    breakpoints.dropped += 1;
    return undefined;
  }
  breakpoints.remaining -= 1;
  return Cache.ttlBucket(cache.ttlSeconds) === '1h' ? EPHEMERAL_1H : EPHEMERAL_5M;
};

const anthropicMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({
  anthropic: metadata,
});

const signatureFromMetadata = (metadata: ProviderMetadata | undefined): string | undefined => {
  const anthropic = metadata?.anthropic;
  if (!ProviderShared.isRecord(anthropic)) return undefined;
  return typeof anthropic.signature === 'string' ? anthropic.signature : undefined;
};

const redactedDataFromMetadata = (metadata: ProviderMetadata | undefined): string | undefined => {
  const anthropic = metadata?.anthropic;
  if (!ProviderShared.isRecord(anthropic)) return undefined;
  return typeof anthropic.redactedData === 'string' ? anthropic.redactedData : undefined;
};

// Anthropic requires a signature on every thinking block, except for relay
// providers that never emit one. A signature-less block must be dropped or
// demoted, never sent as an unsigned `thinking` block (which the API rejects).
const requireThinkingSignature = (request: LLMRequest) => {
  if (request.model.compatibility?.requireSignature !== undefined)
    return request.model.compatibility.requireSignature;
  const provider = request.model.provider.toLowerCase();
  const model = request.model.id.toLowerCase();
  const baseURL = (request.model.route.endpoint.baseURL ?? '').toLowerCase();
  if (
    provider === 'kimi-for-coding' ||
    provider === 'moonshotai' ||
    provider === 'moonshotai-cn' ||
    model.startsWith('kimi-') ||
    baseURL.includes('api.kimi.com/coding') ||
    baseURL.includes('api.moonshot.ai/anthropic') ||
    baseURL.includes('api.moonshot.cn/anthropic')
  )
    return false;
  if (provider.includes('xiaomi') || model.includes('mimo') || baseURL.includes('xiaomimimo.com'))
    return false;
  return true;
};

const lowerTool = (
  breakpoints: Cache.Breakpoints,
  tool: ToolDefinition,
  inputSchema: JsonSchema,
): AnthropicTool => ({
  name: tool.name,
  description: tool.description,
  input_schema: inputSchema,
  cache_control: cacheControl(breakpoints, tool.cache),
});

const lowerToolChoice = (toolChoice: NonNullable<LLMRequest['toolChoice']>) =>
  ProviderShared.matchToolChoice('Anthropic Messages', toolChoice, {
    auto: () => ({
      type: 'auto' as const,
      ...(toolChoice.disableParallelToolUse === undefined
        ? {}
        : { disable_parallel_tool_use: toolChoice.disableParallelToolUse }),
    }),
    none: () => undefined,
    required: () => ({
      type: 'any' as const,
      ...(toolChoice.disableParallelToolUse === undefined
        ? {}
        : { disable_parallel_tool_use: toolChoice.disableParallelToolUse }),
    }),
    tool: (name) => ({
      type: 'tool' as const,
      name,
      ...(toolChoice.disableParallelToolUse === undefined
        ? {}
        : { disable_parallel_tool_use: toolChoice.disableParallelToolUse }),
    }),
  });

// Anthropic only accepts `[a-zA-Z0-9_-]` in tool ids; ids minted by other
// providers must be scrubbed so replayed history stays sendable.
const scrubToolCallID = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

const lowerToolCall = (part: ToolCallPart): AnthropicToolUseBlock => ({
  type: 'tool_use',
  id: scrubToolCallID(part.id),
  name: part.name,
  input: part.input,
});

const lowerServerToolCall = (part: ToolCallPart): AnthropicServerToolUseBlock => ({
  type: 'server_tool_use',
  id: scrubToolCallID(part.id),
  name: part.name,
  input: part.input,
});

// Server tool result blocks are typed by name. Anthropic ships three today;
// extend this list when new server tools land. The block content is the
// structured payload returned by the provider, which we round-trip as-is.
const serverToolResultType = (name: string): AnthropicServerToolResultType | undefined => {
  if (name === 'web_search') return 'web_search_tool_result';
  if (name === 'code_execution') return 'code_execution_tool_result';
  if (name === 'web_fetch') return 'web_fetch_tool_result';
  return undefined;
};

const lowerServerToolResult = Effect.fn('AnthropicMessages.lowerServerToolResult')(function* (
  part: ToolResultPart,
) {
  const wireType = serverToolResultType(part.name);
  if (!wireType)
    return yield* invalid(
      `Anthropic Messages does not know how to round-trip server tool result for ${part.name}`,
    );
  // Prefer the provider-owned replay payload; fall back to the result value for
  // histories built directly from provider events.
  const payload = part.providerMetadata?.['anthropic']?.['result'] ?? part.result.value;
  return {
    type: wireType,
    tool_use_id: scrubToolCallID(part.id),
    content: payload,
  } satisfies AnthropicServerToolResultBlock;
});

const fileIdFromMetadata = (metadata: MediaPart['metadata']): string | undefined => {
  if (!ProviderShared.isRecord(metadata)) return undefined;
  const anthropic = metadata['anthropic'];
  if (ProviderShared.isRecord(anthropic)) {
    if (typeof anthropic['file_id'] === 'string') return anthropic['file_id'];
    if (typeof anthropic['fileId'] === 'string') return anthropic['fileId'];
  }
  if (typeof metadata['file_id'] === 'string') return metadata['file_id'];
  if (typeof metadata['fileId'] === 'string') return metadata['fileId'];
  return undefined;
};

const transformationsFromMetadata = (
  metadata: MediaPart['metadata'],
): AnthropicImageBlock['transformations'] | undefined => {
  if (!ProviderShared.isRecord(metadata)) return undefined;
  const anthropic = ProviderShared.isRecord(metadata['anthropic'])
    ? metadata['anthropic']
    : undefined;
  const raw = anthropic?.['transformations'] ?? metadata['transformations'];
  if (ProviderShared.isRecord(raw)) {
    const value = raw['oversized_image'];
    if (value === 'downsize' || value === 'error') return { oversized_image: value };
  }
  if (
    anthropic !== undefined &&
    (anthropic['oversized_image'] === 'downsize' || anthropic['oversized_image'] === 'error')
  )
    return { oversized_image: anthropic['oversized_image'] };
  return undefined;
};

const documentTitleFromPart = (part: MediaPart): string | undefined => {
  if (ProviderShared.isRecord(part.metadata)) {
    const anthropic = part.metadata['anthropic'];
    if (ProviderShared.isRecord(anthropic) && typeof anthropic['title'] === 'string')
      return anthropic['title'];
    if (typeof part.metadata['title'] === 'string') return part.metadata['title'];
  }
  if (typeof part.filename === 'string' && part.filename.length > 0) return part.filename;
  return undefined;
};

const documentContextFromMetadata = (metadata: MediaPart['metadata']): string | undefined => {
  if (!ProviderShared.isRecord(metadata)) return undefined;
  const anthropic = ProviderShared.isRecord(metadata['anthropic'])
    ? metadata['anthropic']
    : undefined;
  if (anthropic !== undefined && typeof anthropic['context'] === 'string')
    return anthropic['context'];
  if (typeof metadata['context'] === 'string') return metadata['context'];
  return undefined;
};

const citationsFromMetadata = (
  metadata: MediaPart['metadata'],
): AnthropicDocumentBlock['citations'] | undefined => {
  if (!ProviderShared.isRecord(metadata)) return undefined;
  const raw = ProviderShared.isRecord(metadata['anthropic'])
    ? (metadata['anthropic']['citations'] ?? metadata['citations'])
    : metadata['citations'];
  if (ProviderShared.isRecord(raw) && typeof raw['enabled'] === 'boolean')
    return { enabled: raw['enabled'] };
  return undefined;
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

/** Anthropic Messages 支持的媒体：图片 + PDF 文档（对齐参考库）。 */
const ANTHROPIC_MEDIA_MIMES = new Set<string>([...ProviderShared.IMAGE_MIMES, 'application/pdf']);

/**
 * 对齐参考库 `lowerMedia`：图片 / PDF 文档统一降级为 provider-native 内容块。
 *
 * 支持 base64、HTTP URL、`file_id` 直传（Anthropic Files API）与
 * `text/plain` 文本文档，并透传 `transformations` / `title` / `context` /
 * `citations` 元数据。此前只支持 base64 图片，非图片媒体会直接报错。
 */
const lowerMedia = Effect.fn('AnthropicMessages.lowerMedia')(function* (
  part: MediaPart,
  breakpoints?: Cache.Breakpoints,
) {
  const mime = part.mediaType.toLowerCase();
  const cacheControlValue = breakpoints ? cacheControl(breakpoints, part.cache) : undefined;
  const cacheField = cacheControlValue === undefined ? {} : { cache_control: cacheControlValue };
  const transformations = transformationsFromMetadata(part.metadata);
  const documentFields = {
    ...(documentTitleFromPart(part) === undefined
      ? {}
      : { title: documentTitleFromPart(part) as string }),
    ...(documentContextFromMetadata(part.metadata) === undefined
      ? {}
      : { context: documentContextFromMetadata(part.metadata) as string }),
    ...(citationsFromMetadata(part.metadata) === undefined
      ? {}
      : { citations: citationsFromMetadata(part.metadata) as { enabled: boolean } }),
  };

  // SDK file sources: {type:"file", file_id} — Files API 直传。
  const fileId = fileIdFromMetadata(part.metadata);
  if (fileId !== undefined) {
    if (mime.startsWith('image/'))
      return {
        type: 'image' as const,
        source: { type: 'file' as const, file_id: fileId },
        ...cacheField,
        ...(transformations === undefined ? {} : { transformations }),
      } satisfies AnthropicImageBlock;
    if (mime === 'application/pdf')
      return {
        type: 'document' as const,
        source: { type: 'file' as const, file_id: fileId },
        ...cacheField,
        ...documentFields,
      } satisfies AnthropicDocumentBlock;
    return yield* invalid(`Anthropic Messages does not support media type ${part.mediaType}`);
  }

  // SDK URL sources: {type:"url", url} — 图片 / PDF 直链。
  const rawString = typeof part.data === 'string' ? part.data.trim() : undefined;
  if (rawString !== undefined && isHttpUrl(rawString) && !rawString.startsWith('data:')) {
    if (mime.startsWith('image/'))
      return {
        type: 'image' as const,
        source: { type: 'url' as const, url: rawString },
        ...cacheField,
        ...(transformations === undefined ? {} : { transformations }),
      } satisfies AnthropicImageBlock;
    if (mime === 'application/pdf')
      return {
        type: 'document' as const,
        source: { type: 'url' as const, url: rawString },
        ...cacheField,
        ...documentFields,
      } satisfies AnthropicDocumentBlock;
    return yield* invalid(`Anthropic Messages does not support media type ${part.mediaType}`);
  }

  // SDK PlainTextSource: {type:"text", media_type:"text/plain", data}
  if (mime === 'text/plain') {
    const textData =
      typeof part.data !== 'string'
        ? Buffer.from(part.data).toString('utf8')
        : part.data.startsWith('data:')
          ? (() => {
              const comma = part.data.indexOf(',');
              const payload = comma >= 0 ? part.data.slice(comma + 1) : part.data;
              return part.data.includes(';base64')
                ? Buffer.from(payload, 'base64').toString('utf8')
                : decodeURIComponent(payload);
            })()
          : part.data;
    return {
      type: 'document' as const,
      source: { type: 'text' as const, media_type: 'text/plain' as const, data: textData },
      ...cacheField,
      ...documentFields,
    } satisfies AnthropicDocumentBlock;
  }

  const media = yield* ProviderShared.validateMedia(
    'Anthropic Messages',
    part,
    ANTHROPIC_MEDIA_MIMES,
  );
  if (media.mime === 'application/pdf')
    return {
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: 'application/pdf' as const,
        data: media.base64,
      },
      ...cacheField,
      ...documentFields,
    } satisfies AnthropicDocumentBlock;
  return {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: media.mime, data: media.base64 },
    ...cacheField,
    ...(transformations === undefined ? {} : { transformations }),
  } satisfies AnthropicImageBlock;
});

// Tool results may carry structured text/images/documents. Keep media as
// provider-native content instead of JSON-stringifying base64 into a prompt string.
const lowerToolResultContentItem = Effect.fn('AnthropicMessages.lowerToolResultContentItem')(
  function* (item: ToolContent) {
    if (item.type === 'text')
      return { type: 'text' as const, text: item.text } satisfies AnthropicTextBlock;
    // Type guard ensures item is file type here
    if (item.type !== 'file') throw new Error('Unexpected content type');
    return yield* lowerMedia({
      type: 'media',
      mediaType: item.mime,
      data: item.uri,
      filename: item.name,
    });
  },
);

const lowerToolResultContent = Effect.fn('AnthropicMessages.lowerToolResultContent')(function* (
  part: ToolResultPart,
) {
  // Text / json / error results stay as a string for backward compatibility
  // with existing cassettes and provider expectations.
  if (part.result.type !== 'content') return ProviderShared.toolResultText(part);
  // Preserve the narrowed array element type when compiled through a consumer package.
  const content: ReadonlyArray<ToolContent> = part.result.value;
  return yield* Effect.forEach(content, lowerToolResultContentItem);
});

// Mid-conversation system messages are a native Claude API feature only for
// Opus 4.8. Other Anthropic models intentionally use the same visible wrapped-
// user fallback as non-Anthropic routes rather than sending a role they reject.
const supportsNativeSystemUpdates = (request: LLMRequest) =>
  String(request.model.id) === 'claude-opus-4-8';

const endsInServerToolUse = (message: LLMRequest['messages'][number]) => {
  const last = message.content.at(-1);
  return (
    message.role === 'assistant' && last?.type === 'tool-call' && last.providerExecuted === true
  );
};

const canUseNativeSystemUpdate = (messages: LLMRequest['messages'], index: number) => {
  const previous = messages[index - 1];
  const next = messages[index + 1];
  return (
    previous !== undefined &&
    previous.role !== 'system' &&
    (previous.role === 'user' || previous.role === 'tool' || endsInServerToolUse(previous)) &&
    next?.role !== 'system' &&
    (next === undefined || next.role === 'assistant')
  );
};

const splitsLocalToolResults = (messages: LLMRequest['messages'], index: number) => {
  const pending = new Set<string>();
  for (const message of messages.slice(0, index)) {
    for (const part of message.content) {
      if (
        message.role === 'assistant' &&
        part.type === 'tool-call' &&
        part.providerExecuted !== true
      )
        pending.add(part.id);
      if (message.role === 'tool' && part.type === 'tool-result') pending.delete(part.id);
    }
  }
  return pending.size > 0;
};

const lowerNativeSystemUpdate = Effect.fn('AnthropicMessages.lowerNativeSystemUpdate')(function* (
  message: LLMRequest['messages'][number],
  breakpoints: Cache.Breakpoints,
) {
  const content = yield* ProviderShared.systemUpdateText('Anthropic Messages', message);
  return {
    role: 'system' as const,
    content: content.map((part) => ({
      type: 'text' as const,
      text: part.text,
      cache_control: cacheControl(breakpoints, part.cache),
    })),
  };
});

const lowerMessages = Effect.fn('AnthropicMessages.lowerMessages')(function* (
  request: LLMRequest,
  breakpoints: Cache.Breakpoints,
) {
  const messages: AnthropicMessage[] = [];

  for (const [index, message] of request.messages.entries()) {
    if (message.role === 'system') {
      // 对齐参考库：时序 effort 标记降级为原生 `output_config` 消息
      // （任意位置都合法，因此不受文本 system 更新的位置规则约束）。
      const update = effortUpdate(message);
      if (update !== undefined) {
        messages.push({
          role: 'system',
          content: [],
          output_config: { effort: update.effort ?? DEFAULT_EFFORT },
        });
        continue;
      }
      if (splitsLocalToolResults(request.messages, index))
        return yield* invalid(
          'Anthropic Messages system updates cannot split a local tool call from its tool result',
        );
      if (
        supportsNativeSystemUpdates(request) &&
        canUseNativeSystemUpdate(request.messages, index)
      ) {
        messages.push(yield* lowerNativeSystemUpdate(message, breakpoints));
        continue;
      }
      const part = yield* ProviderShared.wrappedSystemUpdate('Anthropic Messages', message);
      const block = {
        type: 'text' as const,
        text: part.text,
        cache_control: cacheControl(breakpoints, part.cache),
      };
      const previous = messages.at(-1);
      if (previous?.role === 'user')
        messages[messages.length - 1] = { role: 'user', content: [...previous.content, block] };
      else messages.push({ role: 'user', content: [block] });
      continue;
    }

    if (message.role === 'user') {
      const content: AnthropicUserBlock[] = [];
      for (const part of message.content) {
        if (part.type === 'text') {
          if (part.text.trim().length === 0) continue;
          content.push({
            type: 'text',
            text: part.text,
            cache_control: cacheControl(breakpoints, part.cache),
          });
          continue;
        }
        if (part.type === 'media') {
          content.push(yield* lowerMedia(part, breakpoints));
          continue;
        }
        return yield* ProviderShared.unsupportedContent('Anthropic Messages', 'user', [
          'text',
          'media',
        ]);
      }
      if (content.length > 0) messages.push({ role: 'user', content });
      continue;
    }

    if (message.role === 'assistant') {
      const content: AnthropicAssistantBlock[] = [];
      for (const part of message.content) {
        if (part.type === 'text') {
          if (part.text.trim().length === 0) continue;
          content.push({
            type: 'text',
            text: part.text,
            cache_control: cacheControl(breakpoints, part.cache),
          });
          continue;
        }
        if (part.type === 'reasoning') {
          // A signature marks visible thinking; only signature-less parts
          // carrying redactedData round-trip as opaque redacted_thinking.
          const signature = part.encrypted ?? signatureFromMetadata(part.providerMetadata);
          const redactedData = redactedDataFromMetadata(part.providerMetadata);
          if (signature === undefined && redactedData !== undefined) {
            content.push({ type: 'redacted_thinking', data: redactedData });
            continue;
          }
          if (typeof signature !== 'string' || signature.trim().length === 0) {
            if (part.text.trim().length === 0) continue;
            if (!requireThinkingSignature(request)) {
              content.push({ type: 'thinking', thinking: part.text, signature: '' });
              continue;
            }
            // Unsigned thinking is invalid on the real API; demote it to text
            // so the conversation stays sendable.
            content.push({ type: 'text', text: part.text });
            continue;
          }
          content.push({ type: 'thinking', thinking: part.text, signature });
          continue;
        }
        if (part.type === 'tool-call') {
          content.push(part.providerExecuted ? lowerServerToolCall(part) : lowerToolCall(part));
          continue;
        }
        if (part.type === 'tool-result' && part.providerExecuted) {
          content.push(yield* lowerServerToolResult(part));
          continue;
        }
        return yield* invalid(
          `Anthropic Messages assistant messages only support text, reasoning, and tool-call content for now`,
        );
      }
      messages.push({ role: 'assistant', content });
      continue;
    }

    const content: AnthropicToolResultBlock[] = [];
    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ['tool-result']))
        return yield* ProviderShared.unsupportedContent('Anthropic Messages', 'tool', [
          'tool-result',
        ]);
      content.push({
        type: 'tool_result',
        tool_use_id: scrubToolCallID(part.id),
        content: yield* lowerToolResultContent(part),
        is_error: part.result.type === 'error' ? true : undefined,
        cache_control: cacheControl(breakpoints, part.cache),
      });
    }
    messages.push({ role: 'user', content });
  }

  return messages;
});

const anthropicOptions = (request: LLMRequest) => request.providerOptions?.anthropic;

/**
 * 对齐参考库：SDK 顶层透传字段（`output_config` / `cache_control` /
 * `container` / `inference_geo` / `metadata` / `service_tier`）。
 * 同时接受 snake_case 与 camelCase 拼写，优先 snake_case；字段校验走
 * Schema，非法值在边界报错而不是发到上游。
 */
const lowerPassthroughOptions = Effect.fn('AnthropicMessages.lowerPassthroughOptions')(function* (
  request: LLMRequest,
) {
  const raw = anthropicOptions(request);
  if (!ProviderShared.isRecord(raw)) return undefined;
  const input = {
    service_tier: raw['service_tier'] ?? raw['serviceTier'],
    metadata: raw['metadata'],
    container: raw['container'],
    inference_geo: raw['inference_geo'] ?? raw['inferenceGeo'],
    cache_control: raw['cache_control'] ?? raw['cacheControl'],
    output_config: raw['output_config'] ?? raw['outputConfig'],
  };
  const decoded = yield* ProviderShared.validateWith(
    Schema.decodeUnknownEffect(
      Schema.Struct({
        service_tier: Schema.optional(AnthropicServiceTier),
        metadata: Schema.optional(AnthropicMetadata),
        container: Schema.optional(Schema.NullOr(AnthropicContainer)),
        inference_geo: Schema.optional(Schema.NullOr(Schema.String)),
        cache_control: Schema.optional(AnthropicCacheControl),
        output_config: Schema.optional(AnthropicOutputConfig),
      }),
    ),
  )(input);
  const result = {
    ...(decoded.service_tier === undefined ? {} : { service_tier: decoded.service_tier }),
    ...(decoded.metadata === undefined ? {} : { metadata: decoded.metadata }),
    ...(decoded.container === undefined ? {} : { container: decoded.container }),
    ...(decoded.inference_geo === undefined ? {} : { inference_geo: decoded.inference_geo }),
    ...(decoded.cache_control === undefined ? {} : { cache_control: decoded.cache_control }),
    ...(decoded.output_config === undefined ? {} : { output_config: decoded.output_config }),
  };
  return Object.keys(result).length === 0 ? undefined : result;
});

const lowerContextManagement = Effect.fn('AnthropicMessages.lowerContextManagement')(function* (
  request: LLMRequest,
) {
  const input = anthropicOptions(request)?.contextManagement;
  if (input === undefined || !ProviderShared.supportsAnthropicContextManagement(request))
    return undefined;
  return yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(AnthropicContextManagement))(
    input,
  );
});

const lowerThinking = Effect.fn('AnthropicMessages.lowerThinking')(function* (request: LLMRequest) {
  const thinking = anthropicOptions(request)?.thinking;
  if (!ProviderShared.isRecord(thinking)) return undefined;
  const display = thinking['display'];
  const thinkingDisplay: { readonly display?: 'summarized' | 'omitted' } =
    display === 'summarized' || display === 'omitted' ? { display } : {};
  // 对齐参考库：`block_binding` 透传（默认值由 applyThinkingBindingDefault 注入）。
  const blockBindingInput = thinking['block_binding'];
  const blockBinding = ProviderShared.isRecord(blockBindingInput)
    ? yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(AnthropicThinkingBlockBinding))(
        blockBindingInput,
      )
    : undefined;
  const thinkingFields = {
    ...thinkingDisplay,
    ...(blockBinding === undefined ? {} : { block_binding: blockBinding }),
  };
  // 对齐参考库：`adaptive` / `disabled` 原样下发（网关对部分模型使用
  // adaptive；此前只认 enabled，导致 adaptive 被静默丢弃）。
  if (thinking['type'] === 'adaptive') return { type: 'adaptive' as const, ...thinkingFields };
  if (thinking['type'] === 'disabled') return { type: 'disabled' as const };
  if (thinking['type'] !== 'enabled') return undefined;
  const budget =
    typeof thinking['budgetTokens'] === 'number'
      ? thinking['budgetTokens']
      : typeof thinking['budget_tokens'] === 'number'
        ? thinking['budget_tokens']
        : undefined;
  if (budget === undefined)
    return yield* invalid('Anthropic thinking provider option requires budgetTokens');
  return { type: 'enabled' as const, budget_tokens: budget, ...thinkingFields };
});

// 对齐参考库：接受网关命名空间与 Vertex 后缀，不把快照日期当 minor 版本。
const claudeVersion = (id: string) => {
  const match =
    /(?:^|[./])claude-(?<family>[a-z]+)-(?<major>\d+)(?:[.-](?<minor>\d{1,2}))?(?:$|[-:@])/.exec(
      id.toLowerCase(),
    )?.groups;
  if (!match) return undefined;
  return {
    family: match['family'] ?? '',
    major: Number(match['major']),
    minor: Number(match['minor'] ?? 0),
  };
};

const supportsThinkingBlockBinding = (model: LLMRequest['model']) => {
  const override = model.compatibility?.supportsThinkingBlockBinding;
  if (override !== undefined) return override;
  const version = claudeVersion(model.id);
  return (
    version !== undefined && (version.major > 5 || (version.major === 5 && version.minor >= 1))
  );
};

const supportsEffortUpdates = (model: LLMRequest['model']) => {
  const override = model.compatibility?.supportsEffortUpdates;
  if (override !== undefined) return override;
  const version = claudeVersion(model.id);
  if (version === undefined) return false;
  if (version.family === 'opus') return version.major >= 5;
  if (version.family !== 'fable' && version.family !== 'mythos') return false;
  return version.major > 5 || (version.major === 5 && version.minor >= 1);
};

/**
 * 对齐参考库：支持的模型默认下发 `block_binding.prefix_mismatch_behavior =
 * 'drop_block'`（未显式配置 thinking 时补 adaptive），避免上游前缀变化导致
 * thinking 块报错；`disabled` 原样返回。
 */
const applyThinkingBindingDefault = (
  model: LLMRequest['model'],
  thinking: Schema.Schema.Type<typeof AnthropicThinking> | undefined,
): Schema.Schema.Type<typeof AnthropicThinking> | undefined => {
  if (thinking?.type === 'disabled') return thinking;
  if (!supportsThinkingBlockBinding(model)) return thinking;
  return {
    ...(thinking ?? { type: 'adaptive' as const }),
    block_binding: {
      prefix_mismatch_behavior: 'drop_block' as const,
      ...thinking?.block_binding,
    },
  };
};

const fromRequest = Effect.fn('AnthropicMessages.fromRequest')(function* (request: LLMRequest) {
  const toolChoice = request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined;
  const generation = request.generation;
  const toolSchemaCompatibility = request.model.compatibility?.toolSchema;
  const outputLimit =
    request.model.defaults?.limits?.output ?? request.model.route.defaults.limits?.output ?? 4096;
  // Allocate the 4-breakpoint budget in invalidation order: tools → system →
  // messages. Tools live highest in the cache hierarchy, so when callers
  // over-mark we keep their tool hints and shed the message-tail ones first.
  const breakpoints = Cache.newBreakpoints(ANTHROPIC_BREAKPOINT_CAP);
  const tools =
    request.tools.length === 0 || request.toolChoice?.type === 'none'
      ? undefined
      : request.tools.map((tool) =>
          lowerTool(
            breakpoints,
            tool,
            ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility),
          ),
        );
  const system =
    request.system.length === 0
      ? undefined
      : request.system.map((part) => ({
          type: 'text' as const,
          text: part.text,
          cache_control: cacheControl(breakpoints, part.cache),
        }));
  // 对齐参考库：时序 effort 更新——顶层 effort 冻结在首个标记的 `previous`，
  // 标记消息由 lowerMessages 降级为原生 `output_config`；最后一个标记与请求
  // 的 effort 不一致（回退 / 分叉历史）时剥离全部标记。
  const passthroughOptions = (yield* lowerPassthroughOptions(request)) ?? {};
  const requestedOutputConfig = passthroughOptions.output_config;
  const { output_config: _outputConfig, ...passthrough } = passthroughOptions;
  const rawEffort = anthropicOptions(request)?.['effort'];
  const requestedEffort =
    requestedOutputConfig?.effort ?? (typeof rawEffort === 'string' ? rawEffort : undefined);
  const effortUpdates = resolveEffortUpdates(request, requestedEffort);
  const messages = yield* lowerMessages(effortUpdates.request, breakpoints);
  const outputConfig =
    effortUpdates.effort === undefined && requestedOutputConfig?.format === undefined
      ? undefined
      : { effort: effortUpdates.effort, format: requestedOutputConfig?.format };
  const contextManagement = yield* lowerContextManagement(request);
  if (breakpoints.dropped > 0) {
    yield* Effect.logWarning(
      `Anthropic Messages: dropped ${breakpoints.dropped} cache breakpoint(s); the API allows at most ${ANTHROPIC_BREAKPOINT_CAP} per request.`,
    );
  }
  return {
    model: request.model.id,
    system,
    messages,
    tools,
    tool_choice: toolChoice,
    stream: true as const,
    max_tokens: generation?.maxTokens ?? outputLimit,
    temperature: generation?.temperature,
    top_p: generation?.topP,
    top_k: generation?.topK,
    stop_sequences: generation?.stop,
    thinking: applyThinkingBindingDefault(request.model, yield* lowerThinking(request)),
    ...(outputConfig === undefined ? {} : { output_config: outputConfig }),
    ...(contextManagement === undefined ? {} : { context_management: contextManagement }),
    ...passthrough,
  };
});

// =============================================================================
// Stream Parsing
// =============================================================================
const mapFinishReason = (reason: string | null | undefined): FinishReason => {
  if (reason === 'end_turn' || reason === 'stop_sequence' || reason === 'pause_turn') return 'stop';
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'length';
  if (reason === 'tool_use') return 'tool-calls';
  if (reason === 'refusal') return 'content-filter';
  return 'unknown';
};

// Anthropic reports the non-overlapping breakdown natively — its
// `input_tokens` is the *non-cached* count per the Messages API docs, with
// cache reads and writes as separate fields. We sum them to derive the
// inclusive `inputTokens` the rest of the contract expects. Extended
// thinking tokens are *not* broken out by Anthropic — they're billed as
// part of `output_tokens`, so `reasoningTokens` stays `undefined` and
// `outputTokens` carries the combined total.
const mapUsage = (usage: AnthropicUsage | undefined): Usage | undefined => {
  if (!usage) return undefined;
  const nonCached = usage.input_tokens;
  const cacheRead = usage.cache_read_input_tokens ?? undefined;
  const cacheWrite = usage.cache_creation_input_tokens ?? undefined;
  const inputTokens = ProviderShared.sumTokens(nonCached, cacheRead, cacheWrite);
  return new Usage({
    inputTokens,
    outputTokens: usage.output_tokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cacheRead,
    cacheWriteInputTokens: cacheWrite,
    totalTokens: ProviderShared.totalTokens(inputTokens, usage.output_tokens, undefined),
    providerMetadata: { anthropic: usage },
  });
};

// Anthropic emits usage on `message_start` and again on `message_delta` — the
// final delta carries the authoritative totals. Right-biased merge: each
// field prefers `right` when defined, falls back to `left`. `inputTokens` is
// recomputed from the merged breakdown so the inclusive total stays
// consistent with `nonCached + cacheRead + cacheWrite`.
const mergeUsage = (left: Usage | undefined, right: Usage | undefined) => {
  if (!left) return right;
  if (!right) return left;
  const nonCachedInputTokens = right.nonCachedInputTokens ?? left.nonCachedInputTokens;
  const cacheReadInputTokens = right.cacheReadInputTokens ?? left.cacheReadInputTokens;
  const cacheWriteInputTokens = right.cacheWriteInputTokens ?? left.cacheWriteInputTokens;
  const inputTokens = ProviderShared.sumTokens(
    nonCachedInputTokens,
    cacheReadInputTokens,
    cacheWriteInputTokens,
  );
  const outputTokens = right.outputTokens ?? left.outputTokens;
  return new Usage({
    inputTokens,
    outputTokens,
    nonCachedInputTokens,
    cacheReadInputTokens,
    cacheWriteInputTokens,
    totalTokens: ProviderShared.totalTokens(inputTokens, outputTokens, undefined),
    providerMetadata: {
      anthropic: {
        ...left.providerMetadata?.['anthropic'],
        ...right.providerMetadata?.['anthropic'],
      },
    },
  });
};

// Server tool result blocks come whole in `content_block_start` (no streaming
// delta sequence). We convert the payload to a `tool-result` event with
// `providerExecuted: true`. The runtime appends it to the assistant message
// for round-trip; downstream consumers can inspect `result.value` for the
// structured payload.
const SERVER_TOOL_RESULT_NAMES: Record<AnthropicServerToolResultType, string> = {
  web_search_tool_result: 'web_search',
  code_execution_tool_result: 'code_execution',
  web_fetch_tool_result: 'web_fetch',
};

const isServerToolResultType = (type: string): type is AnthropicServerToolResultType =>
  type in SERVER_TOOL_RESULT_NAMES;

const serverToolResultEvent = (
  block: NonNullable<AnthropicEvent['content_block']>,
): LLMEvent | undefined => {
  if (!block.type || !isServerToolResultType(block.type)) return undefined;
  const errorPayload =
    typeof block.content === 'object' && block.content !== null && 'type' in block.content
      ? String((block.content as Record<string, unknown>).type)
      : '';
  const isError = errorPayload.endsWith('_tool_result_error');
  return LLMEvent.toolResult({
    id: block.tool_use_id ?? '',
    name: SERVER_TOOL_RESULT_NAMES[block.type],
    result: isError
      ? { type: 'error', value: block.content }
      : { type: 'json', value: block.content },
    providerExecuted: true,
    providerMetadata: anthropicMetadata({ blockType: block.type }),
  });
};

type StepResult = readonly [ParserState, ReadonlyArray<LLMEvent>];

const NO_EVENTS: StepResult['1'] = [];

const onMessageStart = (state: ParserState, event: AnthropicEvent): StepResult => {
  const usage = mapUsage(event.message?.usage);
  return [usage ? { ...state, usage: mergeUsage(state.usage, usage) } : state, NO_EVENTS];
};

const onContentBlockStart = (state: ParserState, event: AnthropicEvent): StepResult => {
  const block = event.content_block;
  if (!block) return [state, NO_EVENTS];

  if (
    (block.type === 'tool_use' || block.type === 'server_tool_use') &&
    event.index !== undefined
  ) {
    const events: LLMEvent[] = [];
    const lifecycle = Lifecycle.stepStart(state.lifecycle, events);
    return [
      {
        ...state,
        lifecycle,
        tools: ToolStream.start(state.tools, event.index, {
          id: block.id ?? String(event.index),
          name: block.name ?? '',
          providerExecuted: block.type === 'server_tool_use',
          // Gateways may deliver the full tool input on the start block and
          // never emit `input_json_delta`; seed the accumulator so the final
          // `tool-call` still carries the real arguments.
          ...(block.input === undefined ? {} : { input: ProviderShared.encodeJson(block.input) }),
        }),
      },
      [
        ...events,
        LLMEvent.toolInputStart({ id: block.id ?? String(event.index), name: block.name ?? '' }),
      ],
    ];
  }

  if (block.type === 'text' && block.text) {
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.textDelta(
          state.lifecycle,
          events,
          `text-${event.index ?? 0}`,
          block.text,
        ),
      },
      events,
    ];
  }

  if (block.type === 'thinking' && block.thinking) {
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningDelta(
          state.lifecycle,
          events,
          `reasoning-${event.index ?? 0}`,
          block.thinking,
        ),
        // Some providers put the signature on the start block instead of a
        // later `signature_delta`; hold it for `content_block_stop`.
        ...(block.signature !== undefined && event.index !== undefined
          ? {
              reasoningSignatures: { ...state.reasoningSignatures, [event.index]: block.signature },
            }
          : {}),
      },
      events,
    ];
  }

  // Redacted thinking surfaces as a reasoning block carrying the opaque payload
  // as metadata; the matching `content_block_stop` closes it. Dropping it used
  // to break multi-turn thinking continuity for safety-filtered turns.
  if (block.type === 'redacted_thinking' && block.data !== undefined) {
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningStart(
          state.lifecycle,
          events,
          `reasoning-${event.index ?? 0}`,
          anthropicMetadata({ redactedData: block.data }),
        ),
      },
      events,
    ];
  }

  const result = serverToolResultEvent(block);
  if (!result) return [state, NO_EVENTS];
  const events: LLMEvent[] = [];
  return [
    { ...state, lifecycle: Lifecycle.stepStart(state.lifecycle, events) },
    [...events, result],
  ];
};

const onContentBlockDelta = Effect.fn('AnthropicMessages.onContentBlockDelta')(function* (
  state: ParserState,
  event: AnthropicEvent,
) {
  const delta = event.delta;

  if (delta?.type === 'text_delta' && delta.text) {
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.textDelta(
          state.lifecycle,
          events,
          `text-${event.index ?? 0}`,
          delta.text,
        ),
      },
      events,
    ] satisfies StepResult;
  }

  if (delta?.type === 'thinking_delta' && delta.thinking) {
    const events: LLMEvent[] = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningDelta(
          state.lifecycle,
          events,
          `reasoning-${event.index ?? 0}`,
          delta.thinking,
        ),
      },
      events,
    ] satisfies StepResult;
  }

  if (delta?.type === 'signature_delta' && delta.signature) {
    // Record only; the reasoning block closes on `content_block_stop` (or
    // `message_stop`), where the signature is attached. Ending here would close
    // the block early if the provider streams more thinking afterwards.
    return [
      event.index === undefined
        ? state
        : {
            ...state,
            reasoningSignatures: {
              ...state.reasoningSignatures,
              [event.index]: delta.signature,
            },
          },
      NO_EVENTS,
    ] satisfies StepResult;
  }

  if (delta?.type === 'input_json_delta' && event.index !== undefined) {
    // A delta without an open block (out-of-order/truncated stream) is ignored
    // rather than failing the whole response.
    if (!state.tools[event.index]) return [state, NO_EVENTS] satisfies StepResult;
    if (!delta.partial_json) return [state, NO_EVENTS] satisfies StepResult;
    const result = ToolStream.appendExisting(
      ADAPTER,
      state.tools,
      event.index,
      delta.partial_json,
      'Anthropic Messages tool argument delta is missing its tool call',
    );
    if (ToolStream.isError(result)) return yield* result;
    const events: LLMEvent[] = [];
    const lifecycle = result.events.length
      ? Lifecycle.stepStart(state.lifecycle, events)
      : state.lifecycle;
    events.push(...result.events);
    return [{ ...state, lifecycle, tools: result.tools }, events] satisfies StepResult;
  }

  return [state, NO_EVENTS] satisfies StepResult;
});

const onContentBlockStop = Effect.fn('AnthropicMessages.onContentBlockStop')(function* (
  state: ParserState,
  event: AnthropicEvent,
) {
  if (event.index === undefined) return [state, NO_EVENTS] satisfies StepResult;
  const result = yield* ToolStream.finish(ADAPTER, state.tools, event.index);
  const events: LLMEvent[] = [];
  const resultEvents = result.events ?? [];
  const signature = state.reasoningSignatures[event.index];
  const lifecycle = resultEvents.length
    ? Lifecycle.stepStart(state.lifecycle, events)
    : Lifecycle.reasoningEnd(
        Lifecycle.textEnd(state.lifecycle, events, `text-${event.index}`),
        events,
        `reasoning-${event.index}`,
        signature === undefined ? undefined : anthropicMetadata({ signature }),
      );
  events.push(...resultEvents);
  const reasoningSignatures = Object.fromEntries(
    Object.entries(state.reasoningSignatures).filter(([key]) => key !== String(event.index)),
  );
  return [
    { ...state, lifecycle, tools: result.tools, reasoningSignatures },
    events,
  ] satisfies StepResult;
});

// `message_delta` only records the terminal reason. Emitting `finish` here
// used to double-fire when a provider sent several deltas (or a bare usage
// update), and it finalized before `message_stop` could flush tools whose
// `content_block_stop` never arrived. `message_stop` now owns the single
// terminal emit; `onHalt` covers providers that omit it.
const onMessageDelta = (state: ParserState, event: AnthropicEvent): StepResult => {
  const usage = mergeUsage(state.usage, mapUsage(event.usage));
  const stopReason = event.delta?.stop_reason;
  const pendingFinish =
    typeof stopReason === 'string' && stopReason.length > 0
      ? {
          reason: mapFinishReason(stopReason),
          raw: stopReason,
          ...(typeof event.delta?.stop_sequence === 'string' && event.delta.stop_sequence.length > 0
            ? { stopSequence: event.delta.stop_sequence }
            : {}),
        }
      : state.pendingFinish;
  return [{ ...state, usage, pendingFinish }, NO_EVENTS];
};

const finishReasonFor = (state: ParserState, hasToolCalls: boolean): FinishReason => {
  const reason = state.pendingFinish?.reason ?? (hasToolCalls ? 'tool-calls' : 'stop');
  return reason === 'stop' && hasToolCalls ? 'tool-calls' : reason;
};

const stopMetadata = (state: ParserState): ProviderMetadata | undefined =>
  state.pendingFinish?.stopSequence
    ? anthropicMetadata({ stopSequence: state.pendingFinish.stopSequence })
    : undefined;

const onMessageStop = Effect.fn('AnthropicMessages.onMessageStop')(function* (state: ParserState) {
  if (state.finished) return [state, NO_EVENTS] satisfies StepResult;
  const finished = yield* ToolStream.finishAll(ADAPTER, state.tools);
  const events: LLMEvent[] = [];
  let lifecycle = state.lifecycle;
  if (finished.events.length) {
    lifecycle = Lifecycle.stepStart(lifecycle, events);
    events.push(...finished.events);
  }
  const hasToolCalls = finished.events.some(LLMEvent.is.toolCall);
  lifecycle = Lifecycle.finish(lifecycle, events, {
    reason: finishReasonFor(state, hasToolCalls),
    reasonRaw: state.pendingFinish?.raw,
    usage: state.usage,
    providerMetadata: stopMetadata(state),
  });
  return [
    { ...state, lifecycle, tools: finished.tools, finished: true },
    events,
  ] satisfies StepResult;
});

const onHalt = (state: ParserState): Effect.Effect<ReadonlyArray<LLMEvent>, LLMError> =>
  Effect.sync(() => {
    if (state.finished || !state.pendingFinish) return [];
    const events: LLMEvent[] = [];
    Lifecycle.finish(state.lifecycle, events, {
      reason: finishReasonFor(state, false),
      reasonRaw: state.pendingFinish.raw,
      usage: state.usage,
      providerMetadata: stopMetadata(state),
    });
    return events;
  });

// Prefix `error.type` so overloads, rate limits, and quota errors are visible
// even when the provider message is generic or empty.
const providerErrorMessage = (event: AnthropicEvent): string => {
  const type = event.error?.type;
  const message = event.error?.message;
  if (type && message) return `${type}: ${message}`;
  return message || type || 'Anthropic Messages stream error';
};

// Anthropic reports transient upstream conditions as typed stream errors.
// Preserve their retryability so the caller's retry policy can act on them
// instead of treating every `error` event as terminal.
const ANTHROPIC_RETRYABLE_ERRORS = new Set(['overloaded_error', 'rate_limit_error']);

const onError = (state: ParserState, event: AnthropicEvent): StepResult => [
  state,
  [
    LLMEvent.providerError({
      message: providerErrorMessage(event),
      classification: isContextOverflow(event.error?.message ?? '')
        ? 'context-overflow'
        : undefined,
      retryable:
        event.error?.type !== undefined && ANTHROPIC_RETRYABLE_ERRORS.has(event.error.type),
    }),
  ],
];

const step = (state: ParserState, event: AnthropicEvent) => {
  if (event.type === 'message_start') return Effect.succeed(onMessageStart(state, event));
  if (event.type === 'content_block_start')
    return Effect.succeed(onContentBlockStart(state, event));
  if (event.type === 'content_block_delta') return onContentBlockDelta(state, event);
  if (event.type === 'content_block_stop') return onContentBlockStop(state, event);
  if (event.type === 'message_delta') return Effect.succeed(onMessageDelta(state, event));
  if (event.type === 'message_stop') return onMessageStop(state);
  if (event.type === 'error') return Effect.succeed(onError(state, event));
  return Effect.succeed<StepResult>([state, NO_EVENTS]);
};

// =============================================================================
// Protocol And Anthropic Route
// =============================================================================
/**
 * The Anthropic Messages protocol — request body construction, body schema,
 * and the streaming-event state machine. Used by native Anthropic Cloud and
 * (once registered) Vertex Anthropic / Bedrock-hosted Anthropic passthrough.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: AnthropicMessagesBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(AnthropicEvent),
    initial: () => ({
      tools: ToolStream.empty<number>(),
      lifecycle: Lifecycle.initial(),
      pendingFinish: undefined,
      reasoningSignatures: {},
      finished: false,
    }),
    step,
    onHalt,
  },
});

export const route = Route.make({
  id: ADAPTER,
  provider: 'anthropic',
  providerMetadataKey: 'anthropic',
  protocol,
  // 对齐参考库：原生 Anthropic 走 beta 端点（`?beta=true`），
  // 中转/兼容端点保持普通路径。
  endpoint: Endpoint.path(
    (input) => (input.request.model.provider === 'anthropic' ? `${PATH}?beta=true` : PATH),
    { baseURL: DEFAULT_BASE_URL },
  ),
  auth: Auth.none,
  framing: Framing.sse,
  // 对齐参考库：支持原生逐消息 effort 更新的模型保留 `Message.effort` 标记；
  // 其余模型由 `applyEffortUpdates` 在编译期剥离标记。
  supportsEffortUpdates: (request) => supportsEffortUpdates(request.model),
  headers: ({ request, body }) => {
    // 对齐参考库 `requiredBetaHeaders`：beta 由请求体决定。
    // 官方端点始终请求 interleaved thinking（API 对不支持的模型会忽略）；
    // 中转/兼容端点保持不主动下发 beta，避免严格网关拒绝。
    const official = ProviderShared.isAnthropicOfficialBaseUrl(
      request.model.route.endpoint.baseURL,
    );
    const betas = official ? ['interleaved-thinking-2025-05-14'] : [];
    if (body.context_management !== undefined && body.context_management.edits.length > 0)
      betas.push('context-management-2025-06-27');
    // 时序 effort 更新（原生 `output_config` system 消息）需要 mid-conversation beta。
    if (
      body.messages.some(
        (message) => message.role === 'system' && message.output_config !== undefined,
      )
    )
      betas.push('mid-conversation-output-config-2026-07-01');
    // 对齐参考库：block binding 需要对应 beta；disabled 不请求。
    if (
      body.thinking !== undefined &&
      body.thinking.type !== 'disabled' &&
      body.thinking.block_binding !== undefined
    )
      betas.push('thinking-binding-controls-2026-08-01');
    return {
      'anthropic-version': '2023-06-01',
      ...(betas.length === 0 ? {} : { 'anthropic-beta': betas.join(',') }),
    };
  },
});

export * as AnthropicMessages from './anthropic-messages.js';
