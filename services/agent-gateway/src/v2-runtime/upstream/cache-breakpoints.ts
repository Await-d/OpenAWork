/**
 * cache-breakpoints — annotate AI SDK `ModelMessage[]` with Anthropic
 * prompt-caching breakpoints so the upstream caches the leading
 * system / context messages and keeps the most recent two
 * user/assistant turns reusable across consecutive requests.
 *
 * Why this lives here:
 *   - The legacy `applyCacheBreakpoints` (in routes/upstream-request.ts)
 *     decorates the wire-format Chat-Completions JSON directly. AI SDK
 *     hides the wire shape behind `ModelMessage`, so we have to
 *     inject the same `cache_control: { type: 'ephemeral' }` markers
 *     through `providerOptions.anthropic.cacheControl` on individual
 *     content parts instead.
 *   - The same heuristic (system + last 2 turns) keeps cache hit
 *     rates aligned between the legacy and v2 paths.
 *
 * Behaviour matrix (mirrors the legacy implementation):
 *   - Provider type `anthropic` / `claude`: full breakpoint application.
 *   - Provider type `openrouter`: same heuristic — OpenRouter passes
 *     the cache_control hint through to Anthropic-backed models.
 *   - All other providers: noop (the input is returned unchanged).
 *
 * Limitations:
 *   - We mark the entire message via `providerOptions.anthropic` on
 *     the message envelope, not on individual `TextPart`s. The
 *     Anthropic SDK applies the breakpoint to the message's last
 *     content block, which is what the legacy single-block JSON
 *     produced anyway.
 */

import type { ModelMessage } from 'ai';

const EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' as const };

function shouldApplyCacheBreakpoints(providerType: string | undefined): boolean {
  if (!providerType) return false;
  const kind = providerType.toLowerCase();
  return kind === 'anthropic' || kind === 'claude' || kind === 'openrouter';
}

function withAnthropicCacheControl(message: ModelMessage): ModelMessage {
  const existing = message.providerOptions ?? {};
  const existingAnthropic = (existing['anthropic'] ?? {}) as Record<string, unknown>;
  return {
    ...message,
    providerOptions: {
      ...existing,
      anthropic: {
        ...existingAnthropic,
        cacheControl: EPHEMERAL_CACHE_CONTROL,
      },
    },
  };
}

/**
 * Apply Anthropic prompt-caching breakpoints to a ModelMessage list.
 *
 * Strategy (matches the legacy `applyCacheBreakpoints`):
 *   - Mark up to the first 2 system messages.
 *   - Mark the last 2 non-system messages (user / assistant / tool).
 *
 * The function returns a new array; the input is not mutated.
 */
export function applyAnthropicCacheBreakpoints(
  messages: ModelMessage[],
  providerType: string | undefined,
): ModelMessage[] {
  if (!shouldApplyCacheBreakpoints(providerType) || messages.length === 0) {
    return messages;
  }

  const indicesToMark = new Set<number>();

  // First two system messages.
  let systemSeen = 0;
  for (let i = 0; i < messages.length && systemSeen < 2; i++) {
    if (messages[i]!.role === 'system') {
      indicesToMark.add(i);
      systemSeen++;
    }
  }

  // Last two non-system messages.
  const nonSystemIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role !== 'system') {
      nonSystemIndices.push(i);
    }
  }
  for (const idx of nonSystemIndices.slice(-2)) {
    indicesToMark.add(idx);
  }

  if (indicesToMark.size === 0) {
    return messages;
  }

  return messages.map((message, idx) =>
    indicesToMark.has(idx) ? withAnthropicCacheControl(message) : message,
  );
}
