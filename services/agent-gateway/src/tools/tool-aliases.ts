import type { ToolDefinition } from '@openAwork/agent-core';
import {
  searchMultiProvider,
  webSearchTool,
  type WebSearchMultiConfig,
} from '@openAwork/agent-core';

const WEBSEARCH_DESCRIPTION =
  '在网上搜索实时信息、新闻和事实。检索近期信息时，请在 query 中带上当前年份。';

/**
 * Static gateway alias kept for non-user-aware callers (verification
 * scripts, the alias used by `tool-definitions.ts` for shape /
 * permission catalog parity). Production execution paths route via
 * `createWebsearchTool()` so a per-user multi-provider rollout can
 * take over (P2-WEBSEARCH workflow 260509).
 */
export const websearchTool: ToolDefinition<
  typeof webSearchTool.inputSchema,
  typeof webSearchTool.outputSchema
> = {
  ...webSearchTool,
  name: 'websearch',
  description: WEBSEARCH_DESCRIPTION,
};

export interface WebsearchToolFactoryOptions {
  /**
   * Per-call resolver for the user's persisted multi-provider rollout
   * policy. Returning `null` (or providing no resolver) keeps the
   * legacy single-call behaviour — the LLM-facing schema is unchanged
   * either way, so this stays purely a gateway-side decision.
   */
  resolveMultiConfig?: () => WebSearchMultiConfig | null;
}

/**
 * Factory variant of `websearchTool` that consults the gateway-side
 * `WebsearchPolicy` before deciding whether to run the legacy
 * single-provider path or the parallel `searchMultiProvider` rollout.
 *
 * Decision rules (kept tight on purpose so non-opted-in users see the
 * exact same behaviour as before):
 *   1. The LLM did not pin a `provider` in the call AND
 *   2. the user has at least one configured `providers[*]` entry AND
 *   3. either `rolloutMode !== 'sequential'` OR there are 2+ providers.
 * In every other case the call falls through to the static tool's
 * own `execute` (duckduckgo default + LLM-supplied fields).
 */
export function createWebsearchTool(
  opts: WebsearchToolFactoryOptions = {},
): ToolDefinition<typeof webSearchTool.inputSchema, typeof webSearchTool.outputSchema> {
  const { resolveMultiConfig } = opts;
  return {
    ...webSearchTool,
    name: 'websearch',
    description: WEBSEARCH_DESCRIPTION,
    execute: async (input, signal) => {
      const llmPickedProvider = typeof input.provider === 'string' && input.provider.length > 0;
      if (!llmPickedProvider && resolveMultiConfig) {
        const policy = resolveMultiConfig();
        if (policy && policy.providers.length > 0) {
          // Honour the policy iff it actually adds something over the
          // legacy single-call (multi-mode OR more than one provider).
          const triggersMulti =
            (policy.rolloutMode && policy.rolloutMode !== 'sequential') ||
            policy.providers.length >= 2;
          if (triggersMulti) {
            return searchMultiProvider(
              input.query,
              {
                providers: policy.providers,
                rolloutMode: policy.rolloutMode,
                ...(policy.timeoutMs !== undefined ? { timeoutMs: policy.timeoutMs } : {}),
                ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
              },
              signal,
            );
          }
        }
      }
      // Legacy path — preserves current behaviour for everyone who
      // hasn't opted in. We delegate to the original tool's `execute`
      // rather than reimplementing the dispatch table here.
      return webSearchTool.execute(input, signal);
    },
  };
}
