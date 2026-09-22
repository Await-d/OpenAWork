import { Effect, Schema } from 'effect';
import { Route } from '../route/client.js';
import { Endpoint } from '../route/endpoint.js';
import { Protocol } from '../route/protocol.js';
import {
  LLMEvent,
  Usage,
  type CacheHint,
  type FinishReason,
  type JsonSchema,
  type LLMError,
  type LLMRequest,
  type ModelToolSchemaCompatibility,
  type ProviderMetadata,
  type ReasoningPart,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
} from '../schema/index.js';
import { BedrockEventStream } from './bedrock-event-stream.js';
import { isContextOverflow } from '../provider-error.js';
import { JsonObject, optionalArray, ProviderShared } from './shared.js';
import { BedrockAuth } from './utils/bedrock-auth.js';
import { BedrockCache } from './utils/bedrock-cache.js';
import { BedrockMedia } from './utils/bedrock-media.js';
import { Lifecycle } from './utils/lifecycle.js';
import { ToolSchemaProjection } from './utils/tool-schema.js';
import { ToolStream } from './utils/tool-stream.js';

const ADAPTER = 'bedrock-converse';

export type { Credentials as BedrockCredentials } from './utils/bedrock-auth.js';

// =============================================================================
// Request Body Schema
// =============================================================================
const BedrockTextBlock = Schema.Struct({
  text: Schema.String,
});
type BedrockTextBlock = Schema.Schema.Type<typeof BedrockTextBlock>;

const BedrockToolUseBlock = Schema.Struct({
  toolUse: Schema.Struct({
    toolUseId: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
  }),
});
type BedrockToolUseBlock = Schema.Schema.Type<typeof BedrockToolUseBlock>;

const BedrockToolResultContentItem = Schema.Union([
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ json: Schema.Unknown }),
  BedrockMedia.ImageBlock,
]);

const BedrockToolResultBlock = Schema.Struct({
  toolResult: Schema.Struct({
    toolUseId: Schema.String,
    content: Schema.Array(BedrockToolResultContentItem),
    status: Schema.optional(Schema.Literals(['success', 'error'])),
  }),
});
type BedrockToolResultBlock = Schema.Schema.Type<typeof BedrockToolResultBlock>;

const BedrockReasoningBlock = Schema.Struct({
  reasoningContent: Schema.Struct({
    reasoningText: Schema.optional(
      Schema.Struct({
        text: Schema.String,
        signature: Schema.optional(Schema.String),
      }),
    ),
  }),
});

const BedrockUserBlock = Schema.Union([
  BedrockTextBlock,
  BedrockMedia.ImageBlock,
  BedrockMedia.DocumentBlock,
  BedrockToolResultBlock,
  BedrockCache.CachePointBlock,
]);
type BedrockUserBlock = Schema.Schema.Type<typeof BedrockUserBlock>;

const BedrockAssistantBlock = Schema.Union([
  BedrockTextBlock,
  BedrockReasoningBlock,
  BedrockToolUseBlock,
  BedrockCache.CachePointBlock,
]);
type BedrockAssistantBlock = Schema.Schema.Type<typeof BedrockAssistantBlock>;

const BedrockMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal('user'), content: Schema.Array(BedrockUserBlock) }),
  Schema.Struct({
    role: Schema.Literal('assistant'),
    content: Schema.Array(BedrockAssistantBlock),
  }),
]).pipe(Schema.toTaggedUnion('role'));
type BedrockMessage = Schema.Schema.Type<typeof BedrockMessage>;

const BedrockSystemBlock = Schema.Union([BedrockTextBlock, BedrockCache.CachePointBlock]);
type BedrockSystemBlock = Schema.Schema.Type<typeof BedrockSystemBlock>;

const BedrockToolSpec = Schema.Struct({
  toolSpec: Schema.Struct({
    name: Schema.String,
    // Converse rejects blank descriptions, so they are omitted entirely.
    description: Schema.optional(Schema.String),
    inputSchema: Schema.Struct({
      json: JsonObject,
    }),
  }),
});
type BedrockToolSpec = Schema.Schema.Type<typeof BedrockToolSpec>;

