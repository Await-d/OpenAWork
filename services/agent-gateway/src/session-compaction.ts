import type { Message } from '@openAwork/shared';
import { callCompactionLlm } from './compaction-llm.js';
import {
  mergeCompactionMetadata,
  readLastCompactionLlmSummary,
  readPersistedCompactionMemory,
  type CompactionTrigger,
} from './compaction-metadata.js';
import { sqliteRun } from './db.js';
import type { ModelRouteConfig } from './model-router.js';
import {
  buildDurableCompactionSummary,
  buildPreparedUpstreamConversation,
  buildStructuredCompactionSummary,
  hasCompactionMarker,
  type DurableCompactionSummary,
} from './session-message-store.js';
import { appendCompactionMarkerMessageV2 as appendCompactionMarkerMessage } from './message-v2-adapter.js';

/** Maximum consecutive auto-compaction failures before circuit-breaker trips. */
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

const PRUNED_TOOL_RESULT_PLACEHOLDER = '[Old tool result content cleared by compaction prune]';

export interface ExecuteSessionCompactionInput {
  legacyMessagesJson?: string;
  metadataJson: string;
  messages: Message[];
  prune?: boolean;
  /** Number of recent messages to keep verbatim after compaction.
   * When > 0, only messages before the keep-boundary are summarized;
   * the boundary is adjusted to preserve tool_call/tool_result pairing. */
  recentMessagesKept?: number;
  route: ModelRouteConfig | null;
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
  summary: string;
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
    if (!message || message.role !== 'tool') continue;
    for (const content of message.content) {
      if (content.type === 'tool_result' && summarizedToolCallIds.has(content.toolCallId)) {
        // This tool_result belongs to a summarized tool_call — keep it together
        // by moving boundary forward past this tool message
        adjusted = Math.min(adjusted + 1, messages.length);
      }
    }
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
            m.role === 'tool' &&
            m.content.some((c) => c.type === 'tool_result' && c.toolCallId === content.toolCallId),
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
  const keepBoundary = calculateKeepBoundary(input.messages, recentMessagesKept);
  const messagesToSummarize = input.messages.slice(0, keepBoundary);
  const messagesToKeep = keepBoundary > 0 ? input.messages.slice(keepBoundary) : [];

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
  const durableSummary = buildDurableCompactionSummary({
    existingMemory,
    messages: messagesToSummarize,
    recentMessagesKept,
    trigger: input.trigger,
  });

  let llmSummary: string | undefined;
  let llmErrorMessage: string | undefined;
  if (input.route) {
    const prunedMessages =
      input.prune === false ? messagesToSummarize : pruneMessagesForCompaction(messagesToSummarize);
    const markerPresent = hasCompactionMarker(prunedMessages);
    const conversationMessages = buildPreparedUpstreamConversation(prunedMessages, {
      contextWindow: 1,
      ...(markerPresent
        ? {}
        : {
            llmCompactionSummary: readLastCompactionLlmSummary(input.metadataJson),
            persistedMemory: existingMemory,
          }),
    }).messages;
    try {
      const result = await callCompactionLlm({
        conversationMessages,
        route: input.route,
        signal: input.signal,
      });
      llmSummary = result.summary;
    } catch (error: unknown) {
      llmErrorMessage = error instanceof Error ? error.message : 'unknown compaction llm error';
    }
  }

  const summary =
    llmSummary ??
    durableSummary?.structuredSummary ??
    buildStructuredCompactionSummary({
      messages: messagesToSummarize,
      recentMessagesKept,
      trigger: input.trigger,
    });

  const isFailure = !!llmErrorMessage;
  const prevFailures = readConsecutiveCompactionFailures(input.metadataJson);
  const nextFailures = isFailure ? prevFailures + 1 : 0;

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

  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [metadataJson, input.sessionId, input.userId],
  );

  appendCompactionMarkerMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    legacyMessagesJson: input.legacyMessagesJson,
    persistedMemory: durableSummary?.persistedMemory,
    signature: durableSummary?.signature,
    summary,
    trigger: input.trigger,
    omittedMessages: durableSummary?.totalRepresentedMessages ?? messagesToSummarize.length,
  });

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
