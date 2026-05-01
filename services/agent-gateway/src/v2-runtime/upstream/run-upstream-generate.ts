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
import { generateText, type GenerateTextResult, type ModelMessage, type ToolSet } from 'ai';
import { applyAnthropicCacheBreakpoints } from './cache-breakpoints.js';
import { buildAISdkProvider } from './provider.js';
import { buildProviderOptions, type ThinkingConfig } from './provider-options.js';

export interface RunUpstreamGenerateInput {
  /** OpenAWork-side provider type (`openai`, `anthropic`, `gemini`, ...). */
  providerType: string;
  /** Upstream API key, when applicable. */
  apiKey?: string;
  /** Upstream base URL — required for non-OpenAI vendors / proxies. */
  baseURL?: string;
  /** Optional headers (e.g. `OpenAI-Project`, `anthropic-version`). */
  headers?: Record<string, string>;
  /** Model identifier (passed straight to AI SDK `languageModel`). */
  model: string;
  /** Optional system prompt — short-circuited when empty. */
  system?: string;
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
}

export interface RunUpstreamGenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  /** Raw AI SDK result — surfaced for callers that need vendor-specific fields. */
  raw: GenerateTextResult<ToolSet, never>;
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

  // Decorate the conversation with Anthropic prompt-cache breakpoints
  // when applicable. This is a noop for non-anthropic providers.
  const decoratedMessages = applyAnthropicCacheBreakpoints(input.messages, input.providerType);

  const providerOptions = buildProviderOptions({
    ...(input.thinking ? { thinking: input.thinking } : {}),
    model: input.model,
  });

  // `ai@5.x` types `generateText`'s model parameter as the V2 union
  // while `@ai-sdk/openai-compatible@2.x` already emits V3 handles.
  // The shapes are runtime-compatible; cast through unknown at this
  // single boundary instead of forcing every caller to do so. Mirrors
  // the casting strategy in `./stream-runner.ts`.
  type GenerateTextModelParam = Parameters<typeof generateText>[0]['model'];

  const result = await generateText({
    model: model as unknown as GenerateTextModelParam,
    messages: decoratedMessages,
    ...(input.system ? { system: input.system } : {}),
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
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });

  return {
    text: result.text,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    finishReason: result.finishReason ?? 'unknown',
    raw: result,
  };
}
