/**
 * AI SDK provider factory — translates OpenAWork's `AIProvider` config
 * (the wire-format the gateway already stores per channel/agent) into
 * Vercel AI SDK provider instances that emit `LanguageModelV1`s suitable
 * for `streamText`.
 *
 * Runtime status:
 *   - The factory is now on the production chat path through
 *     `routes/stream-model-round.ts` → `runUpstreamStream(...)`.
 *   - `routes/stream-model-round.ts` still owns the outer agent loop
 *     (tool dispatch, persistence, multi-round continuation); this file
 *     only resolves the upstream AI SDK adapter and protocol surface.
 *
 * Coverage today:
 *   - `anthropic`            → @ai-sdk/anthropic
 *   - `openai`-compatible    → @ai-sdk/openai-compatible (covers OpenAI,
 *                              Azure, Moonshot, DeepSeek, OpenRouter,
 *                              Qwen, ...; everything that talks the
 *                              OpenAI Chat Completions API).
 *   - other vendor-specific protocols (Gemini native, Bedrock, Vertex)
 *     fall back to OpenAI-compatible when the upstream URL exposes one.
 *
 * Each provider is a small, dependency-injected factory rather than a
 * singleton so callers can hot-swap api keys, base URLs, and headers
 * without leaking state across users.
 */

import {
  createOpenAICompatible,
  type OpenAICompatibleProviderSettings,
} from '@ai-sdk/openai-compatible';
import { createAnthropic, type AnthropicProviderSettings } from '@ai-sdk/anthropic';
import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai';
import { buildAnthropicBetas, formatAnthropicBetaHeader } from '../../provider/anthropic-betas.js';

/**
 * Cross-version `LanguageModel` alias.
 *
 * `ai@5.x` still pins its top-level `LanguageModel` to `LanguageModelV2`,
 * while `@ai-sdk/openai-compatible@2.x` now returns the newer V3 shape.
 * Until the AI SDK unifies the type surface we infer the return type
 * directly from the adapter so callers see a future-proof handle without
 * having to chase upstream type bumps.
 */
type AnthropicLanguageModel = ReturnType<ReturnType<typeof createAnthropic>['languageModel']>;
type OpenAICompatibleLanguageModel = ReturnType<
  ReturnType<typeof createOpenAICompatible>['languageModel']
>;
type OpenAIResponsesLanguageModel = ReturnType<ReturnType<typeof createOpenAI>['responses']>;
// All three SDK adapters currently resolve to the same
// `LanguageModelV3` shape. We collapse the union to a single alias
// (so ESLint's `no-duplicate-type-constituents` rule stays clean) but
// keep the per-vendor aliases above as documentation for the day a
// future SDK bump diverges them again.
export type V2LanguageModel = AnthropicLanguageModel;
// Touch the per-vendor aliases so the build does not flag them as
// unused while we wait for the SDK shapes to diverge again.
export type _OpenAICompatibleLanguageModel = OpenAICompatibleLanguageModel;
export type _OpenAIResponsesLanguageModel = OpenAIResponsesLanguageModel;

export type UpstreamProtocolKind = 'anthropic_messages' | 'chat_completions' | 'responses';

/**
 * Minimal config the v2 stack needs to build an AI SDK provider. Sourced
 * from the legacy `AIProvider` config one-to-one — the field names match
 * `agent-core`'s shape so adapters can pass values straight through.
 */
export interface AISdkProviderConfig {
  /** OpenAWork-side provider type (used to pick the right SDK). */
  providerType: string;
  /** Upstream API key, when applicable. */
  apiKey?: string;
  /** Upstream base URL (for OpenAI-compatible vendors / proxies). */
  baseURL?: string;
  /** Optional headers (e.g. `anthropic-beta`, `OpenAI-Project`). */
  headers?: Record<string, string>;
  /** Free-form short label used by AI SDK telemetry & errors. */
  name?: string;
  /**
   * Optional model id used to compute provider-specific headers
   * (e.g. `anthropic-beta` membership depends on whether the model
   * supports thinking / interleaved-thinking). When omitted the
   * factory falls back to baseline beta headers only.
   */
  model?: string;
  /**
   * Whether the upstream model supports extended thinking. Forwarded
   * to `buildAnthropicBetas` to opt-into `interleaved-thinking-*` /
   * `fine-grained-tool-streaming-*` headers.
   */
  supportsThinking?: boolean;
  /**
   * Per-provider explicit upstream protocol override. When set to
   * `'responses'`, the factory routes through `@ai-sdk/openai`'s
   * Responses API (`/responses`). When omitted, the factory falls
   * back to the protocol implied by `providerType`.
   */
  upstreamProtocol?: UpstreamProtocolKind;
}

