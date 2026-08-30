/**
 * OpenCode LLM non-streaming generate wrapper — Phase A façade for
 * single-shot upstream calls (session title generation, conversation
 * compaction, multimodal look-at, etc.).
 *
 * Why this layer exists:
 *   - Most ad-hoc upstream calls in OpenAWork are simple
 *     request/response cycles that do not need StreamChunk plumbing.
 *     They previously rolled their own fetch + JSON parsing per
 *     protocol (chat_completions / responses / anthropic_messages).
 *   - OpenCode LLM's native protocol routes speak the supported upstream
 *     dialects through a single Effect service. This wrapper keeps the
 *     gateway's existing vendor-agnostic request shape.
 *
 * What it intentionally does NOT do:
 *   - Tool execution or streaming — those live in `./stream-runner.ts`
 *     and the legacy stream-model-round path.
 *   - OpenAI Responses API state continuation (`previous_response_id`)
 *     — tracked in PROGRESS.md as a Phase D follow-up.
 *
 * Phase C.3 additions:
 *   - Optional `thinking` config produces native `providerOptions`
 *     (Anthropic budget, OpenAI reasoningEffort, vendor-specific
 *     thinking toggles) without requiring callers to know the
 *     mapping.
 *   - Native cache hints are applied automatically when the upstream is
 *     anthropic / openrouter, so the upstream hits the prompt cache without
 *     callers touching native message parts.
 *   - Native provider options carry the model's thinking configuration and
 *     provider-specific headers through the same request object.
 */

import { normalizeTokenCount, type RequestOverrides } from '@openAwork/agent-core';
import type { Message, SystemPart } from '@openAwork/opencode-llm';
import { Effect, Layer, Option } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import { buildNativeModel } from './native-model.js';
import type { UpstreamProtocolKind } from './native-model.js';
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
   * gateway), callers should forward it here so the native provider
   * factory routes through the matching adapter instead of falling
   * back to `chat_completions` based on `providerType` alone.
   */
  upstreamProtocol?: UpstreamProtocolKind;
  /** Upstream API key, when applicable. */
  apiKey?: string;
  /** Upstream base URL — required for non-OpenAI vendors / proxies. */
  baseURL?: string;
  allowInsecureLocalhost?: boolean;
  openaiFastMode?: boolean;
  /** Optional headers (e.g. `OpenAI-Project`, `anthropic-version`). */
  headers?: Record<string, string>;
  /** Model identifier passed to the native OpenCode provider route. */
  model: string;
  sessionId?: string;
  /**
   * Optional system prompt(s). Supports a plain string (single prompt)
   * or an array of native system parts (multi-segment prompts).
   * When provided, these are passed via the native request's dedicated `system`
   * parameter rather than embedded in the `messages` array.
   */
  system?: string | SystemPart | SystemPart[];
  messages: ReadonlyArray<
    | Message
    | {
        readonly role: Message['role'];
        readonly content: OpenCodeLLM.Message.ContentInput;
      }
  >;
  /** Sampling parameters forwarded to the native generation options. */
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
   * derive native `providerOptions` automatically.
   */
  thinking?: ThinkingConfig;
  /** Abort signal forwarded to the native Effect runtime. */
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
  cacheReadTokens: number;
  cacheWriteTokens: number;
  finishReason: string;
  /** Raw native response — surfaced for callers that need provider metadata. */
  raw: UpstreamGenerateTextResult;
}

type UpstreamGenerateTextResult = OpenCodeLLM.LLMResponse;

const normalizeMessages = (
  messages: ReadonlyArray<
    | Message
    | {
        readonly role: Message['role'];
        readonly content: OpenCodeLLM.Message.ContentInput;
      }
  >,
): Message[] => messages.map((message) => OpenCodeLLM.Message.make(message));

export class UpstreamGenerateTimeoutError extends Error {
  override readonly name = 'UpstreamGenerateTimeoutError';

  constructor(timeoutMs: number) {
    super(`upstream generate timeout (${timeoutMs}ms)`);
  }
}

export class UpstreamGenerateAbortError extends Error {
  override readonly name = 'AbortError';

  constructor() {
    super('upstream generate aborted');
  }
}

function makeAbortSignalEffect(
  signal: AbortSignal,
): Effect.Effect<never, UpstreamGenerateAbortError> {
  return Effect.callback<never, UpstreamGenerateAbortError>((resume) => {
    const abort = () => resume(Effect.fail(new UpstreamGenerateAbortError()));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    return Effect.sync(() => signal.removeEventListener('abort', abort));
  });
}

export type RunUpstreamGenerateError =
  OpenCodeLLM.LLMError | UpstreamGenerateTimeoutError | UpstreamGenerateAbortError;

const nativeGenerateLayer = OpenCodeLLM.LLMClient.layer.pipe(
  Layer.provide(OpenCodeLLM.RequestExecutor.fetchLayer),
);

