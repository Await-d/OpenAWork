/**
 * OpenCode LLM stream runner — Phase 4 façade that turns OpenCode LLM
 * stream events into OpenAWork's `StreamChunk` taxonomy.
 *
 * The runner is intentionally minimal: `routes/stream-model-round.ts`
 * owns the outer multi-round agent loop, while this file is responsible
 * only for translating OpenCode LLM stream events into OpenAWork's existing
 * `StreamChunk` wire format.
 *
 * Why this layer exists:
 *   - opencode delegates protocol parsing to OpenCode LLM, gaining vendor
 *     coverage and saving thousands of lines of bespoke SSE handling.
 *   - OpenAWork needs to keep emitting the existing `StreamChunk` types
 *     to preserve the SSE wire format every web/mobile/desktop client
 *     already speaks. The runner bridges the two.
 *
 * Phase 4 scope (this file):
 *   - Map text deltas, reasoning deltas, tool input deltas onto
 *     `text_delta` / `thinking_*` / `tool_call_delta` chunks.
 *   - Emit a final `done` chunk with the OpenCode LLM finish reason.
 *   - Surface upstream errors via `error` chunks.
 *
 * Out of scope (deferred to follow-up Phase 4 work):
 *   - Real session_entry persistence (already covered by
 *     persistStreamChunkAsSessionEvents from the legacy path; reuse).
 *   - Provider-specific middleware (cache_control breakpoints,
 *     `previous_response_id`, anthropic-betas, thinking budgets).
 *   - Tool execution loop — OpenCode LLM invokes tools itself, so the
 *     legacy `tool-sandbox` integration moves to the new path later.
 *
 * Phase C.1 additions (this revision):
 *   - Track toolName per tool input id so tool-input-delta events
 *     emit a complete `StreamToolCallChunk` (OpenCode LLM only carries the
 *     name on `tool-input-start`).
 *   - Emit a zero-length `tool_call_delta` on `tool-input-start` to
 *     mirror the Anthropic `content_block_start type=tool_use`
 *     behavior the legacy parser produces.
 *   - Map `tool-error` and `abort` to `StreamErrorChunk` so the
 *     SSE consumer surfaces failures without waiting for a finish.
 */