const BedrockTool = Schema.Union([BedrockToolSpec, BedrockCache.CachePointBlock]);
type BedrockTool = Schema.Schema.Type<typeof BedrockTool>;

const BedrockToolChoice = Schema.Union([
  Schema.Struct({ auto: Schema.Struct({}) }),
  Schema.Struct({ any: Schema.Struct({}) }),
  Schema.Struct({ tool: Schema.Struct({ name: Schema.String }) }),
]);

const BedrockBodyFields = {
  modelId: Schema.String,
  messages: Schema.Array(BedrockMessage),
  system: optionalArray(BedrockSystemBlock),
  inferenceConfig: Schema.optional(
    Schema.Struct({
      maxTokens: Schema.optional(Schema.Number),
      temperature: Schema.optional(Schema.Number),
      topP: Schema.optional(Schema.Number),
      stopSequences: optionalArray(Schema.String),
    }),
  ),
  toolConfig: Schema.optional(
    Schema.Struct({
      tools: Schema.Array(BedrockTool),
      toolChoice: Schema.optional(BedrockToolChoice),
    }),
  ),
  additionalModelRequestFields: Schema.optional(JsonObject),
};
const BedrockConverseBody = Schema.Struct(BedrockBodyFields);
export type BedrockConverseBody = Schema.Schema.Type<typeof BedrockConverseBody>;

const BedrockUsageSchema = Schema.Struct({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
});
type BedrockUsageSchema = Schema.Schema.Type<typeof BedrockUsageSchema>;

// Streaming event shape — the AWS event stream wraps each JSON payload by its
// `:event-type` header (e.g. `messageStart`, `contentBlockDelta`). We
// reconstruct that wrapping in `decodeFrames` below so the event schema can
// stay a plain discriminated record.
const BedrockEvent = Schema.Struct({
  messageStart: Schema.optional(Schema.Struct({ role: Schema.String })),
  contentBlockStart: Schema.optional(
    Schema.Struct({
      contentBlockIndex: Schema.Number,
      start: Schema.optional(
        Schema.Struct({
          toolUse: Schema.optional(
            Schema.Struct({ toolUseId: Schema.String, name: Schema.String }),
          ),
        }),
      ),
    }),
  ),
  contentBlockDelta: Schema.optional(
    Schema.Struct({
      contentBlockIndex: Schema.Number,
      delta: Schema.optional(
        Schema.Struct({
          text: Schema.optional(Schema.String),
          toolUse: Schema.optional(Schema.Struct({ input: Schema.String })),
          reasoningContent: Schema.optional(
            Schema.Struct({
              text: Schema.optional(Schema.String),
              signature: Schema.optional(Schema.String),
            }),
          ),
        }),
      ),
    }),
  ),
  contentBlockStop: Schema.optional(Schema.Struct({ contentBlockIndex: Schema.Number })),
  messageStop: Schema.optional(
    Schema.Struct({
      stopReason: Schema.String,
      additionalModelResponseFields: Schema.optional(Schema.Unknown),
    }),
  ),
  metadata: Schema.optional(
    Schema.Struct({
      usage: Schema.optional(BedrockUsageSchema),
      metrics: Schema.optional(Schema.Unknown),
    }),
  ),
  // AWS event-stream `:message-type: exception` frames are rewrapped by the
  // framing layer under a single `exception` key (the type lives in the
  // `:exception-type` header). Keep the legacy per-type fields below for
  // callers that build events directly.
  exception: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      details: Schema.Struct({
        message: Schema.optional(Schema.String),
        originalMessage: Schema.optional(Schema.String),
        originalStatusCode: Schema.optional(Schema.Number),
      }),
    }),
  ),
  internalServerException: Schema.optional(Schema.Struct({ message: Schema.String })),
  modelStreamErrorException: Schema.optional(Schema.Struct({ message: Schema.String })),
  validationException: Schema.optional(Schema.Struct({ message: Schema.String })),
  throttlingException: Schema.optional(Schema.Struct({ message: Schema.String })),
  serviceUnavailableException: Schema.optional(Schema.Struct({ message: Schema.String })),
});
type BedrockEvent = Schema.Schema.Type<typeof BedrockEvent>;

