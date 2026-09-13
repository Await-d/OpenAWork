/**
 * Round-boundary detection shared by the chat and team stream consumers.
 *
 * The gateway persists **one assistant message per model round**
 * (`services/agent-gateway/src/routes/stream-model-round.ts` → `finalizeAssistant`)
 * and emits a `usage` chunk carrying that round's index as soon as the round is
 * over — before the round's tools run and before any chunk of the next round.
 *
 * That makes `usage.round` the authoritative boundary signal: once the highest
 * reported round is ≥ the round the client is currently accumulating, every
 * later text / reasoning chunk belongs to the next round.
 *
 * Two details matter for correctness:
 *
 * - the boundary is applied when *content* arrives, never on the `usage` chunk
 *   itself — the tool results of the round that just ended arrive after `usage`
 *   and must still land on that round's message;
 * - `usage` is only emitted when the upstream reported usage, so a landed
 *   `tool_result` remains a fallback signal (tools only ever run once their
 *   round has been persisted).
 *
 * The previous heuristic ("any thinking after a tool_call starts a new round")
 * missed the common `tool_call → text` case and split single-round
 * interleavings such as `tool_call → reasoning`.
 */

/** Fallback signal: at least one tool of the current round already produced a result. */
export function hasLandedToolResult(toolCalls: Iterable<{ status?: string }>): boolean {
  for (const toolCall of toolCalls) {
    const status = toolCall.status;
    if (status === 'completed' || status === 'paused' || status === 'error') {
      return true;
    }
  }
  return false;
}

export interface RoundBoundaryInput {
  /** Round the client is currently accumulating (1-based, first round = 1). */
  currentRoundIndex: number;
  /** Highest round the gateway reported as finished (`usage.round`); null when unknown. */
  lastCompletedRound: number | null;
  /** Tool calls seen in the current round, used as the fallback signal. */
  toolCalls: Iterable<{ status?: string }>;
}

/**
 * Whether the gateway has already moved past the round being accumulated.
 *
 * This is the *primary*, authoritative signal: `usage.round` is emitted once the
 * round is over. It is safe for every kind of content — including a
 * `tool_call_delta`, because all tool calls of a round stream before that
 * round's `usage` chunk (parallel tool calls included).
 */
export function hasGatewayAdvancedRound(input: {
  currentRoundIndex: number;
  lastCompletedRound: number | null;
}): boolean {
  const { currentRoundIndex, lastCompletedRound } = input;
  return lastCompletedRound !== null && lastCompletedRound >= currentRoundIndex;
}

/**
 * Whether newly arriving content has to open a new round first.
 *
 * Call this *before* appending text / reasoning (and before closing the round
 * on `done`); it is idempotent within a round because committing the round
 * clears the tool calls and advances `currentRoundIndex`.
 *
 * Unlike {@link hasGatewayAdvancedRound} this also accepts the `tool_result`
 * fallback, which is what covers rounds whose `usage` chunk never arrived. It
 * must not be used for `tool_call_delta`: a resumed round re-streams tool calls
 * after its own tool result, and the fallback would split it.
 */
export function shouldStartNewRound(input: RoundBoundaryInput): boolean {
  if (hasGatewayAdvancedRound(input)) {
    return true;
  }
  return hasLandedToolResult(input.toolCalls);
}

/** Round index the next content should be accumulated under. */
export function resolveNextRoundIndex(input: {
  currentRoundIndex: number;
  lastCompletedRound: number | null;
}): number {
  const { currentRoundIndex, lastCompletedRound } = input;
  return lastCompletedRound !== null && lastCompletedRound >= currentRoundIndex
    ? lastCompletedRound + 1
    : currentRoundIndex + 1;
}
