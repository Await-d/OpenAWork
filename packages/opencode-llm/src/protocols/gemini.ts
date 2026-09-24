import { Effect, Option, Schema } from 'effect';
import { Route } from '../route/client.js';
import { Auth } from '../route/auth.js';
import { Endpoint } from '../route/endpoint.js';
import { Framing } from '../route/framing.js';
import { Protocol } from '../route/protocol.js';
import {
  LLMEvent,
  Usage,
  type FinishReason,
  type JsonSchema,
  type LLMError,
  type LLMRequest,
  type MediaPart,
  type ProviderMetadata,
  type TextPart,
  type ToolCallPart,
  type ToolDefinition,
  type ToolContent,
} from '../schema/index.js';
import { JsonObject, optionalArray, optionalNull, ProviderShared } from './shared.js';
import { isContextOverflow } from '../provider-error.js';
import { GeminiToolSchema } from './utils/gemini-tool-schema.js';
import { Lifecycle } from './utils/lifecycle.js';
import { ToolSchemaProjection } from './utils/tool-schema.js';

const ADAPTER = 'gemini';
const MEDIA_MIMES = new Set<string>(ProviderShared.MEDIA_MIMES);
export const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// =============================================================================
// Request Body Schema
// =============================================================================
// Gemini sends explicit `null` for optional streaming fields (usage counts,
// flags, whole subtrees), so response-side optionals use `optionalNull`. The
// shared part/content schemas also lower the outbound request body; encoding
// drops `undefined` keys, so they stay safe there.
const GeminiTextPart = Schema.Struct({
  text: Schema.String,
  thought: optionalNull(Schema.Boolean),
  thoughtSignature: optionalNull(Schema.String),
});

const GeminiInlineDataPart = Schema.Struct({
  inlineData: Schema.Struct({
    mimeType: Schema.String,
    data: Schema.String,
  }),
});

const GeminiFunctionCallPart = Schema.Struct({
  functionCall: Schema.Struct({
    id: optionalNull(Schema.String),
    name: Schema.String,
    args: Schema.optional(Schema.Unknown),
  }),
  thoughtSignature: optionalNull(Schema.String),
});

const GeminiFunctionResponsePart = Schema.Struct({
  functionResponse: Schema.Struct({
    id: Schema.optional(Schema.String),
    name: Schema.String,
    response: Schema.Unknown,
  }),
});

const GeminiContentPart = Schema.Union([
  GeminiTextPart,
  GeminiInlineDataPart,
  GeminiFunctionCallPart,
  GeminiFunctionResponsePart,
]);

// Response parts are decoded one-by-one so an unknown/proprietary part kind is
// skipped instead of failing the whole frame.
const decodeGeminiContentPart = Schema.decodeUnknownOption(GeminiContentPart);

const GeminiContent = Schema.Struct({
  role: optionalNull(Schema.Literals(['user', 'model'])),
  parts: optionalNull(Schema.Array(GeminiContentPart)),
});
type GeminiContent = Schema.Schema.Type<typeof GeminiContent>;

const GeminiResponseContent = Schema.Struct({
  role: optionalNull(Schema.Literals(['user', 'model'])),
  parts: optionalNull(Schema.Array(Schema.Unknown)),
});

const GeminiSystemInstruction = Schema.Struct({
  parts: Schema.Array(Schema.Struct({ text: Schema.String })),
});

const GeminiFunctionDeclaration = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: Schema.optional(JsonObject),
});

const GeminiTool = Schema.Struct({
  functionDeclarations: Schema.Array(GeminiFunctionDeclaration),
});

const GeminiToolConfig = Schema.Struct({
  functionCallingConfig: Schema.Struct({
    mode: Schema.Literals(['AUTO', 'NONE', 'ANY']),
    allowedFunctionNames: optionalArray(Schema.String),
  }),
});

const GeminiThinkingConfig = Schema.Struct({
  thinkingBudget: Schema.optional(Schema.Number),
  includeThoughts: Schema.optional(Schema.Boolean),
  // 对齐参考库：thinkingLevel（minimal / low / medium / high），与 budget 互斥使用。
  thinkingLevel: Schema.optional(Schema.String),
});

