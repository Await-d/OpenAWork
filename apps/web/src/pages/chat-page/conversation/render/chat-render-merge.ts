import type { ChatRenderEntry } from '../../../../components/chat/message/chat-message-group-list.js';
import {
  parseAssistantEventContent,
  readAssistantTracePayload,
  type ChatMessagePart,
} from '../../../../components/conversation-runtime/messages/support.js';

/** Matches the `msg_` ordered-id prefix (mirrors `ordered-id.ts`). */
const ORDERED_MESSAGE_ID_PATTERN = /^msg_[0-9a-f]{12}/;

function isDerivedAssistantRequestId(value: string | undefined, requestId: string): boolean {
  if (!value?.startsWith(`${requestId}:assistant:`)) {
    return false;
  }

  const round = value.slice(`${requestId}:assistant:`.length);
  return (
    round.length > 0 && Array.from(round).every((character) => character >= '0' && character <= '9')
  );
}

/**
 * Ordered ids (`msg_<12-hex-timestamp><14-random>` — see `ordered-id.ts`) sort
 * lexicographically by creation time, which makes them a *stronger* ordering
 * signal than `createdAt`.
 *
 * The live overlay's `createdAt` is the **request** start: neither the gateway
 * nor the client records a per-round start time, so the streaming bubble always
 * looks older than the rounds of that same request that were already committed.
 * Comparing timestamps directly therefore hoisted the streaming bubble above its
 * own earlier rounds mid-stream.
 *
 * Returns null when either side is not an ordered id (e.g. ids written by an
 * older gateway), so callers can fall back to timestamps.
 */
