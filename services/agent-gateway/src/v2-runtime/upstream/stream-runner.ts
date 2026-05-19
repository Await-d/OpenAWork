/**
 * AI SDK stream runner — Phase 4 façade that turns Vercel AI SDK
 * `streamText` events into OpenAWork's `StreamChunk` taxonomy.
 *
 * The runner is intentionally minimal so it can act as a drop-in
 * replacement for the self-rolled SSE parser in
 * `routes/stream-model-round.ts` once the upstream switch is flipped.
 * Today it lives entirely under `v2-runtime/upstream/`; production
 * traffic still flows through the legacy parser.
 *
 * Why this layer exists:
 *   - opencode delegates protocol parsing to the AI SDK, gaining vendor
 *     coverage and saving thousands of lines of bespoke SSE handling.
 *   - OpenAWork needs to keep emitting the existing `StreamChunk` types
 *     to preserve the SSE wire format every web/mobile/desktop client
 *     already speaks. The runner bridges the two.
 *
 * Phase 4 scope (this file):
 *   - Map text deltas, reasoning deltas, tool input deltas onto
 *     `text_delta` / `thinking_*` / `tool_call_delta` chunks.
 *   - Emit a final `done` chunk with the AI SDK finish reason.
 *   - Surface upstream errors via `error` chunks.
 *
 * Out of scope (deferred to follow-up Phase 4 work):
 *   - Real session_entry persistence (already covered by
 *     persistStreamChunkAsSessionEvents from the legacy path; reuse).
 *   - Provider-specific middleware (cache_control breakpoints,
 *     `previous_response_id`, anthropic-betas, thinking budgets).
 *   - Tool execution loop — `streamText` invokes tools itself, so the
 *     legacy `tool-sandbox` integration moves to the new path later.
 *
 * Phase C.1 additions (this revision):
 *   - Track toolName per tool input id so tool-input-delta events
 *     emit a complete `StreamToolCallChunk` (AI SDK only carries the
 *     name on `tool-input-start`).
 *   - Emit a zero-length `tool_call_delta` on `tool-input-start` to
 *     mirror the Anthropic `content_block_start type=tool_use`
 *     behavior the legacy parser produces.
 *   - Map `tool-error` and `abort` to `StreamErrorChunk` so the
 *     SSE consumer surfaces failures without waiting for a finish.
 */

import type { StreamChunk, StreamDoneChunk, StreamErrorChunk } from '@openAwork/shared';
import type { RequestOverrides } from '@openAwork/agent-core';
import type { JSONValue, SharedV2ProviderOptions } from '@ai-sdk/provider';
import type { ModelMessage, StreamTextResult, ToolSet } from 'ai';
import { streamText, tool as defineTool, jsonSchema } from 'ai';
import { applyCaching, buildPromptCacheModelInfo } from './cache-breakpoints.js';
import { dispatchChatParams } from '../../runtime/plugin-host.js';
import type { V2LanguageModel } from './provider.js';
import {
  buildBaseProviderOptions,
  buildProviderOptions,
  buildProviderOptionsModelInfo,
  providerOptions,
  type ThinkingConfig,
} from './provider-options.js';
import { applyProviderMessageTransforms } from './message-transforms.js';