const GeminiGenerationConfig = Schema.Struct({
  maxOutputTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
  frequencyPenalty: Schema.optional(Schema.Number),
  presencePenalty: Schema.optional(Schema.Number),
  seed: Schema.optional(Schema.Number),
  stopSequences: optionalArray(Schema.String),
  thinkingConfig: Schema.optional(GeminiThinkingConfig),
});

// 对齐参考库：Gemini 安全设置（category / threshold 接受任意字符串，
// 已知值仅用于提示，避免闭集校验挡住新类目）。
const GeminiSafetySetting = Schema.Struct({
  category: Schema.String,
  threshold: Schema.String,
});

const GeminiBodyFields = {
  contents: Schema.Array(GeminiContent),
  systemInstruction: Schema.optional(GeminiSystemInstruction),
  tools: optionalArray(GeminiTool),
  toolConfig: Schema.optional(GeminiToolConfig),
  generationConfig: Schema.optional(GeminiGenerationConfig),
  safetySettings: optionalArray(GeminiSafetySetting),
  serviceTier: Schema.optional(Schema.String),
};
const GeminiBody = Schema.Struct(GeminiBodyFields);
export type GeminiBody = Schema.Schema.Type<typeof GeminiBody>;

const GeminiUsage = Schema.Struct({
  cachedContentTokenCount: optionalNull(Schema.Number),
  thoughtsTokenCount: optionalNull(Schema.Number),
  promptTokenCount: optionalNull(Schema.Number),
  candidatesTokenCount: optionalNull(Schema.Number),
  totalTokenCount: optionalNull(Schema.Number),
});
type GeminiUsage = Schema.Schema.Type<typeof GeminiUsage>;

const GeminiCandidate = Schema.Struct({
  content: optionalNull(GeminiResponseContent),
  finishReason: optionalNull(Schema.String),
});