// =============================================================================
// Request Lowering
// =============================================================================
const lowerToolSpec = (tool: ToolDefinition, inputSchema: JsonSchema): BedrockToolSpec => ({
  toolSpec: {
    name: tool.name,
    ...(tool.description.trim().length > 0 ? { description: tool.description } : {}),
    inputSchema: { json: inputSchema },
  },
});

const lowerTools = (
  compatibility: ModelToolSchemaCompatibility | undefined,
  breakpoints: BedrockCache.Breakpoints,
  tools: ReadonlyArray<ToolDefinition>,
): BedrockTool[] => {
  const result: BedrockTool[] = [];
  for (const tool of tools) {
    result.push(
      lowerToolSpec(tool, ToolSchemaProjection.modelCompatibility(tool.inputSchema, compatibility)),
    );
    const cachePoint = BedrockCache.block(breakpoints, tool.cache);
    if (cachePoint) result.push(cachePoint);
  }
  return result;
};

const textWithCache = (
  breakpoints: BedrockCache.Breakpoints,
  text: string,
  cache: CacheHint | undefined,
): Array<BedrockTextBlock | BedrockCache.CachePointBlock> => {
  const cachePoint = BedrockCache.block(breakpoints, cache);
  return cachePoint ? [{ text }, cachePoint] : [{ text }];
};

const lowerToolChoice = (toolChoice: NonNullable<LLMRequest['toolChoice']>) =>
  ProviderShared.matchToolChoice('Bedrock Converse', toolChoice, {
    auto: () => ({ auto: {} }) as const,
    none: () => undefined,
    required: () => ({ any: {} }) as const,
    tool: (name) => ({ tool: { name } }) as const,
  });

const bedrockMetadata = (metadata: Record<string, unknown>): ProviderMetadata => ({
  bedrock: metadata,
});

const reasoningSignature = (part: ReasoningPart) => {
  const bedrock = part.providerMetadata?.bedrock;
  return (
    part.encrypted ??
    (ProviderShared.isRecord(bedrock) && typeof bedrock.signature === 'string'
      ? bedrock.signature
      : undefined)
  );
};

// Models can emit names/keys that Converse rejects when the call is replayed
// in history; sanitize before sending.
const removeEmptyToolInputKeys = (input: unknown): unknown => {
  if (Array.isArray(input)) return input.map(removeEmptyToolInputKeys);
  if (!ProviderShared.isRecord(input)) return input;
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) =>
      key === '' ? [] : [[key, removeEmptyToolInputKeys(value)]],
    ),
  );
};

const lowerToolCall = (part: ToolCallPart): BedrockToolUseBlock => ({
  toolUse: {
    toolUseId: part.id,
    name: part.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || '_',
    input: removeEmptyToolInputKeys(part.input),
  },
});

const lowerToolResultContent = Effect.fn('BedrockConverse.lowerToolResultContent')(function* (
  part: ToolResultPart,
  documentNames: Set<string>,
) {
  if (part.result.type === 'text' || part.result.type === 'error')
    return [{ text: ProviderShared.toolResultText(part) }];
  if (part.result.type === 'json') return [{ json: part.result.value }];

  const content: Array<Schema.Schema.Type<typeof BedrockToolResultContentItem>> = [];
  for (const item of part.result.value) {
    if (item.type === 'text') {
      content.push({ text: item.text });
      continue;
    }
    const media = yield* BedrockMedia.lower(
      {
        type: 'media',
        mediaType: item.mime,
        data: item.uri,
        filename: item.name,
      },
      documentNames,
    );
    if (!('image' in media))
      return yield* ProviderShared.invalidRequest(
        'Bedrock Converse only supports image media in tool results',
      );
    content.push(media);
  }
  return content;
});

