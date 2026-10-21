/**
 * Venice Chat 协议（对齐上游 `venice-chat.ts`）。
 *
 * 在共享的 OpenAI Chat lowering 与流式状态机之上叠加 Venice 专有部分：
 *
 * - **请求侧** `venice_parameters`（web search / character 等，下发前转成 snake_case）
 *   与一批 Venice 采样参数（`min_p` / `top_k` / `max_temp` …）。
 * - **加密推理**：Venice 把不可见的思维链以 `__ENCRYPTED_REASONING__` 标记为界输出，
 *   标记之后的内容必须原样回传（`reasoning_content`）而不能展示给用户。
 * - **`thought_signature` 往返**：消息级与工具调用级的签名经 `providerMetadata.venice`
 *   持久化，回传时写回 `thought_signature`。
 */

import { Effect, Schema } from 'effect';
import { Framing } from '../route/framing.js';
import { Protocol } from '../route/protocol.js';
import { LLMEvent, type LLMRequest } from '../schema/index.js';
import { OpenAIChat } from './openai-chat.js';
import { JsonObject, ProviderShared } from './shared.js';

const Parameters = Schema.Struct({
  enableWebSearch: Schema.optional(Schema.String),
  enableWebScraping: Schema.optional(Schema.Boolean),
  enableWebCitations: Schema.optional(Schema.Boolean),
  enableXSearch: Schema.optional(Schema.Boolean),
  stripThinkingResponse: Schema.optional(Schema.Boolean),
  disableThinking: Schema.optional(Schema.Boolean),
  includeVeniceSystemPrompt: Schema.optional(Schema.Boolean),
  characterSlug: Schema.optional(Schema.String),
  includeSearchResultsInStream: Schema.optional(Schema.Boolean),
  returnSearchResultsAsDocuments: Schema.optional(Schema.Boolean),
});
type Parameters = Schema.Schema.Type<typeof Parameters>;

const Reasoning = Schema.Struct({
  effort: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  summary: Schema.optional(Schema.String),
});
type Reasoning = Schema.Schema.Type<typeof Reasoning>;

/** `providerOptions.venice` 的形状。 */
const Options = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.String),
  reasoning: Schema.optional(Reasoning),
  veniceParameters: Schema.optional(Parameters),
  promptCacheKey: Schema.optional(Schema.String),
  promptCacheRetention: Schema.optional(Schema.String),
  parallelToolCalls: Schema.optional(Schema.Boolean),
  maxCompletionTokens: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  minP: Schema.optional(Schema.Number),
  repetitionPenalty: Schema.optional(Schema.Number),
  stopTokenIds: Schema.optional(Schema.Array(Schema.Number)),
  logprobs: Schema.optional(Schema.Boolean),
  topLogprobs: Schema.optional(Schema.Number),
  maxTemp: Schema.optional(Schema.Number),
  minTemp: Schema.optional(Schema.Number),
  responseFormat: Schema.optional(JsonObject),
  user: Schema.optional(Schema.String),
});
export type VeniceChatOptionsInput = Schema.Schema.Type<typeof Options>;

const Body = Schema.Struct({
  ...OpenAIChat.bodyFields,
  messages: Schema.Array(OpenAIChat.OpenAIChatMessage),
  reasoning: Schema.optional(Reasoning),
  // Venice 专有参数：键必须 snake_case（下发前由 camelCase 转换）。
  venice_parameters: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean])),
  prompt_cache_retention: Options.fields.promptCacheRetention,
  parallel_tool_calls: Options.fields.parallelToolCalls,
  min_p: Options.fields.minP,
  top_k: Schema.optional(Schema.Number),
  repetition_penalty: Options.fields.repetitionPenalty,
  stop_token_ids: Options.fields.stopTokenIds,
  logprobs: Options.fields.logprobs,
  top_logprobs: Options.fields.topLogprobs,
  max_temp: Options.fields.maxTemp,
  min_temp: Options.fields.minTemp,
  response_format: Options.fields.responseFormat,
  user: Options.fields.user,
});
export type VeniceChatBody = Schema.Schema.Type<typeof Body>;

const MARKER = '__ENCRYPTED_REASONING__';

