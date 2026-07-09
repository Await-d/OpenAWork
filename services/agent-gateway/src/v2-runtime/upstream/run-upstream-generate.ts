/**
 * AI SDK non-streaming generateText wrapper — Phase A façade for
 * single-shot upstream calls (session title generation, conversation
 * compaction, multimodal look-at, etc.).
 *
 * Why this layer exists:
 *   - Most ad-hoc upstream calls in OpenAWork are simple
 *     request/response cycles that do not need StreamChunk plumbing.
 *     They previously rolled their own fetch + JSON parsing per
 *     protocol (chat_completions / responses / anthropic_messages).
 *   - Vercel AI SDK's `generateText` already speaks all three
 *     dialects through the provider factory in `./provider.ts`. This
 *     wrapper unifies callers behind a single, vendor-agnostic API.
 *
 * What it intentionally does NOT do:
 *   - Tool execution or streaming — those live in `./stream-runner.ts`
 *     and the legacy stream-model-round path.
 *   - OpenAI Responses API state continuation (`previous_response_id`)
 *     — requires `@ai-sdk/openai`, tracked in PROGRESS.md as a Phase D
 *     follow-up.
 *
 * Phase C.3 additions:
 *   - Optional `thinking` config produces AI SDK `providerOptions`
 *     (Anthropic budget, OpenAI reasoningEffort, vendor-specific
 *     thinking toggles) without requiring callers to know the
 *     mapping.
 *   - Anthropic `cache_control` breakpoints are applied automatically
 *     when the upstream is anthropic / openrouter, so the upstream
 *     hits the prompt cache without callers touching ModelMessages.
 *   - The Anthropic provider factory now derives `anthropic-beta`
 *     headers from `model` + `supportsThinking` (see `./provider.ts`),
 *     so callers can opt-into interleaved-thinking by setting
 *     `thinking.supportsThinking = true`.
 */

import type { RequestOverrides } from '@openAwork/agent-core';
import { generateText, type ModelMessage, type SystemModelMessage, type ToolSet } from 'ai';
import {
  applyCaching,
  applyCachingToSystemMessages,
  buildPromptCacheModelInfo,
} from './cache-breakpoints.js';
import { buildAISdkProvider, type UpstreamProtocolKind } from './provider.js';
import {
  buildBaseProviderOptions,
  buildProviderOptions,
  mergeProviderOptions,
  type ThinkingConfig,
} from './provider-options.js';
import { applyProviderMessageTransforms } from './message-transforms.js';
import { sanitizeSurrogates } from './message-transforms.js';

export interface RunUpstreamGenerateInput {
  /** OpenAWork-side provider type (`openai`, `anthropic`, `gemini`, ...). */
  providerType: string;
  /**
   * Per-provider explicit upstream protocol override. When the user
   * has configured a provider with a specific `upstreamProtocol`
   * (e.g. `'responses'` for an OpenAI-compatible relay that exposes
   * `/responses`, or `'anthropic_messages'` for an Anthropic-shaped
   * gateway), callers should forward it here so the AI SDK provider
   * factory routes through the matching adapter instead of falling
   * back to `chat_completions` based on `providerType` alone.
   */
  upstreamProtocol?: UpstreamProtocolKind;
  /** Upstream API key, when applicable. */
  apiKey?: string;
  /** Upstream base URL — required for non-OpenAI vendors / proxies. */
  baseURL?: string;
  /** Optional headers (e.g. `OpenAI-Project`, `anthropic-version`). */
  headers?: Record<string, string>;
  /** Model identifier (passed straight to AI SDK `languageModel`). */
  model: string;
  sessionId?: string;
  /**
   * Optional system prompt(s). Supports a plain string (single prompt)
   * or an array of `SystemModelMessage` objects (multi-segment prompts).
   * When provided, these are passed via the AI SDK's dedicated `system`
   * parameter rather than embedded in the `messages` array.
   */
  system?: string | SystemModelMessage | SystemModelMessage[];
  /** Conversation history in AI SDK ModelMessage shape. */
  messages: ModelMessage[];
  /** Sampling parameters — pass-through to `generateText`. */
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  /**
   * OpenAWork `RequestOverrides` — only `omitBodyKeys` is honored to
   * suppress incompatible params (e.g. GPT-5 family rejects
   * `temperature`). Vendor-specific `body` extras still need to be
   * passed via `providerOptions` (use `buildProviderOptions`).
   */
  requestOverrides?: RequestOverrides;
  /**
   * Optional thinking / reasoning configuration. When present we
   * derive AI SDK `providerOptions` automatically.
   */
  thinking?: ThinkingConfig;
  /** Abort signal forwarded to the AI SDK. */
  signal?: AbortSignal;
  /**
   * Optional wall-clock timeout (ms) for this single generate call, combined
   * with `signal` via `AbortSignal.any`. Defaults to
   * `DEFAULT_UPSTREAM_GENERATE_TIMEOUT_MS` (env-overridable); pass `<=0` to
   * disable the intrinsic backstop. Callers that already supply their own,
   * tighter deadline can leave this unset — whichever signal fires first wins.
   */
  timeoutMs?: number;
}

