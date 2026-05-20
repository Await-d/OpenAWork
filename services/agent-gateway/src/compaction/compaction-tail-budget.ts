/**
 * Turn-based, token-budget-aware tail selection for compaction.
 *
 * Mirrors opencode's `session/compaction.ts` `select` + `splitTurn`
 * helpers. The intent is: when picking which recent messages to
 * preserve verbatim across a compaction round, walk turns (each
 * starting with a `user` message) from the most recent backwards
 * until adding the next turn would exceed `preserveRecentTokens`.
 * If a single turn already exceeds the budget, split inside it on
 * the latest message that still fits.
 *
 * The function returns a boundary index compatible with
 * `calculateKeepBoundary`: messages[:boundary] are summarized,
 * messages[boundary:] are kept verbatim.
 */

import type { Message } from '@openAwork/shared';

/** Default token preserve budget when caller does not supply one.
 * Increased from 2K/8K to 10K/40K to align with Claude Code's
 * session-memory-compact config (minTokens=10K, maxTokens=40K).
 * Preserving more recent context improves task continuity across
 * compaction rounds, especially for long multi-step tasks. */
export const MIN_PRESERVE_RECENT_TOKENS = 10_000;
export const MAX_PRESERVE_RECENT_TOKENS = 40_000;

/**
 * Default token estimator. ~4 characters per token is a coarse but
 * reliable approximation for English / code mixed payloads when no
 * provider tokenizer is available, which matches the resolution at
 * which opencode's `Token.estimate` operates.
 */
export function estimateMessageTokens(message: Message): number {
  let chars = 0;
  for (const content of message.content) {
    switch (content.type) {
      case 'text':
        chars += content.text.length;
        break;
      case 'reasoning':
        chars += (content.text ?? '').length;
        break;
      case 'tool_call':
        chars += content.toolCallId.length + (content.toolName?.length ?? 0);
        chars += JSON.stringify(content.input ?? {}).length;
        break;
      case 'tool_result':
        chars += content.toolCallId.length;
        chars += typeof content.output === 'string' ? content.output.length : 0;
        break;
      default:
        // Unknown variant — fall back to JSON length.
        try {
          chars += JSON.stringify(content).length;
        } catch {
          // ignore
        }
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Clamp `value` between `min` and `max`. Used to bound the
 * automatically-derived preserve budget.
 */
export function boundPreserveTokens(value: number): number {
  return Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.min(MAX_PRESERVE_RECENT_TOKENS, value));
}

interface Turn {
  /** Start index (inclusive) — points at a `user` message. */
  start: number;
  /** End index (exclusive) — equals `messages.length` for the last turn. */
  end: number;
}

function buildTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'user') {
      turns.push({ start: i, end: messages.length });
    }
  }
  for (let i = 0; i < turns.length - 1; i++) {
    turns[i]!.end = turns[i + 1]!.start;
  }
  return turns;
}

function turnTokens(messages: Message[], turn: Turn, estimate: (m: Message) => number): number {
  let total = 0;
  for (let i = turn.start; i < turn.end; i++) {
    const m = messages[i];
    if (m) total += estimate(m);
  }
  return total;
}

/**
 * Within a single oversized turn, find the latest message index whose
 * tail fits inside `budget`. Returns the index, or `undefined` when no
 * sub-window fits — in that case the caller should fall back to
 * dropping the turn entirely (matches opencode's behavior).
 */
function splitTurn(input: {
  messages: Message[];
  turn: Turn;
  budget: number;
  estimate: (m: Message) => number;
}): number | undefined {
  if (input.budget <= 0) return undefined;
  if (input.turn.end - input.turn.start <= 1) return undefined;
  for (let start = input.turn.start + 1; start < input.turn.end; start++) {
    let size = 0;
    for (let i = start; i < input.turn.end; i++) {
      const m = input.messages[i];
      if (m) size += input.estimate(m);
    }
    if (size <= input.budget) return start;
  }
  return undefined;
}

export interface TailBudgetSelection {
  /** Boundary index. `messages[:boundary]` should be summarized. */
  boundary: number;
  /** ID of the first message in the kept tail (if any). */
  tailStartMessageId: string | undefined;
  /** Estimated tokens used by the kept tail. */
  tailTokenEstimate: number;
}

/**
 * Pick a verbatim-tail boundary that fits within `preserveRecentTokens`.
 *
 * Walks turns from the back: includes whole turns until the next one
 * would push the running total over budget; if a turn is itself larger
 * than the remaining budget, falls back to `splitTurn` which keeps
 * only the suffix of that turn that fits. When no tail can fit — or
 * the result would land at index 0 — returns `boundary === messages.length`
 * so the caller summarizes the entire history (no verbatim tail).
 *
 * Mirrors opencode's `select` in `session/compaction.ts`.
 */
export function selectTailByTokenBudget(input: {
  messages: Message[];
  preserveRecentTokens: number;
  /** Maximum number of recent turns to consider — defaults to 4 (increased
   * from opencode's 2 to preserve more context across compaction rounds). */
  maxTurns?: number;
  estimate?: (m: Message) => number;
}): TailBudgetSelection {
  const estimate = input.estimate ?? estimateMessageTokens;
  const limit = input.maxTurns ?? 4;
  if (input.messages.length === 0 || limit <= 0 || input.preserveRecentTokens <= 0) {
    return { boundary: input.messages.length, tailStartMessageId: undefined, tailTokenEstimate: 0 };
  }

  const turns = buildTurns(input.messages);
  if (turns.length === 0) {
    return { boundary: input.messages.length, tailStartMessageId: undefined, tailTokenEstimate: 0 };
  }

  const recent = turns.slice(-limit);
  const sizes = recent.map((turn) => turnTokens(input.messages, turn, estimate));

  let total = 0;
  let keepStart: number | undefined;
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i]!;
    const size = sizes[i]!;
    if (total + size <= input.preserveRecentTokens) {
      total += size;
      keepStart = turn.start;
      continue;
    }
    const remaining = input.preserveRecentTokens - total;
    const split = splitTurn({
      messages: input.messages,
      turn,
      budget: remaining,
      estimate,
    });
    if (split !== undefined) keepStart = split;
    break;
  }

  if (keepStart === undefined || keepStart === 0) {
    return { boundary: input.messages.length, tailStartMessageId: undefined, tailTokenEstimate: 0 };
  }

  return {
    boundary: keepStart,
    tailStartMessageId: input.messages[keepStart]?.id,
    tailTokenEstimate: total,
  };
}
