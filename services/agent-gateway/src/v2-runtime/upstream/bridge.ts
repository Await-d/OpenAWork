/**
 * Bridge — translate OpenAWork's `AIProvider` (the wire-format the
 * gateway already stores per channel/agent) into the inputs that the
 * Phase 4 AI SDK provider factory needs.
 *
 * The bridge is intentionally pure: no I/O, no global state, no
 * preferences cached anywhere. Callers feed in the legacy config and
 * receive a ready-to-call `BuiltAISdkProvider` plus a metadata bag
 * describing how upstream traffic should be shaped (protocol, the
 * relevant `RequestOverrides`, headers, etc.).
 *
 * Today no production path consumes this bridge — it exists to give
 * follow-up work (the `OPENAWORK_RUNTIME_UPSTREAM=v2` switch in
 * `routes/stream-model-round.ts`) a one-liner to swap to the v2 stack
 * without re-implementing provider plumbing.
 */

import type { AIProvider, RequestOverrides } from '@openAwork/agent-core';
import {
  buildAISdkProvider,
  type AISdkProviderConfig,
  type BuiltAISdkProvider,
  type UpstreamProtocolKind,
} from './provider.js';

export interface BridgeBuildInput {
  provider: AIProvider;
  /**
   * Optional model-level overrides — combined with the provider-level
   * `requestOverrides` so callers do not have to merge them by hand.
   */
  modelOverrides?: RequestOverrides;
  /** Inject extra HTTP headers on top of the provider config. */
  extraHeaders?: Record<string, string>;
  /**
   * Model id the caller intends to invoke. Forwarded to the provider
   * factory so vendor-specific headers (notably `anthropic-beta`) can
   * be derived from the model name + capability flags.
   */
  model?: string;
  /**
   * Whether the upstream model supports extended thinking. Used by
   * the Anthropic provider factory to opt-into
   * `interleaved-thinking-*` / `fine-grained-tool-streaming-*` betas.
   */
  supportsThinking?: boolean;
}

export interface BridgeBuildResult {
  /** The AI SDK provider — call `.languageModel(modelId)` to get a model. */
  built: BuiltAISdkProvider;
  /** Final HTTP base URL passed to the SDK. */
  baseURL: string | undefined;
  /** Final upstream protocol (after honouring `upstreamProtocol` override). */
  protocol: UpstreamProtocolKind;
  /**
   * Merged `RequestOverrides` (model takes precedence over provider).
   * Forward this to the stream runner / middleware layer rather than
   * re-merging in every caller.
   */
  requestOverrides: RequestOverrides;
}

const ANTHROPIC_PROVIDER_TYPES: ReadonlySet<string> = new Set(['anthropic']);

function mergeOverrides(
  base: RequestOverrides | undefined,
  override: RequestOverrides | undefined,
): RequestOverrides {
  if (!base && !override) return {};
  const merged: RequestOverrides = { ...(base ?? {}), ...(override ?? {}) };
  if (base?.headers || override?.headers) {
    merged.headers = { ...(base?.headers ?? {}), ...(override?.headers ?? {}) };
  }
  if (base?.body || override?.body) {
    merged.body = { ...(base?.body ?? {}), ...(override?.body ?? {}) };
  }
  if (base?.omitBodyKeys || override?.omitBodyKeys) {
    merged.omitBodyKeys = [
      ...new Set([...(base?.omitBodyKeys ?? []), ...(override?.omitBodyKeys ?? [])]),
    ];
  }
  return merged;
}

function pickProtocol(provider: AIProvider): UpstreamProtocolKind {
  if (provider.upstreamProtocol) return provider.upstreamProtocol;
  if (ANTHROPIC_PROVIDER_TYPES.has(provider.type)) return 'anthropic_messages';
  // Every remaining vendor exposes an OpenAI-compatible Chat Completions
  // surface today, even when their primary product is Responses-shaped.
  return 'chat_completions';
}

function selectApiKey(
  provider: AIProvider,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (provider.apiKey && provider.apiKey.length > 0) return provider.apiKey;
  if (provider.apiKeyEnv) {
    const fromEnv = env[provider.apiKeyEnv];
    if (fromEnv && fromEnv.length > 0) return fromEnv;
  }
  return undefined;
}

/**
 * Build an AI SDK provider directly from an OpenAWork `AIProvider`.
 *
 * Returns a tuple-style object exposing both the constructed provider
 * handle and the metadata each caller needs (final protocol, merged
 * overrides). This single call replaces all the bespoke logic that
 * lives in the legacy `routes/upstream-request.ts` today.
 */
export function buildAISdkProviderFromConfig(
  input: BridgeBuildInput,
  env: NodeJS.ProcessEnv = process.env,
): BridgeBuildResult {
  const merged = mergeOverrides(input.provider.requestOverrides, input.modelOverrides);
  const headers = {
    ...(merged.headers ?? {}),
    ...(input.extraHeaders ?? {}),
  };
  const apiKey = selectApiKey(input.provider, env);

  // Resolve the protocol up-front so the SDK factory can pick the
  // matching provider implementation (e.g. Responses API → @ai-sdk/openai
  // instead of @ai-sdk/openai-compatible). Without this the factory
  // would silently fall back to /chat/completions even when the user
  // explicitly opted into Responses mode.
  const protocol = pickProtocol(input.provider);
  const sdkConfig: AISdkProviderConfig = {
    providerType: input.provider.type,
    name: input.provider.name,
    upstreamProtocol: protocol,
    ...(apiKey ? { apiKey } : {}),
    ...(input.provider.baseUrl ? { baseURL: input.provider.baseUrl } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(typeof input.supportsThinking === 'boolean'
      ? { supportsThinking: input.supportsThinking }
      : {}),
  };

  const built = buildAISdkProvider(sdkConfig);

  return {
    built: { ...built, protocol },
    baseURL: input.provider.baseUrl,
    protocol,
    requestOverrides: merged,
  };
}

export type { BuiltAISdkProvider, UpstreamProtocolKind } from './provider.js';