export interface RunUpstreamGenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  /** Raw AI SDK result — surfaced for callers that need vendor-specific fields. */
  raw: UpstreamGenerateTextResult;
}

type UpstreamGenerateTextResult = Awaited<ReturnType<typeof generateText<ToolSet>>>;

/**
 * Resolve which params should be omitted given OpenAWork
 * `requestOverrides.omitBodyKeys`. The list uses upstream wire-format
 * names (e.g. `temperature`, `max_tokens`, `top_p`); we map them to AI
 * SDK option keys here so callers do not need to reason about both
 * naming surfaces.
 */
function shouldOmit(upstreamKeys: string[] | undefined, ...candidates: string[]): boolean {
  if (!upstreamKeys || upstreamKeys.length === 0) return false;
  return candidates.some((k) => upstreamKeys.includes(k));
}

/**
 * Intrinsic wall-clock backstop for a single non-streaming upstream call. The
 * AI SDK `generateText` honours `abortSignal` but has NO built-in deadline, and
 * a caller's request-scoped signal only fires on client disconnect — not when
 * an upstream socket connects-but-hangs. The streaming sibling
 * `runUpstreamStream` already bounds that with an idle watchdog; this gives the
 * non-streaming path an equivalent floor so a forgetful / future caller cannot
 * leave a half-open upstream call pending forever. Generous by default so it
 * never pre-empts the tighter per-caller deadlines (compaction 120s, title 15s,
 * connectivity 20s, ...) — `AbortSignal.any` means whichever fires first wins.
 * Override via `OPENAWORK_UPSTREAM_GENERATE_TIMEOUT_MS`; `<=0` disables.
 */