const lowerToolResult = Effect.fn('BedrockConverse.lowerToolResult')(function* (
  part: ToolResultPart,
  documentNames: Set<string>,
) {
  return {
    toolResult: {
      toolUseId: part.id,
      content: yield* lowerToolResultContent(part, documentNames),
      status: part.result.type === 'error' ? 'error' : 'success',
    },
  } satisfies BedrockToolResultBlock;
});

const lowerMessages = Effect.fn('BedrockConverse.lowerMessages')(function* (
  request: LLMRequest,
  breakpoints: BedrockCache.Breakpoints,
  documentNames: Set<string>,
) {
  const messages: BedrockMessage[] = [];

  for (const message of request.messages) {
    if (message.role === 'system') {
      const part = yield* ProviderShared.wrappedSystemUpdate('Bedrock Converse', message);
      const content = textWithCache(breakpoints, part.text, part.cache);
      const previous = messages.at(-1);
      if (previous?.role === 'user')
        messages[messages.length - 1] = {
          role: 'user',
          content: [...previous.content, ...content],
        };
      else messages.push({ role: 'user', content });
      continue;
    }

    if (message.role === 'user') {
      const content: BedrockUserBlock[] = [];
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ['text', 'media']))
          return yield* ProviderShared.unsupportedContent('Bedrock Converse', 'user', [
            'text',
            'media',
          ]);
        if (part.type === 'text') {
          content.push(...textWithCache(breakpoints, part.text, part.cache));
          continue;
        }
        if (part.type === 'media') {
          content.push(yield* BedrockMedia.lower(part, documentNames));
          continue;
        }
      }
      // Converse requires alternating roles; fold consecutive user messages.
      const previous = messages.at(-1);
      if (previous?.role === 'user')
        messages[messages.length - 1] = {
          role: 'user',
          content: [...previous.content, ...content],
        };
      else messages.push({ role: 'user', content });
      continue;
    }

    if (message.role === 'assistant') {
      const content: BedrockAssistantBlock[] = [];
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ['text', 'reasoning', 'tool-call']))
          return yield* ProviderShared.unsupportedContent('Bedrock Converse', 'assistant', [
            'text',
            'reasoning',
            'tool-call',
          ]);
        if (part.type === 'text') {
          content.push(...textWithCache(breakpoints, part.text, part.cache));
          continue;
        }
        if (part.type === 'reasoning') {
          content.push({
            reasoningContent: {
              reasoningText: { text: part.text, signature: reasoningSignature(part) },
            },
          });
          continue;
        }
        if (part.type === 'tool-call') {
          content.push(lowerToolCall(part));
          continue;
        }
      }
      // An empty assistant turn carries nothing and would break role
      // alternation; drop it.
      if (content.length === 0) continue;
      messages.push({ role: 'assistant', content });
      continue;
    }

    const content: BedrockUserBlock[] = [];
    for (const part of message.content) {
      if (!ProviderShared.supportsContent(part, ['tool-result']))
        return yield* ProviderShared.unsupportedContent('Bedrock Converse', 'tool', [
          'tool-result',
        ]);
      content.push(yield* lowerToolResult(part, documentNames));
      const cachePoint = BedrockCache.block(breakpoints, part.cache);
      if (cachePoint) content.push(cachePoint);
    }
    // Parallel tool results belong to the same user turn.
    const previous = messages.at(-1);
    if (previous?.role === 'user')
      messages[messages.length - 1] = { role: 'user', content: [...previous.content, ...content] };
    else messages.push({ role: 'user', content });
  }

  return messages;
});

// System prompts share the cache-point convention: emit the text block, then
// optionally a positional `cachePoint` marker.
const lowerSystem = (
  breakpoints: BedrockCache.Breakpoints,
  system: ReadonlyArray<LLMRequest['system'][number]>,
): BedrockSystemBlock[] =>
  system
    .filter((part) => part.text.length > 0)
    .flatMap((part) => textWithCache(breakpoints, part.text, part.cache));

