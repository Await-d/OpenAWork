import type { AssistantTraceToolCall, Message } from '@openAwork/shared';
import type { ChatMessage } from './message-model.js';
import {
  getComparableCreatedAt,
  joinReasoningBlocks,
  normalizeCreatedAt,
} from './message-coercion.js';
import { parseAssistantEventContent } from './card-codec.js';
import {
  areLikelySameNearbyUserMessage,
  areLogicalMessageDuplicates,
  areMessagesSeparatedByUserTurn,
  areSameAssistantMessageContent,
  areSnapshotMessagesEquivalent,
  areStronglyIdenticalMessages,
  hasOverlappingPartIds,
  hasUserMessageBetween,
} from './message-equivalence.js';
import { buildReadableAssistantText } from './reasoning-content.js';
import {
  contentFromParts,
  createAssistantTraceContent,
  readAssistantTracePayload,
  reconcilePartsById,
} from './trace-codec.js';

export function toSharedMessageSnapshot(messages: ChatMessage[]): Message[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: normalizeCreatedAt(message.createdAt),
    content:
      message.role === 'assistant'
        ? [
            {
              type: 'text',
              text: (() => {
                const assistantTrace = readAssistantTracePayload(message);
                return assistantTrace
                  ? buildReadableAssistantText(assistantTrace.text, assistantTrace.reasoningBlocks)
                  : message.content;
              })(),
            },
          ]
        : message.rawContent && message.rawContent.length > 0
          ? message.rawContent
          : [{ type: 'text', text: message.content }],
  }));
}

