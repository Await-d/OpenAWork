/**
 * Reactive Compact — Fast recovery from prompt-too-long errors.
 *
 * Modeled after Claude Code's `truncateHeadForPTLRetry` and reactive
 * compact logic.
 *
 * When the provider returns a context-length error, this module drops
 * the oldest API-round groups from the message history until the token
 * gap is covered. This is faster than full LLM compaction (no API call)
 * but more lossy — it's the first recovery attempt before falling back
 * to Session Memory compact or Full LLM compact.
 *
 * Strategy:
 * 1. Parse the token gap from the error (actualTokens - limitTokens)
 * 2. Group messages by API round
 * 3. Drop groups from the head until the gap is covered
 * 4. If gap is unparseable, drop 20% of groups as fallback
 * 5. Keep at least 1 group so there's something to work with
 */

import type { Message } from '@openAwork/shared';
import { groupMessagesByApiRound, estimateGroupTokens } from './message-grouping.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReactiveCompactResult {
  /** Whether recovery was successful (enough groups dropped). */
  recovered: boolean;
  /** Number of messages dropped. */
  droppedMessages: number;
  /** Number of API-round groups dropped. */
  droppedGroups: number;
  /** Estimated tokens freed. */
  tokensFreed: number;
  /** Remaining messages after dropping. */
  remainingMessages: Message[];
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Drop the oldest API-round groups from messages until tokenGap is covered.
 *
 * Falls back to dropping 20% of groups when the gap is unparseable (some
 * Vertex/Bedrock error formats). Returns null when nothing can be dropped
 * without leaving an empty message set.
 *
 * This is the fast-path escape hatch — when the compact request itself
 * hits prompt-too-long, the user is otherwise stuck. Dropping the oldest
 * context is lossy but unblocks them.
 */
export function reactiveCompactByTokenGap(
  messages: Message[],
  tokenGap: number | undefined,
): ReactiveCompactResult | null {
  const groups = groupMessagesByApiRound(messages);

  // Need at least 2 groups (something to drop + something to keep)
  if (groups.length < 2) return null;

  let dropCount: number;

  if (tokenGap !== undefined && tokenGap > 0) {
    // Known gap: drop groups from the head until we cover it
    let accumulated = 0;
    dropCount = 0;
    for (const group of groups) {
      accumulated += estimateGroupTokens(group);
      dropCount++;
      if (accumulated >= tokenGap) break;
    }
  } else {
    // Unknown gap: drop 20% of groups as a heuristic
    dropCount = Math.max(1, Math.floor(groups.length * 0.2));
  }

  // Keep at least one group so there's something to work with
  dropCount = Math.min(dropCount, groups.length - 1);
  if (dropCount < 1) return null;

  const droppedGroups = groups.slice(0, dropCount);
  const keptGroups = groups.slice(dropCount);
  const remainingMessages = keptGroups.flat();
  const droppedMessages = droppedGroups.flat();

  const tokensFreed = droppedGroups.reduce((sum, group) => sum + estimateGroupTokens(group), 0);

  // Ensure the remaining messages start with a user message
  // (API requires first message to be role=user)
  const firstRemaining = remainingMessages[0];
  if (firstRemaining && firstRemaining.role === 'assistant') {
    // Prepend a synthetic user marker so the API doesn't reject
    const syntheticMarker: Message = {
      id: `reactive-compact-marker-${Date.now()}`,
      role: 'user',
      content: [
        {
          type: 'text',
          text: '[earlier conversation truncated for context recovery]',
        },
      ],
      createdAt: Date.now(),
    };
    remainingMessages.unshift(syntheticMarker);
  }

  return {
    recovered: true,
    droppedMessages: droppedMessages.length,
    droppedGroups: dropCount,
    tokensFreed,
    remainingMessages,
  };
}

/**
 * Parse the token gap from a provider error.
 * Returns the number of tokens over the limit, or undefined if unparseable.
 *
 * Supports patterns like:
 * - "137500 tokens > 135000 maximum"
 * - "prompt is too long: 137500 tokens > 135000"
 * - "exceeds maximum context length of 135000"
 */
export function parseTokenGapFromError(error: unknown): number | undefined {
  if (!error) return undefined;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof error === 'object' && 'message' in error
          ? String(error.message)
          : undefined;

  if (!message) return undefined;

  // Pattern: "X tokens > Y maximum" or "X tokens ... exceeds ... Y"
  const patterns = [
    /(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)/i,
    /prompt.*?(\d[\d,]*).*?tokens.*?exceeds.*?(\d[\d,]*)/i,
    /(\d[\d,]*).*?tokens.*?limit.*?(\d[\d,]*)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1] && match[2]) {
      const num1 = parseInt(match[1].replace(/,/g, ''), 10);
      const num2 = parseInt(match[2].replace(/,/g, ''), 10);
      if (Number.isNaN(num1) || Number.isNaN(num2)) continue;
      const actual = Math.max(num1, num2);
      const limit = Math.min(num1, num2);
      const gap = actual - limit;
      return gap > 0 ? gap : undefined;
    }
  }

  return undefined;
}
