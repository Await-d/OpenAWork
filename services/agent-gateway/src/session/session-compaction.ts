import type { Message } from '@openAwork/shared';
import { callCompactionLlm } from '../compaction/compaction-llm.js';
import {
  mergeCompactionMetadata,
  readLastCompactionLlmSummary,
  readPersistedCompactionMemory,
  type CompactionTrigger,
} from '../compaction/compaction-metadata.js';
import { sqliteGet, sqliteRun, sqliteTransaction } from '../infra/db.js';
import type { UnifiedMessage } from '../message/message-to-model-messages.js';
import type { ModelRouteConfig } from '../provider/model-router.js';
import {
  buildDurableCompactionSummary,
  buildPreparedUpstreamConversation,
  buildStructuredCompactionSummary,
  type DurableCompactionSummary,
} from './session-message-store.js';
import { appendCompactionMarkerMessageV2 as appendCompactionMarkerMessage } from '../message/message-v2-adapter.js';
import { extractToolResultContentsFromMessage } from '../tools/tool-result-contract.js';
import {
  selectTailByTokenBudget,
  boundPreserveTokens,
  MIN_PRESERVE_RECENT_TOKENS,
} from '../compaction/compaction-tail-budget.js';

/** Maximum consecutive auto-compaction failures before circuit-breaker trips. */
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

const PRUNED_TOOL_RESULT_PLACEHOLDER = '[Old tool result content cleared by compaction prune]';
const COMPACTION_RESERVATION_LEASE_MINUTES = 5;

export interface ExecuteSessionCompactionInput {
  clientRequestId?: string;
  metadataJson: string;
  messages: Message[];
  prune?: boolean;
  /** Number of recent messages to keep verbatim after compaction.
   * When > 0, only messages before the keep-boundary are summarized;
   * the boundary is adjusted to preserve tool_call/tool_result pairing.
   *
   * When `preserveRecentTokens` is also set, the token-budget walker
   * runs first and only falls back to this count if it cannot pick
   * any non-empty tail. Setting just this field preserves the legacy
   * count-only behaviour for callers that have not migrated yet. */
  recentMessagesKept?: number;
  /**
   * Token budget for the verbatim tail. When set, the compaction
   * walker selects whole turns (each anchored at a `user` message)
   * from the back of the conversation until the running estimate
   * exceeds the budget, mirroring opencode's
   * `preserve_recent_tokens` selector. Bounded by
   * `MIN_PRESERVE_RECENT_TOKENS` / `MAX_PRESERVE_RECENT_TOKENS`.
   */
  preserveRecentTokens?: number;
  /**
   * Maximum number of recent turns the token-budget walker is allowed
   * to consider. Defaults to 2 (matches opencode's `tail_turns`).
   */
  tailTurns?: number;
  route: ModelRouteConfig | null;
  round?: number;
  sessionId: string;
  signal?: AbortSignal;
  trigger: CompactionTrigger;
  userId: string;
}

export interface ExecuteSessionCompactionResult {
  durableSummary: DurableCompactionSummary | null;
  llmErrorMessage?: string;
  llmSummary?: string;
  messagesToKeep?: Message[];
  metadata: Record<string, unknown>;
  metadataJson: string;
  retryable?: boolean;
  summary?: string;
}

interface CompactionRequestIdentity {
  clientRequestId: string;
  round: number;
  sessionId: string;
  signature: string;
  userId: string;
}

interface CompactionRequestRow {
  reservation_expired: number;
  llm_error_message: string | null;
  llm_summary: string | null;
  metadata_json: string | null;
  status: string;
  summary: string | null;
}

type CompactionRequestReservation =
  { kind: 'acquired' } | { kind: 'existing'; row: CompactionRequestRow };

function getCompactionRequestIdentity(
  input: ExecuteSessionCompactionInput,
  signature: string | undefined,
): CompactionRequestIdentity | undefined {
  if (
    !input.clientRequestId ||
    typeof input.round !== 'number' ||
    !Number.isInteger(input.round) ||
    !signature
  ) {
    return undefined;
  }

  return {
    clientRequestId: input.clientRequestId,
    round: input.round,
    sessionId: input.sessionId,
    signature,
    userId: input.userId,
  };
}

