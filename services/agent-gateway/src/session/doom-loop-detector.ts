import { createHash } from 'node:crypto';

const DOOM_LOOP_THRESHOLD = 3;

interface ToolCallEntry {
  toolName: string;
  inputHash: string;
}

/**
 * Per-session doom loop history.
 * Tracks recent consecutive tool calls to detect when the same tool
 * is called with the same arguments repeatedly (LLM stuck in a loop).
 *
 * Mirrors opencode's doom loop detection in processor.ts.
 *
 * History is split into two operations:
 *   - `recordDoomLoopEntry` — appends an entry to the history. Callers
 *     should only invoke this once they've confirmed the tool call is
 *     about to enter real dispatch (i.e. not short-circuited by
 *     schema validation, missing args, Prometheus guard or "tool not
 *     enabled" early-exit paths). Recording short-circuited failures
 *     would inflate the loop counter even though the model is making
 *     progress (next attempt may carry different args).
 *   - `peekDoomLoop` — checks whether **adding** the next entry would
 *     trip the loop threshold, without mutating history. Use this to
 *     decide whether to short-circuit the call before dispatch.
 *
 * The legacy `checkDoomLoop` helper combines both operations and is
 * kept around for tests / older call sites.
 */
const sessionHistory = new Map<string, ToolCallEntry[]>();

function stableStringify(value: unknown): string {
  // Recursive structural-equality stringify: object keys sorted, arrays
  // preserve order. Used so two calls whose JSON-serialized form would
  // only differ in key ordering still hash to the same value (the model
  // can emit `{a, b}` one turn and `{b, a}` the next; we want both to
  // count as the "same" call for doom-loop purposes).
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const body = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',');
  return `{${body}}`;
}

function hashInput(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function getOrCreateHistory(sessionId: string): ToolCallEntry[] {
  let history = sessionHistory.get(sessionId);
  if (!history) {
    history = [];
    sessionHistory.set(sessionId, history);
  }
  return history;
}

function trimHistory(history: ToolCallEntry[]): void {
  if (history.length > DOOM_LOOP_THRESHOLD) {
    history.splice(0, history.length - DOOM_LOOP_THRESHOLD);
  }
}

/**
 * Check whether appending `(toolName, rawInput)` to the per-session
 * history would result in N identical consecutive entries (i.e. would
 * trigger the doom loop guard). The history is **not** mutated.
 */
export function peekDoomLoop(sessionId: string, toolName: string, rawInput: unknown): boolean {
  const history = sessionHistory.get(sessionId);
  if (!history) return false;
  if (history.length < DOOM_LOOP_THRESHOLD - 1) return false;
  const candidateHash = hashInput(rawInput);
  // The candidate would become the last entry — re-check the trailing
  // (DOOM_LOOP_THRESHOLD - 1) existing entries plus the candidate.
  const tailStart = history.length - (DOOM_LOOP_THRESHOLD - 1);
  for (let i = tailStart; i < history.length; i += 1) {
    const h = history[i]!;
    if (h.toolName !== toolName || h.inputHash !== candidateHash) {
      return false;
    }
  }
  return true;
}

/**
 * Append a tool call to the session history. Callers should only do
 * this once they've confirmed the call is about to enter real
 * dispatch — see file header for rationale.
 */
export function recordDoomLoopEntry(sessionId: string, toolName: string, rawInput: unknown): void {
  const entry: ToolCallEntry = { toolName, inputHash: hashInput(rawInput) };
  const history = getOrCreateHistory(sessionId);
  history.push(entry);
  trimHistory(history);
}

/**
 * Legacy combined operation: record + check. Returns `true` when the
 * just-recorded entry made the trailing N entries identical.
 *
 * Newer call paths should prefer the explicit peek/record pair so
 * short-circuited dispatches don't pollute the history.
 */
export function checkDoomLoop(sessionId: string, toolName: string, rawInput: unknown): boolean {
  recordDoomLoopEntry(sessionId, toolName, rawInput);
  const history = sessionHistory.get(sessionId);
  if (!history || history.length < DOOM_LOOP_THRESHOLD) return false;
  const last = history[history.length - 1]!;
  return history
    .slice(-DOOM_LOOP_THRESHOLD)
    .every((h) => h.toolName === last.toolName && h.inputHash === last.inputHash);
}

/**
 * Reset doom loop history for a session (e.g. after a permission approval or new user message).
 */
export function resetDoomLoopHistory(sessionId: string): void {
  sessionHistory.delete(sessionId);
}

/**
 * Clear all doom loop state. Useful for tests.
 */
export function clearAllDoomLoopHistory(): void {
  sessionHistory.clear();
}