const GeminiPromptFeedback = Schema.StructWithRest(
  Schema.Struct({
    blockReason: optionalNull(Schema.String),
    blockReasonMessage: optionalNull(Schema.String),
    safetyRatings: optionalNull(Schema.Unknown),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
type GeminiPromptFeedback = Schema.Schema.Type<typeof GeminiPromptFeedback>;

const GeminiEvent = Schema.Struct({
  error: Schema.optional(Schema.Unknown),
  candidates: optionalNull(Schema.Array(GeminiCandidate)),
  promptFeedback: optionalNull(GeminiPromptFeedback),
  usageMetadata: optionalNull(GeminiUsage),
});
type GeminiEvent = Schema.Schema.Type<typeof GeminiEvent>;

interface ParserState {
  readonly finishReason?: string;
  readonly hasToolCalls: boolean;
  readonly promptFeedback?: GeminiPromptFeedback;
  readonly usage?: Usage;
  readonly lifecycle: Lifecycle.State;
  readonly reasoningSignature?: string;
  readonly textSignature?: string;
  readonly reasoningId?: string;
  readonly textId?: string;
  readonly nextReasoningId: number;
  readonly nextTextId: number;
  readonly seenCallIds?: ReadonlySet<string>;
}

// =============================================================================
// Tool Schema Conversion
// =============================================================================
// Tool-schema conversion has two distinct concerns:
//
// 1. Sanitize — fix common authoring mistakes Gemini rejects: integer/number
//    enums (must be strings), `required` entries that don't match a property,
//    untyped arrays (`items` must be present), and `properties`/`required`
//    keys on non-object scalars. Mirrors OpenCode's historical Gemini rules.
//
// 2. Project — lossy mapping from JSON Schema to Gemini's schema dialect:
//    drop empty objects, derive `nullable: true` from `type: [..., "null"]`,
//    coerce `const` to `[const]` enum, recurse properties/items, propagate
//    only an allowlisted set of keys (description, required, format, type,
//    properties, items, allOf, anyOf, oneOf, minLength). Anything outside the
//    allowlist (e.g. `additionalProperties`, `$ref`) is silently dropped.
//
// Sanitize runs first, then project. The implementation lives in
// `utils/gemini-tool-schema` so this protocol keeps the same shape as the other
// provider protocols.

// =============================================================================
// Request Lowering
// =============================================================================
const lowerTool = (tool: ToolDefinition, inputSchema: JsonSchema) => ({
  name: tool.name,
  description: tool.description,
  parameters: GeminiToolSchema.convert(inputSchema),
});

const lowerToolConfig = (toolChoice: NonNullable<LLMRequest['toolChoice']>) =>
  ProviderShared.matchToolChoice('Gemini', toolChoice, {
    auto: () => ({ functionCallingConfig: { mode: 'AUTO' as const } }),
    none: () => ({ functionCallingConfig: { mode: 'NONE' as const } }),
    required: () => ({ functionCallingConfig: { mode: 'ANY' as const } }),
    tool: (name) => ({
      functionCallingConfig: { mode: 'ANY' as const, allowedFunctionNames: [name] },
    }),
  });

const lowerUserPart = Effect.fn('Gemini.lowerUserPart')(function* (part: TextPart | MediaPart) {
  if (part.type === 'text') return { text: part.text };
  const media = yield* ProviderShared.validateMedia('Gemini', part, MEDIA_MIMES);
  return { inlineData: { mimeType: media.mime, data: media.base64 } };
});

const googleMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({
  google: metadata,
});

const thoughtSignature = (providerMetadata: ProviderMetadata | undefined) => {
  const google = providerMetadata?.google;
  return ProviderShared.isRecord(google) && typeof google.thoughtSignature === 'string'
    ? google.thoughtSignature
    : undefined;
};

const lowerToolCall = (part: ToolCallPart) => ({
  functionCall: { id: part.id, name: part.name, args: part.input },
  thoughtSignature: thoughtSignature(part.providerMetadata),
});

const lowerMessages = Effect.fn('Gemini.lowerMessages')(function* (request: LLMRequest) {
  const contents: GeminiContent[] = [];

  for (const message of request.messages) {
    if (message.role === 'system') {
      const part = yield* ProviderShared.wrappedSystemUpdate('Gemini', message);
      const previous = contents.at(-1);
      if (previous?.role === 'user')
        contents[contents.length - 1] = {
          role: 'user',
          parts: [...(previous.parts ?? []), { text: part.text }],
        };
      else contents.push({ role: 'user', parts: [{ text: part.text }] });
      continue;
    }

    if (message.role === 'user') {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = [];
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ['text', 'media']))
          return yield* ProviderShared.unsupportedContent('Gemini', 'user', ['text', 'media']);
        parts.push(yield* lowerUserPart(part));
      }
      contents.push({ role: 'user', parts });
      continue;
    }

    if (message.role === 'assistant') {
      const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = [];
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ['text', 'reasoning', 'tool-call']))
          return yield* ProviderShared.unsupportedContent('Gemini', 'assistant', [
            'text',
            'reasoning',
            'tool-call',
          ]);
        if (part.type === 'text') {
          parts.push({
            text: part.text,
            thoughtSignature: thoughtSignature(part.providerMetadata),
          });
          continue;
        }
        if (part.type === 'reasoning') {
          parts.push({
            text: part.text,
            thought: true,
            thoughtSignature: thoughtSignature(part.providerMetadata),
          });
          continue;
        }
        if (part.type === 'tool-call') {
          parts.push(lowerToolCall(part));
          continue;
        }
      }
      contents.push({ role: 'model', parts });
      continue;
    }

    const parts: Array<Schema.Schema.Type<typeof GeminiContentPart>> = [];
    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ['tool-result']))
        return yield* ProviderShared.unsupportedContent('Gemini', 'tool', ['tool-result']);
      if (part.result.type !== 'content') {
        parts.push({
          functionResponse: {
            id: part.id,
            name: part.name,
            response: {
              name: part.name,
              content: ProviderShared.toolResultText(part),
            },
          },
        });
        continue;
      }
      const content: ReadonlyArray<ToolContent> = part.result.value;
      const text = content
        .filter((item): item is Extract<ToolContent, { type: 'text' }> => item.type === 'text')
        .map((item) => item.text);
      parts.push({
        functionResponse: {
          id: part.id,
          name: part.name,
          response: {
            name: part.name,
            content: text.join('\n'),
          },
        },
      });
      for (const item of content) {
        if (item.type === 'text') continue;
        if (item.type !== 'file') continue;
        const media = yield* ProviderShared.validateToolFile('Gemini', item, MEDIA_MIMES);
        parts.push({ inlineData: { mimeType: media.mime, data: media.base64 } });
      }
    }
    contents.push({ role: 'user', parts });
  }

  return contents;
});