export interface RunUpstreamStreamInput {
  /** AI SDK language model handle (build via `buildAISdkProvider`). */
  model: V2LanguageModel;
  /** Model identifier used for provider transform decisions. */
  modelId?: string;
  /** Conversation history in AI SDK's `ModelMessage` shape. */
  messages: ModelMessage[];
  /** Optional tool set — disabled by default during the migration. */
  tools?: ToolSet;
  /** RNG-style identifiers carried into emitted StreamChunks for replay. */
  runId?: string;
  agentId?: string;
  sessionId?: string;
  /** Abort signal forwarded to the AI SDK. */
  signal?: AbortSignal;
  /** Optional system prompt. */
  system?: string;
  /** Temperature / max tokens / top-p — pass-through to streamText. */
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  requestOverrides?: RequestOverrides;
  /**
   * Provider type — used to decide whether to apply prompt-cache
   * breakpoints. Pass the OpenAWork-side identifier
   * (e.g. `'anthropic'`, `'openai'`, `'openrouter'`).
   */
  providerType?: string;
  /**
   * Optional thinking / reasoning configuration. When present we
   * derive AI SDK `providerOptions` automatically.
   */
  thinking?: ThinkingConfig;
  /**
   * When true, inject a `_noop` stub tool whenever the conversation
   * history contains tool_call / tool_result parts but the caller
   * passed no active tools. Mirrors opencode's LiteLLM/Bedrock
   * compatibility shim — those proxies reject requests where the
   * message history references tools but the request has no `tools`
   * parameter (e.g. during compaction). Default: auto-detect via
   * `providerType` containing "litellm" / "bedrock".
   */
  litellmProxy?: boolean;
  /**
   * Maximum number of retry attempts the AI SDK should perform on
   * transient transport / 5xx / 429 errors. Mirrors the legacy
   * `fetchUpstreamStreamWithRetry` behaviour: when the caller passes
   * `n`, AI SDK retries the upstream call up to `n` times before
   * surfacing the error. Defaults to AI SDK's own default (2).
   */
  maxRetries?: number;
  /**
   * Optional callback fired exactly once when the AI SDK emits the
   * top-level `finish` event with `totalUsage`. The runner does not
   * await the callback — use it to side-effect (e.g. populate a
   * caller-side `usageSummary` variable) without blocking the
   * stream. Errors thrown from inside the callback are swallowed.
   */
  onFinish?: (info: {
    finishReason: string | undefined;
    usage: {
      inputTokens: number | undefined;
      outputTokens: number | undefined;
      totalTokens: number | undefined;
      reasoningTokens?: number | undefined;
      cachedInputTokens?: number | undefined;
      inputTokenDetails?: {
        cacheReadTokens?: number | undefined;
        cacheWriteTokens?: number | undefined;
      };
      outputTokenDetails?: {
        reasoningTokens?: number | undefined;
      };
    };
  }) => void;
}

export type RunUpstreamStreamEvent = StreamChunk;

/**
 * Return a copy of `tools` whose entries are ordered by tool name
 * (`localeCompare`). The serialised tool list is hashed as part of the
 * prompt-cache key by Anthropic, OpenAI Responses, and Bedrock; running
 * with a stable subset of tools but inconsistent iteration order would
 * therefore cause spurious cache misses across requests in the same
 * session. Mirrors opencode #26370.
 *
 * Returns `undefined` when `tools` is `undefined` so callers can
 * forward "no tools" through unchanged.
 */
export function sortToolsByName(tools: ToolSet | undefined): ToolSet | undefined {
  if (!tools) return undefined;
  // `Array#toSorted` is ES2023 and our typecheck lib targets ES2022.
  // Use `slice().sort()` for the same non-mutating semantics.
  const sortedEntries = Object.entries(tools)
    .slice()
    .sort(([a]: [string, unknown], [b]: [string, unknown]) => a.localeCompare(b));
  return Object.fromEntries(sortedEntries) as ToolSet;
}

const FINISH_REASON_TO_STOP: Record<string, StreamDoneChunk['stopReason']> = {
  stop: 'end_turn',
  length: 'max_tokens',
  'tool-calls': 'tool_use',
  'content-filter': 'error',
  error: 'error',
  other: 'end_turn',
  unknown: 'end_turn',
};

function mapFinishReason(value: string | undefined): StreamDoneChunk['stopReason'] {
  if (!value) return 'end_turn';
  return FINISH_REASON_TO_STOP[value] ?? 'end_turn';
}

function shouldOmit(upstreamKeys: string[] | undefined, ...candidates: string[]): boolean {
  if (!upstreamKeys || upstreamKeys.length === 0) return false;
  return candidates.some((k) => upstreamKeys.includes(k));
}

type ProviderOptionsRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ProviderOptionsRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDeep(
  target: ProviderOptionsRecord,
  source: ProviderOptionsRecord,
): ProviderOptionsRecord {
  const result: ProviderOptionsRecord = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeDeep(current, value) : value;
  }
  return result;
}

function mergeProviderOptions(
  ...items: Array<SharedV2ProviderOptions | undefined>
): SharedV2ProviderOptions | undefined {
  const merged = items.reduce<ProviderOptionsRecord>((acc, item) => {
    if (!item) return acc;
    return mergeDeep(acc, item as ProviderOptionsRecord);
  }, {});
  return Object.keys(merged).length > 0 ? (merged as SharedV2ProviderOptions) : undefined;
}