function buildGenerationOptions(
  input: RunUpstreamGenerateInput,
  omittedKeys: string[] | undefined,
): OpenCodeLLM.GenerationOptions | undefined {
  const options = {
    temperature:
      typeof input.temperature === 'number' && !shouldOmit(omittedKeys, 'temperature')
        ? input.temperature
        : undefined,
    maxTokens:
      typeof input.maxOutputTokens === 'number' &&
      !shouldOmit(omittedKeys, 'max_tokens', 'max_output_tokens', 'maxOutputTokens')
        ? input.maxOutputTokens
        : undefined,
    topP:
      typeof input.topP === 'number' && !shouldOmit(omittedKeys, 'top_p', 'topP')
        ? input.topP
        : undefined,
    frequencyPenalty:
      typeof input.frequencyPenalty === 'number' &&
      !shouldOmit(omittedKeys, 'frequency_penalty', 'frequencyPenalty')
        ? input.frequencyPenalty
        : undefined,
    presencePenalty:
      typeof input.presencePenalty === 'number' &&
      !shouldOmit(omittedKeys, 'presence_penalty', 'presencePenalty')
        ? input.presencePenalty
        : undefined,
  };
  return Object.values(options).some((value) => value !== undefined)
    ? new OpenCodeLLM.GenerationOptions(options)
    : undefined;
}

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
 * The native Effect request honours the caller signal but has no built-in
 * deadline, and a request-scoped signal only fires on client disconnect — not when
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
 * Drive a native OpenCode LLM generate request against the configured provider
 * and return the assistant text plus token usage.
 *
 * Throws on transport errors, upstream HTTP failures, or empty
 * responses — callers may decide whether to retry / fall back.
 */
export function runUpstreamGenerate(
  input: RunUpstreamGenerateInput,
): Effect.Effect<RunUpstreamGenerateResult, RunUpstreamGenerateError> {
  return Effect.gen(function* () {
    const omit = input.requestOverrides?.omitBodyKeys;

    const transformedMessages = applyProviderMessageTransforms(normalizeMessages(input.messages), {
      providerType: input.providerType,
      model: input.model,
    });

    const systemMessages: SystemPart[] =
      input.system === undefined
        ? []
        : (typeof input.system === 'string'
            ? [{ type: 'text', text: input.system }]
            : Array.isArray(input.system)
              ? input.system
              : [input.system]
          ).map((message) => ({
            ...message,
            type: 'text' as const,
            text: sanitizeSurrogates(message.text),
          }));
    const providerOptions = mergeProviderOptions(
      buildBaseProviderOptions({
        providerType: input.providerType,
        model: input.model,
        sessionId: input.sessionId,
        openaiFastMode: input.openaiFastMode,
      }),
      buildProviderOptions({
        ...(input.thinking ? { thinking: input.thinking } : {}),
        providerType: input.providerType,
        ...(input.upstreamProtocol ? { upstreamProtocol: input.upstreamProtocol } : {}),
        model: input.model,
      }),
    );

    const timeoutMs = input.timeoutMs ?? resolveUpstreamGenerateTimeoutMs();
    const generation = buildGenerationOptions(input, omit);
    const body = input.requestOverrides?.body;
    const headers = input.requestOverrides?.headers;
    const http =
      body === undefined && headers === undefined
        ? undefined
        : new OpenCodeLLM.HttpOptions({
            ...(body === undefined ? {} : { body }),
            ...(headers === undefined ? {} : { headers }),
          });
    const request = new OpenCodeLLM.LLMRequest({
      model: buildNativeModel(input),
      system: systemMessages,
      messages: transformedMessages,
      tools: [],
      ...(generation ? { generation } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      ...(http ? { http } : {}),
    });
    const generated = OpenCodeLLM.LLMClient.generate(request).pipe(
      Effect.provide(nativeGenerateLayer),
    );
    const effect =
      timeoutMs > 0
        ? generated.pipe(
            Effect.timeoutOption(`${timeoutMs} millis`),
            Effect.flatMap((value) =>
              Option.isSome(value)
                ? Effect.succeed(value.value)
                : Effect.fail(new UpstreamGenerateTimeoutError(timeoutMs)),
            ),
          )
        : generated;
    const result = yield* input.signal
      ? Effect.raceFirst(effect, makeAbortSignalEffect(input.signal))
      : effect;

    return {
      text: result.text,
      inputTokens: normalizeTokenCount(
        result.usage?.nonCachedInputTokens ?? result.usage?.inputTokens,
      ),
      outputTokens: normalizeTokenCount(result.usage?.outputTokens),
      cacheReadTokens: normalizeTokenCount(result.usage?.cacheReadInputTokens),
      cacheWriteTokens: normalizeTokenCount(result.usage?.cacheWriteInputTokens),
      finishReason: result.finishReason,
      raw: result,
    } satisfies RunUpstreamGenerateResult;
  });
}