const snakeCase = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const fromRequest = Effect.fnUntraced(function* (request: LLMRequest) {
  const options = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))(
    request.providerOptions?.[String(request.model.provider)] ?? {},
  );
  const body = yield* OpenAIChat.fromRequest(request, {
    // 共享 lowering 之后再写回 Venice 专有字段：签名/加密推理来自**本地来源消息**
    // 的 `providerMetadata.venice`，共享 lowering 不感知它们。
    assistant: (source, message) => {
      if (message.role !== 'assistant') return message;
      const parts = source.content.filter(
        (part) => part.type === 'text' || part.type === 'reasoning' || part.type === 'tool-call',
      );
      const calls = source.content.filter((part) => part.type === 'tool-call');
      const signature = parts
        .map((part) => part.providerMetadata?.venice?.['messageThoughtSignature'])
        .find((value) => typeof value === 'string');
      const raw = parts
        .map((part) => part.providerMetadata?.venice?.['encryptedReasoningContent'])
        .find((value) => typeof value === 'string');
      return {
        ...message,
        ...(signature === undefined ? {} : { thought_signature: signature }),
        ...(raw === undefined ? {} : { reasoning_content: raw }),
        tool_calls: message.tool_calls?.map((call, index) => {
          const thoughtSignature = calls[index]?.providerMetadata?.venice?.['thoughtSignature'];
          return {
            ...call,
            ...(typeof thoughtSignature === 'string'
              ? { thought_signature: thoughtSignature }
              : {}),
          };
        }),
      };
    },
  });
  return {
    ...body,
    messages: body.messages,
    max_completion_tokens:
      options.maxCompletionTokens ?? options.maxTokens ?? request.generation?.maxTokens,
    // Venice 用 `reasoning` 对象承载档位，不下发 OpenAI 的扁平 `reasoning_effort`。
    reasoning_effort: undefined,
    reasoning:
      options.reasoningEffort === undefined
        ? options.reasoning
        : { ...options.reasoning, effort: options.reasoningEffort },
    // 对齐上游：显式带上 `includeVeniceSystemPrompt` 默认 false（Venice SDK 的历史默认），
    // 且只下发有值的键。
    venice_parameters: Object.fromEntries(
      Object.entries({
        ...options.veniceParameters,
        includeVeniceSystemPrompt: options.veniceParameters?.includeVeniceSystemPrompt ?? false,
      })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [snakeCase(key), value]),
    ),
    prompt_cache_retention: options.promptCacheRetention,
    parallel_tool_calls: options.parallelToolCalls,
    min_p: options.minP,
    top_k: request.generation?.topK,
    repetition_penalty: options.repetitionPenalty,
    stop_token_ids: options.stopTokenIds?.slice(),
    logprobs: options.logprobs,
    top_logprobs: options.topLogprobs,
    max_temp: options.maxTemp,
    min_temp: options.minTemp,
    response_format: options.responseFormat,
    user: options.user,
  };
});

/** 流式状态：共享 Chat 状态 + 加密推理的跨帧拼装 + 工具调用签名表。 */
interface State {
  readonly shared: OpenAIChat.ParserState;
  /** 可能是 `__ENCRYPTED_REASONING__` 前缀的尾字节，需要与下一帧拼接。 */
  readonly pending: string;
  /** 已累计的完整推理文本（加密态下用于回传）。 */
  readonly reasoning: string;
  readonly encrypted: boolean;
  readonly signature?: string;
  /** 工具调用 id → 签名。 */
  readonly tools: Readonly<Record<string, string>>;
}

const stringOf = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * 读取 Venice 专有的 `thought_signature`。
 *
 * 共享的 delta schema 里没有该字段（它只出现在 Venice 的流上），因此按局部形状
 * 收窄读取，而不是把 Venice 字段塞进共享 schema（那会污染其他供应商的解析）。
 */
const thoughtSignatureOf = (value: unknown): string | undefined =>
  typeof value === 'object' && value !== null
    ? stringOf((value as { readonly thought_signature?: unknown }).thought_signature)
    : undefined;

