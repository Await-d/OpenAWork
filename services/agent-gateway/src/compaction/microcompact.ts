/**
 * Microcompact — Lightweight per-round tool output clearing.
 *
 * Modeled after Claude Code's `services/compact/microCompact.ts`.
 *
 * Runs before every upstream API call to clear stale tool_result outputs,
 * reducing token usage without any LLM call. This delays the need for
 * full compaction and keeps the context window lean.
 *
 * Two trigger modes:
 * 1. Count-based: When compactable tool_results exceed `triggerThreshold`,
 *    clear all but the most recent `keepRecent`.
 * 2. Time-based: When the gap since the last assistant message exceeds
 *    `timeGapThresholdMinutes` (cache is cold anyway), clear aggressively.
 *
 * Operates on UnifiedMessage[] at render time — does NOT mutate DB data.
 * This ensures the same DB state always produces the same output within
 * a single round (prompt-cache stability), while still saving tokens.
 */

import type { UnifiedMessage } from '../message/message-to-model-messages.js';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface MicrocompactConfig {
  /** Enable/disable microcompact entirely. */
  enabled: boolean;
  /** Trigger threshold: compact when compactable tool_results exceed this count. */
  triggerThreshold: number;
  /** Number of most-recent compactable tool_results to keep intact. */
  keepRecent: number;
  /** Whether the time-based trigger is enabled. */
  timeBasedEnabled: boolean;
  /** Time-based trigger: minutes since last assistant message. */
  timeGapThresholdMinutes: number;
  /** Number of recent compactable results kept by the time-based trigger. */
  timeBasedKeepRecent: number;
  /** Tool names whose results are eligible for clearing. */
  compactableTools: ReadonlySet<string>;
  /** Tool names whose results must never be cleared. */
  protectedTools: ReadonlySet<string>;
}

export const DEFAULT_COMPACTABLE_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'file_read',
  'write_file',
  'file_write',
  'edit_file',
  'file_edit',
  'bash',
  'shell',
  'execute_command',
  'grep',
  'grep_search',
  'glob',
  'file_search',
  'web_search',
  'web_fetch',
  'list_directory',
  'read_code',
  'desktop_automation',
  'desktop_control',
]);

export const DEFAULT_PROTECTED_TOOLS: ReadonlySet<string> = new Set(['skill']);

export const DEFAULT_MICROCOMPACT_CONFIG: MicrocompactConfig = {
  enabled: true,
  triggerThreshold: 20,
  keepRecent: 8,
  timeBasedEnabled: false,
  timeGapThresholdMinutes: 60,
  timeBasedKeepRecent: 5,
  compactableTools: DEFAULT_COMPACTABLE_TOOLS,
  protectedTools: DEFAULT_PROTECTED_TOOLS,
};

// ─── Result Type ─────────────────────────────────────────────────────────────

export interface MicrocompactResult {
  /** Whether any clearing was performed. */
  applied: boolean;
  /** Number of tool_results cleared. */
  clearedCount: number;
  /** Estimated tokens saved. */
  tokensSaved: number;
  /** Trigger reason. */
  trigger: 'count' | 'time' | 'none';
}

// ─── Placeholder ─────────────────────────────────────────────────────────────

const MICROCOMPACT_CLEARED_PLACEHOLDER = '[Old tool result content cleared]';

// ─── Core Logic ──────────────────────────────────────────────────────────────

interface ToolResultCandidate {
  /** Index in the messages array. */
  messageIndex: number;
  /** Tool name (from the preceding tool_call or the tool message itself). */
  toolName: string;
  /** Original output length in characters. */
  outputLength: number;
}

/**
 * Collect all compactable tool_result entries from the message list.
 * Returns them in encounter order (oldest first).
 */
function collectCompactableToolResults(
  messages: UnifiedMessage[],
  config: MicrocompactConfig,
): ToolResultCandidate[] {
  const candidates: ToolResultCandidate[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role !== 'tool') continue;

    const toolName = msg.toolName ?? '';
    // Skip if tool is protected
    if (config.protectedTools.has(toolName)) continue;
    // Only compact tools in the compactable set (if set is non-empty)
    if (config.compactableTools.size > 0 && !config.compactableTools.has(toolName)) continue;

    const outputLength = msg.content.length;
    // Skip already-cleared results
    if (outputLength <= MICROCOMPACT_CLEARED_PLACEHOLDER.length + 10) continue;

    candidates.push({ messageIndex: i, toolName, outputLength });
  }

  return candidates;
}

/**
 * The caller provides the persisted timestamp of the last assistant message.
 */
function shouldTimeBasedTrigger(
  config: MicrocompactConfig,
  lastAssistantTimestamp: number | undefined,
): boolean {
  if (
    !config.timeBasedEnabled ||
    lastAssistantTimestamp === undefined ||
    !Number.isFinite(lastAssistantTimestamp)
  ) {
    return false;
  }
  const gapMs = Date.now() - lastAssistantTimestamp;
  const gapMinutes = gapMs / 60_000;
  return gapMinutes >= config.timeGapThresholdMinutes;
}

/**
 * Apply microcompact to a UnifiedMessage array.
 *
 * Does NOT mutate the input — returns a new array with cleared tool outputs.
 *
 * @param messages - The conversation messages (after filterCompacted + toModelMessages)
 * @param configOverrides - Optional partial config overrides
 * @param context - Optional context for time-based triggering
 */
export function microcompactMessages(
  messages: UnifiedMessage[],
  configOverrides?: Partial<MicrocompactConfig>,
  context?: { lastAssistantTimestamp?: number },
): MicrocompactResult & { messages: UnifiedMessage[] } {
  const config: MicrocompactConfig = {
    ...DEFAULT_MICROCOMPACT_CONFIG,
    ...configOverrides,
  };

  if (!config.enabled) {
    return { applied: false, clearedCount: 0, tokensSaved: 0, trigger: 'none', messages };
  }

  const candidates = collectCompactableToolResults(messages, config);

  if (candidates.length === 0) {
    return { applied: false, clearedCount: 0, tokensSaved: 0, trigger: 'none', messages };
  }

  // ── Determine trigger mode ──

  let trigger: 'count' | 'time' | 'none' = 'none';
  let keepCount: number;

  if (shouldTimeBasedTrigger(config, context?.lastAssistantTimestamp)) {
    trigger = 'time';
    keepCount = config.timeBasedKeepRecent;
  } else if (candidates.length > config.triggerThreshold) {
    trigger = 'count';
    keepCount = config.keepRecent;
  } else {
    // Neither trigger fires
    return { applied: false, clearedCount: 0, tokensSaved: 0, trigger: 'none', messages };
  }

  // ── Determine which candidates to clear ──

  const keepSet = new Set(candidates.slice(-keepCount).map((c) => c.messageIndex));
  const toClear = candidates.filter((c) => !keepSet.has(c.messageIndex));

  if (toClear.length === 0) {
    return { applied: false, clearedCount: 0, tokensSaved: 0, trigger, messages };
  }

  // ── Apply clearing (immutable) ──

  const clearIndices = new Set(toClear.map((c) => c.messageIndex));
  let tokensSaved = 0;

  const newMessages = messages.map((msg, index) => {
    if (!clearIndices.has(index)) return msg;
    if (msg.role !== 'tool') return msg;

    tokensSaved += Math.ceil(msg.content.length / 4);
    return {
      ...msg,
      content: MICROCOMPACT_CLEARED_PLACEHOLDER,
    };
  });

  return {
    applied: true,
    clearedCount: toClear.length,
    tokensSaved,
    trigger,
    messages: newMessages,
  };
}