const fromRequest = Effect.fn('BedrockConverse.fromRequest')(function* (request: LLMRequest) {
  const toolChoice = request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined;
  const generation = request.generation;
  // Bedrock-Claude shares Anthropic's 4-breakpoint cap. Spend the budget in
  // tools → system → messages order to favour the highest-impact prefixes.
  const breakpoints = BedrockCache.breakpoints(request.model.id);
  // `toolChoice: "none"` only omits the choice; the tool declarations stay so
  // the cached prefix remains stable.
  const toolConfig =
    request.tools.length > 0
      ? {
          tools: lowerTools(request.model.compatibility?.toolSchema, breakpoints, request.tools),
          toolChoice,
        }
      : undefined;
  const systemBlocks = lowerSystem(breakpoints, request.system);
  const system = systemBlocks.length === 0 ? undefined : systemBlocks;
  // Converse requires document labels to be unique across the whole request, so
  // one Set is threaded through every media lowering call.
  const documentNames = new Set<string>();
  const messages = yield* lowerMessages(request, breakpoints, documentNames);
  if (breakpoints.dropped > 0) {
    yield* Effect.logWarning(
      `Bedrock Converse: dropped ${breakpoints.dropped} cache breakpoint(s); the API allows at most ${BedrockCache.BEDROCK_BREAKPOINT_CAP} per request.`,
    );
  }
  return {
    modelId: request.model.id,
    messages,
    system,
    inferenceConfig:
      generation?.maxTokens === undefined &&
      generation?.temperature === undefined &&
      generation?.topP === undefined &&
      (generation?.stop === undefined || generation.stop.length === 0)
        ? undefined
        : {
            maxTokens: generation?.maxTokens,
            temperature: generation?.temperature,
            topP: generation?.topP,
            stopSequences: generation?.stop,
          },
    toolConfig,
    // Converse's base inferenceConfig has no topK; Anthropic/Nova accept it
    // as a model-specific field, so it goes through additionalModelRequestFields.
    additionalModelRequestFields:
      generation?.topK === undefined ? undefined : { top_k: generation.topK },
  };
});

// =============================================================================
// Stream Parsing
// =============================================================================
const mapFinishReason = (reason: string): FinishReason => {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'length';
  if (reason === 'tool_use') return 'tool-calls';
  if (reason === 'content_filtered' || reason === 'guardrail_intervened') return 'content-filter';
  return 'unknown';
};

// AWS reports `inputTokens` separately from cache reads and writes, so it is the
// *non-cached* count; the inclusive total must be summed. Bedrock does not break
// reasoning out of `outputTokens` for current models.
const mapUsage = (usage: BedrockUsageSchema | undefined): Usage | undefined => {
  if (!usage) return undefined;
  const inputTokens = ProviderShared.sumTokens(
    usage.inputTokens,
    usage.cacheReadInputTokens,
    usage.cacheWriteInputTokens,
  );
  return new Usage({
    inputTokens,
    outputTokens: usage.outputTokens,
    nonCachedInputTokens: usage.inputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    totalTokens: ProviderShared.totalTokens(inputTokens, usage.outputTokens, usage.totalTokens),
    providerMetadata: { bedrock: usage },
  });
};

interface ParserState {
  readonly tools: ToolStream.State<number>;
  // Bedrock splits the finish into `messageStop` (carries `stopReason`) and
  // `metadata` (carries usage). Hold the stop reason in state so `onHalt` can
  // emit exactly one finish after both chunks have had a chance to arrive.
  // `metadata` never fabricates a stop reason: a stream that ends without
  // `messageStop` stays incomplete instead of completing as an implicit `stop`.
  readonly pendingFinish: { readonly reason: FinishReason; readonly raw?: string } | undefined;
  readonly usage?: Usage;
  readonly hasToolCalls: boolean;
  readonly lifecycle: Lifecycle.State;
  readonly reasoningSignatures: Readonly<Record<number, string>>;
}