export interface BuiltAISdkProvider {
  /** The protocol the legacy config expects this provider to speak. */
  protocol: UpstreamProtocolKind;
  /** Resolve an AI SDK language model handle for the requested model id. */
  languageModel(modelId: string): V2LanguageModel;
}

/**
 * Compose the `anthropic-beta` header value for a given model.
 *
 * Mirrors `getAllModelBetas` in claude-code: emits the baseline
 * `prompt-caching-scope` header for every request, opts into
 * `interleaved-thinking` / `fine-grained-tool-streaming` for thinking
 * models that aren't Haiku, and appends user-provided overrides from
 * `process.env.ANTHROPIC_BETAS`. The merged value replaces any
 * caller-provided `anthropic-beta` so we always end up with a
 * canonical, deduplicated list.
 */
function composeAnthropicHeaders(config: AISdkProviderConfig): Record<string, string> {
  const headers = { ...(config.headers ?? {}) };
  // Drop any case-variant the caller may have set; we will rewrite.
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'anthropic-beta') {
      delete headers[key];
    }
  }

  const betas = buildAnthropicBetas({
    model: config.model ?? '',
    ...(typeof config.supportsThinking === 'boolean'
      ? { supportsThinking: config.supportsThinking }
      : {}),
  });
  if (betas.length > 0) {
    headers['anthropic-beta'] = formatAnthropicBetaHeader(betas);
  }
  return headers;
}

function buildAnthropic(config: AISdkProviderConfig): BuiltAISdkProvider {
  const headers = composeAnthropicHeaders(config);
  const settings: AnthropicProviderSettings = {
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(config.name ? { name: config.name } : {}),
  };
  const provider = createAnthropic(settings);
  return {
    protocol: 'anthropic_messages',
    languageModel: (modelId) => provider.languageModel(modelId),
  };
}

function buildOpenAICompatible(config: AISdkProviderConfig): BuiltAISdkProvider {
  const settings: OpenAICompatibleProviderSettings = {
    name: config.name ?? config.providerType,
    // Always request `stream_options.include_usage: true` so the
    // upstream emits a final usage chunk on the SSE wire. OpenAWork
    // depends on this for monthly usage accounting and cost
    // reporting; without it the chat-completions provider would
    // silently drop tokens for streaming requests.
    includeUsage: true,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.baseURL ? { baseURL: config.baseURL } : { baseURL: 'https://api.openai.com/v1' }),
    ...(config.headers ? { headers: config.headers } : {}),
  };
  const provider = createOpenAICompatible(settings);
  return {
    protocol: 'chat_completions',
    languageModel: (modelId) => provider.languageModel(modelId),
  };
}

function buildOpenAIResponses(config: AISdkProviderConfig): BuiltAISdkProvider {
  const settings: OpenAIProviderSettings = {
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.headers ? { headers: config.headers } : {}),
    ...(config.name ? { name: config.name } : {}),
  };
  const provider = createOpenAI(settings);
  return {
    protocol: 'responses',
    languageModel: (modelId) => provider.responses(modelId),
  };
}

/**
 * Build an AI SDK provider from an OpenAWork `AIProvider` config.
 *
 * The factory is intentionally forgiving: any unrecognised
 * `providerType` falls back to OpenAI-compatible, which covers every
 * vendor in OpenAWork's catalogue today (they all expose a Chat
 * Completions surface). Vendor-specific quirks (thinking budgets,
 * `previous_response_id`, cache breakpoints) are layered on at the
 * stream-runner level via AI SDK middleware, not here.
 */
export function buildAISdkProvider(config: AISdkProviderConfig): BuiltAISdkProvider {
  const kind = config.providerType.toLowerCase();
  if (kind === 'anthropic' || kind === 'claude') {
    return buildAnthropic(config);
  }
  // Honour explicit Responses protocol override even on non-OpenAI
  // provider types: any OpenAI-compatible relay that exposes a
  // `/responses` endpoint can be reached via `@ai-sdk/openai` once
  // the user explicitly opts in.
  if (config.upstreamProtocol === 'responses') {
    return buildOpenAIResponses(config);
  }
  return buildOpenAICompatible(config);
}
