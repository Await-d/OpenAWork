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
 */
const sessionHistory = new Map<string, ToolCallEntry[]>();

function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/**
 * Record a tool call and check if a doom loop is detected.
 *
 * Returns `true` if the last N consecutive tool calls are identical
 * (same toolName + same input), indicating the LLM is stuck.
 */
export function checkDoomLoop(sessionId: string, toolName: string, rawInput: unknown): boolean {
  const entry: ToolCallEntry = { toolName, inputHash: hashInput(rawInput) };
  let history = sessionHistory.get(sessionId);
  if (!history) {
    history = [];
    sessionHistory.set(sessionId, history);
  }

  history.push(entry);

  // Keep only the last DOOM_LOOP_THRESHOLD entries to bound memory
  if (history.length > DOOM_LOOP_THRESHOLD) {
    history.splice(0, history.length - DOOM_LOOP_THRESHOLD);
  }

  if (history.length < DOOM_LOOP_THRESHOLD) {
    return false;
  }

  // Check if all recent entries are identical
  return history.every((h) => h.toolName === entry.toolName && h.inputHash === entry.inputHash);
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