const step = (state: ParserState, event: BedrockEvent) =>
  Effect.gen(function* () {
    if (event.contentBlockStart?.start?.toolUse) {
      const index = event.contentBlockStart.contentBlockIndex;
      const events: LLMEvent[] = [];
      const lifecycle = Lifecycle.stepStart(state.lifecycle, events);
      return [
        {
          ...state,
          lifecycle,
          tools: ToolStream.start(state.tools, index, {
            id: event.contentBlockStart.start.toolUse.toolUseId,
            name: event.contentBlockStart.start.toolUse.name,
          }),
        },
        [
          ...events,
          LLMEvent.toolInputStart({
            id: event.contentBlockStart.start.toolUse.toolUseId,
            name: event.contentBlockStart.start.toolUse.name,
          }),
        ],
      ] as const;
    }

    if (event.contentBlockDelta?.delta?.text) {
      const events: LLMEvent[] = [];
      return [
        {
          ...state,
          lifecycle: Lifecycle.textDelta(
            state.lifecycle,
            events,
            `text-${event.contentBlockDelta.contentBlockIndex}`,
            event.contentBlockDelta.delta.text,
          ),
        },
        events,
      ] as const;
    }

    if (event.contentBlockDelta?.delta?.reasoningContent) {
      const index = event.contentBlockDelta.contentBlockIndex;
      const reasoning = event.contentBlockDelta.delta.reasoningContent;
      const events: LLMEvent[] = [];
      return [
        {
          ...state,
          lifecycle: reasoning.text
            ? Lifecycle.reasoningDelta(
                state.lifecycle,
                events,
                `reasoning-${index}`,
                reasoning.text,
              )
            : state.lifecycle,
          reasoningSignatures: reasoning.signature
            ? { ...state.reasoningSignatures, [index]: reasoning.signature }
            : state.reasoningSignatures,
        },
        events,
      ] as const;
    }

    if (event.contentBlockDelta?.delta?.toolUse) {
      const index = event.contentBlockDelta.contentBlockIndex;
      // A delta can arrive after `contentBlockStop` (or for an index that never
      // started); ignore it instead of failing the whole response.
      const result = ToolStream.append(
        state.tools,
        index,
        event.contentBlockDelta.delta.toolUse.input,
      );
      if (!result) return [state, []] as const;
      const events: LLMEvent[] = [];
      const lifecycle = result.events.length
        ? Lifecycle.stepStart(state.lifecycle, events)
        : state.lifecycle;
      events.push(...result.events);
      return [{ ...state, lifecycle, tools: result.tools }, events] as const;
    }

    if (event.contentBlockStop) {
      const index = event.contentBlockStop.contentBlockIndex;
      const result = yield* ToolStream.finish(ADAPTER, state.tools, index);
      const events: LLMEvent[] = [];
      const resultEvents = result.events ?? [];
      const lifecycle = resultEvents.length
        ? Lifecycle.stepStart(state.lifecycle, events)
        : Lifecycle.reasoningEnd(
            Lifecycle.textEnd(state.lifecycle, events, `text-${index}`),
            events,
            `reasoning-${index}`,
            state.reasoningSignatures[index]
              ? bedrockMetadata({ signature: state.reasoningSignatures[index] })
              : undefined,
          );
      events.push(...resultEvents);
      return [
        {
          ...state,
          hasToolCalls: resultEvents.some(LLMEvent.is.toolCall) ? true : state.hasToolCalls,
          lifecycle,
          tools: result.tools,
          reasoningSignatures: Object.fromEntries(
            Object.entries(state.reasoningSignatures).filter(([key]) => key !== String(index)),
          ),
        },
        events,
      ] as const;
    }

    if (event.messageStop) {
      // Bedrock reports corrupted model output as a stop reason rather than an
      // exception. Treat it as a failed turn so the caller can retry instead of
      // accepting a truncated/`unknown` completion.
      if (
        event.messageStop.stopReason === 'malformed_model_output' ||
        event.messageStop.stopReason === 'malformed_tool_use'
      )
        return yield* ProviderShared.eventError(
          ADAPTER,
          `Bedrock Converse stopped with ${event.messageStop.stopReason}`,
          ProviderShared.encodeJson(event),
        );
      return [
        {
          ...state,
          pendingFinish: {
            reason: mapFinishReason(event.messageStop.stopReason),
            raw: event.messageStop.stopReason,
          },
        },
        [],
      ] as const;
    }

    if (event.metadata) {
      return [{ ...state, usage: mapUsage(event.metadata.usage) ?? state.usage }, []] as const;
    }

    if (event.exception) {
      const { type, details } = event.exception;
      const message =
        details.message ?? details.originalMessage ?? `Bedrock Converse stream error: ${type}`;
      return [
        state,
        [
          LLMEvent.providerError({
            message,
            classification:
              type === 'validationException' && isContextOverflow(message)
                ? 'context-overflow'
                : undefined,
            retryable:
              type === 'throttlingException' ||
              type === 'internalServerException' ||
              type === 'serviceUnavailableException' ||
              type === 'modelStreamErrorException',
          }),
        ],
      ] as const;
    }

    if (
      event.internalServerException ||
      event.modelStreamErrorException ||
      event.serviceUnavailableException
    ) {
      const message =
        event.internalServerException?.message ??
        event.modelStreamErrorException?.message ??
        event.serviceUnavailableException?.message ??
        'Bedrock Converse stream error';
      return [state, [LLMEvent.providerError({ message, retryable: true })]] as const;
    }

    if (event.validationException || event.throttlingException) {
      const message =
        event.validationException?.message ??
        event.throttlingException?.message ??
        'Bedrock Converse error';
      return [
        state,
        [
          LLMEvent.providerError({
            message,
            classification:
              event.validationException && isContextOverflow(message)
                ? 'context-overflow'
                : undefined,
            retryable: event.throttlingException !== undefined,
          }),
        ],
      ] as const;
    }

    return [state, []] as const;
  });

