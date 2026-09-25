import { Effect, Schema } from 'effect';
import { Route } from '../route/client.js';
import { Auth } from '../route/auth.js';
import { Endpoint } from '../route/endpoint.js';
import { HttpTransport } from '../route/transport/index.js';
import { Framing } from '../route/framing.js';
import { Protocol } from '../route/protocol.js';
import {
  LLMEvent,
  ReasoningEfforts,
  Usage,
  type FinishReason,
  type JsonSchema,
  type LLMError,
  type LLMRequest,
  type MediaPart,
  type ReasoningPart,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
  type ToolContent,
} from '../schema/index.js';
import { isRecord, JsonObject, optionalArray, optionalNull, ProviderShared } from './shared.js';
import { isContextOverflow } from '../provider-error.js';
import { OpenAIOptions, type OpenAIServiceTier } from './utils/openai-options.js';
import { Lifecycle } from './utils/lifecycle.js';
import { ToolSchemaProjection } from './utils/tool-schema.js';
import { ToolStream } from './utils/tool-stream.js';

const ADAPTER = 'openai-chat';
/**
 * 对齐参考库：思维链字段名不能与 OpenAI Chat 的保留字段冲突。
 */
const RESERVED_REASONING_FIELDS = new Set(['role', 'content', 'refusal', 'tool_calls']);
const IMAGE_MIMES = new Set<string>(ProviderShared.IMAGE_MIMES);
export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const PATH = '/chat/completions';

// =============================================================================
// Request Body Schema
// =============================================================================
// The body schema is the provider-native JSON body. `fromRequest` below builds
// this shape from the common `LLMRequest`, then `Route.make` validates and
// JSON-encodes it before transport.
const OpenAIChatFunction = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: JsonObject,
  // 对齐参考库：仅在上游支持时显式下发 `strict: false`。
  strict: Schema.optional(Schema.Boolean),
});

const OpenAIChatTool = Schema.Struct({
  type: Schema.tag('function'),
  function: OpenAIChatFunction,
});
type OpenAIChatTool = Schema.Schema.Type<typeof OpenAIChatTool>;

const OpenAIChatAssistantToolCall = Schema.Struct({
  id: Schema.String,
  type: Schema.tag('function'),
  function: Schema.Struct({
    name: Schema.String,
    arguments: Schema.String,
  }),
});
type OpenAIChatAssistantToolCall = Schema.Schema.Type<typeof OpenAIChatAssistantToolCall>;

const OpenAIChatUserContent = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('image_url'),
    image_url: Schema.Struct({ url: Schema.String }),
  }),
]);

const OpenAIChatMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal('system'), content: Schema.String }),
  Schema.Struct({
    role: Schema.Literal('user'),
    content: Schema.Union([Schema.String, Schema.Array(OpenAIChatUserContent)]),
  }),
  // 对齐 opencode 参考库：assistant 消息必须容忍并保留思维链字段变体
  // （`reasoning` / `reasoning_text` / `reasoning_details`）与未知扩展字段。
  // 严格 Struct 会在解析历史消息时静默剥掉它们，回传上游即丢失。
  Schema.StructWithRest(
    Schema.Struct({
      role: Schema.Literal('assistant'),
      content: Schema.NullOr(Schema.String),
      tool_calls: optionalArray(OpenAIChatAssistantToolCall),
      reasoning_content: Schema.optional(Schema.String),
      reasoning: Schema.optional(Schema.String),
      reasoning_text: Schema.optional(Schema.String),
      reasoning_details: Schema.optional(Schema.Unknown),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
  Schema.Struct({
    role: Schema.Literal('tool'),
    tool_call_id: Schema.String,
    content: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion('role'));
type OpenAIChatMessage = Schema.Schema.Type<typeof OpenAIChatMessage>;

const OpenAIChatToolChoice = Schema.Union([
  Schema.Literals(['auto', 'none', 'required']),
  Schema.Struct({
    type: Schema.tag('function'),
    function: Schema.Struct({ name: Schema.String }),
  }),
]);

export const bodyFields = {
  model: Schema.String,
  messages: Schema.Array(OpenAIChatMessage),
  tools: optionalArray(OpenAIChatTool),
  tool_choice: Schema.optional(OpenAIChatToolChoice),
  stream: Schema.Literal(true),
  stream_options: Schema.optional(Schema.Struct({ include_usage: Schema.Boolean })),
  store: Schema.optional(Schema.Boolean),
  service_tier: Schema.optional(OpenAIOptions.OpenAIServiceTier),
  reasoning_effort: Schema.optional(Schema.Literals(ReasoningEfforts)),
  reasoning: Schema.optional(JsonObject),
  thinking: Schema.optional(JsonObject),
  enable_thinking: Schema.optional(Schema.Boolean),
  thinking_budget: Schema.optional(Schema.Number),
  google: Schema.optional(JsonObject),
  max_tokens: Schema.optional(Schema.Number),
  // 对齐参考库：原生 OpenAI 新模型只接受 `max_completion_tokens`。
  max_completion_tokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  frequency_penalty: Schema.optional(Schema.Number),
  presence_penalty: Schema.optional(Schema.Number),
  seed: Schema.optional(Schema.Number),
  stop: optionalArray(Schema.String),
  // 对齐参考库：仅在 `supportsPromptCacheKey` 显式开启时下发。
  prompt_cache_key: Schema.optional(Schema.String),
  // 对齐参考库：ZAI / Zhipu 流式工具调用开关（`zaiToolStream` 探测命中时下发）。
  tool_stream: Schema.optional(Schema.Boolean),
};
const OpenAIChatBody = Schema.Struct(bodyFields);
export type OpenAIChatBody = Schema.Schema.Type<typeof OpenAIChatBody>;

// =============================================================================
// Streaming Event Schema
// =============================================================================
// The event schema is one decoded SSE `data:` payload. `Framing.sseWithDone`
// splits the byte stream into strings (keeping the `[DONE]` sentinel), then the
// union below decodes each string into this provider-native event shape.
const OpenAIChatUsage = Schema.Struct({
  prompt_tokens: Schema.optional(Schema.Number),
  completion_tokens: Schema.optional(Schema.Number),
  total_tokens: Schema.optional(Schema.Number),
  // DeepSeek 官方 API 用顶层 `prompt_cache_hit_tokens` 上报自动上下文缓存的
  // 命中量（不在 `prompt_tokens_details.cached_tokens` 里）。漏读会让直连
  // DeepSeek 的会话在 UI/usage 事件里永远显示 0% 命中（实测台账全 0）。
  prompt_cache_hit_tokens: optionalNull(Schema.Number),
  prompt_tokens_details: optionalNull(
    Schema.Struct({
      cached_tokens: Schema.optional(Schema.Number),
    }),
  ),
  completion_tokens_details: optionalNull(
    Schema.Struct({
      reasoning_tokens: Schema.optional(Schema.Number),
    }),
  ),
});

const OpenAIChatToolCallDeltaFunction = Schema.Struct({
  name: optionalNull(Schema.String),
  arguments: optionalNull(Schema.String),
});

const OpenAIChatToolCallDelta = Schema.Struct({
  // Some OpenAI-compatible gateways omit `index`; the parser resolves it from
  // the tool id / running position instead of failing the whole stream.
  index: optionalNull(Schema.Number),
  id: optionalNull(Schema.String),
  function: optionalNull(OpenAIChatToolCallDeltaFunction),
});
type OpenAIChatToolCallDelta = Schema.Schema.Type<typeof OpenAIChatToolCallDelta>;

const OpenAIChatDelta = Schema.StructWithRest(
  Schema.Struct({
    content: optionalNull(
      Schema.Union([
        Schema.String,
        Schema.Array(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })),
      ]),
    ),
    // 对齐 opencode 参考库：拒绝文本必须按正文渲染。
    // 严格 Struct 会静默丢弃未声明字段——上游把可见内容放在 `refusal`
    // 时，客户端会表现为「有思考、正文为空」。
    refusal: optionalNull(Schema.String),
    reasoning_content: optionalNull(Schema.String),
    // 对齐 opencode：兼容 `reasoning` / `reasoning_text` 字段名变体
    // （不同兼容网关对思维链字段的命名不一致）。
    reasoning: optionalNull(Schema.String),
    reasoning_text: optionalNull(Schema.String),
    // 对齐 opencode：`reasoning_details` 承载结构化思维链
    // （`reasoning.text` / `reasoning.summary`）。
    reasoning_details: optionalNull(Schema.Unknown),
    tool_calls: optionalNull(Schema.Array(OpenAIChatToolCallDelta)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

const OpenAIChatChoice = Schema.StructWithRest(
  Schema.Struct({
    delta: optionalNull(OpenAIChatDelta),
    finish_reason: optionalNull(Schema.String),
    // Some gateways surface the provider-native reason here while normalizing
    // `finish_reason`.
    native_finish_reason: optionalNull(Schema.String),
    // 对齐 opencode：部分兼容网关（Moonshot 等）把 usage 挂在 choice 上。
    usage: optionalNull(OpenAIChatUsage),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

const OpenAIChatEvent = Schema.StructWithRest(
  Schema.Struct({
    // Error-only bodies carry no `choices`; tolerate their absence.
    choices: optionalArray(OpenAIChatChoice),
    usage: optionalNull(OpenAIChatUsage),
    service_tier: optionalNull(OpenAIOptions.OpenAIServiceTier),
    // 200-with-error-body responses (rate limits, quota, invalid request) come
    // back as a top-level `error` object instead of an HTTP failure.
    error: Schema.optional(
      Schema.Struct({
        type: optionalNull(Schema.String),
        code: optionalNull(Schema.String),
        message: optionalNull(Schema.String),
      }),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
type OpenAIChatEvent = Schema.Schema.Type<typeof OpenAIChatEvent>;
type OpenAIChatRequestMessage = LLMRequest['messages'][number];

/**
 * 对齐参考库：`[DONE]` 是 OpenAI Chat 流的终止哨兵，必须作为独立帧保留
 * （见 `Framing.sseWithDone`），由 `stream.terminal` 停止读取。
 * 之前把它当保活帧在 framing 层丢弃，只能读到 HTTP body EOF 才知道流结束，
 * 上游发完 `[DONE]` 不关连接时会被误判为 STALL。
 */
const DONE = '[DONE]' as const;
const OpenAIChatStreamEvent = Schema.Union([
  Schema.Literal(DONE),
  Protocol.jsonEvent(OpenAIChatEvent),
]);
type OpenAIChatStreamEvent = Schema.Schema.Type<typeof OpenAIChatStreamEvent>;

export interface ParserState {
  /** 元数据命名空间（路由 `providerMetadataKey`，未配置时回退 provider 字符串）。 */
  readonly providerMetadataKey: string;
  readonly tools: ToolStream.State<number>;
  readonly pendingToolArguments: Partial<Record<number, string>>;
  readonly toolCallEvents: ReadonlyArray<LLMEvent>;
  readonly usage?: Usage;
  readonly finishReason?: FinishReason;
  readonly finishReasonRaw?: string;
  readonly serviceTier?: OpenAIServiceTier;
  // Tool-call index resolution when a gateway omits `tool_calls[].index`:
  // remember the id→index mapping and the running position so anonymous deltas
  // continue the current call and a new id opens the next one.
  readonly lastToolIndex?: number;
  readonly nextToolIndex?: number;
  readonly toolIndexById?: Readonly<Record<string, number>>;
  readonly lifecycle: Lifecycle.State;
  /**
   * 对齐 opencode：首个被识别的思维链字段名。
   *
   * 不同兼容网关对思维链字段命名不一致（`reasoning_content` / `reasoning` /
   * `reasoning_text`），记住首个命中项，避免同一响应内反复猜测字段，
   * 并让历史回传时按同一字段名写回。
   */
  readonly reasoningField?: string;
  /**
   * 对齐 opencode：累计的结构化思维链条目（`reasoning_details`）。
   *
   * 部分兼容网关要求把 `reasoning_details` 原样回传才能续接工具回合；
   * 它同时会作为 `reasoning-end` 的 providerMetadata 下发。
   */
  readonly reasoningDetails: ReadonlyArray<unknown>;
  /** 本响应是否出现过 `reasoning_details`（决定是否下发聚合元数据）。 */
  readonly reasoningDetailsObserved: boolean;
  /** 本响应是否已经产出过思维链事件（避免 `finishEvents` 重复开启空块）。 */
  readonly reasoningEmitted: boolean;
  /**
   * 对齐 opencode：流必须以 `finish_reason` 收尾（默认 true）。
   *
   * 缺失即视为「响应在终态事件前结束」，`finishEvents` 会产出
   * incomplete-stream 失败而不是静默收尾。
   */
  readonly requireFinishReason: boolean;
  /**
   * 本响应已产生 provider-error（顶层 error 体）。
   *
   * 参考库在此抛错让流直接失败；移植版以 provider-error 事件表达
   * （网关依赖它的 `context-overflow` 分类触发压缩），因此需要显式记录，
   * 让 `finishEvents` 不再叠加 incomplete-stream。
   */
  readonly providerFailed: boolean;
}

const invalid = ProviderShared.invalidRequest;

// =============================================================================
// Request Lowering
// =============================================================================
// Lowering is the only place that knows how common LLM messages map onto the
// OpenAI Chat wire format. Keep provider quirks here instead of leaking native
// fields into `LLMRequest`.
const isMistralModel = (modelID: string) =>
  ['mistral', 'devstral', 'codestral', 'pixtral', 'mixtral'].some((family) =>
    modelID.includes(family),
  );

/**
 * 对齐参考库：按 provider / baseURL 探测 `max_tokens` vs `max_completion_tokens`。
 *
 * 原生 OpenAI 新模型（o 系 / GPT-5）只接受 `max_completion_tokens`；下列
 * 兼容网关（models.dev 命名对齐）仍只认 `max_tokens`。
 *
 * 与参考库的差异：额外把 `custom` / `openai-compatible` 归入 `max_tokens`。
 * 参考库由 catalog 保证 provider 是具体厂商 id；移植版网关把用户自建的
 * 第三方中转统一标为 `custom`，这些中转普遍只认旧字段，保守处理避免 400。
 */
const detectMaxTokensField = (
  provider: string,
  baseURL: string | undefined,
): 'max_tokens' | 'max_completion_tokens' => {
  const p = provider.toLowerCase();
  const url = (baseURL ?? '').toLowerCase();
  if (
    p === 'custom' ||
    p === 'openai-compatible' ||
    p === 'deepseek' ||
    url.includes('deepseek.com') ||
    p === 'moonshotai' ||
    url.includes('api.moonshot.ai') ||
    p === 'togetherai' ||
    url.includes('api.together.') ||
    p === 'zai' ||
    p === 'zai-coding-plan' ||
    p === 'zhipuai' ||
    p === 'zhipuai-coding-plan' ||
    url.includes('api.z.ai') ||
    url.includes('open.bigmodel.cn') ||
    p === 'nvidia' ||
    url.includes('integrate.api.nvidia.com') ||
    p === 'cerebras' ||
    url.includes('cerebras.ai') ||
    url.includes('llm.chutes.ai') ||
    p === 'chutes' ||
    p === 'cloudflare-ai-gateway' ||
    url.includes('gateway.ai.cloudflare.com') ||
    p === 'cloudflare-workers-ai' ||
    url.includes('api.cloudflare.com')
  )
    return 'max_tokens';
  return 'max_completion_tokens';
};

/** 对齐参考库：下列网关不支持 `store` 字段，不能下发。 */
const detectSupportsStore = (provider: string, baseURL: string | undefined): boolean => {
  const p = provider.toLowerCase();
  const url = (baseURL ?? '').toLowerCase();
  const isNonStandard =
    // 与参考库的差异：移植版把用户自建的第三方中转（custom /
    // openai-compatible）按保守处理——不发 `store`，避免严格网关 400。
    p === 'custom' ||
    p === 'openai-compatible' ||
    p === 'nvidia' ||
    url.includes('integrate.api.nvidia.com') ||
    p === 'cerebras' ||
    url.includes('cerebras.ai') ||
    p === 'xai' ||
    url.includes('api.x.ai') ||
    p === 'togetherai' ||
    p === 'together' ||
    url.includes('api.together.') ||
    p === 'chutes' ||
    url.includes('chutes.ai') ||
    p === 'deepseek' ||
    url.includes('deepseek.com') ||
    p === 'zai' ||
    p === 'zai-coding-plan' ||
    p === 'zhipuai' ||
    p === 'zhipuai-coding-plan' ||
    url.includes('api.z.ai') ||
    url.includes('open.bigmodel.cn') ||
    p === 'moonshotai' ||
    p === 'moonshotai-cn' ||
    url.includes('api.moonshot.') ||
    p === 'opencode' ||
    url.includes('opencode.ai') ||
    p === 'cloudflare-workers-ai' ||
    url.includes('api.cloudflare.com') ||
    p === 'cloudflare-ai-gateway' ||
    url.includes('gateway.ai.cloudflare.com') ||
    p === 'vercel-ai-gateway' ||
    url.includes('ai-gateway.vercel.sh') ||
    url.includes('vercel.sh') ||
    p === 'ant-ling' ||
    url.includes('api.ant-ling.com');
  return !isNonStandard;
};

/** 对齐参考库：下列网关拒绝工具定义上的 `strict` 字段。 */
const detectSupportsStrictMode = (provider: string, baseURL: string | undefined): boolean => {
  const p = provider.toLowerCase();
  const url = (baseURL ?? '').toLowerCase();
  // 与参考库的差异：用户自建的第三方中转（custom / openai-compatible）
  // 同样不下发 `strict`（此前行为是永不下发，保持兼容）。
  if (p === 'custom' || p === 'openai-compatible') return false;
  const isMoonshot = p === 'moonshotai' || p === 'moonshotai-cn' || url.includes('api.moonshot.');
  const isTogether = p === 'togetherai' || p === 'together' || url.includes('api.together.');
  const isCloudflareAiGateway =
    p === 'cloudflare-ai-gateway' || url.includes('gateway.ai.cloudflare.com');
  const isNvidia = p === 'nvidia' || url.includes('integrate.api.nvidia.com');
  return !isMoonshot && !isTogether && !isCloudflareAiGateway && !isNvidia;
};

/**
 * 对齐参考库：ZAI / Zhipu 的流式工具调用开关。
 *
 * 命中 `zai` / `zai-coding-plan` / `zhipuai` / `zhipuai-coding-plan` / `zhipu`
 * 或 z.ai / bigmodel.cn 端点时启用；GLM 4.5 系列不支持，保持关闭。
 */
const detectZaiToolStream = (
  provider: string,
  baseURL: string | undefined,
  modelID: string,
): boolean => {
  const p = provider.toLowerCase();
  const url = (baseURL ?? '').toLowerCase();
  const isZai =
    p === 'zai' ||
    p === 'zai-coding-plan' ||
    p === 'zhipuai' ||
    p === 'zhipuai-coding-plan' ||
    // 移植版网关的 provider catalog 用 `zhipu` 作为平台类型。
    p === 'zhipu' ||
    url.includes('api.z.ai') ||
    url.includes('open.bigmodel.cn');
  if (!isZai) return false;
  const id = modelID.toLowerCase();
  if (id === 'glm-4.5' || id === 'glm-4.5-air' || id === 'glm-4.5-flash' || id === 'glm-4.5v')
    return false;
  return true;
};

/**
 * 对齐参考库：工具调用 ID 的线上归一化（Mistral 9 位字母数字、Claude 字符集、
 * OpenAI 40 字符上限）。assistant 的 `tool_calls[].id` 与 `tool` 消息的
 * `tool_call_id` 必须使用同一映射。
 */
const toolCallIDNormalizer = (input: {
  readonly modelID: string;
  readonly provider: string;
}): ((id: string) => string) => {
  if (isMistralModel(input.modelID))
    return (id) =>
      id
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 9)
        .padEnd(9, '0');
  if (input.modelID.includes('claude')) return (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (
    input.provider === 'openai' ||
    input.provider === 'azure' ||
    input.modelID.startsWith('openai/')
  )
    return (id) => id.slice(0, 40);
  return (id) => id;
};

const lowerTool = (
  tool: ToolDefinition,
  inputSchema: JsonSchema,
  supportsStrictMode: boolean,
): OpenAIChatTool => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: ToolSchemaProjection.openAI(inputSchema),
    ...(supportsStrictMode ? { strict: false } : {}),
  },
});

const lowerToolChoice = (toolChoice: NonNullable<LLMRequest['toolChoice']>) =>
  ProviderShared.matchToolChoice('OpenAI Chat', toolChoice, {
    auto: () => 'auto' as const,
    none: () => 'none' as const,
    required: () => 'required' as const,
    tool: (name) => ({ type: 'function' as const, function: { name } }),
  });

const lowerToolCall = (
  part: ToolCallPart,
  toolCallID: (id: string) => string,
): OpenAIChatAssistantToolCall => ({
  id: toolCallID(part.id),
  type: 'function',
  function: {
    name: part.name,
    arguments: ProviderShared.encodeJson(part.input),
  },
});

const lowerMedia = Effect.fn('OpenAIChat.lowerMedia')(function* (part: MediaPart) {
  const media = yield* ProviderShared.validateMedia('OpenAI Chat', part, IMAGE_MIMES);
  return { type: 'image_url' as const, image_url: { url: media.dataUrl } };
});

const openAICompatibleReasoningContent = (native: unknown) =>
  isRecord(native) && typeof native.reasoning_content === 'string'
    ? native.reasoning_content
    : undefined;

/**
 * 对齐参考库 `reasoningMetadata`：思维链事件的 providerMetadata。
 *
 * `reasoningField` 记录字段名，`reasoningDetails` 携带累计的结构化条目；
 * 两者都会随 `reasoning-delta` / `reasoning-end` 下发，供上层持久化后
 * 在历史回传时原样写回上游。命名空间来自路由的 `providerMetadataKey`
 * （未配置时回退到 provider 字符串）。
 */
const reasoningMetadata = (
  key: string,
  field: string | undefined,
  details?: ReadonlyArray<unknown>,
) => ({
  [key]: {
    ...(field === undefined ? {} : { reasoningField: field }),
    ...(details === undefined ? {} : { reasoningDetails: details }),
  },
});

/** 从 reasoning part 的 providerMetadata 读回思维链字段名（历史回传）。 */
const reasoningFieldOf = (part: ReasoningPart, key: string): string | undefined => {
  const field = part.providerMetadata?.[key]?.['reasoningField'];
  return typeof field === 'string' ? field : undefined;
};

/**
 * 从 reasoning part 的 providerMetadata（`native.openaiCompatible` 兜底）
 * 读回结构化思维链条目。对齐参考库 `reasoningDetails`。
 */
const reasoningDetailsOf = (
  parts: ReadonlyArray<ReasoningPart>,
  native: unknown,
  key: string,
): ReadonlyArray<unknown> | undefined => {
  const observed = parts.flatMap((part) => {
    const details = part.providerMetadata?.[key]?.['reasoningDetails'];
    return Array.isArray(details) ? details : [];
  });
  if (parts.some((part) => Array.isArray(part.providerMetadata?.[key]?.['reasoningDetails'])))
    return observed;
  if (isRecord(native) && Array.isArray(native['reasoning_details']))
    return native['reasoning_details'];
  return undefined;
};

const lowerUserMessage = Effect.fn('OpenAIChat.lowerUserMessage')(function* (
  message: OpenAIChatRequestMessage,
) {
  const content: Array<Schema.Schema.Type<typeof OpenAIChatUserContent>> = [];
  for (const part of message.content) {
    if (part.type === 'text') {
      content.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.type === 'media') {
      content.push(yield* lowerMedia(part));
      continue;
    }
    return yield* ProviderShared.unsupportedContent('OpenAI Chat', 'user', ['text', 'media']);
  }
  if (content.every((part) => part.type === 'text'))
    return { role: 'user' as const, content: content.map((part) => part.text).join('') };
  return { role: 'user' as const, content };
});

const lowerAssistantMessage = Effect.fn('OpenAIChat.lowerAssistantMessage')(function* (
  message: OpenAIChatRequestMessage,
  configuredField: string | undefined,
  requireReasoning: boolean,
  providerMetadataKey: string,
  toolCallID: (id: string) => string,
) {
  const content: TextPart[] = [];
  const reasoning: ReasoningPart[] = [];
  const toolCalls: OpenAIChatAssistantToolCall[] = [];
  for (const part of message.content) {
    if (!ProviderShared.supportsContent(part, ['text', 'reasoning', 'tool-call']))
      return yield* ProviderShared.unsupportedContent('OpenAI Chat', 'assistant', [
        'text',
        'reasoning',
        'tool-call',
      ]);
    if (part.type === 'text') {
      content.push(part);
      continue;
    }
    if (part.type === 'reasoning') {
      reasoning.push(part);
      continue;
    }
    if (part.type === 'tool-call') {
      toolCalls.push(lowerToolCall(part, toolCallID));
      continue;
    }
  }
  const text = reasoning.map((part) => part.text).join('');
  const details = reasoningDetailsOf(
    reasoning,
    message.native?.openaiCompatible,
    providerMetadataKey,
  );
  const observedField = reasoning
    .map((part) => reasoningFieldOf(part, providerMetadataKey))
    .find((value) => value !== undefined);
  const nativeReasoning = openAICompatibleReasoningContent(message.native?.openaiCompatible);
  const fullyStructured = reasoning.every((part) =>
    Array.isArray(part.providerMetadata?.[providerMetadataKey]?.['reasoningDetails']),
  );
  // 对齐参考库的字段名选择：显式配置优先 → 回放观测到的字段名 → native /
  // `reasoning_content` 兜底。DeepSeek 系要求始终带字段（requireReasoning）。
  const field = (() => {
    if (
      configuredField !== undefined &&
      (requireReasoning || reasoning.length > 0 || nativeReasoning !== undefined)
    )
      return configuredField;
    if (reasoning.length === 0) return requireReasoning ? 'reasoning_content' : undefined;
    if (observedField !== undefined) return observedField;
    if (nativeReasoning !== undefined) return 'reasoning_content';
    if (!fullyStructured || requireReasoning) return 'reasoning_content';
    return undefined;
  })();
  const reasoningText = (() => {
    if (configuredField !== undefined)
      return reasoning.length === 0
        ? (nativeReasoning ?? (requireReasoning ? '' : undefined))
        : text;
    if (reasoning.length === 0) return nativeReasoning ?? (requireReasoning ? '' : undefined);
    return text;
  })();
  return {
    role: 'assistant' as const,
    // OpenAI Chat requires `content` or `tool_calls` to be set. A reasoning-only
    // turn (no text, no tool call) therefore uses an empty string rather than
    // `null`, which strict OpenAI-compatible gateways reject with
    // "Invalid assistant message: content or tool_calls must be set".
    content:
      content.length > 0 ? ProviderShared.joinText(content) : toolCalls.length > 0 ? null : '',
    tool_calls: toolCalls.length === 0 ? undefined : toolCalls,
    // 对齐参考库：结构化思维链条目原样回传（部分网关要求它才能续接工具回合）。
    ...(details === undefined ? {} : { reasoning_details: details }),
    // 对齐参考库：思维链按「原字段名」回传；字段名或文本缺失时省略该字段。
    ...(field === undefined || reasoningText === undefined ? {} : { [field]: reasoningText }),
  };
});

const lowerToolMessages = Effect.fn('OpenAIChat.lowerToolMessages')(function* (
  message: OpenAIChatRequestMessage,
  toolCallID: (id: string) => string,
) {
  const messages: OpenAIChatMessage[] = [];
  const images: Array<Schema.Schema.Type<typeof OpenAIChatUserContent>> = [];
  for (const part of message.content) {
    if (!ProviderShared.supportsContent(part, ['tool-result']))
      return yield* ProviderShared.unsupportedContent('OpenAI Chat', 'tool', ['tool-result']);
    if (part.result.type !== 'content') {
      messages.push({
        role: 'tool',
        tool_call_id: toolCallID(part.id),
        content: ProviderShared.toolResultText(part),
      });
      continue;
    }
    const content: ReadonlyArray<ToolContent> = part.result.value;
    const text = content
      .filter((item): item is Extract<ToolContent, { type: 'text' }> => item.type === 'text')
      .map((item) => item.text);
    messages.push({ role: 'tool', tool_call_id: toolCallID(part.id), content: text.join('\n') });
    const files = content.filter(
      (item): item is Extract<ToolContent, { type: 'file' }> => item.type === 'file',
    );
    images.push(
      ...(yield* Effect.forEach(files, (item) =>
        lowerMedia({ type: 'media', mediaType: item.mime, data: item.uri, filename: item.name }),
      )),
    );
  }
  return { messages, images };
});

const lowerMessage = Effect.fn('OpenAIChat.lowerMessage')(function* (
  message: OpenAIChatRequestMessage,
  configuredField: string | undefined,
  requireReasoning: boolean,
  providerMetadataKey: string,
  toolCallID: (id: string) => string,
) {
  if (message.role === 'user') return [yield* lowerUserMessage(message)];
  if (message.role === 'assistant')
    return [
      yield* lowerAssistantMessage(
        message,
        configuredField,
        requireReasoning,
        providerMetadataKey,
        toolCallID,
      ),
    ];
  return (yield* lowerToolMessages(message, toolCallID)).messages;
});

const lowerMessages = Effect.fn('OpenAIChat.lowerMessages')(function* (request: LLMRequest) {
  const system: OpenAIChatMessage[] =
    request.system.length === 0
      ? []
      : [{ role: 'system', content: ProviderShared.joinText(request.system) }];
  const messages = [...system];
  // 对齐参考库：思维链字段名与「是否必须回传」由模型兼容配置决定；
  // 未配置时按 DeepSeek 系（provider / baseURL / 模型名）自动推断。
  const configuredField = request.model.compatibility?.reasoningField;
  const modelID = request.model.id.toLowerCase();
  const providerMetadataKey =
    request.model.route.providerMetadataKey ?? String(request.model.provider);
  const requireReasoning =
    request.model.compatibility?.requireReasoning ??
    (configuredField !== undefined ||
      request.model.provider === 'deepseek' ||
      (request.model.route.endpoint.baseURL ?? '').toLowerCase().includes('deepseek.com') ||
      modelID.includes('deepseek'));
  const toolCallID = toolCallIDNormalizer({ modelID, provider: String(request.model.provider) });
  // 对齐参考库：Mistral 系不接受「tool 消息紧跟 tool 消息」的历史形态，
  // 在下一个用户轮 / 图片轮之前桥接一条 assistant 消息。
  const requireAssistantAfterTool =
    request.model.compatibility?.requireAssistantAfterTool ?? isMistralModel(modelID);
  const bridgeTools = () => {
    if (requireAssistantAfterTool && messages.at(-1)?.role === 'tool')
      messages.push({ role: 'assistant', content: 'Done.' });
  };
  const pendingImages: Array<Schema.Schema.Type<typeof OpenAIChatUserContent>> = [];
  const flushImages = () => {
    if (pendingImages.length === 0) return;
    bridgeTools();
    messages.push({ role: 'user', content: pendingImages.splice(0) });
  };
  for (const message of request.messages) {
    if (message.role === 'user') bridgeTools();
    if (message.role === 'system') {
      const part = yield* ProviderShared.wrappedSystemUpdate('OpenAI Chat', message);
      if (pendingImages.length > 0) {
        messages.push({
          role: 'user',
          content: [...pendingImages.splice(0), { type: 'text', text: part.text }],
        });
        continue;
      }
      const previous = messages.at(-1);
      if (previous?.role === 'user' && typeof previous.content === 'string')
        messages[messages.length - 1] = {
          role: 'user',
          content: `${previous.content}\n${part.text}`,
        };
      else if (previous?.role === 'user' && Array.isArray(previous.content))
        messages[messages.length - 1] = {
          role: 'user',
          content: [...previous.content, { type: 'text', text: part.text }],
        };
      else messages.push({ role: 'user', content: part.text });
      continue;
    }
    // Assistant turns made up entirely of blank text carry nothing for the
    // model; drop them instead of emitting an empty message. Reasoning-only
    // turns are intentionally kept (they lower to `content: ""` plus the
    // reasoning field), matching the upstream OpenAI Chat protocol.
    if (
      message.role === 'assistant' &&
      message.content.every((part) => part.type === 'text' && part.text.trim() === '')
    )
      continue;
    if (message.role === 'tool') {
      const lowered = yield* lowerToolMessages(message, toolCallID);
      messages.push(...lowered.messages);
      pendingImages.push(...lowered.images);
      continue;
    }
    flushImages();
    messages.push(
      ...(yield* lowerMessage(
        message,
        configuredField,
        requireReasoning,
        providerMetadataKey,
        toolCallID,
      )),
    );
  }
  flushImages();
  return messages;
});

const lowerOptions = Effect.fn('OpenAIChat.lowerOptions')(function* (
  request: LLMRequest,
  supportsStore: boolean,
) {
  const store = OpenAIOptions.store(request);
  const serviceTier = OpenAIOptions.serviceTier(request);
  const reasoningEffort = OpenAIOptions.reasoningEffort(request);
  // 对齐参考库：`prompt_cache_key` 默认关闭（严格网关会对未知字段 400），
  // 仅在上游显式声明 `supportsPromptCacheKey` 时下发。优先取请求级
  // `promptCacheKey`，回退到既有的 `providerOptions.openai.promptCacheKey`
  // 生产者（网关历史上只为 Responses 路径注入后者）。
  const cacheKey =
    request.model.compatibility?.supportsPromptCacheKey === true
      ? (ProviderShared.promptCacheKey(request) ?? OpenAIOptions.promptCacheKey(request))
      : undefined;
  if (reasoningEffort && !OpenAIOptions.isReasoningEffort(reasoningEffort))
    return yield* invalid(
      `OpenAI Chat does not support reasoning effort ${String(reasoningEffort)}`,
    );
  return {
    ...(supportsStore && store !== undefined ? { store } : {}),
    // 对齐参考库：支持 `store` 的上游显式下发 `store: false`（原生 OpenAI
    // Chat 默认）；不支持的上游完全省略该字段，避免被 400 拒绝。
    ...(supportsStore && store === undefined ? { store: false } : {}),
    ...(cacheKey === undefined ? {} : { prompt_cache_key: cacheKey }),
    ...(serviceTier ? { service_tier: serviceTier } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };
});

const lowerCompatibleProviderOptions = (request: LLMRequest) =>
  request.model.route.id === 'openai-compatible-chat'
    ? (request.providerOptions?.[request.model.provider] ?? {})
    : {};

const fromRequest = Effect.fn('OpenAIChat.fromRequest')(function* (request: LLMRequest) {
  // `fromRequest` returns the provider body only. Endpoint, auth, framing,
  // validation, and HTTP execution are composed by `Route.make`.
  const reasoningField = request.model.compatibility?.reasoningField;
  if (reasoningField !== undefined && RESERVED_REASONING_FIELDS.has(reasoningField))
    return yield* invalid(
      `OpenAI Chat reasoning field conflicts with reserved field ${reasoningField}`,
    );
  const generation = request.generation;
  const toolSchemaCompatibility = request.model.compatibility?.toolSchema;
  // 对齐参考库：请求侧兼容开关先看显式配置，未配置时按 provider / baseURL 探测。
  const provider = String(request.model.provider);
  const baseURL = request.model.route.endpoint.baseURL;
  const maxTokensField =
    request.model.compatibility?.maxTokensField ?? detectMaxTokensField(provider, baseURL);
  const supportsStore =
    request.model.compatibility?.supportsStore ?? detectSupportsStore(provider, baseURL);
  const supportsUsageInStreaming = request.model.compatibility?.supportsUsageInStreaming ?? true;
  const supportsStrictMode =
    request.model.compatibility?.supportsStrictMode ?? detectSupportsStrictMode(provider, baseURL);
  const zaiToolStream =
    request.model.compatibility?.zaiToolStream ??
    detectZaiToolStream(provider, baseURL, request.model.id);
  // 对齐参考库：只有存在可用工具（且未被 tool_choice: none 禁用）时才发
  // `tool_stream`。
  const hasActiveTools = request.tools.length > 0 && request.toolChoice?.type !== 'none';
  return {
    ...lowerCompatibleProviderOptions(request),
    model: request.model.id,
    messages: yield* lowerMessages(request),
    tools:
      request.tools.length === 0
        ? undefined
        : request.tools.map((tool) =>
            lowerTool(
              tool,
              ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility),
              supportsStrictMode,
            ),
          ),
    tool_choice: request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined,
    stream: true as const,
    ...(zaiToolStream && hasActiveTools ? { tool_stream: true } : {}),
    ...(supportsUsageInStreaming ? { stream_options: { include_usage: true } } : {}),
    ...(maxTokensField === 'max_completion_tokens'
      ? { max_completion_tokens: generation?.maxTokens }
      : { max_tokens: generation?.maxTokens }),
    temperature: generation?.temperature,
    top_p: generation?.topP,
    frequency_penalty: generation?.frequencyPenalty,
    presence_penalty: generation?.presencePenalty,
    seed: generation?.seed,
    stop: generation?.stop,
    ...(yield* lowerOptions(request, supportsStore)),
  };
});

// =============================================================================
// Stream Parsing
// =============================================================================
// Streaming parsers are small state machines: every event returns a new state
// plus the common `LLMEvent`s produced by that event. Tool calls are accumulated
// because OpenAI streams JSON arguments across multiple deltas.
/**
 * 对齐 opencode 参考库：不受支持的 `finish_reason` 不再静默降级。
 *
 * opencode 对 `error` / `network_error` / 未知值一律抛
 * `UnknownProviderError` / `ProviderInternalError`，由上层当作「上游异常」
 * 处理（可重试 / 可上报），而不是当成正常结束。移植版曾把未知值折叠成
 * `'unknown'` 并被网关映射为 `end_turn`——上游流异常时表现为「思考完就停止、
 * 没有回复」，且不会触发任何重试。
 *
 * 返回 `undefined` 表示该值不受支持，调用方必须转为可重试的上游错误。
 */
const mapFinishReason = (reason: string | null | undefined): FinishReason | undefined => {
  if (reason === 'stop' || reason === 'end') return 'stop';
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'content-filter';
  if (reason === 'function_call' || reason === 'tool_calls') return 'tool-calls';
  return undefined;
};

// OpenAI Chat reports `prompt_tokens` (inclusive total) with a
// `cached_tokens` subset, and `completion_tokens` (inclusive total) with
// a `reasoning_tokens` subset. We pass the inclusive totals through and
// derive the non-cached breakdown so the `LLM.Usage` contract is
// satisfied on both sides.
/**
 * 对齐 opencode 的 `reasoningDelta`：按优先级从 delta 中提取思维链文本。
 *
 * 不同兼容网关对思维链字段的命名不一致——`reasoning_content`（DeepSeek 系）、
 * `reasoning` / `reasoning_text`（部分网关）——只认 `reasoning_content` 会让
 * 其余命名下的思考内容被静默丢弃（严格 Struct 会先一步剥掉未声明字段）。
 */
function pickReasoningDelta(
  delta: Schema.Schema.Type<typeof OpenAIChatDelta> | null | undefined,
  configuredField?: string,
): { field: string; text: string } | undefined {
  if (!delta) return undefined;
  const record = delta as unknown as Record<string, unknown>;
  const fields = new Set<string | undefined>([
    configuredField,
    'reasoning_content',
    'reasoning',
    'reasoning_text',
  ]);
  for (const field of fields) {
    if (field === undefined) continue;
    const text = record[field];
    if (typeof text === 'string' && text.length > 0) return { field, text };
  }
  return undefined;
}

/**
 * 对齐 opencode 的 `detailText`：从 `reasoning_details` 的
 * `reasoning.text` / `reasoning.summary` 条目提取文本。
 */
function reasoningDetailText(details: unknown): string | undefined {
  if (!Array.isArray(details)) return undefined;
  const parts = details.flatMap((detail) => {
    if (!isRecord(detail)) return [];
    if (
      detail['type'] === 'reasoning.text' &&
      typeof detail['text'] === 'string' &&
      detail['text'].length > 0
    ) {
      return [detail['text']];
    }
    if (
      detail['type'] === 'reasoning.summary' &&
      typeof detail['summary'] === 'string' &&
      detail['summary'].length > 0
    ) {
      return [detail['summary']];
    }
    return [];
  });
  return parts.length > 0 ? parts.join('') : undefined;
}

const mapUsage = (
  usage: OpenAIChatEvent['usage'],
  providerMetadataKey: string,
): Usage | undefined => {
  if (!usage) return undefined;
  // 兼容两种上报口径：OpenAI 的 `prompt_tokens_details.cached_tokens` 与
  // DeepSeek 的顶层 `prompt_cache_hit_tokens`（后者缺失时才回退）。
  const cached =
    usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? undefined;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  const nonCached = ProviderShared.subtractTokens(usage.prompt_tokens, cached);
  return new Usage({
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cached,
    reasoningTokens: reasoning,
    totalTokens: ProviderShared.totalTokens(
      usage.prompt_tokens,
      usage.completion_tokens,
      usage.total_tokens,
    ),
    providerMetadata: { [providerMetadataKey]: usage },
  });
};

const step = (state: ParserState, event: OpenAIChatEvent) =>
  Effect.gen(function* () {
    const events: LLMEvent[] = [];
    // 对齐 opencode：部分兼容网关（Moonshot 等）把 usage 挂在 choice 上。
    const choiceUsage = (event.choices?.[0] as unknown as { usage?: OpenAIChatEvent['usage'] })
      ?.usage;
    const usage =
      mapUsage(event.usage, state.providerMetadataKey) ??
      (choiceUsage ? mapUsage(choiceUsage, state.providerMetadataKey) : undefined) ??
      state.usage;
    const serviceTier = event.service_tier ?? state.serviceTier;
    // 200-with-error body: OpenAI-compatible gateways report rate limits and
    // quota errors as a top-level `error` object instead of an HTTP failure.
    if (event.error) {
      const type = event.error.type ?? undefined;
      const code = event.error.code ?? undefined;
      const message = event.error.message ?? undefined;
      if (type !== undefined || code !== undefined || message !== undefined) {
        const label = [code ?? type, message]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join(': ');
        return [
          // 记录「已失败」：`finishEvents` 据此跳过 incomplete-stream 检查
          // （参考库在此抛错让流直接失败，移植版以事件表达，语义等价）。
          { ...state, providerFailed: true },
          [
            LLMEvent.providerError({
              message: label || 'OpenAI Chat provider error',
              classification: isContextOverflow(label) ? 'context-overflow' : undefined,
              retryable:
                code === 'rate_limit_exceeded' ||
                code === 'insufficient_quota' ||
                code === 'server_error' ||
                type === 'server_error',
            }),
          ],
        ] as const;
      }
    }

    const choice = event.choices?.[0];
    // 对齐 opencode：不受支持的 finish_reason 是上游异常，必须显式失败，
    // 否则会被下游静默当作正常结束（详见 mapFinishReason 注释）。
    let finishReason = state.finishReason;
    if (choice?.finish_reason) {
      const mapped = mapFinishReason(choice.finish_reason);
      if (mapped === undefined) {
        return yield* ProviderShared.eventError(
          ADAPTER,
          `Provider finish_reason: ${choice.finish_reason}`,
          ProviderShared.encodeJson(event),
        );
      }
      finishReason = mapped;
    }
    const finishReasonRaw =
      choice?.native_finish_reason ?? choice?.finish_reason ?? state.finishReasonRaw;
    const delta = choice?.delta;
    const toolDeltas = delta?.tool_calls ?? [];

    // 对齐 opencode：finish 之后仍收到内容 = 上游流异常（协议不允许）。
    // 原样返回状态、不重复产出事件；有内容则显式失败。
    if (state.finishReason !== undefined) {
      const lateRefusal = delta?.['refusal'];
      const hasLateContent =
        Boolean(delta?.content) ||
        (typeof lateRefusal === 'string' && lateRefusal.length > 0) ||
        pickReasoningDelta(delta, state.reasoningField) !== undefined ||
        reasoningDetailText(delta?.['reasoning_details']) !== undefined ||
        toolDeltas.some(
          (tool) =>
            Boolean(tool.id) || Boolean(tool.function?.name) || Boolean(tool.function?.arguments),
        );
      if (hasLateContent) {
        return yield* ProviderShared.eventError(
          ADAPTER,
          'OpenAI Chat received content after the finish reason',
          ProviderShared.encodeJson(event),
        );
      }
      return [{ ...state, usage }, events] as const;
    }

    let tools = state.tools;
    const pendingToolArguments = { ...state.pendingToolArguments };
    let lastToolIndex = state.lastToolIndex ?? -1;
    let nextToolIndex = state.nextToolIndex ?? 0;
    const toolIndexById = { ...state.toolIndexById };

    let lifecycle = state.lifecycle;

    // 对齐 opencode：`refusal`（模型拒绝文本）同样按正文渲染。
    // 严格 Struct 丢弃该字段时，整轮回答会表现为「有思考、正文为空」。
    const refusal = (delta as unknown as Record<string, unknown> | undefined)?.['refusal'];
    const hasRefusal = typeof refusal === 'string' && refusal.length > 0;

    // 思维链提取（对齐 opencode）：
    //   1. `reasoning_details`（结构化条目）优先，其次按字段名探测
    //      （`reasoning_content` / `reasoning` / `reasoning_text`）；
    //   2. 结构化条目累计进 state，并随 `reasoning-delta` 下发 providerMetadata
    //      （字段名 + 累计条目），供上层持久化后历史回传；
    //   3. 思维链是「响应级通道」——**保持打开**，由 `finishEvents` 统一关闭，
    //      这样迟到的思维链 delta 会并入同一块，而不是反复开关产生多个块。
    const pickedReasoning = pickReasoningDelta(delta, state.reasoningField);
    const reasoningField = state.reasoningField ?? pickedReasoning?.field;
    const rawDetails = (delta as unknown as Record<string, unknown> | undefined)?.[
      'reasoning_details'
    ];
    const detailDelta = Array.isArray(rawDetails) ? rawDetails : undefined;
    const reasoningDetails =
      detailDelta === undefined
        ? state.reasoningDetails
        : [...state.reasoningDetails, ...detailDelta];
    const reasoningDetailsObserved = state.reasoningDetailsObserved || detailDelta !== undefined;
    const deltaMetadata = reasoningMetadata(state.providerMetadataKey, reasoningField);
    const detailText = reasoningDetailText(detailDelta);
    const reasoningText = detailText ?? pickedReasoning?.text;
    if (reasoningText !== undefined) {
      lifecycle = Lifecycle.reasoningDelta(
        lifecycle,
        events,
        'reasoning-0',
        reasoningText,
        deltaMetadata,
      );
    } else if (
      reasoningDetailsObserved &&
      !lifecycle.reasoning.has('reasoning-0') &&
      (Boolean(delta?.content) || hasRefusal || toolDeltas.length > 0)
    ) {
      // 只有结构化条目、没有可提取文本时，也要开启思维链块，
      // 让 `finishEvents` 能把完整元数据下发（对齐参考库）。
      lifecycle = Lifecycle.reasoningStart(lifecycle, events, 'reasoning-0', deltaMetadata);
    }
    const reasoningEmitted = state.reasoningEmitted || lifecycle.reasoning.has('reasoning-0');

    if (delta?.content) {
      const text =
        typeof delta.content === 'string'
          ? delta.content
          : delta.content.map((part) => part.text).join('');
      lifecycle = Lifecycle.textDelta(lifecycle, events, 'text-0', text);
    }

    if (hasRefusal) {
      lifecycle = Lifecycle.textDelta(lifecycle, events, 'text-0', refusal);
    }

    for (const tool of toolDeltas) {
      const toolId = tool.id?.trim() ? tool.id.trim() : undefined;
      const matchedById = toolId === undefined ? undefined : toolIndexById[toolId];
      const index =
        tool.index ??
        matchedById ??
        (toolId !== undefined && lastToolIndex >= 0 && tools[lastToolIndex]?.id !== toolId
          ? nextToolIndex
          : Math.max(lastToolIndex, 0));
      const current = tools[index];
      const toolName = tool.function?.name;
      const toolArguments = tool.function?.arguments ?? '';
      if (!current && toolId === undefined && !toolName && toolArguments.length === 0) continue;
      if (!current && toolId === undefined && !toolName?.trim() && toolArguments.length > 0) {
        pendingToolArguments[index] = `${pendingToolArguments[index] ?? ''}${toolArguments}`;
        if (toolId !== undefined) toolIndexById[toolId] = index;
        lastToolIndex = index;
        nextToolIndex = Math.max(nextToolIndex, index + 1);
        continue;
      }
      const bufferedArguments = pendingToolArguments[index] ?? '';
      delete pendingToolArguments[index];
      const result = ToolStream.appendOrStart(
        ADAPTER,
        tools,
        index,
        {
          id: tool.id ?? undefined,
          name: toolName ?? undefined,
          text: `${bufferedArguments}${toolArguments}`,
        },
        `OpenAI Chat tool call delta is missing id or name (index=${index}, hasCurrent=${String(current !== undefined)}, hasId=${String(toolId !== undefined)}, hasName=${String(Boolean(toolName?.trim()))}, argumentLength=${String(toolArguments.length)}, bufferedArgumentLength=${String(bufferedArguments.length)})`,
      );
      if (ToolStream.isError(result)) return yield* result;
      tools = result.tools;
      if (toolId !== undefined) toolIndexById[toolId] = index;
      lastToolIndex = index;
      nextToolIndex = Math.max(nextToolIndex, index + 1);
      if (result.events.length) lifecycle = Lifecycle.stepStart(lifecycle, events);
      events.push(...result.events);
    }

    // Truncation and content filtering terminate the response without ever
    // completing the pending tool calls, so their accumulated arguments are
    // partial by definition. Finalizing them would either fail the stream or —
    // worse — hand a half-written command to a local tool. Drop them instead
    // and let the caller's incomplete-stream continuation re-request.
    const incompleteTools = finishReason === 'length' || finishReason === 'content-filter';

    // Finalize accumulated tool inputs eagerly when finish_reason arrives so
    // JSON parse failures fail the stream at the boundary rather than at halt.
    if (
      finishReason !== undefined &&
      !incompleteTools &&
      state.finishReason === undefined &&
      Object.keys(pendingToolArguments).length > 0
    )
      return yield* invalid(
        `OpenAI Chat tool call delta is missing id or name (unresolvedIndexes=${Object.keys(pendingToolArguments).join(',')})`,
      );
    const finished =
      finishReason !== undefined &&
      !incompleteTools &&
      state.finishReason === undefined &&
      Object.keys(tools).length > 0
        ? yield* ToolStream.finishAll(ADAPTER, tools)
        : undefined;

    return [
      {
        providerMetadataKey: state.providerMetadataKey,
        tools: finished?.tools ?? tools,
        pendingToolArguments,
        toolCallEvents: finished?.events ?? state.toolCallEvents,
        usage,
        finishReason,
        finishReasonRaw,
        serviceTier,
        lastToolIndex,
        nextToolIndex,
        toolIndexById,
        lifecycle,
        reasoningField,
        reasoningDetails,
        reasoningDetailsObserved,
        reasoningEmitted,
        requireFinishReason: state.requireFinishReason,
        providerFailed: state.providerFailed,
      },
      events,
    ] as const;
  });

const finishEvents = (state: ParserState): Effect.Effect<ReadonlyArray<LLMEvent>, LLMError> =>
  Effect.gen(function* () {
    // 已产生 provider-error（顶层 error 体）时视为已有终态：不再产出任何
    // 事件，否则会触发外层 `requireTerminalEvent` 的「终态之后仍有事件」失败。
    if (state.providerFailed) return [];
    // 对齐 opencode 参考库：流在终态事件前结束（无 `finish_reason`）即
    // 「不完整流」。以 `incomplete-stream` 失败整条流，让上层据此重试，
    // 而不是把截断的响应当成正常收尾。
    if (state.finishReason === undefined && state.requireFinishReason) {
      return yield* ProviderShared.incompleteStreamError(
        ADAPTER,
        'OpenAI Chat stream ended without finish_reason',
      );
    }
    const events: LLMEvent[] = [];
    // 对齐参考库：关闭思维链块时带上完整元数据（字段名 + 累计结构化条目），
    // 供上层持久化后历史回传；若只观测到结构化条目而从未产出过 delta，
    // 这里补一次 start，保证元数据仍能随 `reasoning-end` 下发。
    const reasoningMetadataValue = reasoningMetadata(
      state.providerMetadataKey,
      state.reasoningField,
      state.reasoningDetailsObserved ? [...state.reasoningDetails] : undefined,
    );
    const started =
      state.reasoningDetailsObserved && !state.reasoningEmitted
        ? Lifecycle.reasoningStart(
            state.lifecycle,
            events,
            'reasoning-0',
            reasoningMetadata(state.providerMetadataKey, state.reasoningField),
          )
        : state.lifecycle;
    const reasoned = Lifecycle.reasoningEnd(started, events, 'reasoning-0', reasoningMetadataValue);
    // 对齐参考库：`requireFinishReason=false` 且上游未给终态时，仍要收尾
    // 未完成的工具调用，并合成一个终态 reason，否则外层
    // `requireTerminalEvent` 会因为缺少 finish / provider-error 事件再次失败。
    const toolCallEvents =
      state.finishReason === undefined && Object.keys(state.tools).length > 0
        ? (yield* ToolStream.finishAll(ADAPTER, state.tools)).events
        : state.toolCallEvents;
    const hasToolCalls = toolCallEvents.length > 0;
    const reason =
      state.finishReason === 'stop' && hasToolCalls
        ? 'tool-calls'
        : (state.finishReason ?? (hasToolCalls ? 'tool-calls' : 'stop'));
    const lifecycle = toolCallEvents.length ? Lifecycle.stepStart(reasoned, events) : reasoned;
    events.push(...toolCallEvents);
    Lifecycle.finish(lifecycle, events, {
      reason,
      reasonRaw: state.finishReasonRaw,
      usage: state.usage,
      ...(state.serviceTier === undefined
        ? {}
        : {
            providerMetadata: { [state.providerMetadataKey]: { serviceTier: state.serviceTier } },
          }),
    });
    return events;
  });

/**
 * 对齐参考库：`[DONE]` 是终止哨兵，不是内容帧；解析器把它当空操作，
 * 由 `terminal` 让客户端停止读取（不必等 HTTP body EOF）。
 */
const stepEvent = (
  state: ParserState,
  event: OpenAIChatStreamEvent,
): Effect.Effect<readonly [ParserState, ReadonlyArray<LLMEvent>], LLMError> =>
  event === DONE ? Effect.succeed([state, []]) : step(state, event);

// =============================================================================
// Protocol And OpenAI Route
// =============================================================================
/**
 * The OpenAI Chat protocol — request body construction, body schema, and the
 * streaming-event state machine. Reused by every route that speaks OpenAI Chat
 * over HTTP+SSE: native OpenAI, DeepSeek, TogetherAI, Cerebras, Baseten,
 * Fireworks, DeepInfra, and (once added) Azure OpenAI Chat.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: OpenAIChatBody,
    from: fromRequest,
  },
  stream: {
    event: OpenAIChatStreamEvent,
    initial: (request) => ({
      providerMetadataKey:
        request.model.route.providerMetadataKey ?? String(request.model.provider),
      tools: ToolStream.empty<number>(),
      pendingToolArguments: {},
      toolCallEvents: [],
      lifecycle: Lifecycle.initial(),
      // 对齐 opencode：思维链字段名可由模型兼容配置指定；
      // 未配置时由 delta 探测首个命中的字段。
      ...(request.model.compatibility?.reasoningField === undefined
        ? {}
        : { reasoningField: request.model.compatibility.reasoningField }),
      reasoningDetails: [],
      reasoningDetailsObserved: false,
      reasoningEmitted: false,
      requireFinishReason: request.model.compatibility?.requireFinishReason ?? true,
      providerFailed: false,
    }),
    step: stepEvent,
    terminal: (event) => event === DONE,
    onHalt: finishEvents,
  },
});

/** 对齐参考库：openai-chat 家族的规范 framing（保留 `[DONE]` 终止哨兵）。 */
export const framing = Framing.sseWithDone;

export const httpTransport = HttpTransport.sseJson.with<OpenAIChatBody>().with({ framing });

export const route = Route.make({
  id: ADAPTER,
  provider: 'openai',
  providerMetadataKey: 'openai',
  protocol,
  endpoint: Endpoint.path(PATH, { baseURL: DEFAULT_BASE_URL }),
  auth: Auth.none,
  transport: httpTransport,
});

export * as OpenAIChat from './openai-chat.js';
