/**
 * stream-usage — provider-agnostic token usage summary used across the
 * gateway. Lifted out of `stream-protocol.ts` so v2 callers can depend
 * on the type without dragging the legacy SSE parser into their import
 * graph (the legacy parser was removed in the v2-only cutover).
 */

export interface StreamUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheTokensAreSeparate?: boolean;
}