const step = Effect.fnUntraced(function* (state: State, event: typeof Event.Type) {
  const delta = event.choices?.[0]?.delta;
  const scalar = stringOf(delta?.['reasoning_content']) ?? '';
  const text = state.pending + scalar;
  const marker = text.indexOf(MARKER);
  // 标记可能跨帧到达：只有确认「不是标记的前缀」才把已收字符当作可见内容。
  const pending =
    marker >= 0 || state.encrypted
      ? 0
      : (Array.from({ length: Math.min(text.length, MARKER.length - 1) }, (_, index) => index + 1)
          .filter((length) => text.endsWith(MARKER.slice(0, length)))
          .at(-1) ?? 0);
  const visible = state.encrypted
    ? ''
    : marker >= 0
      ? text.slice(0, marker)
      : text.slice(0, text.length - pending);
  const result = yield* OpenAIChat.protocol.stream.step(state.shared, {
    ...event,
    error: event.error,
    usage: event.usage,
    choices: event.choices?.map((choice, index) =>
      index === 0 && choice.delta
        ? {
            ...choice,
            delta: {
              ...choice.delta,
              // 密文不进入事件流：只把解密可见的部分交给共享状态机。
              reasoning_content: visible || undefined,
              reasoning_details: choice.delta.reasoning_details ?? (marker >= 0 ? [] : undefined),
            },
          }
        : choice,
    ),
  });
  const tools = { ...state.tools };
  for (const call of delta?.['tool_calls'] ?? []) {
    const thoughtSignature = thoughtSignatureOf(call);
    if (thoughtSignature === undefined) continue;
    const index = call?.index ?? result[0].lastToolIndex;
    const id =
      stringOf(call?.id) ??
      (index === undefined ? undefined : stringOf(result[0].tools[index]?.id));
    if (id !== undefined) tools[id] = thoughtSignature;
  }
  return [
    {
      shared: result[0],
      pending: pending > 0 ? text.slice(-pending) : '',
      reasoning: state.reasoning + scalar,
      encrypted: state.encrypted || marker >= 0,
      signature: stringOf(delta?.['thought_signature']) ?? state.signature,
      tools,
    },
    result[1],
  ] as const;
});

const onHalt = Effect.fnUntraced(function* (state: State) {
  const events = yield* OpenAIChat.finishEvents(state.shared);
  return events.flatMap((event): LLMEvent[] => {
    if (
      event.type !== 'reasoning-end' &&
      event.type !== 'text-end' &&
      event.type !== 'tool-call' &&
      event.type !== 'tool-input-end'
    )
      return [event];
    const signature =
      event.type === 'tool-call' || event.type === 'tool-input-end'
        ? state.tools[event.id]
        : undefined;
    const providerMetadata = {
      ...event.providerMetadata,
      venice: {
        ...event.providerMetadata?.['venice'],
        ...(state.signature === undefined ? {} : { messageThoughtSignature: state.signature }),
        ...(signature === undefined ? {} : { thoughtSignature: signature }),
        // 加密推理的密文随 `reasoning-end` 一起下发，供上层原样回传。
        ...(event.type === 'reasoning-end' && state.encrypted
          ? { encryptedReasoningContent: state.reasoning }
          : {}),
      },
    };
    // 收尾时还有未判定的尾字节：先补一个 delta，再结束该块（否则尾字符丢失）。
    if (event.type === 'reasoning-end' && state.pending.length > 0)
      return [
        LLMEvent.reasoningDelta({ id: event.id, text: state.pending }),
        { ...event, providerMetadata },
      ];
    return [{ ...event, providerMetadata }];
  });
});

const Event = OpenAIChat.OpenAIChatEvent;

export const protocol = Protocol.make({
  id: 'venice-chat',
  body: { schema: Body, from: fromRequest },
  stream: {
    event: Schema.Union([Schema.Literal('[DONE]'), Protocol.jsonEvent(Event)]),
    initial: (request): State => ({
      shared: OpenAIChat.protocol.stream.initial(request),
      pending: '',
      reasoning: '',
      encrypted: false,
      tools: {},
    }),
    step: (state: State, event) =>
      event === '[DONE]' ? Effect.succeed([state, []] as const) : step(state, event),
    terminal: (event) => event === '[DONE]',
    onHalt,
  },
});

export const framing = Framing.sseWithDone;

/**
 * Venice 的兼容声明（对齐上游 `venice-chat.ts:compatibility`）。
 *
 * `supportsStore: false` 与 `maxTokensField: 'max_completion_tokens'` 同时也在
 * `openai-chat` 的探测函数里覆盖（走 OpenAI 兼容端点时用）；这里显式声明是为了
 * 原生协议路径不依赖探测。
 */
export const compatibility = {
  maxTokensField: 'max_completion_tokens',
  supportsStore: false,
  supportsPromptCacheKey: true,
} as const;

export * as VeniceChat from './venice-chat.js';
