import { Effect, Schema } from 'effect';
import { Route } from '../route/client.js';
import { Auth } from '../route/auth.js';
import { Endpoint } from '../route/endpoint.js';
import { Framing } from '../route/framing.js';
import { Protocol } from '../route/protocol.js';
import { AnthropicContextManagement, LLMEvent, Usage } from '../schema/index.js';
import { JsonObject, optionalArray, optionalNull, ProviderShared } from './shared.js';
import { isContextOverflow } from '../provider-error.js';
import * as Cache from './utils/cache.js';
import { Lifecycle } from './utils/lifecycle.js';
import { ToolSchemaProjection } from './utils/tool-schema.js';
import { ToolStream } from './utils/tool-stream.js';
const ADAPTER = 'anthropic-messages';
export const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
export const PATH = '/messages';
// =============================================================================
// Request Body Schema
// =============================================================================
const AnthropicCacheControl = Schema.Struct({
  type: Schema.tag('ephemeral'),
  ttl: Schema.optional(Schema.Literals(['5m', '1h'])),
});
const AnthropicTextBlock = Schema.Struct({
  type: Schema.tag('text'),
  text: Schema.String,
  cache_control: Schema.optional(AnthropicCacheControl),
});
const AnthropicImageBlock = Schema.Struct({
  type: Schema.tag('image'),
  source: Schema.Struct({
    type: Schema.tag('base64'),
    media_type: Schema.String,
    data: Schema.String,
  }),
  cache_control: Schema.optional(AnthropicCacheControl),
});
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
const AnthropicServerToolUseBlock = Schema.Struct({
  type: Schema.tag('server_tool_use'),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
});
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
const AnthropicServerToolResultBlock = Schema.Struct({
  type: AnthropicServerToolResultType,
  tool_use_id: Schema.String,
  content: Schema.Unknown,
  cache_control: Schema.optional(AnthropicCacheControl),
});
// Anthropic accepts either a plain string or an ordered array of text/image
// blocks inside `tool_result.content`. The array form is required when a tool
// returns image bytes (screenshot, image search, etc.) so they can be passed
// to the model as proper image inputs instead of being JSON-stringified into
// the prompt — which silently inflates context by megabytes and can push the
// conversation over the model's token limit.
const AnthropicToolResultContent = Schema.Union([AnthropicTextBlock, AnthropicImageBlock]);
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
  AnthropicToolResultBlock,
]);
const AnthropicAssistantBlock = Schema.Union([
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicToolUseBlock,
  AnthropicServerToolUseBlock,
  AnthropicServerToolResultBlock,
]);
const AnthropicMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal('user'), content: Schema.Array(AnthropicUserBlock) }),
  Schema.Struct({
    role: Schema.Literal('assistant'),
    content: Schema.Array(AnthropicAssistantBlock),
  }),
  Schema.Struct({ role: Schema.Literal('system'), content: Schema.Array(AnthropicTextBlock) }),
]).pipe(Schema.toTaggedUnion('role'));
const AnthropicTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  input_schema: JsonObject,
  cache_control: Schema.optional(AnthropicCacheControl),
});
const AnthropicToolChoice = Schema.Union([
  Schema.Struct({ type: Schema.Literals(['auto', 'any']) }),
  Schema.Struct({ type: Schema.tag('tool'), name: Schema.String }),
]);
const AnthropicThinking = Schema.Struct({
  type: Schema.tag('enabled'),
  budget_tokens: Schema.Number,
});
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
};
const AnthropicMessagesBody = Schema.Struct(AnthropicBodyFields);
const AnthropicUsage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  cache_creation_input_tokens: optionalNull(Schema.Number),
  cache_read_input_tokens: optionalNull(Schema.Number),
});
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
const invalid = ProviderShared.invalidRequest;
// =============================================================================
// Request Lowering
// =============================================================================
// Anthropic accepts at most 4 explicit cache_control breakpoints per request,
// across `tools`, `system`, and `messages`. Beyond the cap the API returns a
// 400 — so the lowering layer counts emitted markers and silently drops any
// that exceed it.
const ANTHROPIC_BREAKPOINT_CAP = 4;
const EPHEMERAL_5M = { type: 'ephemeral' };
const EPHEMERAL_1H = { type: 'ephemeral', ttl: '1h' };
const cacheControl = (breakpoints, cache) => {
  if (cache?.type !== 'ephemeral' && cache?.type !== 'persistent') return undefined;
  if (breakpoints.remaining <= 0) {
    breakpoints.dropped += 1;
    return undefined;
  }
  breakpoints.remaining -= 1;
  return Cache.ttlBucket(cache.ttlSeconds) === '1h' ? EPHEMERAL_1H : EPHEMERAL_5M;
};
const anthropicMetadata = (metadata) => ({ anthropic: metadata });
const signatureFromMetadata = (metadata) => {
  const anthropic = metadata?.anthropic;
  if (!ProviderShared.isRecord(anthropic)) return undefined;
  return typeof anthropic.signature === 'string' ? anthropic.signature : undefined;
};
const lowerTool = (breakpoints, tool, inputSchema) => ({
  name: tool.name,
  description: tool.description,
  input_schema: inputSchema,
  cache_control: cacheControl(breakpoints, tool.cache),
});
const lowerToolChoice = (toolChoice) =>
  ProviderShared.matchToolChoice('Anthropic Messages', toolChoice, {
    auto: () => ({ type: 'auto' }),
    none: () => undefined,
    required: () => ({ type: 'any' }),
    tool: (name) => ({ type: 'tool', name }),
  });