export function reconcileSnapshotChatMessages(
  previousMessages: ChatMessage[],
  snapshotMessages: ChatMessage[],
): ChatMessage[] {
  if (previousMessages.length === 0 || snapshotMessages.length === 0) {
    return snapshotMessages.length === 0 ? previousMessages : snapshotMessages;
  }

  // Build an index of previous messages by ID for O(1) lookup.
  const previousById = new Map<string, { message: ChatMessage; index: number }>();
  for (let index = 0; index < previousMessages.length; index++) {
    const message = previousMessages[index]!;
    previousById.set(message.id, { message, index });
  }

  // Track which previous messages have been matched so we can preserve unmatched
  // assistant event cards near their original anchors without duplicating them later.
  const matchedPreviousIndices = new Set<number>();
  const preservedPreviousIndices = new Set<number>();
  const reconciledSnapshotEntries: Array<{
    matchedPreviousIndex: number | null;
    message: ChatMessage;
  }> = [];

  // Walk through snapshot messages in server order (canonical order).
  for (const [snapshotIndex, snapshotMessage] of snapshotMessages.entries()) {
    const previousEntry = previousById.get(snapshotMessage.id);

    if (previousEntry) {
      // Same ID — use parts-based merge (opencode pattern).
      matchedPreviousIndices.add(previousEntry.index);
      const previousMessage = previousEntry.message;

      if (previousMessage.status === 'streaming' && snapshotMessage.status !== 'streaming') {
        // Snapshot has a finalized version (e.g. completed/error), prefer it.
        // Still keep a locally known cancelled/error terminal if the snapshot
        // only brought a generic completed payload.
        const mergedParts =
          previousMessage.parts && snapshotMessage.parts
            ? reconcilePartsById(previousMessage.parts, snapshotMessage.parts)
            : snapshotMessage.parts;
        reconciledSnapshotEntries.push({
          matchedPreviousIndex: previousEntry.index,
          message: {
            ...snapshotMessage,
            ...(mergedParts
              ? {
                  parts: mergedParts,
                  content: contentFromParts(
                    mergedParts,
                    snapshotMessage.modifiedFilesSummary ?? previousMessage.modifiedFilesSummary,
                  ),
                }
              : {}),
            ...preferLocalTerminalStatus(previousMessage, snapshotMessage),
          },
        });
      } else if (previousMessage.parts && snapshotMessage.parts) {
        // Both have parts — merge by part ID (find → replace or push).
        const mergedParts = reconcilePartsById(previousMessage.parts, snapshotMessage.parts);
        reconciledSnapshotEntries.push({
          matchedPreviousIndex: previousEntry.index,
          message: {
            ...previousMessage,
            parts: mergedParts,
            content: contentFromParts(
              mergedParts,
              previousMessage.modifiedFilesSummary ?? snapshotMessage.modifiedFilesSummary,
            ),
            modifiedFilesSummary:
              snapshotMessage.modifiedFilesSummary ?? previousMessage.modifiedFilesSummary,
            ...preferLocalTerminalStatus(previousMessage, snapshotMessage),
          },
        });
      } else {
        // Fallback: prefer previous to preserve local annotations, but merge
        // if the snapshot has more complete text content.
        const merged = mergePreferringCompleteContent(previousMessage, snapshotMessage);
        reconciledSnapshotEntries.push({
          matchedPreviousIndex: previousEntry.index,
          message: {
            ...merged,
            ...preferLocalTerminalStatus(previousMessage, snapshotMessage),
          },
        });
      }
    } else {
      // No ID match — check if a previous message at a nearby position shares
      // overlapping part IDs or equivalent content (handles server assigning
      // a different message ID for the same logical message).
      // Use a wider forward window (+5) to skip over locally-appended event
      // cards (permission events, compaction cards, etc.) that the server
      // snapshot does not include.
      let foundEquivalent = false;
      for (let offset = -1; offset <= 5 && !foundEquivalent; offset++) {
        const candidateIndex = reconciledSnapshotEntries.length + offset;
        if (
          candidateIndex >= 0 &&
          candidateIndex < previousMessages.length &&
          !matchedPreviousIndices.has(candidateIndex) &&
          !hasUserMessageBetween(previousMessages, candidateIndex, snapshotIndex)
        ) {
          const candidate = previousMessages[candidateIndex]!;
          const matchedByParts = hasOverlappingPartIds(candidate.parts, snapshotMessage.parts);
          const matchedByNearbyUserMessage = areLikelySameNearbyUserMessage(
            candidate,
            snapshotMessage,
          );
          const matchedByAssistantContent = areSameAssistantMessageContent(
            candidate,
            snapshotMessage,
          );
          if (
            matchedByParts ||
            matchedByNearbyUserMessage ||
            matchedByAssistantContent ||
            areSnapshotMessagesEquivalent(candidate, snapshotMessage)
          ) {
            matchedPreviousIndices.add(candidateIndex);
            const mergedParts =
              matchedByParts && candidate.parts && snapshotMessage.parts
                ? reconcilePartsById(candidate.parts, snapshotMessage.parts)
                : undefined;
            const mergedMessage =
              mergedParts !== undefined
                ? {
                    ...snapshotMessage,
                    parts: mergedParts,
                    content: contentFromParts(
                      mergedParts,
                      snapshotMessage.modifiedFilesSummary ?? candidate.modifiedFilesSummary,
                    ),
                  }
                : candidate.parts && !snapshotMessage.parts
                  ? {
                      ...snapshotMessage,
                      parts: candidate.parts,
                      content: contentFromParts(
                        candidate.parts,
                        snapshotMessage.modifiedFilesSummary ?? candidate.modifiedFilesSummary,
                      ),
                    }
                  : snapshotMessage;
            reconciledSnapshotEntries.push({
              matchedPreviousIndex: candidateIndex,
              // Keep the server identity/terminal metadata, but retain the
              // live part order whenever both sides describe the same trace.
              message:
                mergedParts !== undefined
                  ? mergedMessage
                  : matchedByParts || matchedByNearbyUserMessage || matchedByAssistantContent
                    ? mergedMessage
                    : candidate,
            });
            foundEquivalent = true;
          }
        }
      }

      if (!foundEquivalent) {
        // Genuinely new message from the server.
        reconciledSnapshotEntries.push({ matchedPreviousIndex: null, message: snapshotMessage });
      }
    }
  }

  const reconciled: ChatMessage[] = [];
  let nextPreviousIndex = 0;

  const preserveInterleavedAssistantEventsBefore = (matchedPreviousIndex: number) => {
    while (nextPreviousIndex < matchedPreviousIndex) {
      if (!matchedPreviousIndices.has(nextPreviousIndex)) {
        const previousMessage = previousMessages[nextPreviousIndex]!;
        if (
          previousMessage.status !== 'streaming' &&
          parseAssistantEventContent(previousMessage.content)
        ) {
          preservedPreviousIndices.add(nextPreviousIndex);
          reconciled.push(previousMessage);
        }
      }
      nextPreviousIndex += 1;
    }
  };

  for (const entry of reconciledSnapshotEntries) {
    if (entry.matchedPreviousIndex !== null) {
      preserveInterleavedAssistantEventsBefore(entry.matchedPreviousIndex);
      reconciled.push(entry.message);
      nextPreviousIndex = entry.matchedPreviousIndex + 1;
      continue;
    }

    reconciled.push(entry.message);
  }

  // Append any previous messages that were not matched (local-only, e.g. event cards
  // appended during streaming that the server snapshot hasn't synced yet).
  // Before appending, check that no content-equivalent message already exists in
  // the reconciled list — this prevents duplication when the server snapshot assigns
  // a different ID to the same logical message the client created locally.
  for (let index = 0; index < previousMessages.length; index++) {
    if (!matchedPreviousIndices.has(index) && !preservedPreviousIndices.has(index)) {
      const previousMessage = previousMessages[index]!;
      // Only preserve completed local messages; skip streaming placeholders
      // that should have been replaced by the snapshot.
      if (previousMessage.status === 'streaming') {
        continue;
      }

      // Check if an equivalent message already exists in reconciled output
      // (e.g. the snapshot contains the same message under a different ID).
      const alreadyPresent = reconciled.some(
        (existing) =>
          existing.id !== previousMessage.id &&
          areSnapshotMessagesEquivalent(existing, previousMessage) &&
          !areMessagesSeparatedByUserTurn(existing, previousMessage, previousMessages),
      );
      if (alreadyPresent) {
        continue;
      }

      const previousCreatedAt = getComparableCreatedAt(previousMessage.createdAt);
      const snapshotHasDifferentRequest = snapshotMessages.some(
        (snapshotMessage) =>
          previousMessage.clientRequestId !== undefined &&
          snapshotMessage.clientRequestId !== undefined &&
          previousMessage.clientRequestId !== snapshotMessage.clientRequestId,
      );
      // A *trailing* local message is either the newest turn the snapshot has
      // not persisted yet, or — when the snapshot re-issued that turn under a
      // new id (recovery re-projection) — a stale copy of it. In both shapes the
      // snapshot's tail order stays authoritative, so append it. Only interior
      // unmatched messages (an earlier round the snapshot omitted entirely) are
      // positioned by `createdAt`, otherwise they would render after turns that
      // came later.
      const isTrailingLocalMessage = index === previousMessages.length - 1;
      if (previousCreatedAt === null || snapshotHasDifferentRequest || isTrailingLocalMessage) {
        reconciled.push(previousMessage);
        continue;
      }
      const insertionIndex = reconciled.findIndex((candidate) => {
        const candidateCreatedAt = getComparableCreatedAt(candidate.createdAt);
        return candidateCreatedAt !== null && candidateCreatedAt > previousCreatedAt;
      });
      if (insertionIndex === -1) {
        reconciled.push(previousMessage);
      } else {
        reconciled.splice(insertionIndex, 0, previousMessage);
      }
    }
  }

  // 最终去重：实时提交、快照刷新和恢复投影可能给同一回合分配不同
  // message id。仅按 id 去重会把这些逻辑副本一起交给渲染层。
  const snapshotMessageIds = new Set(snapshotMessages.map((message) => message.id));
  const deduplicated: ChatMessage[] = [];
  for (const message of reconciled) {
    const duplicateIndex = deduplicated.findIndex((existing) => {
      // 两条消息都来自权威快照时，它们是各自独立持久化的消息：只有强身份
      // 才能判为重复。模糊等价仅用于把本地乐观副本与其快照孪生配对，
      // 否则同一回合的相邻两轮（文本相同且时间接近）会被错误合并而丢失。
      if (snapshotMessageIds.has(existing.id) && snapshotMessageIds.has(message.id)) {
        return areStronglyIdenticalMessages(existing, message);
      }
      return areLogicalMessageDuplicates(existing, message);
    });
    const hasUserTurnBetween =
      duplicateIndex >= 0 &&
      areMessagesSeparatedByUserTurn(deduplicated[duplicateIndex]!, message, reconciled);
    if (duplicateIndex < 0 || hasUserTurnBetween) {
      deduplicated.push(message);
      continue;
    }

    // Keep the first entry's position, but let the later snapshot contribute
    // terminal status/output and the newer ordered parts.
    const existing = deduplicated[duplicateIndex]!;
    deduplicated[duplicateIndex] = chooseMoreCompleteMessage(existing, message);
  }

  return deduplicated;
}