function compareOrderedMessageIds(left: string, right: string): number | null {
  if (!ORDERED_MESSAGE_ID_PATTERN.test(left) || !ORDERED_MESSAGE_ID_PATTERN.test(right)) {
    return null;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function toComparableTimestamp(value: number | string | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasSharedTracePart(
  left: ChatMessagePart[] | undefined,
  right: ChatMessagePart[] | undefined,
) {
  if (!left || !right || left.length === 0 || right.length === 0) return false;
  const rightIds = new Set(right.map((part) => part.id));
  return left.some((part) => rightIds.has(part.id));
}

function hasSharedToolCall(
  left: ChatMessagePart[] | undefined,
  right: ChatMessagePart[] | undefined,
) {
  if (!left || !right) return false;
  const rightToolIds = new Set(
    right.filter((part) => part.type === 'tool').map((part) => part.toolCallId),
  );
  return left.some((part) => part.type === 'tool' && rightToolIds.has(part.toolCallId));
}

function hasSameVisibleText(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const a = normalize(left);
  const b = normalize(right);
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  if (a.length < 8 || b.length < 8) return false;
  return a.length < b.length ? b.startsWith(a) : a.startsWith(b);
}

/**
 * Index of the last user message, or -1 when the transcript has none. The live
 * assistant overlay must always render after it: the bubble answers that turn.
 */
function findLastUserEntryIndex(entries: ChatRenderEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.message.role === 'user') {
      return index;
    }
  }
  return -1;
}

function visibleAssistantText(message: ChatRenderEntry['message']): string {
  if (message.role !== 'assistant') return message.content;
  const trace = readAssistantTracePayload(message);
  return trace?.text ?? message.content;
}

export function mergeStreamingEntryIntoHistoricalEntries(
  historicalRenderedMessageEntries: ChatRenderEntry[],
  streamingRenderedMessageEntry: ChatRenderEntry | null,
  activeStreamMessageId: string | null,
  activeStreamClientRequestId: string | null,
): ChatRenderEntry[] {
  if (!streamingRenderedMessageEntry) {
    return historicalRenderedMessageEntries;
  }

  const streamingMessage = streamingRenderedMessageEntry.message;
  const exactMatchIndices = historicalRenderedMessageEntries.flatMap((entry, index) => {
    const existingMessage = entry.message;
    const matchesMessageId =
      activeStreamMessageId !== null && existingMessage.id === activeStreamMessageId;
    const matchesRequestId =
      streamingMessage.role === 'assistant' &&
      activeStreamClientRequestId !== null &&
      existingMessage.role === 'assistant' &&
      existingMessage.clientRequestId === activeStreamClientRequestId;
    return matchesMessageId || matchesRequestId ? [index] : [];
  });

  if (exactMatchIndices.length > 0) {
    const firstMatchIndex = exactMatchIndices[0]!;
    const matchingIndices = new Set(exactMatchIndices);
    return historicalRenderedMessageEntries.flatMap((entry, index) => {
      if (index === firstMatchIndex) {
        return [streamingRenderedMessageEntry];
      }
      return matchingIndices.has(index) ? [] : [entry];
    });
  }

  // The gateway may persist the round under a new message ID before the
  // local streaming entry is committed. Shared part/tool IDs are a stronger
  // identity signal than timestamp ordering; otherwise the same assistant
  // response is rendered once from history and once from the live overlay.
  const traceMatchIndices = historicalRenderedMessageEntries.flatMap((entry, index) => {
    const message = entry.message;
    if (message.role !== 'assistant') return [];
    return hasSharedTracePart(message.parts, streamingMessage.parts) ||
      hasSharedToolCall(message.parts, streamingMessage.parts)
      ? [index]
      : [];
  });
  if (traceMatchIndices.length > 0) {
    const firstMatchIndex = traceMatchIndices[0]!;
    const matchingIndices = new Set(traceMatchIndices);
    return historicalRenderedMessageEntries.flatMap((entry, index) => {
      if (index === firstMatchIndex) return [streamingRenderedMessageEntry];
      return matchingIndices.has(index) ? [] : [entry];
    });
  }

  // Some recovery snapshots omit clientRequestId and parts. In that shape,
  // an exact/prefix visible-text match on the most recent assistant entries
  // is the remaining identity signal. Limit it to the tail so two separate
  // historical turns with similar wording are never collapsed.
  if (streamingMessage.role === 'assistant') {
    let assistantCandidates = 0;
    for (let index = historicalRenderedMessageEntries.length - 1; index >= 0; index -= 1) {
      const existing = historicalRenderedMessageEntries[index]!.message;
      if (existing.role !== 'assistant') continue;
      const isEventCard = parseAssistantEventContent(existing.content) !== null;
      if (!isEventCard) assistantCandidates += 1;
      if (
        hasSameVisibleText(
          visibleAssistantText(existing),
          visibleAssistantText(streamingMessage),
        ) &&
        (!existing.clientRequestId || existing.clientRequestId === activeStreamClientRequestId) &&
        (activeStreamClientRequestId !== null || (!isEventCard && assistantCandidates === 1))
      ) {
        return historicalRenderedMessageEntries.map((entry, entryIndex) =>
          entryIndex === index ? streamingRenderedMessageEntry : entry,
        );
      }
      if (assistantCandidates >= 3) break;
    }
  }

  if (streamingMessage.role === 'assistant' && activeStreamClientRequestId) {
    let lastDerivedRoundIndex = -1;
    for (let index = 0; index < historicalRenderedMessageEntries.length; index += 1) {
      const existingMessage = historicalRenderedMessageEntries[index]!.message;
      if (
        existingMessage.role === 'assistant' &&
        isDerivedAssistantRequestId(existingMessage.clientRequestId, activeStreamClientRequestId)
      ) {
        lastDerivedRoundIndex = index;
      }
    }

    if (lastDerivedRoundIndex !== -1) {
      return [
        ...historicalRenderedMessageEntries.slice(0, lastDerivedRoundIndex + 1),
        streamingRenderedMessageEntry,
        ...historicalRenderedMessageEntries.slice(lastDerivedRoundIndex + 1),
      ];
    }
  }

  // Last resort: the live overlay is the newest round of the current request, so
  // it belongs *after* everything already in the transcript. Ordered ids give
  // the exact creation order; timestamps are only a fallback because the live
  // entry's `createdAt` is the request start (see `compareOrderedMessageIds`).
  const streamingTimestamp = toComparableTimestamp(streamingMessage.createdAt);
  const laterEntryIndex = historicalRenderedMessageEntries.findIndex((entry) => {
    const orderedComparison = compareOrderedMessageIds(entry.message.id, streamingMessage.id);
    if (orderedComparison !== null) {
      return orderedComparison > 0;
    }
    const entryTimestamp = toComparableTimestamp(entry.message.createdAt);
    return (
      streamingTimestamp !== null && entryTimestamp !== null && entryTimestamp > streamingTimestamp
    );
  });
  const insertionIndex =
    laterEntryIndex === -1 ? historicalRenderedMessageEntries.length : laterEntryIndex;
  // The live bubble answers the latest user turn, so it can never be ordered
  // above it. This holds even when the placeholder's ordered id was minted
  // before the user message id (see `startStandardChatStream`) or when the
  // timestamps tie — otherwise "正在对话" would render above the question that
  // triggered it.
  const lastUserEntryIndex = findLastUserEntryIndex(historicalRenderedMessageEntries);
  const safeInsertionIndex = Math.max(insertionIndex, lastUserEntryIndex + 1);
  if (safeInsertionIndex < historicalRenderedMessageEntries.length) {
    return [
      ...historicalRenderedMessageEntries.slice(0, safeInsertionIndex),
      streamingRenderedMessageEntry,
      ...historicalRenderedMessageEntries.slice(safeInsertionIndex),
    ];
  }

  return [...historicalRenderedMessageEntries, streamingRenderedMessageEntry];
}
