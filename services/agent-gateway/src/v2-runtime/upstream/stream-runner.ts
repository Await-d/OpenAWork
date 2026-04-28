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

import type {
  StreamChunk,
  StreamDoneChunk,
  StreamErrorChunk,
} from '@openAwork/shared';
import type { ModelMessage, StreamTextResult, ToolSet } from 'ai';
import { streamText } from 'ai';
import { applyAnthropicCacheBreakpoints } from './cache-breakpoints.js';
import type { V2LanguageModel } from './provider.js';
import { buildProviderOptions, type ThinkingConfig } from './provider-options.js';

export interface RunUpstreamStreamInput {
  /** AI SDK language model handle (build via `buildAISdkProvider`). */
  model: V2LanguageModel;
  /** Conversation history in AI SDK's `ModelMessage` shape. */
  messages: ModelMessage[];
  /** Optional tool set — disabled by default during the migration. */
  tools?: ToolSet;
  /** RNG-style identifiers carried into emitted StreamChunks for replay. */
  runId?: string;
  agentId?: string;
  /** Abort signal forwarded to the AI SDK. */
  signal?: AbortSignal;
  /** Optional system prompt. */
  system?: string;
  /** Temperature / max tokens / top-p — pass-through to streamText. */
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  /**
   * Provider type — used to decide whether to apply Anthropic
   * prompt-cache breakpoints. Pass the OpenAWork-side identifier
   * (e.g. `'anthropic'`, `'openai'`, `'openrouter'`).
   */
  providerType?: string;
  /**
   * Optional thinking / reasoning configuration. When present we
   * derive AI SDK `providerOptions` automatically.
   */
  thinking?: ThinkingConfig;
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
    };
  }) => void;
}

export type RunUpstreamStreamEvent = StreamChunk;

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

interface RunnerState {
  runId?: string;
  agentId?: string;
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

  // Decorate the conversation with Anthropic prompt-cache breakpoints
  // when applicable. Noop for non-anthropic / non-openrouter providers.
  const decoratedMessages = applyAnthropicCacheBreakpoints(
    input.messages,
    input.providerType,
  );

  // Synthesise AI SDK providerOptions for thinking / reasoning when
  // a thinking config is provided. The model id used for the lookup
  // is recovered from the model handle when possible (AI SDK
  // V2/V3 expose `modelId`); fall back to the empty string otherwise
  // — buildProviderOptions only needs it for vendor-specific gating.
  const modelIdForOptions =
    'modelId' in input.model && typeof (input.model as { modelId?: unknown }).modelId === 'string'
      ? (input.model as { modelId: string }).modelId
      : '';
  const providerOptions = buildProviderOptions({
    ...(input.thinking ? { thinking: input.thinking } : {}),
    model: modelIdForOptions,
  });

  // `ai@5.x` types `streamText`'s model parameter as the V2 union, but
  // `@ai-sdk/openai-compatible@2.x` already emits V3 instances. Both
  // shapes are runtime-compatible; until the SDK aligns the type
  // surface we cast through `unknown` at this single boundary instead
  // of forcing every caller to do so.
  type StreamTextModelParam = Parameters<typeof streamText>[0]['model'];
  const result = streamText({
    model: input.model as unknown as StreamTextModelParam,
    messages: decoratedMessages,
    ...(input.tools ? { tools: input.tools } : {}),
    ...(input.system ? { system: input.system } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
    ...(typeof input.maxOutputTokens === 'number'
      ? { maxOutputTokens: input.maxOutputTokens }
      : {}),
    ...(typeof input.topP === 'number' ? { topP: input.topP } : {}),
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
        const itemId =
          'id' in part && typeof part.id === 'string' ? part.id : undefined;
        state.thinkingActive = true;
        state.thinkingItemId = itemId;
        yield {
          type: 'thinking_start',
          ...(itemId ? { itemId } : {}),
          ...meta({}),
        };
        break;
      }
      case 'reasoning-delta': {
        const itemId =
          'id' in part && typeof part.id === 'string' ? part.id : state.thinkingItemId;
        yield {
          type: 'thinking_delta',
          delta: part.text,
          ...(itemId ? { itemId } : {}),
          ...meta({}),
        };
        break;
      }
      case 'reasoning-end': {
        const itemId =
          'id' in part && typeof part.id === 'string' ? part.id : state.thinkingItemId;
        state.thinkingActive = false;
        state.thinkingItemId = undefined;
        yield {
          type: 'thinking_end',
          ...(itemId ? { itemId } : {}),
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
          'toolCallId' in part && typeof part.toolCallId === 'string'
            ? part.toolCallId
            : undefined;
        const toolName =
          ('toolName' in part && typeof part.toolName === 'string'
            ? part.toolName
            : undefined) ??
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
        if (!state.toolNamesById.has(callId)) {
          // No prior tool-input-start was emitted (legacy path);
          // register name + emit zero-length delta first so
          // downstream sees the binding before the JSON payload.
          state.toolNamesById.set(callId, toolName);
          yield {
            type: 'tool_call_delta',
            toolCallId: callId,
            toolName,
            inputDelta: '',
            ...meta({}),
          };
        }
        if (inputDelta.length > 0) {
          yield {
            type: 'tool_call_delta',
            toolCallId: callId,
            toolName,
            inputDelta,
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
        const errorChunk: StreamErrorChunk = {
          type: 'error',
          code: 'UPSTREAM_ERROR',
          message,
          ...meta({}),
        };
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