const DEFAULT_UPSTREAM_GENERATE_TIMEOUT_MS = 180_000;
function resolveUpstreamGenerateTimeoutMs(): number {
  const raw = globalThis.process?.env?.['OPENAWORK_UPSTREAM_GENERATE_TIMEOUT_MS'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_UPSTREAM_GENERATE_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/**
 * Drive an AI SDK `generateText` call against the configured provider
 * and return the assistant text plus token usage.
 *
 * Throws on transport errors, upstream HTTP failures, or empty
 * responses — callers may decide whether to retry / fall back.
 */
export async function runUpstreamGenerate(
  input: RunUpstreamGenerateInput,
): Promise<RunUpstreamGenerateResult> {
  const provider = buildAISdkProvider({
    providerType: input.providerType,
    ...(input.upstreamProtocol ? { upstreamProtocol: input.upstreamProtocol } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
    model: input.model,
    ...(typeof input.thinking?.supportsThinking === 'boolean'
      ? { supportsThinking: input.thinking.supportsThinking }
      : {}),
  });
  const model = provider.languageModel(input.model);

  const omit = input.requestOverrides?.omitBodyKeys;

  const transformedMessages = applyProviderMessageTransforms(input.messages, {
    providerType: input.providerType,
    model: input.model,
  });

  // Decorate the conversation with prompt-cache breakpoints when applicable.
  const cacheModelInfo = buildPromptCacheModelInfo({
    providerType: input.providerType,
    model: input.model,
  });
  const decoratedMessages = applyCaching(transformedMessages, cacheModelInfo);

  // Apply cache breakpoints to system messages passed via the dedicated
  // `system` parameter, mirroring the stream-runner path. Also apply
  // surrogate sanitisation to system text content to match
  // `applyProviderMessageTransforms` → `sanitizeAllTextContent`.
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

  const providerOptions = mergeProviderOptions(
    buildBaseProviderOptions({
      providerType: input.providerType,
      model: input.model,
      sessionId: input.sessionId,
    }),
    buildProviderOptions({
      ...(input.thinking ? { thinking: input.thinking } : {}),
      model: input.model,
    }),
  );

  // `ai@5.x` types `generateText`'s model parameter as the V2 union
  // while `@ai-sdk/openai-compatible@2.x` already emits V3 handles.
  // The shapes are runtime-compatible; cast through unknown at this
  // single boundary instead of forcing every caller to do so. Mirrors
  // the casting strategy in `./stream-runner.ts`.
  type GenerateTextModelParam = Parameters<typeof generateText>[0]['model'];

  // Intrinsic wall-clock backstop (combined with any caller signal). See
  // DEFAULT_UPSTREAM_GENERATE_TIMEOUT_MS — bounds a connects-but-hangs upstream
  // even when the caller forgot to supply its own deadline.
  const timeoutMs = input.timeoutMs ?? resolveUpstreamGenerateTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let effectiveSignal: AbortSignal | undefined = input.signal;
  if (timeoutMs > 0) {
    const timeoutController = new AbortController();
    timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);
    timer.unref?.();
    effectiveSignal = input.signal
      ? AbortSignal.any([timeoutController.signal, input.signal])
      : timeoutController.signal;
  }

  let result: UpstreamGenerateTextResult;
  try {
    result = await generateText({
      model: model as unknown as GenerateTextModelParam,
      messages: decoratedMessages,
      // Allow system messages that may appear mid-conversation (from
      // persisted session history) to pass through without triggering
      // the SDK's security warning. Callers pass system prompts via the
      // dedicated `system` parameter; this covers residual system
      // messages in historical turns.
      allowSystemInMessages: true,
      ...(decoratedSystem ? { system: decoratedSystem } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(typeof input.temperature === 'number' && !shouldOmit(omit, 'temperature')
        ? { temperature: input.temperature }
        : {}),
      ...(typeof input.maxOutputTokens === 'number' &&
      !shouldOmit(omit, 'max_tokens', 'max_output_tokens', 'maxOutputTokens')
        ? { maxOutputTokens: input.maxOutputTokens }
        : {}),
      ...(typeof input.topP === 'number' && !shouldOmit(omit, 'top_p', 'topP')
        ? { topP: input.topP }
        : {}),
      ...(typeof input.frequencyPenalty === 'number' &&
      !shouldOmit(omit, 'frequency_penalty', 'frequencyPenalty')
        ? { frequencyPenalty: input.frequencyPenalty }
        : {}),
      ...(typeof input.presencePenalty === 'number' &&
      !shouldOmit(omit, 'presence_penalty', 'presencePenalty')
        ? { presencePenalty: input.presencePenalty }
        : {}),
      ...(effectiveSignal ? { abortSignal: effectiveSignal } : {}),
      // 团队层级调用（PM1/PM2）有自己的 callLlmWithRetry 做限流感知重试，
      // AI SDK 默认 maxRetries=2 会在限流时快速重试加剧 429。
      // 传 maxRetries: 0 让上层控制重试节奏。
      maxRetries: 0,
    });
  } catch (err) {
    if (timedOut) {
      throw new Error(`upstream generate timeout (${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  return {
    text: result.text,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    finishReason: result.finishReason ?? 'unknown',
    raw: result,
  };
}