const geminiOptions = (request: LLMRequest) => request.providerOptions?.gemini;

const thinkingConfig = (request: LLMRequest) => {
  const value = geminiOptions(request)?.thinkingConfig;
  if (!ProviderShared.isRecord(value)) return undefined;
  // Requesting a thinking budget implicitly asks for thoughts unless the caller
  // explicitly opts out; an empty thinkingConfig still enables thoughts.
  return {
    thinkingBudget:
      typeof value['thinkingBudget'] === 'number' ? value['thinkingBudget'] : undefined,
    includeThoughts:
      typeof value['includeThoughts'] === 'boolean' ? value['includeThoughts'] : true,
    // 对齐参考库：thinkingLevel 透传（与 budget 二选一，由调用方决定）。
    thinkingLevel: typeof value['thinkingLevel'] === 'string' ? value['thinkingLevel'] : undefined,
  };
};

/** 对齐参考库：`serviceTier` provider option 透传（standard / flex / priority）。 */
const lowerServiceTier = (request: LLMRequest): string | undefined => {
  const value = geminiOptions(request)?.['serviceTier'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/**
 * 对齐参考库：`safetySettings` provider option 透传（category / threshold）。
 * 非法条目在边界报错而不是静默丢弃。
 */
const lowerSafetySettings = Effect.fn('Gemini.lowerSafetySettings')(function* (
  request: LLMRequest,
) {
  const value = geminiOptions(request)?.['safetySettings'];
  if (value === undefined) return undefined;
  return yield* ProviderShared.validateWith(
    Schema.decodeUnknownEffect(Schema.Array(GeminiSafetySetting)),
  )(value);
});

const fromRequest = Effect.fn('Gemini.fromRequest')(function* (request: LLMRequest) {
  const toolsEnabled = request.tools.length > 0 && request.toolChoice?.type !== 'none';
  const generation = request.generation;
  const toolSchemaCompatibility = request.model.compatibility?.toolSchema;
  const generationConfig = {
    maxOutputTokens: generation?.maxTokens,
    temperature: generation?.temperature,
    topP: generation?.topP,
    topK: generation?.topK,
    frequencyPenalty: generation?.frequencyPenalty,
    presencePenalty: generation?.presencePenalty,
    seed: generation?.seed,
    stopSequences: generation?.stop,
    thinkingConfig: thinkingConfig(request),
  };

  return {
    contents: yield* lowerMessages(request),
    systemInstruction:
      request.system.length === 0
        ? undefined
        : { parts: [{ text: ProviderShared.joinText(request.system) }] },
    tools: toolsEnabled
      ? [
          {
            functionDeclarations: request.tools.map((tool) =>
              lowerTool(
                tool,
                ToolSchemaProjection.modelCompatibility(tool.inputSchema, toolSchemaCompatibility),
              ),
            ),
          },
        ]
      : undefined,
    toolConfig:
      toolsEnabled && request.toolChoice ? yield* lowerToolConfig(request.toolChoice) : undefined,
    generationConfig: Object.values(generationConfig).some((value) => value !== undefined)
      ? generationConfig
      : undefined,
    safetySettings: yield* lowerSafetySettings(request),
    serviceTier: lowerServiceTier(request),
  };
});

// =============================================================================
// Stream Parsing
// =============================================================================
// Gemini reports `promptTokenCount` (inclusive total) with a
// `cachedContentTokenCount` subset. `candidatesTokenCount` is *exclusive*
// of `thoughtsTokenCount` — visible-only, not a total — so we sum the two
// to produce the inclusive `outputTokens` the rest of the contract expects.
const mapUsage = (usage: GeminiUsage | undefined) => {
  if (!usage) return undefined;
  const cached = usage.cachedContentTokenCount ?? undefined;
  const promptTokens = usage.promptTokenCount ?? undefined;
  const thoughts = usage.thoughtsTokenCount ?? undefined;
  const nonCached = ProviderShared.subtractTokens(promptTokens, cached);
  // `candidatesTokenCount` is visible-only; sum with thoughts to produce the
  // inclusive `outputTokens` the contract expects. Only compute the total
  // when the visible component is reported — otherwise we'd fabricate an
  // inclusive number from a partial breakdown.
  const candidates = usage.candidatesTokenCount ?? undefined;
  const outputTokens = candidates !== undefined ? candidates + (thoughts ?? 0) : undefined;
  return new Usage({
    inputTokens: promptTokens,
    outputTokens,
    nonCachedInputTokens: nonCached,
    cacheReadInputTokens: cached,
    reasoningTokens: thoughts,
    totalTokens: ProviderShared.totalTokens(
      promptTokens,
      outputTokens,
      usage.totalTokenCount ?? undefined,
    ),
    providerMetadata: { google: usage },
  });
};

const mapFinishReason = (finishReason: string | undefined, hasToolCalls: boolean): FinishReason => {
  // No terminal reason: a turn that produced tool calls is a tool-call stop,
  // otherwise the ending is unknown rather than a clean `stop`.
  if (finishReason === undefined) return hasToolCalls ? 'tool-calls' : 'unknown';
  if (finishReason === 'STOP') return hasToolCalls ? 'tool-calls' : 'stop';
  if (finishReason === 'MAX_TOKENS') return 'length';
  if (
    finishReason === 'IMAGE_SAFETY' ||
    finishReason === 'RECITATION' ||
    finishReason === 'SAFETY' ||
    finishReason === 'BLOCKLIST' ||
    finishReason === 'PROHIBITED_CONTENT' ||
    finishReason === 'SPII' ||
    finishReason === 'MODEL_ARMOR' ||
    finishReason === 'IMAGE_PROHIBITED_CONTENT' ||
    finishReason === 'IMAGE_RECITATION' ||
    finishReason === 'LANGUAGE'
  )
    return 'content-filter';
  if (
    finishReason === 'MALFORMED_FUNCTION_CALL' ||
    finishReason === 'MALFORMED_RESPONSE' ||
    finishReason === 'UNEXPECTED_TOOL_CALL' ||
    finishReason === 'NO_IMAGE' ||
    finishReason === 'TOO_MANY_TOOL_CALLS' ||
    finishReason === 'MISSING_THOUGHT_SIGNATURE'
  )
    return 'error';
  return 'unknown';
};

const finishEvents = (state: ParserState): ReadonlyArray<LLMEvent> =>
  state.finishReason || state.usage || state.promptFeedback?.blockReason
    ? (() => {
        const events: LLMEvent[] = [];
        let lifecycle = state.lifecycle;
        if (state.reasoningId !== undefined)
          lifecycle = Lifecycle.reasoningEnd(
            lifecycle,
            events,
            state.reasoningId,
            state.reasoningSignature
              ? googleMetadata({ thoughtSignature: state.reasoningSignature })
              : undefined,
          );
        if (state.textId !== undefined)
          lifecycle = Lifecycle.textEnd(
            lifecycle,
            events,
            state.textId,
            state.textSignature
              ? googleMetadata({ thoughtSignature: state.textSignature })
              : undefined,
          );
        // A prompt-level block is only the terminal signal when no finish
        // reason arrived; otherwise the model's own reason wins.
        const promptBlockReason =
          state.finishReason === undefined
            ? (state.promptFeedback?.blockReason ?? undefined)
            : undefined;
        Lifecycle.finish(lifecycle, events, {
          reason:
            promptBlockReason === undefined
              ? mapFinishReason(state.finishReason, state.hasToolCalls)
              : 'content-filter',
          reasonRaw: state.finishReason ?? promptBlockReason,
          usage: state.usage,
          providerMetadata:
            state.promptFeedback === undefined
              ? undefined
              : googleMetadata({ promptFeedback: state.promptFeedback }),
        });
        return events;
      })()
    : [];

/** 对齐 opencode 参考库：`onHalt` 返回 Effect（Gemini 路径不失败）。 */
const finish = (state: ParserState): Effect.Effect<ReadonlyArray<LLMEvent>, LLMError> =>
  Effect.sync(() => finishEvents(state));

const step = (state: ParserState, event: GeminiEvent) => {
  if (ProviderShared.isRecord(event.error)) {
    const status = typeof event.error.status === 'string' ? event.error.status : undefined;
    const code = typeof event.error.code === 'number' ? event.error.code : undefined;
    const message =
      typeof event.error.message === 'string' && event.error.message.length > 0
        ? event.error.message
        : status !== undefined && status.length > 0
          ? status
          : 'Gemini provider error';
    return Effect.succeed([
      state,
      [
        LLMEvent.providerError({
          message,
          classification: isContextOverflow(message) ? 'context-overflow' : undefined,
          retryable:
            code === 429 ||
            code === 500 ||
            code === 503 ||
            status === 'UNAVAILABLE' ||
            status === 'RESOURCE_EXHAUSTED' ||
            status === 'INTERNAL' ||
            status === 'DEADLINE_EXCEEDED',
        }),
      ],
    ] as const);
  }
  const nextState = {
    ...state,
    promptFeedback: event.promptFeedback ?? state.promptFeedback,
    usage: event.usageMetadata ? (mapUsage(event.usageMetadata) ?? state.usage) : state.usage,
  };
  const candidate = event.candidates?.[0];
  // Corrupted model output is reported as a finish reason rather than an error
  // payload; surface it as a provider error instead of a normal completion.
  if (
    candidate?.finishReason &&
    mapFinishReason(candidate.finishReason, state.hasToolCalls) === 'error'
  )
    return Effect.succeed([
      nextState,
      [
        LLMEvent.providerError({
          message: `Gemini stopped with ${candidate.finishReason}`,
        }),
      ],
    ] as const);
  if (!candidate?.content)
    return Effect.succeed([
      { ...nextState, finishReason: candidate?.finishReason ?? nextState.finishReason },
      [],
    ] as const);

  const events: LLMEvent[] = [];
  let hasToolCalls = nextState.hasToolCalls;
  let lifecycle = nextState.lifecycle;
  let reasoningSignature = nextState.reasoningSignature;
  let textSignature = nextState.textSignature;
  let reasoningId = nextState.reasoningId;
  let textId = nextState.textId;
  let nextReasoningId = nextState.nextReasoningId;
  let nextTextId = nextState.nextTextId;
  // Supplier ids are tracked across chunks of the same response, not just
  // within one event's parts.
  const seenCallIds = new Set(nextState.seenCallIds);

  for (const raw of candidate.content.parts ?? []) {
    // Unknown/proprietary parts (e.g. `executableCode`) are skipped rather than
    // failing the frame.
    if (
      ProviderShared.isRecord(raw) &&
      !('text' in raw) &&
      !('inlineData' in raw) &&
      !('functionCall' in raw) &&
      !('functionResponse' in raw)
    )
      continue;
    const decoded = decodeGeminiContentPart(raw);
    if (Option.isNone(decoded)) continue;
    const part = decoded.value;
    const signature =
      'thoughtSignature' in part && part.thoughtSignature ? part.thoughtSignature : undefined;
    // Gemini attaches replay signatures to thought parts, visible text, or
    // function calls; each block kind must keep the signature of its own parts.
    if (signature !== undefined && 'thought' in part && part.thought)
      reasoningSignature = signature;
    else if (signature !== undefined && 'text' in part) textSignature = signature;
    if ('text' in part && part.text.length > 0) {
      if (part.thought) {
        if (textId !== undefined) {
          lifecycle = Lifecycle.textEnd(
            lifecycle,
            events,
            textId,
            textSignature ? googleMetadata({ thoughtSignature: textSignature }) : undefined,
          );
          textId = undefined;
          textSignature = undefined;
        }
        if (reasoningId === undefined) {
          reasoningId = `reasoning-${nextReasoningId}`;
          nextReasoningId += 1;
        }
        lifecycle = Lifecycle.reasoningDelta(
          lifecycle,
          events,
          reasoningId,
          part.text,
          signature ? googleMetadata({ thoughtSignature: signature }) : undefined,
        );
        continue;
      }
      if (reasoningId !== undefined) {
        lifecycle = Lifecycle.reasoningEnd(
          lifecycle,
          events,
          reasoningId,
          reasoningSignature ? googleMetadata({ thoughtSignature: reasoningSignature }) : undefined,
        );
        reasoningId = undefined;
        reasoningSignature = undefined;
      }
      if (textId === undefined) {
        textId = `text-${nextTextId}`;
        nextTextId += 1;
      }
      lifecycle = Lifecycle.textDelta(
        lifecycle,
        events,
        textId,
        part.text,
        textSignature ? googleMetadata({ thoughtSignature: textSignature }) : undefined,
      );
      textSignature = undefined;
      continue;
    }

    if ('functionCall' in part) {
      const input = part.functionCall.args === undefined ? {} : part.functionCall.args;
      // Gemini 2.0+ supplies a unique function call id; when omitted (or a
      // duplicate id would replay as two identical calls) fall back to a
      // globally unique id so downstream registries never collide across
      // requests.
      const supplied = part.functionCall.id ?? undefined;
      const duplicate = supplied !== undefined && seenCallIds.has(supplied);
      if (supplied !== undefined) seenCallIds.add(supplied);
      const id =
        supplied !== undefined && !duplicate
          ? supplied
          : `tool_${crypto.randomUUID().replaceAll('-', '')}`;
      if (reasoningId !== undefined) {
        lifecycle = Lifecycle.reasoningEnd(
          lifecycle,
          events,
          reasoningId,
          reasoningSignature ? googleMetadata({ thoughtSignature: reasoningSignature }) : undefined,
        );
        reasoningId = undefined;
        reasoningSignature = undefined;
      }
      // Close an open visible-text block before the tool call so `text-end`
      // is not emitted after `tool-call`.
      if (textId !== undefined) {
        lifecycle = Lifecycle.textEnd(
          lifecycle,
          events,
          textId,
          textSignature ? googleMetadata({ thoughtSignature: textSignature }) : undefined,
        );
        textId = undefined;
        textSignature = undefined;
      }
      lifecycle = Lifecycle.stepStart(lifecycle, events);
      events.push(
        LLMEvent.toolCall({
          id,
          name: part.functionCall.name,
          input,
          providerMetadata: part.thoughtSignature
            ? googleMetadata({ thoughtSignature: part.thoughtSignature })
            : undefined,
        }),
      );
      hasToolCalls = true;
    }
  }

  return Effect.succeed([
    {
      ...nextState,
      hasToolCalls,
      lifecycle,
      reasoningSignature,
      textSignature,
      reasoningId,
      textId,
      nextReasoningId,
      nextTextId,
      seenCallIds,
      finishReason: candidate.finishReason ?? nextState.finishReason,
    },
    events,
  ] as const);
};

// =============================================================================
// Protocol And Gemini Route
// =============================================================================
/**
 * The Gemini protocol — request body construction, body schema, and the
 * streaming-event state machine. Used by Google AI Studio Gemini and (once
 * registered) Vertex Gemini.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: GeminiBody,
    from: fromRequest,
  },
  stream: {
    event: Protocol.jsonEvent(GeminiEvent),
    initial: () => ({
      hasToolCalls: false,
      nextReasoningId: 0,
      nextTextId: 0,
      lifecycle: Lifecycle.initial(),
    }),
    step,
    onHalt: finish,
  },
});

export const route = Route.make({
  id: ADAPTER,
  provider: 'google',
  protocol,
  // Gemini's path embeds the model id and pins SSE framing at the URL level.
  endpoint: Endpoint.path(
    ({ request }) => `/models/${request.model.id}:streamGenerateContent?alt=sse`,
    {
      baseURL: DEFAULT_BASE_URL,
    },
  ),
  auth: Auth.none,
  framing: Framing.sse,
});

export * as Gemini from './gemini.js';