function chooseMoreCompleteMessage(left: ChatMessage, right: ChatMessage): ChatMessage {
  const leftParts = left.parts?.length ?? 0;
  const rightParts = right.parts?.length ?? 0;
  if (rightParts > leftParts) return right;
  if (right.status !== 'streaming' && left.status === 'streaming') return right;
  return left;
}

function preferLocalTerminalStatus(
  previous: ChatMessage,
  snapshot: ChatMessage,
): Pick<ChatMessage, 'status' | 'stopReason'> {
  const previousIsTerminal =
    previous.status === 'error' ||
    previous.status === 'cancelled' ||
    previous.stopReason === 'error' ||
    previous.stopReason === 'cancelled';
  const snapshotIsGenericCompleted =
    snapshot.status === undefined ||
    snapshot.status === 'completed' ||
    snapshot.status === 'streaming';

  if (previousIsTerminal && snapshotIsGenericCompleted) {
    return {
      ...(previous.status ? { status: previous.status } : {}),
      ...(previous.stopReason ? { stopReason: previous.stopReason } : {}),
    };
  }

  return {
    ...(snapshot.status
      ? { status: snapshot.status }
      : previous.status
        ? { status: previous.status }
        : {}),
    ...(snapshot.stopReason
      ? { stopReason: snapshot.stopReason }
      : previous.stopReason
        ? { stopReason: previous.stopReason }
        : {}),
  };
}