function reserveCompactionRequest(
  identity: CompactionRequestIdentity,
): CompactionRequestReservation {
  return sqliteTransaction(() => {
    const existing = sqliteGet<CompactionRequestRow>(
      `SELECT status, metadata_json, summary, llm_summary, llm_error_message
              , (status = 'reserved' AND created_at <= datetime('now', '-${COMPACTION_RESERVATION_LEASE_MINUTES} minutes')) AS reservation_expired
       FROM compaction_requests
       WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND round = ? AND signature = ?`,
      [
        identity.sessionId,
        identity.userId,
        identity.clientRequestId,
        identity.round,
        identity.signature,
      ],
    );
    if (existing && existing.reservation_expired !== 1) {
      return { kind: 'existing', row: existing };
    }

    if (existing) {
      sqliteRun(
        `DELETE FROM compaction_requests
         WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND round = ?
           AND signature = ? AND status = 'reserved'`,
        [
          identity.sessionId,
          identity.userId,
          identity.clientRequestId,
          identity.round,
          identity.signature,
        ],
      );
    }

    sqliteRun(
      `INSERT INTO compaction_requests
       (session_id, user_id, client_request_id, round, signature, status)
       VALUES (?, ?, ?, ?, ?, 'reserved')`,
      [
        identity.sessionId,
        identity.userId,
        identity.clientRequestId,
        identity.round,
        identity.signature,
      ],
    );
    return { kind: 'acquired' };
  });
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCompactionRequestMetadata(metadataJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    if (isMetadataRecord(parsed)) {
      return parsed;
    }
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }
  return {};
}

export function pruneMessagesForCompaction(
  messages: Message[],
  options: { keepRecentToolResults?: number } = {},
): Message[] {
  const keepRecentToolResults = options.keepRecentToolResults ?? 2;
  const toolResultPositions: Array<{ contentIndex: number; messageIndex: number }> = [];

  messages.forEach((message, messageIndex) => {
    message.content.forEach((content, contentIndex) => {
      if (content.type === 'tool_result') {
        toolResultPositions.push({ messageIndex, contentIndex });
      }
    });
  });

  const keepStartIndex = Math.max(0, toolResultPositions.length - keepRecentToolResults);
  const keepKeys = new Set(
    toolResultPositions
      .slice(keepStartIndex)
      .map((item) => `${item.messageIndex}:${item.contentIndex}`),
  );

  return messages.map((message, messageIndex) => ({
    ...message,
    content: message.content.map((content, contentIndex) => {
      if (content.type !== 'tool_result') {
        return content;
      }

      if (keepKeys.has(`${messageIndex}:${contentIndex}`)) {
        return content;
      }

      return {
        ...content,
        output: PRUNED_TOOL_RESULT_PLACEHOLDER,
      };
    }),
  }));
}

/**
 * Calculate the split index for compaction, preserving tool_call/tool_result
 * pairing and ensuring the kept tail has a valid conversation start.
 * Returns the index at which to split: messages[:splitIndex] are summarized,
 * messages[splitIndex:] are kept verbatim.
 */
export function calculateKeepBoundary(messages: Message[], recentMessagesKept: number): number {
  if (messages.length === 0) {
    return 0;
  }

  // recentMessagesKept = 0 means summarize everything, keep nothing verbatim
  if (recentMessagesKept <= 0) {
    return messages.length;
  }

  const splitIndex = Math.max(0, messages.length - recentMessagesKept);
  if (splitIndex === 0) {
    return 0;
  }

  return adjustBoundaryForToolPairing(messages, splitIndex);
}

/**
 * Adjust a boundary index so that tool_call/tool_result pairs are not split
 * across the summarize/keep divide. Moves the boundary backward (more messages
 * summarized) when a tool_call in the kept section has its tool_result in
 * the summarized section, or forward when a tool_result in the kept section
 * has its tool_call in the summarized section.
 */
function adjustBoundaryForToolPairing(messages: Message[], boundary: number): number {
  let adjusted = boundary;

  // Collect tool_call IDs in the summarized section
  const summarizedToolCallIds = new Set<string>();
  for (let index = 0; index < adjusted; index += 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    for (const content of message.content) {
      if (content.type === 'tool_call') {
        summarizedToolCallIds.add(content.toolCallId);
      }
    }
  }

  // Collect tool_call IDs in the kept section
  const keptToolCallIds = new Set<string>();
  for (let index = adjusted; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === 'assistant') {
      for (const content of message.content) {
        if (content.type === 'tool_call') {
          keptToolCallIds.add(content.toolCallId);
        }
      }
    }
  }

  // Check tool_result messages in the kept section: if any reference a
  // tool_call in the summarized section, move boundary backward to include
  // that assistant message (and its tool_call) in the summarized section.
  for (let index = adjusted; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    extractToolResultContentsFromMessage(message).forEach((content) => {
      if (summarizedToolCallIds.has(content.toolCallId)) {
        adjusted = Math.min(adjusted + 1, messages.length);
      }
    });
  }

  // Check tool_call messages in the kept section: if any have their
  // tool_result in the summarized section, move boundary backward to
  // include the tool_call in the summarized section instead.
  for (let index = adjusted; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') continue;
    for (const content of message.content) {
      if (
        content.type === 'tool_call' &&
        !messages.some(
          (m, mIdx) =>
            mIdx >= adjusted &&
            extractToolResultContentsFromMessage(m).some(
              (c) => c.toolCallId === content.toolCallId,
            ),
        )
      ) {
        // tool_result is in summarized section — move boundary backward
        adjusted = Math.max(0, adjusted - 1);
      }
    }
  }

  // Ensure the kept section starts with a valid first message for the API
  // (must be 'user' or 'system', not 'assistant' or 'tool')
  while (
    adjusted < messages.length &&
    messages[adjusted] !== undefined &&
    messages[adjusted]?.role !== 'user' &&
    messages[adjusted]?.role !== 'system'
  ) {
    adjusted += 1;
  }

  return adjusted;
}