/**
 * True if any message in the history carries a `tool-call` /
 * `tool-result` part. Used to decide whether the LiteLLM/Bedrock
 * `_noop` stub must be injected to satisfy proxies that demand a
 * `tools` parameter whenever the conversation references tools.
 *
 * Mirrors opencode's `hasToolCalls` (`session/llm.ts`).
 */
function hasToolCallsInHistory(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      const partType = (part as { type?: unknown }).type;
      if (partType === 'tool-call' || partType === 'tool-result') return true;
    }
  }
  return false;
}

/**
 * Heuristic: does this provider need the LiteLLM/Bedrock `_noop`
 * compatibility stub? Auto-detected from the OpenAWork-side provider
 * type identifier; explicit `litellmProxy: true/false` always wins.
 */
function shouldInjectNoopStub(input: { litellmProxy?: boolean; providerType?: string }): boolean {
  if (typeof input.litellmProxy === 'boolean') return input.litellmProxy;
  const pt = (input.providerType ?? '').toLowerCase();
  return pt.includes('litellm') || pt.includes('bedrock') || pt.includes('github-copilot');
}

const NOOP_TOOL_DEFINITION = defineTool({
  description: '请勿调用此工具。它仅为 API 兼容性而存在，绝不应被调用。',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      reason: { type: 'string', description: '未使用' },
    },
  }),
  execute: async () => ({ output: '', title: '', metadata: {} }),
});

function buildRequestOverrideProviderOptions(input: {
  model: string;
  providerType?: string;
  requestOverrides?: RequestOverrides;
}): SharedV2ProviderOptions | undefined {
  const body = input.requestOverrides?.body;
  if (!body || Object.keys(body).length === 0) return undefined;
  const omitted = new Set(input.requestOverrides?.omitBodyKeys ?? []);
  const filteredBody = Object.fromEntries(
    Object.entries(body).filter(([key]) => !omitted.has(key)),
  );
  if (Object.keys(filteredBody).length === 0) return undefined;
  const modelInfo = buildProviderOptionsModelInfo({
    providerType: input.providerType ?? 'custom',
    model: input.model,
  });
  return providerOptions(modelInfo, { body: filteredBody as JSONValue });
}

interface RunnerState {
  runId?: string;
  agentId?: string;
  sessionId?: string;
  thinkingActive: boolean;
  thinkingItemId?: string;
  /**
   * AI SDK only emits the tool name on `tool-input-start`; subsequent
   * `tool-input-delta` parts only carry the id. We cache the mapping
   * here so each delta we yield has the full `(toolCallId, toolName)`
   * pair downstream consumers expect.
   */
  toolNamesById: Map<string, string>;
  /**
   * Responses API encrypted reasoning payload captured from the
   * provider's reasoning-start providerMetadata. Forwarded on
   * reasoning-end so downstream accumulators can persist it for
   * round-2 replay.
   */
  thinkingEncryptedContent?: string;
  /**
   * AI SDK fires both `finish-step` (per round) and `finish` (overall)
   * for non-multi-step calls; legacy emits exactly one `done` chunk
   * per upstream completion. We collapse the two into a single emit
   * so downstream consumers see the same shape on both paths.
   */
  doneEmitted: boolean;
}

/**
 * Drive an AI SDK `streamText` call and yield OpenAWork StreamChunks.
 *
 * Returns an async iterable so the caller can pipe the events into the
 * existing `writeChunk(...)` consumer in `runModelRound` without further
 * adaptation.
 */