const framing = BedrockEventStream.framing(ADAPTER);

const onHalt = (state: ParserState): Effect.Effect<ReadonlyArray<LLMEvent>, LLMError> =>
  Effect.sync(() =>
    state.pendingFinish
      ? (() => {
          const events: LLMEvent[] = [];
          Lifecycle.finish(state.lifecycle, events, {
            reason:
              state.pendingFinish.reason === 'stop' && state.hasToolCalls
                ? 'tool-calls'
                : state.pendingFinish.reason,
            reasonRaw: state.pendingFinish.raw,
            usage: state.usage,
          });
          return events;
        })()
      : [],
  );

// =============================================================================
// Protocol And Bedrock Route
// =============================================================================
/**
 * The Bedrock Converse protocol — request body construction, body schema, and
 * the streaming-event state machine.
 */
export const protocol = Protocol.make({
  id: ADAPTER,
  body: {
    schema: BedrockConverseBody,
    from: fromRequest,
  },
  stream: {
    event: BedrockEvent,
    initial: () => ({
      tools: ToolStream.empty<number>(),
      pendingFinish: undefined,
      usage: undefined,
      hasToolCalls: false,
      lifecycle: Lifecycle.initial(),
      reasoningSignatures: {},
    }),
    step,
    onHalt,
  },
});

export const route = Route.make({
  id: ADAPTER,
  provider: 'bedrock',
  protocol,
  // Bedrock's URL embeds the region in the route endpoint host and the
  // validated modelId in the path. We read the validated body so the URL
  // matches the body that gets signed.
  endpoint: Endpoint.path<BedrockConverseBody>(
    ({ body }) => `/model/${encodeURIComponent(body.modelId)}/converse-stream`,
  ),
  auth: BedrockAuth.auth,
  framing,
});

export const sigV4Auth = BedrockAuth.sigV4;

export * as BedrockConverse from './bedrock-converse.js';