/** Read consecutive auto-compaction failure count from session metadata. */
export function readConsecutiveCompactionFailures(metadataJson: string): number {
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const count = record['consecutiveCompactionFailures'];
      return typeof count === 'number' ? count : 0;
    }
  } catch {
    // ignore parse errors
  }
  return 0;
}

/** Check if the circuit-breaker has tripped for auto-compaction. */
export function isAutoCompactCircuitBreakerTripped(metadataJson: string): boolean {
  return readConsecutiveCompactionFailures(metadataJson) >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
}

export async function executeSessionCompaction(
  input: ExecuteSessionCompactionInput,
): Promise<ExecuteSessionCompactionResult> {
  const recentMessagesKept = input.recentMessagesKept ?? 0;
  // Prefer the opencode-style token-budget tail selection when the
  // caller passes `preserveRecentTokens`. Falls back to the legacy
  // message-count walker if no tail fits or the budget is unset.
  const tailSelection =
    typeof input.preserveRecentTokens === 'number' && input.preserveRecentTokens > 0
      ? selectTailByTokenBudget({
          messages: input.messages,
          preserveRecentTokens: boundPreserveTokens(input.preserveRecentTokens),
          maxTurns: input.tailTurns ?? 2,
        })
      : undefined;
  const keepBoundary =
    tailSelection && tailSelection.boundary < input.messages.length
      ? tailSelection.boundary
      : calculateKeepBoundary(input.messages, recentMessagesKept);
  const tailStartMessageId =
    tailSelection?.tailStartMessageId ??
    (keepBoundary > 0 && keepBoundary < input.messages.length
      ? input.messages[keepBoundary]?.id
      : undefined);
  const messagesToSummarize = input.messages.slice(0, keepBoundary);
  const messagesToKeep = keepBoundary > 0 ? input.messages.slice(keepBoundary) : [];
  // Suppress lint: kept for telemetry surface even when not yet exported in the result.
  void MIN_PRESERVE_RECENT_TOKENS;

  // If there are no messages to summarize, nothing to compact
  if (messagesToSummarize.length === 0) {
    const metadata = {
      ...mergeCompactionMetadata(input.metadataJson, {
        summary: '',
        trigger: input.trigger,
        recentMessagesKept,
      }),
      lastCompactionLlmSummary: '',
      consecutiveCompactionFailures: 0,
    };
    const metadataJson = JSON.stringify(metadata);
    return {
      durableSummary: null,
      messagesToKeep,
      metadata,
      metadataJson,
      summary: '',
    };
  }

  const existingMemory = readPersistedCompactionMemory(input.metadataJson);
  // Anchor-update path: when the session has already been compacted before,
  // pass the previous LLM summary back as the anchor so the model can
  // merge new facts in place instead of re-summarising from scratch.
  // Mirrors opencode #23870.
  const previousLlmSummary = readLastCompactionLlmSummary(input.metadataJson);
  const durableSummary = buildDurableCompactionSummary({
    existingMemory,
    messages: messagesToSummarize,
    recentMessagesKept,
    trigger: input.trigger,
  });
  const signature = durableSummary?.signature;
  const compactionRequest = getCompactionRequestIdentity(input, signature);
  const reservation = compactionRequest ? reserveCompactionRequest(compactionRequest) : undefined;
  const fallbackSummary =
    durableSummary?.structuredSummary ??
    buildStructuredCompactionSummary({
      messages: messagesToSummarize,
      recentMessagesKept,
      trigger: input.trigger,
    });

  if (reservation?.kind === 'existing') {
    const isCompleted = reservation.row.status === 'completed';
    if (!isCompleted) {
      return {
        durableSummary,
        llmErrorMessage: 'compaction request is in progress; retry this request',
        ...(messagesToKeep.length > 0 ? { messagesToKeep } : {}),
        metadata: parseCompactionRequestMetadata(input.metadataJson),
        metadataJson: input.metadataJson,
        retryable: true,
      };
    }
    const metadataJson = reservation.row.metadata_json ?? input.metadataJson;
    const metadata = parseCompactionRequestMetadata(metadataJson);
    const summary = reservation.row.summary ?? fallbackSummary;

    return {
      durableSummary,
      ...(reservation.row.llm_error_message
        ? { llmErrorMessage: reservation.row.llm_error_message }
        : {}),
      ...(reservation.row.llm_summary ? { llmSummary: reservation.row.llm_summary } : {}),
      ...(messagesToKeep.length > 0 ? { messagesToKeep } : {}),
      metadata,
      metadataJson,
      summary,
    };
  }

  const previousFailures = readConsecutiveCompactionFailures(input.metadataJson);
  const tripsAutomaticCircuitBreaker =
    input.trigger === 'automatic' && previousFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
  let llmSummary: string | undefined;
  let llmErrorMessage = tripsAutomaticCircuitBreaker
    ? `automatic compaction circuit breaker tripped after ${MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES} consecutive failures`
    : undefined;
  if (input.route && !tripsAutomaticCircuitBreaker) {
    const prunedMessages =
      input.prune === false ? messagesToSummarize : pruneMessagesForCompaction(messagesToSummarize);
    // `NormalizedConversationMessage` and `UnifiedMessage` are
    // structurally equivalent for the role/content/toolCalls/reasoning
    // fields the compaction LLM consumes; we cast at the boundary so
    // `callCompactionLlm` (which now consumes `UnifiedMessage[]`)
    // does not re-encode the same shape.
    const conversationMessages = buildPreparedUpstreamConversation(prunedMessages, {
      contextWindow: 1,
      metadataJson: input.metadataJson,
      persistedMemory: existingMemory,
    }).normalizedMessages as unknown as UnifiedMessage[];
    try {
      const result = await callCompactionLlm({
        conversationMessages,
        route: input.route,
        sessionId: input.sessionId,
        signal: input.signal,
        ...(previousLlmSummary ? { previousSummary: previousLlmSummary } : {}),
      });
      llmSummary = result.summary;
    } catch (error: unknown) {
      llmErrorMessage = error instanceof Error ? error.message : 'unknown compaction llm error';
    }
  }

  const summary = llmSummary ?? fallbackSummary;

  const isFailure = !!llmErrorMessage;
  const nextFailures = isFailure
    ? Math.min(previousFailures + 1, MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES)
    : 0;

  const metadata = {
    ...mergeCompactionMetadata(input.metadataJson, {
      persistedMemory: durableSummary?.persistedMemory,
      summary,
      trigger: input.trigger,
      omittedMessages: durableSummary?.totalRepresentedMessages ?? messagesToSummarize.length,
      recentMessagesKept,
      signature: durableSummary?.signature,
    }),
    lastCompactionLlmSummary: summary,
    consecutiveCompactionFailures: nextFailures,
  };
  const metadataJson = JSON.stringify(metadata);

  try {
    sqliteTransaction(() => {
      sqliteRun(
        "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [metadataJson, input.sessionId, input.userId],
      );

      appendCompactionMarkerMessage({
        sessionId: input.sessionId,
        userId: input.userId,
        persistedMemory: durableSummary?.persistedMemory,
        signature,
        summary,
        trigger: input.trigger,
        omittedMessages: durableSummary?.totalRepresentedMessages ?? messagesToSummarize.length,
        ...(tailStartMessageId ? { tailStartMessageId } : {}),
        ...(input.clientRequestId && typeof input.round === 'number' && signature
          ? {
              clientRequestId: `compaction-marker:${input.clientRequestId}:${input.round}:${signature}`,
            }
          : {}),
      });

      if (compactionRequest) {
        sqliteRun(
          `UPDATE compaction_requests
           SET status = 'completed', metadata_json = ?, summary = ?, llm_summary = ?,
               llm_error_message = ?, completed_at = datetime('now')
           WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND round = ?
             AND signature = ? AND status = 'reserved'`,
          [
            metadataJson,
            summary,
            llmSummary,
            llmErrorMessage,
            compactionRequest.sessionId,
            compactionRequest.userId,
            compactionRequest.clientRequestId,
            compactionRequest.round,
            compactionRequest.signature,
          ],
        );
      }
    });
  } catch (error: unknown) {
    if (compactionRequest) {
      sqliteRun(
        `DELETE FROM compaction_requests
         WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND round = ?
           AND signature = ? AND status = 'reserved'`,
        [
          compactionRequest.sessionId,
          compactionRequest.userId,
          compactionRequest.clientRequestId,
          compactionRequest.round,
          compactionRequest.signature,
        ],
      );
    }
    throw error;
  }

  return {
    durableSummary,
    ...(llmErrorMessage ? { llmErrorMessage } : {}),
    ...(llmSummary ? { llmSummary } : {}),
    ...(messagesToKeep.length > 0 ? { messagesToKeep } : {}),
    metadata,
    metadataJson,
    summary,
  };
}
