/**
 * Session Memory Compact — Zero-LLM compaction using pre-extracted session memory.
 *
 * Modeled after Claude Code's `services/compact/sessionMemoryCompact.ts`.
 *
 * When the session memory system has already extracted key information from
 * the conversation in the background, this module uses that pre-existing
 * summary as the compaction output — avoiding an additional LLM call entirely.
 *
 * This is Layer 1 in the 4-layer compaction hierarchy:
 *   Layer 0: Microcompact (clear old tool outputs, no LLM)
 *   Layer 1: Session Memory Compact (use pre-extracted summary, no LLM) ← this
 *   Layer 2: Full Compact (LLM summarization)
 *   Layer 3: Reactive Compact (drop oldest rounds, no LLM)
 *
 * Priority in overflow recovery:
 *   Reactive Compact → Session Memory Compact → Aggressive Truncation → Full Compact
 */

import { createHash } from 'node:crypto';
import type { Message } from '@openAwork/shared';
import { sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';
import { appendCompactionMarkerMessageV2 as appendCompactionMarkerMessage } from '../message/message-v2-adapter.js';
import { mergeCompactionMetadata } from './compaction-metadata.js';
import { estimateMessageTokens } from './compaction-tail-budget.js';
import { readSessionMemoryContent, isSessionMemoryEmpty } from './session-memory-store.js';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface SessionMemoryCompactConfig {
  /** Minimum tokens to preserve after compaction. */
  minPreserveTokens: number;
  /** Minimum number of messages with text content to keep. */
  minTextBlockMessages: number;
  /** Maximum tokens to preserve after compaction (hard cap). */
  maxPreserveTokens: number;
}

export const DEFAULT_SESSION_MEMORY_COMPACT_CONFIG: SessionMemoryCompactConfig = {
  minPreserveTokens: 10_000,
  minTextBlockMessages: 5,
  maxPreserveTokens: 40_000,
};

// ─── Result Type ─────────────────────────────────────────────────────────────

export interface SessionMemoryCompactResult {
  /** Whether compaction was successful. */
  success: boolean;
  /** The summary content used. */
  summary: string;
  /** Messages preserved verbatim after compaction. */
  messagesToKeep: Message[];
  /** Updated session metadata JSON. */
  metadataJson: string;
  /** Pre-compact token estimate. */
  preCompactTokenEstimate: number;
  /** Post-compact token estimate. */
  postCompactTokenEstimate: number;
  signature: string;
  committed: boolean;
}

interface SessionMetadataRow {
  readonly metadata_json: string;
}

interface SessionMemoryMarkerRow {
  readonly id: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if a message contains meaningful text content (not just tool results).
 */
function hasTextContent(message: Message): boolean {
  return message.content.some((c) => c.type === 'text' && c.text.trim().length > 0);
}

/**
 * Estimate total tokens for a set of messages.
 */
function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Read the session memory content from the session memory store.
 * Returns null if no session memory exists or it's empty.
 */
function readSessionMemoryForSession(sessionId: string, userId: string): string | null {
  const content = readSessionMemoryContent(sessionId, userId);
  if (!content) return null;
  if (isSessionMemoryEmpty(content)) return null;
  return content;
}

function buildSessionMemorySignature(input: {
  readonly sessionId: string;
  readonly userId: string;
  readonly sessionMemory: string;
}): string {
  return createHash('sha256')
    .update(input.sessionId)
    .update('\u0000')
    .update(input.userId)
    .update('\u0000')
    .update(input.sessionMemory)
    .digest('hex');
}

function buildSessionMemoryMarkerRequestId(input: {
  readonly clientRequestId: string;
  readonly round: number;
  readonly signature: string;
}): string {
  return `compaction-marker:${input.clientRequestId}:${input.round}:${input.signature}`;
}

/**
 * Calculate the starting index for messages to keep after compaction.
 *
 * Walks backwards from the end, expanding until both minimums are met:
 * - At least `minPreserveTokens` tokens
 * - At least `minTextBlockMessages` messages with text content
 *
 * Stops expanding if `maxPreserveTokens` is reached.
 * Also ensures tool_call/tool_result pairs are not split.
 */
function calculateMessagesToKeepIndex(
  messages: Message[],
  config: SessionMemoryCompactConfig,
): number {
  if (messages.length === 0) return 0;

  let totalTokens = 0;
  let textBlockCount = 0;
  let startIndex = messages.length;

  // Walk backwards from the end
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const msgTokens = estimateMessageTokens(msg);

    // Check if adding this message would exceed the hard cap
    if (totalTokens + msgTokens > config.maxPreserveTokens) {
      break;
    }

    totalTokens += msgTokens;
    if (hasTextContent(msg)) {
      textBlockCount++;
    }
    startIndex = i;

    // Stop if we meet both minimums
    if (totalTokens >= config.minPreserveTokens && textBlockCount >= config.minTextBlockMessages) {
      break;
    }
  }

  // Adjust for tool_call/tool_result pairing
  return adjustForToolPairing(messages, startIndex);
}

/**
 * Adjust the start index to ensure tool_call/tool_result pairs are not split.
 * If a kept message has a tool_result referencing a tool_call before the boundary,
 * move the boundary backward to include that tool_call.
 */
function adjustForToolPairing(messages: Message[], startIndex: number): number {
  if (startIndex <= 0 || startIndex >= messages.length) return startIndex;

  let adjusted = startIndex;

  // Collect tool_result IDs in the kept range
  const toolResultIds = new Set<string>();
  for (let i = adjusted; i < messages.length; i++) {
    const msg = messages[i]!;
    for (const content of msg.content) {
      if (content.type === 'tool_result') {
        toolResultIds.add(content.toolCallId);
      }
    }
  }

  // Collect tool_call IDs already in the kept range
  const keptToolCallIds = new Set<string>();
  for (let i = adjusted; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role !== 'assistant') continue;
    for (const content of msg.content) {
      if (content.type === 'tool_call') {
        keptToolCallIds.add(content.toolCallId);
      }
    }
  }

  // Find tool_results that reference tool_calls before the boundary
  const neededToolCallIds = new Set([...toolResultIds].filter((id) => !keptToolCallIds.has(id)));

  if (neededToolCallIds.size === 0) return adjusted;

  // Walk backwards to find the assistant messages with those tool_calls
  for (let i = adjusted - 1; i >= 0 && neededToolCallIds.size > 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== 'assistant') continue;
    for (const content of msg.content) {
      if (content.type === 'tool_call' && neededToolCallIds.has(content.toolCallId)) {
        adjusted = i;
        neededToolCallIds.delete(content.toolCallId);
      }
    }
  }

  // Ensure the kept section starts with a user message
  while (adjusted < messages.length && messages[adjusted]?.role !== 'user') {
    adjusted++;
  }

  return adjusted;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Try to use session memory for compaction instead of full LLM compaction.
 *
 * Returns null if:
 * - No session memory exists for this session
 * - Session memory is empty/template-only
 * - Post-compact token count would still exceed the threshold
 *
 * When successful, writes a compaction marker and updates session metadata,
 * just like full compaction does.
 */