const lowerToolCall = (part) => ({
  type: 'tool_use',
  id: part.id,
  name: part.name,
  input: part.input,
});
const lowerServerToolCall = (part) => ({
  type: 'server_tool_use',
  id: part.id,
  name: part.name,
  input: part.input,
});
// Server tool result blocks are typed by name. Anthropic ships three today;
// extend this list when new server tools land. The block content is the
// structured payload returned by the provider, which we round-trip as-is.
const serverToolResultType = (name) => {
  if (name === 'web_search') return 'web_search_tool_result';
  if (name === 'code_execution') return 'code_execution_tool_result';
  if (name === 'web_fetch') return 'web_fetch_tool_result';
  return undefined;
};
const lowerServerToolResult = Effect.fn('AnthropicMessages.lowerServerToolResult')(
  function* (part) {
    const wireType = serverToolResultType(part.name);
    if (!wireType)
      return yield* invalid(
        `Anthropic Messages does not know how to round-trip server tool result for ${part.name}`,
      );
    return { type: wireType, tool_use_id: part.id, content: part.result.value };
  },
);
const lowerImage = Effect.fn('AnthropicMessages.lowerImage')(function* (part) {
  const media = yield* ProviderShared.validateMedia(
    'Anthropic Messages',
    part,
    new Set(ProviderShared.IMAGE_MIMES),
  );
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: media.mime,
      data: media.base64,
    },
  };
});
// Tool results may carry structured text/images. Keep media as provider-native
// content instead of JSON-stringifying base64 into a prompt string.
const lowerToolResultContentItem = Effect.fn('AnthropicMessages.lowerToolResultContentItem')(
  function* (item) {
    if (item.type === 'text') return { type: 'text', text: item.text };
    // Type guard ensures item is file type here
    if (item.type !== 'file') throw new Error('Unexpected content type');
    const media = yield* ProviderShared.validateToolFile(
      'Anthropic Messages',
      item,
      new Set(ProviderShared.IMAGE_MIMES),
    );
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: media.mime,
        data: media.base64,
      },
    };
  },
);
const lowerToolResultContent = Effect.fn('AnthropicMessages.lowerToolResultContent')(
  function* (part) {
    // Text / json / error results stay as a string for backward compatibility
    // with existing cassettes and provider expectations.
    if (part.result.type !== 'content') return ProviderShared.toolResultText(part);
    // Preserve the narrowed array element type when compiled through a consumer package.
    const content = part.result.value;
    return yield* Effect.forEach(content, lowerToolResultContentItem);
  },
);
// Mid-conversation system messages are a native Claude API feature only for
// Opus 4.8. Other Anthropic models intentionally use the same visible wrapped-
// user fallback as non-Anthropic routes rather than sending a role they reject.
const supportsNativeSystemUpdates = (request) => String(request.model.id) === 'claude-opus-4-8';
const endsInServerToolUse = (message) => {
  const last = message.content.at(-1);
  return (
    message.role === 'assistant' && last?.type === 'tool-call' && last.providerExecuted === true
  );
};
const canUseNativeSystemUpdate = (messages, index) => {
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
const splitsLocalToolResults = (messages, index) => {
  const pending = new Set();
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
const lowerNativeSystemUpdate = Effect.fn('AnthropicMessages.lowerNativeSystemUpdate')(
  function* (message, breakpoints) {
    const content = yield* ProviderShared.systemUpdateText('Anthropic Messages', message);
    return {
      role: 'system',
      content: content.map((part) => ({
        type: 'text',
        text: part.text,
        cache_control: cacheControl(breakpoints, part.cache),
      })),
    };
  },
);
const lowerMessages = Effect.fn('AnthropicMessages.lowerMessages')(
  function* (request, breakpoints) {
    const messages = [];
    for (const [index, message] of request.messages.entries()) {
      if (message.role === 'system') {
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
          type: 'text',
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
        const content = [];
        for (const part of message.content) {
          if (part.type === 'text') {
            content.push({
              type: 'text',
              text: part.text,
              cache_control: cacheControl(breakpoints, part.cache),
            });
            continue;
          }
          if (part.type === 'media') {
            content.push(yield* lowerImage(part));
            continue;
          }
          return yield* ProviderShared.unsupportedContent('Anthropic Messages', 'user', [
            'text',
            'media',
          ]);
        }
        messages.push({ role: 'user', content });
        continue;
      }
      if (message.role === 'assistant') {
        const content = [];
        for (const part of message.content) {
          if (part.type === 'text') {
            content.push({
              type: 'text',
              text: part.text,
              cache_control: cacheControl(breakpoints, part.cache),
            });
            continue;
          }
          if (part.type === 'reasoning') {
            content.push({
              type: 'thinking',
              thinking: part.text,
              signature: part.encrypted ?? signatureFromMetadata(part.providerMetadata),
            });
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
      const content = [];
      for (const part of message.content) {
        if (!ProviderShared.supportsContent(part, ['tool-result']))
          return yield* ProviderShared.unsupportedContent('Anthropic Messages', 'tool', [
            'tool-result',
          ]);
        content.push({
          type: 'tool_result',
          tool_use_id: part.id,
          content: yield* lowerToolResultContent(part),
          is_error: part.result.type === 'error' ? true : undefined,
          cache_control: cacheControl(breakpoints, part.cache),
        });
      }
      messages.push({ role: 'user', content });
    }
    return messages;
  },
);
const anthropicOptions = (request) => request.providerOptions?.anthropic;
const lowerContextManagement = Effect.fn('AnthropicMessages.lowerContextManagement')(
  function* (request) {
    const input = anthropicOptions(request)?.contextManagement;
    if (input === undefined || !ProviderShared.supportsAnthropicContextManagement(request))
      return undefined;
    return yield* ProviderShared.validateWith(
      Schema.decodeUnknownEffect(AnthropicContextManagement),
    )(input);
  },
);
const lowerThinking = Effect.fn('AnthropicMessages.lowerThinking')(function* (request) {
  const thinking = anthropicOptions(request)?.thinking;
  if (!ProviderShared.isRecord(thinking) || thinking.type !== 'enabled') return undefined;
  const budget =
    typeof thinking.budgetTokens === 'number'
      ? thinking.budgetTokens
      : typeof thinking.budget_tokens === 'number'
        ? thinking.budget_tokens
        : undefined;
  if (budget === undefined)
    return yield* invalid('Anthropic thinking provider option requires budgetTokens');
  return { type: 'enabled', budget_tokens: budget };
});
const fromRequest = Effect.fn('AnthropicMessages.fromRequest')(function* (request) {
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
          type: 'text',
          text: part.text,
          cache_control: cacheControl(breakpoints, part.cache),
        }));
  const messages = yield* lowerMessages(request, breakpoints);
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
    stream: true,
    max_tokens: generation?.maxTokens ?? outputLimit,
    temperature: generation?.temperature,
    top_p: generation?.topP,
    top_k: generation?.topK,
    stop_sequences: generation?.stop,
    thinking: yield* lowerThinking(request),
    ...(contextManagement === undefined ? {} : { context_management: contextManagement }),
  };
});
// =============================================================================
// Stream Parsing
// =============================================================================
const mapFinishReason = (reason) => {
  if (reason === 'end_turn' || reason === 'stop_sequence' || reason === 'pause_turn') return 'stop';
  if (reason === 'max_tokens') return 'length';
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
const mapUsage = (usage) => {
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
const mergeUsage = (left, right) => {
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
const SERVER_TOOL_RESULT_NAMES = {
  web_search_tool_result: 'web_search',
  code_execution_tool_result: 'code_execution',
  web_fetch_tool_result: 'web_fetch',
};
const isServerToolResultType = (type) => type in SERVER_TOOL_RESULT_NAMES;
const serverToolResultEvent = (block) => {
  if (!block.type || !isServerToolResultType(block.type)) return undefined;
  const errorPayload =
    typeof block.content === 'object' && block.content !== null && 'type' in block.content
      ? String(block.content.type)
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
const NO_EVENTS = [];
const onMessageStart = (state, event) => {
  const usage = mapUsage(event.message?.usage);
  return [usage ? { ...state, usage: mergeUsage(state.usage, usage) } : state, NO_EVENTS];
};
const onContentBlockStart = (state, event) => {
  const block = event.content_block;
  if (!block) return [state, NO_EVENTS];
  if (
    (block.type === 'tool_use' || block.type === 'server_tool_use') &&
    event.index !== undefined
  ) {
    const events = [];
    const lifecycle = Lifecycle.stepStart(state.lifecycle, events);
    return [
      {
        ...state,
        lifecycle,
        tools: ToolStream.start(state.tools, event.index, {
          id: block.id ?? String(event.index),
          name: block.name ?? '',
          providerExecuted: block.type === 'server_tool_use',
        }),
      },
      [
        ...events,
        LLMEvent.toolInputStart({ id: block.id ?? String(event.index), name: block.name ?? '' }),
      ],
    ];
  }
  if (block.type === 'text' && block.text) {
    const events = [];
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
    const events = [];
    return [
      {
        ...state,
        lifecycle: Lifecycle.reasoningDelta(
          state.lifecycle,
          events,
          `reasoning-${event.index ?? 0}`,
          block.thinking,
        ),
      },
      events,
    ];
  }
  const result = serverToolResultEvent(block);
  if (!result) return [state, NO_EVENTS];
  const events = [];
  return [
    { ...state, lifecycle: Lifecycle.stepStart(state.lifecycle, events) },
    [...events, result],
  ];
};
const onContentBlockDelta = Effect.fn('AnthropicMessages.onContentBlockDelta')(
  function* (state, event) {
    const delta = event.delta;
    if (delta?.type === 'text_delta' && delta.text) {
      const events = [];
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
      ];
    }
    if (delta?.type === 'thinking_delta' && delta.thinking) {
      const events = [];
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
      ];
    }
    if (delta?.type === 'signature_delta' && delta.signature) {
      const events = [];
      return [
        {
          ...state,
          lifecycle: Lifecycle.reasoningEnd(
            state.lifecycle,
            events,
            `reasoning-${event.index ?? 0}`,
            anthropicMetadata({ signature: delta.signature }),
          ),
        },
        events,
      ];
    }
    if (delta?.type === 'input_json_delta' && event.index !== undefined) {
      if (!delta.partial_json) return [state, NO_EVENTS];
      const result = ToolStream.appendExisting(
        ADAPTER,
        state.tools,
        event.index,
        delta.partial_json,
        'Anthropic Messages tool argument delta is missing its tool call',
      );
      if (ToolStream.isError(result)) return yield* result;
      const events = [];
      const lifecycle = result.events.length
        ? Lifecycle.stepStart(state.lifecycle, events)
        : state.lifecycle;
      events.push(...result.events);
      return [{ ...state, lifecycle, tools: result.tools }, events];
    }
    return [state, NO_EVENTS];
  },
);
const onContentBlockStop = Effect.fn('AnthropicMessages.onContentBlockStop')(
  function* (state, event) {
    if (event.index === undefined) return [state, NO_EVENTS];
    const result = yield* ToolStream.finish(ADAPTER, state.tools, event.index);
    const events = [];
    const resultEvents = result.events ?? [];
    const lifecycle = resultEvents.length
      ? Lifecycle.stepStart(state.lifecycle, events)
      : Lifecycle.reasoningEnd(
          Lifecycle.textEnd(state.lifecycle, events, `text-${event.index}`),
          events,
          `reasoning-${event.index}`,
        );
    events.push(...resultEvents);
    return [{ ...state, lifecycle, tools: result.tools }, events];
  },
);
const onMessageDelta = (state, event) => {
  const usage = mergeUsage(state.usage, mapUsage(event.usage));
  const events = [];
  const lifecycle = Lifecycle.finish(state.lifecycle, events, {
    reason: mapFinishReason(event.delta?.stop_reason),
    usage,
    providerMetadata: event.delta?.stop_sequence
      ? anthropicMetadata({ stopSequence: event.delta.stop_sequence })
      : undefined,
  });
  return [{ ...state, lifecycle, usage }, events];
};
// Prefix `error.type` so overloads, rate limits, and quota errors are visible
// even when the provider message is generic or empty.
const providerErrorMessage = (event) => {
  const type = event.error?.type;
  const message = event.error?.message;
  if (type && message) return `${type}: ${message}`;
  return message || type || 'Anthropic Messages stream error';
};
const onError = (state, event) => [
  state,
  [
    LLMEvent.providerError({
      message: providerErrorMessage(event),
      classification: isContextOverflow(event.error?.message ?? '')
        ? 'context-overflow'
        : undefined,
    }),
  ],
];
const step = (state, event) => {
  if (event.type === 'message_start') return Effect.succeed(onMessageStart(state, event));
  if (event.type === 'content_block_start')
    return Effect.succeed(onContentBlockStart(state, event));
  if (event.type === 'content_block_delta') return onContentBlockDelta(state, event);
  if (event.type === 'content_block_stop') return onContentBlockStop(state, event);
  if (event.type === 'message_delta') return Effect.succeed(onMessageDelta(state, event));
  if (event.type === 'error') return Effect.succeed(onError(state, event));
  return Effect.succeed([state, NO_EVENTS]);
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
    initial: () => ({ tools: ToolStream.empty(), lifecycle: Lifecycle.initial() }),
    step,
  },
});
export const route = Route.make({
  id: ADAPTER,
  provider: 'anthropic',
  protocol,
  endpoint: Endpoint.path(PATH, { baseURL: DEFAULT_BASE_URL }),
  auth: Auth.none,
  framing: Framing.sse,
  headers: ({ request }) => ({
    'anthropic-version': '2023-06-01',
    ...(anthropicOptions(request)?.contextManagement !== undefined &&
    ProviderShared.supportsAnthropicContextManagement(request)
      ? { 'anthropic-beta': 'context-management-2025-06-27' }
      : {}),
  }),
});
export * as AnthropicMessages from './anthropic-messages.js';
//# sourceMappingURL=anthropic-messages.js.map