export async function* runUpstreamStream(
  input: RunUpstreamStreamInput,
): AsyncGenerator<RunUpstreamStreamEvent, StreamTextResult<ToolSet, never> | undefined, void> {
  const state: RunnerState = {
    runId: input.runId,
    agentId: input.agentId,
    thinkingActive: false,
    toolNamesById: new Map<string, string>(),
    doneEmitted: false,
  };

  // Synthesise AI SDK providerOptions for thinking / reasoning when
  // a thinking config is provided.
  const modelIdForOptions =
    input.modelId ??
    ('modelId' in input.model && typeof (input.model as { modelId?: unknown }).modelId === 'string'
      ? (input.model as { modelId: string }).modelId
      : '');
  const transformedMessages = applyProviderMessageTransforms(input.messages, {
    providerType: input.providerType,
    model: modelIdForOptions,
  });
  // Decorate the conversation with prompt-cache breakpoints when applicable.
  const decoratedMessages = applyCaching(
    transformedMessages,
    buildPromptCacheModelInfo({ providerType: input.providerType, model: modelIdForOptions }),
  );
  const omit = input.requestOverrides?.omitBodyKeys;
  const providerOptions = mergeProviderOptions(
    buildBaseProviderOptions({
      model: modelIdForOptions,
      providerType: input.providerType,
      sessionId: input.sessionId,
    }),
    buildRequestOverrideProviderOptions({
      model: modelIdForOptions,
      providerType: input.providerType,
      requestOverrides: input.requestOverrides,
    }),
    buildProviderOptions({
      ...(input.thinking ? { thinking: input.thinking } : {}),
      model: modelIdForOptions,
    }),
  );
  let temperature = input.requestOverrides?.temperature ?? input.temperature;
  let maxOutputTokens = input.requestOverrides?.maxTokens ?? input.maxOutputTokens;
  let topP = input.requestOverrides?.topP ?? input.topP;
  let frequencyPenalty = input.requestOverrides?.frequencyPenalty ?? input.frequencyPenalty;
  let presencePenalty = input.requestOverrides?.presencePenalty ?? input.presencePenalty;

  // PR-D-Plugin: `chat.params` hook — let plugins override sampling
  // params + arbitrary `options` immediately before the AI SDK
  // `streamText` call. Mirrors opencode's
  // `@/temp/opencode/packages/plugin/src/index.ts:140-160` contract:
  // plugins receive the resolved params as a mutable output object,
  // mutate fields in place, and we read the mutations back into the
  // local `let` bindings. The shared `options` bag carries
  // frequency/presence penalty + future provider extensions.
  //
  // Hook errors are isolated inside the dispatcher (see
  // `plugin-host.ts`) so a misbehaving plugin can't crash a turn.
  const chatParamsOutput: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    options: Record<string, unknown>;
  } = {
    options: {},
  };
  if (typeof temperature === 'number') chatParamsOutput.temperature = temperature;
  if (typeof topP === 'number') chatParamsOutput.topP = topP;
  if (typeof maxOutputTokens === 'number') chatParamsOutput.maxOutputTokens = maxOutputTokens;
  if (typeof frequencyPenalty === 'number')
    chatParamsOutput.options['frequencyPenalty'] = frequencyPenalty;
  if (typeof presencePenalty === 'number')
    chatParamsOutput.options['presencePenalty'] = presencePenalty;

  await dispatchChatParams(
    {
      sessionID: input.sessionId ?? '',
      modelId: input.modelId ?? '',
    },
    chatParamsOutput,
  );

  // Read the (possibly-mutated) values back. We deliberately allow
  // plugins to NULL these out (set to `undefined`) — that's a valid
  // signal "stop sending this param to the model".
  temperature = chatParamsOutput.temperature;
  topP = chatParamsOutput.topP;
  maxOutputTokens = chatParamsOutput.maxOutputTokens;
  const optsFreq = chatParamsOutput.options['frequencyPenalty'];
  frequencyPenalty = typeof optsFreq === 'number' ? optsFreq : undefined;
  const optsPres = chatParamsOutput.options['presencePenalty'];
  presencePenalty = typeof optsPres === 'number' ? optsPres : undefined;

  // `ai@5.x` types `streamText`'s model parameter as the V2 union, but
  // `@ai-sdk/openai-compatible@2.x` already emits V3 instances. Both
  // shapes are runtime-compatible; until the SDK aligns the type
  // surface we cast through `unknown` at this single boundary instead
  // of forcing every caller to do so.
  // LiteLLM/Bedrock proxies reject requests where the message history
  // references tools but no `tools` parameter is present. When there are
  // no active tools (e.g. compaction round) inject a `_noop` stub.
  const incomingTools = input.tools;
  const needsStub =
    (!incomingTools || Object.keys(incomingTools).length === 0) &&
    hasToolCallsInHistory(decoratedMessages) &&
    shouldInjectNoopStub({ litellmProxy: input.litellmProxy, providerType: input.providerType });
  // Sort tool entries by name for deterministic ordering. Many providers
  // hash the serialised tool list as part of the prompt-cache key (Anthropic
  // prompt caching, OpenAI Responses cached tools, Bedrock prompt-cache),
  // so even a stable subset of tools that arrives in shifting insertion
  // order causes spurious cache misses across requests in the same session.
  // Mirrors opencode #26370.
  const sortedIncomingTools = sortToolsByName(incomingTools);
  const effectiveTools: ToolSet | undefined = needsStub
    ? ({ _noop: NOOP_TOOL_DEFINITION } as unknown as ToolSet)
    : sortedIncomingTools;
  const toolNameLookup = new Map<string, string>();
  if (effectiveTools) {
    for (const name of Object.keys(effectiveTools)) {
      toolNameLookup.set(name.toLowerCase(), name);
    }
  }

  type StreamTextModelParam = Parameters<typeof streamText>[0]['model'];
  const result = streamText({
    model: input.model as unknown as StreamTextModelParam,
    messages: decoratedMessages,
    ...(effectiveTools ? { tools: effectiveTools } : {}),
    // Repair tool calls whose name only differs in case before the AI
    // SDK rejects them. Matches opencode's `experimental_repairToolCall`.
    ...(effectiveTools
      ? {
          experimental_repairToolCall: (async (failed: { toolCall: { toolName: string } }) => {
            const requested = failed.toolCall.toolName;
            const lower = requested.toLowerCase();
            const canonical = toolNameLookup.get(lower);
            if (canonical && canonical !== requested) {
              return { ...failed.toolCall, toolName: canonical };
            }
            return null;
          }) as Parameters<typeof streamText>[0]['experimental_repairToolCall'],
        }
      : {}),
    ...(input.system ? { system: input.system } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    ...(typeof temperature === 'number' && !shouldOmit(omit, 'temperature') ? { temperature } : {}),
    ...(typeof maxOutputTokens === 'number' &&
    !shouldOmit(omit, 'max_tokens', 'max_output_tokens', 'maxOutputTokens')
      ? { maxOutputTokens }
      : {}),
    ...(typeof topP === 'number' && !shouldOmit(omit, 'top_p', 'topP') ? { topP } : {}),
    ...(typeof frequencyPenalty === 'number' &&
    !shouldOmit(omit, 'frequency_penalty', 'frequencyPenalty')
      ? { frequencyPenalty }
      : {}),
    ...(typeof presencePenalty === 'number' &&
    !shouldOmit(omit, 'presence_penalty', 'presencePenalty')
      ? { presencePenalty }
      : {}),
    ...(typeof input.maxRetries === 'number' ? { maxRetries: input.maxRetries } : {}),
    abortSignal: input.signal,
  }) as unknown as StreamTextResult<ToolSet, never>;

  const meta = (extra: Record<string, unknown>) => ({
    ...(state.runId ? { runId: state.runId } : {}),
    ...(state.agentId ? { agentId: state.agentId } : {}),
    occurredAt: Date.now(),
    ...extra,
  });

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        yield {
          type: 'text_delta',
          delta: part.text,
          ...meta({}),
        };
        break;
      case 'reasoning-start': {
        const itemId = 'id' in part && typeof part.id === 'string' ? part.id : undefined;
        state.thinkingActive = true;
        state.thinkingItemId = itemId;
        // Responses API encrypted reasoning replay: the OpenAI SDK
        // attaches `encrypted_content` (and the source `itemId`) to the
        // reasoning-start providerMetadata. Capture it so the
        // reasoning-end emit can forward it downstream where the
        // accumulator persists it for round-2 replay (`previous_response_id`
        // / `input.reasoning` parity).
        const startPmd = (part as { providerMetadata?: Record<string, unknown> }).providerMetadata;
        const openaiStartMeta = startPmd?.['openai'] as
          | { reasoningEncryptedContent?: unknown; itemId?: unknown }
          | undefined;
        if (
          typeof openaiStartMeta?.reasoningEncryptedContent === 'string' &&
          openaiStartMeta.reasoningEncryptedContent.length > 0
        ) {
          state.thinkingEncryptedContent = openaiStartMeta.reasoningEncryptedContent;
        }
        yield {
          type: 'thinking_start',
          ...(itemId ? { itemId } : {}),
          ...meta({}),
        };
        break;
      }
      case 'reasoning-delta': {
        const itemId = 'id' in part && typeof part.id === 'string' ? part.id : state.thinkingItemId;
        yield {
          type: 'thinking_delta',
          delta: part.text,
          ...(itemId ? { itemId } : {}),
          ...meta({}),
        };
        break;
      }
      case 'reasoning-end': {
        const itemId = 'id' in part && typeof part.id === 'string' ? part.id : state.thinkingItemId;
        state.thinkingActive = false;
        state.thinkingItemId = undefined;
        // Anthropic extended thinking attaches the per-block signature
        // here via providerMetadata.anthropic.signature (Bedrock-hosted
        // Claude reuses the same shape under .bedrock). Forward it so
        // downstream accumulators can persist it on the matching
        // ReasoningPart for multi-turn replay.
        const pmd = (part as { providerMetadata?: Record<string, unknown> }).providerMetadata;
        const anthropicMeta = (pmd?.['anthropic'] ?? pmd?.['bedrock']) as
          | { signature?: unknown }
          | undefined;
        const signature =
          typeof anthropicMeta?.signature === 'string' && anthropicMeta.signature.length > 0
            ? anthropicMeta.signature
            : undefined;
        const encryptedContent = state.thinkingEncryptedContent;
        state.thinkingEncryptedContent = undefined;
        const providerMetadata =
          signature || encryptedContent
            ? {
                ...(signature ? { signature } : {}),
                ...(encryptedContent ? { encryptedContent } : {}),
              }
            : undefined;
        yield {
          type: 'thinking_end',
          ...(itemId ? { itemId } : {}),
          ...(providerMetadata ? { providerMetadata } : {}),
          ...meta({}),
        };
        break;
      }
      case 'tool-input-start': {
        const callId = typeof part.id === 'string' ? part.id : undefined;
        const toolName = typeof part.toolName === 'string' ? part.toolName : '';
        if (!callId) break;
        state.toolNamesById.set(callId, toolName);
        // Emit a zero-length delta so downstream accumulators register
        // the (toolCallId, toolName) pair before any input streams in.
        // Matches legacy `content_block_start type=tool_use` output.
        yield {
          type: 'tool_call_delta',
          toolCallId: callId,
          toolName,
          inputDelta: '',
          ...meta({}),
        };
        break;
      }
      case 'tool-input-delta': {
        const callId =
          'id' in part && typeof part.id === 'string'
            ? part.id
            : 'toolCallId' in part && typeof part.toolCallId === 'string'
              ? part.toolCallId
              : undefined;
        if (!callId) break;
        const toolName =
          state.toolNamesById.get(callId) ??
          ('toolName' in part && typeof part.toolName === 'string' ? part.toolName : '');
        yield {
          type: 'tool_call_delta',
          toolCallId: callId,
          toolName,
          inputDelta: part.delta ?? '',
          ...meta({}),
        };
        break;
      }
      case 'tool-input-end':
        // No StreamChunk equivalent; the accumulator wraps up on the
        // next `tool-call` part or the round's `finish` event.
        break;
      case 'tool-call': {
        // The provider has resolved a complete tool call. Many
        // upstreams stream the whole input via tool-input-delta
        // already; for those that emit a single `tool-call` (e.g.
        // legacy OpenAI `function_call`), surface the JSON payload
        // as a final `tool_call_delta` so accumulators see it once.
        const callId =
          'toolCallId' in part && typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
        const toolName =
          ('toolName' in part && typeof part.toolName === 'string' ? part.toolName : undefined) ??
          (callId ? state.toolNamesById.get(callId) : undefined) ??
          '';
        if (!callId) break;
        const inputValue = (part as { input?: unknown }).input;
        const inputDelta =
          typeof inputValue === 'string'
            ? inputValue
            : inputValue !== undefined
              ? JSON.stringify(inputValue)
              : '';
        // Capture provider metadata so it can ride on the *closer*
        // delta we emit below. The OpenAI Responses adapter attaches
        // `openai.itemId` (`fc_xxx`) here — without persisting it,
        // round-2 input rebuilds `function_call.id` from the
        // call_id (`call_xxx`), OpenAI re-keys the item, and the
        // prompt-cache prefix from this point on misses on every
        // subsequent request.
        const providerMetadata = (
          part as {
            providerMetadata?: Record<string, Record<string, unknown>>;
          }
        ).providerMetadata;
        if (!state.toolNamesById.has(callId)) {
          // No prior tool-input-start was emitted (legacy path, e.g.
          // OpenAI Chat Completions `function_call`): register name +
          // emit zero-length delta first so downstream sees the
          // binding, then emit the full JSON payload below.
          state.toolNamesById.set(callId, toolName);
          yield {
            type: 'tool_call_delta',
            toolCallId: callId,
            toolName,
            inputDelta: '',
            ...meta({}),
          };
          if (inputDelta.length > 0) {
            yield {
              type: 'tool_call_delta',
              toolCallId: callId,
              toolName,
              inputDelta,
              ...meta({}),
            };
          }
        }
        // If we *did* see a prior tool-input-start, the input has
        // already been streamed via tool-input-delta chunks, so we
        // must NOT emit the final `tool-call.input` again — doing so
        // would double the JSON in the accumulator (e.g. `{}{}`),
        // make `JSON.parse` fail, and force callers to fall back to
        // `{ raw: '{}{}' }`, which Zod-validated tools then reject.
        //
        // We *do* emit a zero-length closer delta carrying
        // `providerMetadata` whenever the provider supplied one, so
        // the accumulator can attach `openai.itemId` (and any future
        // provider-specific metadata) without re-streaming the input.
        if (providerMetadata && Object.keys(providerMetadata).length > 0) {
          yield {
            type: 'tool_call_delta',
            toolCallId: callId,
            toolName,
            inputDelta: '',
            providerMetadata,
            ...meta({}),
          };
        }
        break;
      }
      case 'tool-error': {
        const errPart = part as {
          error?: unknown;
          toolName?: string;
          toolCallId?: string;
        };
        const message =
          errPart.error instanceof Error
            ? errPart.error.message
            : typeof errPart.error === 'string'
              ? errPart.error
              : 'tool execution error';
        const errorChunk: StreamErrorChunk = {
          type: 'error',
          code: 'TOOL_ERROR',
          message,
          ...meta({}),
        };
        yield errorChunk;
        break;
      }
      case 'abort': {
        const errorChunk: StreamErrorChunk = {
          type: 'error',
          code: 'ABORTED',
          message: 'upstream stream aborted',
          ...meta({}),
        };
        yield errorChunk;
        break;
      }
      case 'finish':
      case 'finish-step': {
        // Capture usage from whichever event provides it. The
        // top-level `finish` carries `totalUsage`; per-step events
        // carry `usage`. Either is acceptable as the canonical
        // round-level total since the v2 path runs a single round.
        if (input.onFinish) {
          const usage =
            part.type === 'finish' && 'totalUsage' in part && part.totalUsage
              ? part.totalUsage
              : 'usage' in part && part.usage
                ? part.usage
                : undefined;
          if (usage) {
            try {
              input.onFinish({
                finishReason:
                  'finishReason' in part && typeof part.finishReason === 'string'
                    ? part.finishReason
                    : undefined,
                usage,
              });
            } catch {
              // best-effort — caller-side telemetry must never
              // break the stream.
            }
          }
        }
        if (state.doneEmitted) break;
        const stopReason = mapFinishReason(
          'finishReason' in part && typeof part.finishReason === 'string'
            ? part.finishReason
            : undefined,
        );
        const done: StreamDoneChunk = {
          type: 'done',
          stopReason,
          ...meta({}),
        };
        state.doneEmitted = true;
        yield done;
        break;
      }
      case 'error': {
        const message =
          part.error instanceof Error
            ? part.error.message
            : typeof part.error === 'string'
              ? part.error
              : 'unknown upstream error';
        // Emit the legacy-compatible `MODEL_ERROR` code + HTTP-ish
        // `status: 502` so SSE consumers (and the
        // verify-openai-responses verifier) continue to see the same
        // error shape the custom parser produced pre-migration.
        const errorChunk = {
          type: 'error' as const,
          code: 'MODEL_ERROR',
          status: 502,
          message,
          ...meta({}),
        } as StreamErrorChunk;
        yield errorChunk;
        break;
      }
      default:
        // Unknown / vendor-specific events are passed silently; the
        // legacy SSE pipeline will keep producing them in tandem until
        // the runner reaches feature parity.
        break;
    }
  }

  return result;
}