export async function trySessionMemoryCompaction(input: {
  readonly clientRequestId: string;
  readonly round: number;
  readonly requestKind: 'session_memory';
  readonly sessionId: string;
  readonly userId: string;
  readonly messages: Message[];
  readonly metadataJson: string;
  readonly autoCompactThreshold?: number;
  readonly config?: Partial<SessionMemoryCompactConfig>;
}): Promise<SessionMemoryCompactResult | null> {
  const config: SessionMemoryCompactConfig = {
    ...DEFAULT_SESSION_MEMORY_COMPACT_CONFIG,
    ...input.config,
  };

  // Read session memory
  const sessionMemory = readSessionMemoryForSession(input.sessionId, input.userId);
  if (!sessionMemory) {
    return null;
  }

  // Calculate which messages to keep
  const startIndex = calculateMessagesToKeepIndex(input.messages, config);
  const messagesToKeep = input.messages.slice(startIndex);

  if (messagesToKeep.length === 0) {
    return null;
  }

  // Estimate post-compact token count
  const summaryTokens = Math.ceil(sessionMemory.length / 4);
  const keptTokens = estimateMessagesTokens(messagesToKeep);
  const postCompactTokenEstimate = summaryTokens + keptTokens;

  // Check if post-compact would still exceed threshold
  if (
    input.autoCompactThreshold !== undefined &&
    postCompactTokenEstimate >= input.autoCompactThreshold
  ) {
    return null;
  }

  // Build the summary message (Claude Code pattern: session memory + continuation instruction)
  const summary = buildSessionMemorySummary(sessionMemory, messagesToKeep.length > 0);
  const preCompactTokenEstimate = estimateMessagesTokens(input.messages);
  const signature = buildSessionMemorySignature({
    sessionId: input.sessionId,
    userId: input.userId,
    sessionMemory,
  });
  const markerClientRequestId = buildSessionMemoryMarkerRequestId({
    clientRequestId: input.clientRequestId,
    round: input.round,
    signature,
  });
  const persistedSession = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [input.sessionId, input.userId],
  );
  const sourceMetadataJson = persistedSession?.metadata_json ?? input.metadataJson;

  // Update session metadata
  const omittedMessages = input.messages.length - messagesToKeep.length;
  const metadata = {
    ...mergeCompactionMetadata(sourceMetadataJson, {
      summary,
      trigger: 'automatic',
      omittedMessages,
      recentMessagesKept: messagesToKeep.length,
    }),
    lastCompactionLlmSummary: summary,
    lastCompactionSource: 'session_memory',
    consecutiveCompactionFailures: 0,
  };
  const metadataJson = JSON.stringify(metadata);
  let committed = false;
  let persistedMetadataJson = metadataJson;

  sqliteTransaction(() => {
    const existingMarker = sqliteGet<SessionMemoryMarkerRow>(
      `SELECT id FROM message_v2
       WHERE session_id = ? AND user_id = ?
         AND json_extract(data, '$.clientRequestId') = ?
       LIMIT 1`,
      [input.sessionId, input.userId, markerClientRequestId],
    );
    if (existingMarker) {
      persistedMetadataJson =
        sqliteGet<SessionMetadataRow>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
          [input.sessionId, input.userId],
        )?.metadata_json ?? input.metadataJson;
      return;
    }

    sqliteRun(
      "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [metadataJson, input.sessionId, input.userId],
    );

    const tailStartMessageId = messagesToKeep[0]?.id;
    appendCompactionMarkerMessage({
      clientRequestId: markerClientRequestId,
      sessionId: input.sessionId,
      userId: input.userId,
      signature,
      summary,
      trigger: 'automatic',
      omittedMessages,
      ...(tailStartMessageId ? { tailStartMessageId } : {}),
    });
    committed = true;
  });

  return {
    success: true,
    committed,
    summary,
    messagesToKeep,
    metadataJson: persistedMetadataJson,
    preCompactTokenEstimate,
    postCompactTokenEstimate,
    signature,
  };
}

// ─── Summary Builder ─────────────────────────────────────────────────────────

/**
 * Build the compaction summary from session memory content.
 * Adds continuation instructions similar to Claude Code's
 * `getCompactUserSummaryMessage`.
 */
function buildSessionMemorySummary(
  sessionMemory: string,
  recentMessagesPreserved: boolean,
): string {
  let summary = `This session is being continued from a previous conversation that ran out of context. The summary below was extracted from session memory.\n\n${sessionMemory}`;

  if (recentMessagesPreserved) {
    summary += '\n\nRecent messages are preserved verbatim.';
  }

  summary +=
    '\n\nContinue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening. Pick up the last task as if the break never happened.';

  return summary;
}