/**
 * When the previous message and snapshot share the same ID and are both non-streaming,
 * prefer the previous message's local annotations (tool call states, pending permissions)
 * but adopt the snapshot's text if it is strictly longer (more complete).
 */
function mergePreferringCompleteContent(previous: ChatMessage, snapshot: ChatMessage): ChatMessage {
  if (previous.role !== 'assistant') return previous;

  const prevTrace = readAssistantTracePayload(previous);
  const snapTrace = readAssistantTracePayload(snapshot);
  if (!prevTrace || !snapTrace) return previous;

  // Only merge if snapshot has strictly more content (text or reasoning).
  const prevText = prevTrace.text.trim();
  const snapText = snapTrace.text.trim();
  const prevReasoningLen = joinReasoningBlocks(prevTrace.reasoningBlocks).length;
  const snapReasoningLen = joinReasoningBlocks(snapTrace.reasoningBlocks).length;
  if (snapText.length <= prevText.length && snapReasoningLen <= prevReasoningLen) return previous;

  // Merge: use snapshot's text but preserve previous's local tool call annotations.
  const mergedToolCalls: AssistantTraceToolCall[] = snapTrace.toolCalls.map((snapTC) => {
    const prevTC = prevTrace.toolCalls.find((tc) => tc.toolCallId === snapTC.toolCallId);
    if (!prevTC) return snapTC;

    return {
      ...snapTC,
      ...(prevTC.pendingPermissionRequestId
        ? { pendingPermissionRequestId: prevTC.pendingPermissionRequestId }
        : {}),
      ...(prevTC.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
      status: prevTC.status !== 'running' ? prevTC.status : snapTC.status,
    } satisfies AssistantTraceToolCall;
  });

  return {
    ...previous,
    content: createAssistantTraceContent({
      text: snapText,
      toolCalls: mergedToolCalls,
      ...(snapTrace.reasoningBlocks && snapTrace.reasoningBlocks.length > 0
        ? { reasoningBlocks: snapTrace.reasoningBlocks }
        : prevTrace.reasoningBlocks && prevTrace.reasoningBlocks.length > 0
          ? { reasoningBlocks: prevTrace.reasoningBlocks }
          : {}),
      ...(snapTrace.modifiedFilesSummary
        ? { modifiedFilesSummary: snapTrace.modifiedFilesSummary }
        : {}),
    }),
    modifiedFilesSummary: snapTrace.modifiedFilesSummary ?? previous.modifiedFilesSummary,
    ...preferLocalTerminalStatus(previous, snapshot),
  };
}

