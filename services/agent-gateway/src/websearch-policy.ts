/**
 * websearch-policy — persisted user settings for the multi-provider
 * web-search rollout (P2-WEBSEARCH).
 *
 * The settings shape mirrors `WebSearchMultiConfig` from
 * `@openAwork/agent-core` but trims the runtime-only fields (no live
 * `signal`, no per-call `query`) and lifts the env-friendly bits into
 * a stable JSON blob keyed by `user_settings.key='websearch_policy'`.
 *
 * Default behaviour stays "sequential / single provider" so users who
 * have not opted in keep the legacy single-call behaviour. Once a
 * caller wires this into the gateway tool path (currently scheduled
 * for a follow-up), enabling `rolloutMode=first-success` here will
 * fan out across all configured entries.
 */

import { z } from 'zod';

export const WEBSEARCH_POLICY_KEY = 'websearch_policy';

export const WEB_SEARCH_PROVIDERS = [
  'duckduckgo',
  'tavily',
  'exa',
  'serper',
  'searxng',
  'bocha',
  'zhipu',
  'google',
  'bing',
] as const;

export const webSearchProviderSchema = z.enum(WEB_SEARCH_PROVIDERS);

export const webSearchEntrySchema = z.object({
  provider: webSearchProviderSchema,
  apiKey: z.string().min(1).max(500).optional(),
  baseUrl: z.string().min(1).max(500).optional(),
  weight: z.number().int().min(0).max(100).optional(),
});

export const websearchPolicySchema = z.object({
  /** Per-provider entries; first entry is the implicit default. */
  providers: z.array(webSearchEntrySchema).max(8).default([]),
  /**
   * `sequential` (default) preserves OpenAWork's existing single-call
   * behaviour — providers are tried in order, falling through on
   * error. `first-success` and `merge` activate the parallel rollout.
   */
  rolloutMode: z.enum(['sequential', 'first-success', 'merge']).default('sequential'),
  /**
   * Hard ceiling on the slowest provider in `merge` mode (ms).
   * Ignored by `sequential` and `first-success`. Bounded so a
   * misconfigured value cannot stall the tool indefinitely.
   */
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
});

export type WebsearchPolicy = z.infer<typeof websearchPolicySchema>;

const DEFAULT_POLICY: WebsearchPolicy = {
  providers: [],
  rolloutMode: 'sequential',
};

/**
 * Read the persisted policy from a parsed `user_settings.value` blob.
 * Falls back to the documented default for any malformed / missing
 * input rather than throwing — reading should never block a session
 * just because of a bad row.
 */
export function readWebsearchPolicy(value: unknown): WebsearchPolicy {
  if (!value || typeof value !== 'object') return DEFAULT_POLICY;
  const parsed = websearchPolicySchema.safeParse(value);
  if (!parsed.success) return DEFAULT_POLICY;
  return parsed.data;
}