import type { StreamChunk, StreamDoneChunk, StreamErrorChunk } from '@openAwork/shared';
import { resolveThinkingStyle } from '@openAwork/agent-core';
import type { RequestOverrides } from '@openAwork/agent-core';
import type { JSONValue, SharedV2ProviderOptions } from '@ai-sdk/provider';
import { jsonSchema, streamText, tool as defineTool } from 'ai';
import type { ModelMessage, SystemModelMessage, ToolSet } from './opencode-llm-compat.js';
import {
  applyCaching,
  applyCachingToSystemMessages,
  buildPromptCacheModelInfo,
} from './cache-breakpoints.js';
import { dispatchChatParams } from '../../runtime/plugin-host.js';
import type { V2LanguageModel } from './provider.js';
import {
  buildBaseProviderOptions,
  buildProviderOptions,
  buildProviderOptionsModelInfo,
  providerOptions,
  type ThinkingConfig,
  type ExtendedThinkingConfig,
} from './provider-options.js';
import { applyProviderMessageTransforms } from './message-transforms.js';
import { sanitizeSurrogates } from './message-transforms.js';

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
  /**
   * Idle (inter-chunk) wall-clock timeout in milliseconds. The AI SDK
   * `streamText` only honours `abortSignal`; it has no notion of a
   * stalled stream. When an upstream connects, emits a first chunk,
   * then stops producing data without closing the socket, the
   * `for await (fullStream)` loop would otherwise block forever. The
   * runner arms a watchdog that aborts the upstream and surfaces a
   * stable `STREAM_STALL` error if no chunk arrives within this window.
   * Each received chunk resets the timer. Pass `0` (or a non-finite
   * value) to disable. Defaults to `DEFAULT_STREAM_IDLE_TIMEOUT_MS`.
   */
  idleTimeoutMs?: number;
  /**
   * Optional system prompt(s). Supports a plain string (single prompt)
   * or an array of `SystemModelMessage` objects (multi-segment prompts
   * used for prompt-cache breakpoints). When provided, these are passed
   * via the AI SDK's dedicated `system` parameter rather than embedded
   * in the `messages` array, avoiding the SDK's security warning about
   * system messages in `messages`.
   */
  system?: string | SystemModelMessage | SystemModelMessage[];
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
  thinking?: ThinkingConfig | ExtendedThinkingConfig;
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
  /**
   * Optional observer for lightweight stream diagnostics. Called
   * synchronously as chunks are translated so the outer runtime can
   * distinguish "upstream streamed many deltas" from "upstream only
   * delivered a terminal event / error".
   */
  onDiagnostics?: (info: {
    textDeltaCount: number;
    reasoningDeltaCount: number;
    toolCallDeltaCount: number;
    sawDone: boolean;
    sawError: boolean;
    stalled: boolean;
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
  return Object.fromEntries(sortedEntries);
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

type ProviderOptionsRecord = SharedV2ProviderOptions;
type ProviderSettingsRecord = Record<string, JSONValue>;
type UpstreamStreamTextResult = ReturnType<typeof streamText<ToolSet>>;

function isRecord(value: unknown): value is ProviderSettingsRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDeep(
  target: ProviderSettingsRecord,
  source: ProviderSettingsRecord,
): ProviderSettingsRecord {
  const result: ProviderSettingsRecord = { ...target };
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
    const next: ProviderOptionsRecord = { ...acc };
    for (const [provider, settings] of Object.entries(item)) {
      const current = next[provider];
      next[provider] = current ? mergeDeep(current, settings) : settings;
    }
    return next;
  }, {});
  return Object.keys(merged).length > 0 ? merged : undefined;
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
   * Anthropic extended-thinking signature captured from a
   * `reasoning-delta` event. `@ai-sdk/anthropic` streams the block's
   * `signature_delta` as an empty-text `reasoning-delta` carrying
   * `providerMetadata.anthropic.signature` (Bedrock-hosted Claude
   * reuses the same shape under `.bedrock`) — the signature never
   * appears on `reasoning-end`. Captured here and forwarded on
   * reasoning-end so downstream accumulators can persist it for
   * multi-turn replay.
   */
  thinkingSignature?: string;
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
/**
 * Default idle (inter-chunk) timeout for streaming upstream calls.
 * Generous enough to absorb slow first tokens and long reasoning gaps
 * on large models, while still bounding a hung-but-open upstream
 * socket so the agent turn cannot wedge indefinitely.
 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 600_000;

/**
 * Wrap an async iterable with an inter-chunk (idle) deadline. If no value
 * arrives within `idleTimeoutMs`, `onStall` is invoked (used to abort the
 * upstream and release the hung socket), the source iterator is closed via
 * `return()`, and iteration ends gracefully so the caller can surface a
 * stable error. Each yielded value resets the timer. A non-finite or
 * non-positive timeout disables the watchdog (passes the source through).
 *
 * Exported for isolated unit testing — the production caller
 * (`runUpstreamStream`) wraps the AI SDK `fullStream` with it.
 */
/**
 * Close a source async-iterator without letting its `return()` escape or hang.
 * The idle watchdog calls this AFTER aborting the upstream, at which point the
 * AI SDK iterator's `return()` (or the abandoned pending `next()`) may reject
 * with the abort error or never settle. We race the close against a short
 * deadline and swallow any rejection so the watchdog always ends gracefully.
 */
const ITERATOR_CLOSE_TIMEOUT_MS = 5_000;
async function closeIteratorSafely<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (typeof iterator.return !== 'function') {
    return;
  }
  try {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ITERATOR_CLOSE_TIMEOUT_MS);
      timer.unref?.();
    });
    try {
      await Promise.race([
        Promise.resolve(iterator.return(undefined)).then(() => undefined),
        deadline,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    // `return()` rejected (commonly the upstream abort error) — already handled
    // by surfacing STREAM_STALL downstream; nothing to do here.
  }
}

export async function* withStreamIdleWatchdog<T>(
  source: AsyncIterable<T>,
  options: { idleTimeoutMs: number; onStall: () => void },
): AsyncGenerator<T> {
  const { idleTimeoutMs, onStall } = options;
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
    yield* source;
    return;
  }
  const iterator = source[Symbol.asyncIterator]();
  while (true) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const idlePromise = new Promise<'__idle__'>((resolve) => {
      timer = setTimeout(() => resolve('__idle__'), idleTimeoutMs);
      timer.unref?.();
    });
    let res: IteratorResult<T> | '__idle__';
    try {
      res = await Promise.race([iterator.next(), idlePromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res === '__idle__') {
      onStall();
      // Close the source iterator defensively: after `onStall` aborts the
      // upstream, the AI SDK iterator's `return()` (or the abandoned pending
      // `next()`) can REJECT with the abort error, or — for a misbehaving
      // adapter — never settle. An unguarded `await` here would either throw
      // the rejection out of this generator (escaping the `for await` in
      // `runUpstreamStream`, bypassing the stable STREAM_STALL chunk + `return
      // result`) or re-hang the very turn the watchdog exists to bound. Swallow
      // the rejection and cap the close with its own short deadline.
      await closeIteratorSafely(iterator);
      return;
    }
    if (res.done) return;
    yield res.value;
  }
}

export async function* runUpstreamStream(
  input: RunUpstreamStreamInput,
): AsyncGenerator<RunUpstreamStreamEvent, UpstreamStreamTextResult | undefined, void> {
  const state: RunnerState = {
    runId: input.runId,
    agentId: input.agentId,
    thinkingActive: false,
    toolNamesById: new Map<string, string>(),
    doneEmitted: false,
  };
  const diagnostics = {
    textDeltaCount: 0,
    reasoningDeltaCount: 0,
    toolCallDeltaCount: 0,
    sawDone: false,
    sawError: false,
    stalled: false,
  };
  const emitDiagnostics = (): void => {
    input.onDiagnostics?.({
      textDeltaCount: diagnostics.textDeltaCount,
      reasoningDeltaCount: diagnostics.reasoningDeltaCount,
      toolCallDeltaCount: diagnostics.toolCallDeltaCount,
      sawDone: diagnostics.sawDone,
      sawError: diagnostics.sawError,
      stalled: diagnostics.stalled,
    });
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
  const cacheModelInfo = buildPromptCacheModelInfo({
    providerType: input.providerType,
    model: modelIdForOptions,
  });
  const decoratedMessages = applyCaching(transformedMessages, cacheModelInfo);

  // Apply cache breakpoints to system messages passed via the dedicated
  // `system` parameter (when callers extract leading system messages from
  // the conversation). This preserves the multi-segment cache breakpoint
  // design (stable prefix + dynamic suffix) that previously worked when
  // system messages were embedded in the `messages` array.
  //
  // We also apply surrogate sanitisation to system message text content,
  // mirroring `applyProviderMessageTransforms` → `sanitizeAllTextContent`
  // for the `messages` array. Without this, lone UTF-16 surrogates in
  // system prompts could produce different serialised bytes across rounds
  // and silently invalidate Anthropic prompt cache prefixes.
  let decoratedSystem: typeof input.system = input.system;
  if (decoratedSystem && typeof decoratedSystem !== 'string') {
    const systemArray = Array.isArray(decoratedSystem) ? decoratedSystem : [decoratedSystem];
    const sanitizedSystem = systemArray.map((msg) =>
      typeof msg.content === 'string' ? { ...msg, content: sanitizeSurrogates(msg.content) } : msg,
    );
    decoratedSystem = applyCachingToSystemMessages(sanitizedSystem, cacheModelInfo);
  } else if (typeof decoratedSystem === 'string') {
    decoratedSystem = sanitizeSurrogates(decoratedSystem);
  }
  const omit = input.requestOverrides?.omitBodyKeys;

  // 调试日志：检查 thinking 配置
  if (input.thinking) {
    const isExtendedConfig = 'config' in input.thinking;
    if (isExtendedConfig) {
      // ExtendedThinkingConfig
      console.log('[DEBUG] stream-runner thinking 配置 (ExtendedThinkingConfig):', {
        providerType: input.thinking.providerType,
        modelId: modelIdForOptions,
        config: input.thinking.config,
        effort: input.thinking.effort,
        supportsThinking: input.thinking.supportsThinking,
      });
    } else {
      // ThinkingConfig
      console.log('[DEBUG] stream-runner thinking 配置 (ThinkingConfig):', {
        providerType: input.providerType,
        modelId: modelIdForOptions,
        config: input.thinking,
      });
    }
  }

  const thinkingProviderOptions = buildProviderOptions({
    ...(input.thinking ? { thinking: input.thinking } : {}),
    model: modelIdForOptions,
  });

  // 调试日志：检查生成的 providerOptions
  if (thinkingProviderOptions) {
    console.log('[DEBUG] 生成的 thinking providerOptions:', JSON.stringify(thinkingProviderOptions, null, 2));
  } else if (input.thinking) {
    console.warn('[WARN] thinking 配置存在但未生成 providerOptions');
  }

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
    thinkingProviderOptions,
  );

  // 调试日志：检查最终合并的 providerOptions
  if (providerOptions) {
    console.log('[DEBUG] 最终合并的 providerOptions:', JSON.stringify(providerOptions, null, 2));
  } else {
    console.log('[DEBUG] 最终 providerOptions 为空');
  }
  let temperature = input.requestOverrides?.temperature ?? input.temperature;
  let maxOutputTokens = input.requestOverrides?.maxTokens ?? input.maxOutputTokens;
  let topP = input.requestOverrides?.topP ?? input.topP;
  let frequencyPenalty = input.requestOverrides?.frequencyPenalty ?? input.frequencyPenalty;
  let presencePenalty = input.requestOverrides?.presencePenalty ?? input.presencePenalty;

  // MiMo / Moonshot（body_thinking_type 风格）在思考模式下会强制锁定
  // temperature=1.0 / top_p=0.95，发送自定义值无意义且部分代理可能因参数
  // 冲突导致首次请求失败触发 AI SDK 自动重试。在思考启用时主动省略这些
  // 采样参数，减少不必要的请求体体积和潜在冲突。
  // 通过 resolveThinkingStyle 判断（含 modelId 推断），覆盖用户通过 OpenAI
  // 兼容代理使用 MiMo/Moonshot 模型的场景。不检查 supportsThinking，因为
  // 该字段在代理场景下可能为 false（modelConfig 找不到），但 modelId 推断
  // 仍能识别出真实厂商。
  if (input.thinking) {
    const isExtendedConfig = 'config' in input.thinking;
    const thinkingConfig = isExtendedConfig ? input.thinking.config : input.thinking;
    const isThinkingEnabled = thinkingConfig.type === 'enabled' || thinkingConfig.type === 'adaptive';

    if (isThinkingEnabled) {
      const style = resolveThinkingStyle(input.providerType ?? '', modelIdForOptions);
      if (style === 'body_thinking_type') {
        temperature = undefined;
        topP = undefined;
        frequencyPenalty = undefined;
        presencePenalty = undefined;
      }
    }
  }

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
    ? { _noop: NOOP_TOOL_DEFINITION }
    : sortedIncomingTools;
  const toolNameLookup = new Map<string, string>();
  if (effectiveTools) {
    for (const name of Object.keys(effectiveTools)) {
      toolNameLookup.set(name.toLowerCase(), name);
    }
  }

  // Idle (inter-chunk) watchdog: combine the caller signal with an
  // internal controller so a stalled-but-open upstream socket can be
  // aborted even when the client never disconnects.
  const idleController = new AbortController();

  const result = streamText({
    model: input.model,
    messages: decoratedMessages,
    ...(decoratedSystem ? { system: decoratedSystem } : {}),
    ...(effectiveTools ? { tools: effectiveTools } : {}),
    ...(typeof temperature === 'number' && !shouldOmit(omit, 'temperature')
      ? { temperature }
      : {}),
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
    ...(providerOptions ? { providerOptions } : {}),
    ...(input.signal ? { abortSignal: input.signal } : {}),
    ...(typeof input.maxRetries === 'number' ? { maxRetries: input.maxRetries } : {}),
  });

  const meta = (extra: Record<string, unknown>) => ({
    ...(state.runId ? { runId: state.runId } : {}),
    ...(state.agentId ? { agentId: state.agentId } : {}),
    occurredAt: Date.now(),
    ...extra,
  });

  const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  const stallState = { stalled: false };

  for await (const part of withStreamIdleWatchdog(result.fullStream, {
    idleTimeoutMs,
    onStall: () => {
      stallState.stalled = true;
      idleController.abort();
    },
  })) {
    switch (part.type) {
      case 'text-delta':
        diagnostics.textDeltaCount += 1;
        emitDiagnostics();
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
          { reasoningEncryptedContent?: unknown; itemId?: unknown } | undefined;
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
        diagnostics.reasoningDeltaCount += 1;
        emitDiagnostics();
        const itemId = 'id' in part && typeof part.id === 'string' ? part.id : state.thinkingItemId;
        // Anthropic extended-thinking streams the block's signature as a
        // *separate*, empty-text `reasoning-delta` event (mirroring the
        // native `signature_delta` content block delta) rather than on
        // `reasoning-end`. Capture it here so the eventual reasoning-end
        // emit can forward it downstream — without this the signature is
        // silently dropped and replayed thinking blocks fail Anthropic's
        // "unsupported reasoning metadata" validation on the next turn.
        const deltaPmd = (part as { providerMetadata?: Record<string, unknown> }).providerMetadata;
        const deltaSignatureSource = (deltaPmd?.['anthropic'] ?? deltaPmd?.['bedrock']) as
          { signature?: unknown } | undefined;
        if (
          typeof deltaSignatureSource?.signature === 'string' &&
          deltaSignatureSource.signature.length > 0
        ) {
          state.thinkingSignature = deltaSignatureSource.signature;
        }
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
        // Anthropic extended thinking may attach the per-block signature
        // here via providerMetadata.anthropic.signature (Bedrock-hosted
        // Claude reuses the same shape under .bedrock) on some adapter
        // versions; on the currently-vendored @ai-sdk/anthropic it instead
        // arrives on a `reasoning-delta` event (captured into
        // `state.thinkingSignature` above). Prefer the delta-captured
        // value and fall back to an end-carried one for forward/backward
        // compatibility with adapter versions that differ.
        const pmd = (part as { providerMetadata?: Record<string, unknown> }).providerMetadata;
        const anthropicMeta = (pmd?.['anthropic'] ?? pmd?.['bedrock']) as
          { signature?: unknown } | undefined;
        const endSignature =
          typeof anthropicMeta?.signature === 'string' && anthropicMeta.signature.length > 0
            ? anthropicMeta.signature
            : undefined;
        const signature = state.thinkingSignature ?? endSignature;
        state.thinkingSignature = undefined;
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
        if (!callId || !toolName) break;
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
        diagnostics.toolCallDeltaCount += 1;
        emitDiagnostics();
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
        // Skip deltas for tool calls that had no resolvable name — the
        // opener (tool-input-start) was already dropped for this callId,
        // so yielding here would emit a delta with an empty toolName.
        if (!toolName) break;
        yield {
          type: 'tool_call_delta',
          toolCallId: callId,
          toolName,
          inputDelta: part.delta ?? '',
          ...meta({}),
        };
        diagnostics.toolCallDeltaCount += 1;
        emitDiagnostics();
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
        if (!callId || !toolName) break;
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
          diagnostics.toolCallDeltaCount += 1;
          emitDiagnostics();
          if (inputDelta.length > 0) {
            yield {
              type: 'tool_call_delta',
              toolCallId: callId,
              toolName,
              inputDelta,
              ...meta({}),
            };
            diagnostics.toolCallDeltaCount += 1;
            emitDiagnostics();
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
          diagnostics.toolCallDeltaCount += 1;
          emitDiagnostics();
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
        diagnostics.sawError = true;
        emitDiagnostics();
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
        diagnostics.sawError = true;
        emitDiagnostics();
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
        diagnostics.sawDone = true;
        emitDiagnostics();
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
        diagnostics.sawError = true;
        emitDiagnostics();
        yield errorChunk;
        break;
      }
      default:
        // Unknown / vendor-specific events are ignored deliberately.
        // The caller only relies on the normalized StreamChunk surface.
        break;
    }
  }

  if (stallState.stalled) {
    diagnostics.stalled = true;
    diagnostics.sawError = true;
    emitDiagnostics();
    const stallChunk = {
      type: 'error' as const,
      code: 'STREAM_STALL',
      status: 504,
      message: `upstream stream stalled (no data for ${idleTimeoutMs}ms)`,
      ...meta({}),
    } as StreamErrorChunk;
    yield stallChunk;
  }

  return result;
}
