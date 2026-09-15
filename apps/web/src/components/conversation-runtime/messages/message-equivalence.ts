import type { ChatInputImageItem, ChatMessage, ChatMessagePart } from './message-model.js';
import { getComparableCreatedAt, joinReasoningBlocks } from './message-coercion.js';
import { extractDisplayText, extractInputImages } from './message-content.js';
import { parseAssistantEventContent } from './card-codec.js';
import { readAssistantTracePayload } from './trace-codec.js';

const SNAPSHOT_RECONCILE_TIME_TOLERANCE_MS = 15_000;

export function hasUserMessageBetween(
  messages: ChatMessage[],
  candidateIndex: number,
  snapshotIndex: number,
): boolean {
  if (candidateIndex >= snapshotIndex) {
    return false;
  }
  return messages
    .slice(candidateIndex + 1, snapshotIndex + 1)
    .some((message) => message.role === 'user');
}

export function areMessagesSeparatedByUserTurn(
  left: ChatMessage,
  right: ChatMessage,
  messages: ChatMessage[],
): boolean {
  const leftCreatedAt = getComparableCreatedAt(left.createdAt);
  const rightCreatedAt = getComparableCreatedAt(right.createdAt);
  if (leftCreatedAt === null || rightCreatedAt === null || leftCreatedAt === rightCreatedAt) {
    return false;
  }
  const lower = Math.min(leftCreatedAt, rightCreatedAt);
  const upper = Math.max(leftCreatedAt, rightCreatedAt);
  return messages.some((entry) => {
    const createdAt = getComparableCreatedAt(entry.createdAt);
    return entry.role === 'user' && createdAt !== null && createdAt > lower && createdAt < upper;
  });
}

export function areStronglyIdenticalMessages(left: ChatMessage, right: ChatMessage): boolean {
  if (left.id === right.id) return true;
  if (left.role !== right.role) return false;
  if (
    left.clientRequestId &&
    right.clientRequestId &&
    left.clientRequestId === right.clientRequestId
  ) {
    return true;
  }
  if (left.role !== 'assistant') return false;

  const leftParts = left.parts ?? [];
  const rightParts = right.parts ?? [];
  const rightPartIds = new Set(rightParts.map((part) => part.id));
  if (leftParts.some((part) => rightPartIds.has(part.id))) return true;

  const leftToolIds = new Set(
    leftParts.filter((part) => part.type === 'tool').map((part) => part.toolCallId),
  );
  const rightToolIds = new Set(
    rightParts.filter((part) => part.type === 'tool').map((part) => part.toolCallId),
  );
  if (
    leftToolIds.size > 0 &&
    rightToolIds.size > 0 &&
    [...leftToolIds].some((toolCallId) => rightToolIds.has(toolCallId))
  ) {
    return true;
  }

  return false;
}

export function areLogicalMessageDuplicates(left: ChatMessage, right: ChatMessage): boolean {
  if (areStronglyIdenticalMessages(left, right)) return true;
  if (left.role !== right.role) return false;
  // Two messages that both carry a request id but disagree on it are provably
  // different rounds: the id encodes `${requestId}:assistant:${round}`
  // (see round-request-id.ts). The fuzzy equivalence below exists only to pair a
  // local copy that predates identity stamping with its snapshot twin; it must
  // never fold two distinct rounds that happen to share their visible text.
  if (left.clientRequestId && right.clientRequestId) return false;
  return areSnapshotMessagesEquivalent(left, right);
}

/**
 * Check whether two parts arrays share at least one part ID (tool call ID,
 * text ID, reasoning ID). Used to detect equivalent messages across different
 * message IDs — e.g. the client and server may assign different message IDs
 * to the same logical turn.
 */
export function hasOverlappingPartIds(
  a: ChatMessagePart[] | undefined,
  b: ChatMessagePart[] | undefined,
): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return false;
  const aIds = new Set(a.map((p) => p.id));
  return b.some((p) => aIds.has(p.id));
}

export function areSnapshotMessagesEquivalent(left: ChatMessage, right: ChatMessage): boolean {
  if (left.role !== right.role) {
    return false;
  }

  // Both sides carry a request id but disagree: provably different rounds
  // (the id encodes `${requestId}:assistant:${round}` — see round-request-id.ts),
  // so the text/time heuristics below must not fold them.
  if (
    left.clientRequestId &&
    right.clientRequestId &&
    left.clientRequestId !== right.clientRequestId
  ) {
    return false;
  }

  // Fast path: exact content match.
  if (left.content === right.content) {
    const leftCreatedAt = getComparableCreatedAt(left.createdAt);
    const rightCreatedAt = getComparableCreatedAt(right.createdAt);
    if (leftCreatedAt === null || rightCreatedAt === null) {
      return true;
    }
    return Math.abs(leftCreatedAt - rightCreatedAt) <= SNAPSHOT_RECONCILE_TIME_TOLERANCE_MS;
  }

  // For assistant messages, the local version (from onDone) and the server snapshot may
  // have the same text but different tool call states serialized into the content JSON.
  // Compare by the displayable text portion to catch these cases.
  if (left.role === 'assistant') {
    const leftTrace = readAssistantTracePayload(left);
    const rightTrace = readAssistantTracePayload(right);
    if (leftTrace && rightTrace) {
      const leftText = leftTrace.text.trim();
      const rightText = rightTrace.text.trim();
      // Exact text match with time tolerance.
      if (leftText === rightText && leftText.length > 0) {
        const leftCreatedAt = getComparableCreatedAt(left.createdAt);
        const rightCreatedAt = getComparableCreatedAt(right.createdAt);
        if (leftCreatedAt === null || rightCreatedAt === null) {
          return true;
        }
        return Math.abs(leftCreatedAt - rightCreatedAt) <= SNAPSHOT_RECONCILE_TIME_TOLERANCE_MS;
      }
      // Prefix match — the local finalized version (from onDone) and the
      // server snapshot may share a text prefix when the server truncated
      // or reformatted the tail. Only apply this when the shorter text is
      // at least 50% of the longer text to avoid false positives between
      // different rounds with coincidentally similar prefixes.
      // Use a longer time tolerance because long tool-call sequences can
      // span well beyond 15s.
      const shorterLen = Math.min(leftText.length, rightText.length);
      const longerLen = Math.max(leftText.length, rightText.length);
      if (
        leftText.length > 0 &&
        rightText.length > 0 &&
        longerLen > 0 &&
        shorterLen / longerLen >= 0.5 &&
        (leftText.startsWith(rightText) || rightText.startsWith(leftText))
      ) {
        const leftCreatedAt = getComparableCreatedAt(left.createdAt);
        const rightCreatedAt = getComparableCreatedAt(right.createdAt);
        if (leftCreatedAt === null || rightCreatedAt === null) {
          return true;
        }
        return Math.abs(leftCreatedAt - rightCreatedAt) <= SNAPSHOT_RECONCILE_TIME_TOLERANCE_MS * 4;
      }

      // If text is empty on both sides, compare by tool call IDs as a proxy.
      if (leftText.length === 0 && rightText.length === 0) {
        const leftToolCallIds = new Set(
          leftTrace.toolCalls.map((tc) => tc.toolCallId).filter(Boolean),
        );
        const rightToolCallIds = new Set(
          rightTrace.toolCalls.map((tc) => tc.toolCallId).filter(Boolean),
        );
        if (
          leftToolCallIds.size > 0 &&
          leftToolCallIds.size === rightToolCallIds.size &&
          [...leftToolCallIds].every((id) => rightToolCallIds.has(id))
        ) {
          return true;
        }

        // If no tool calls either, compare by reasoning blocks content.
        if (leftToolCallIds.size === 0 && rightToolCallIds.size === 0) {
          const leftReasoning = joinReasoningBlocks(leftTrace.reasoningBlocks);
          const rightReasoning = joinReasoningBlocks(rightTrace.reasoningBlocks);
          if (leftReasoning.length > 0 && leftReasoning === rightReasoning) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

export function areSameAssistantMessageContent(left: ChatMessage, right: ChatMessage): boolean {
  if (left.role !== 'assistant' || right.role !== 'assistant') return false;
  if (
    left.clientRequestId &&
    right.clientRequestId &&
    left.clientRequestId !== right.clientRequestId
  ) {
    return false;
  }
  if (parseAssistantEventContent(left.content) || parseAssistantEventContent(right.content)) {
    return false;
  }

  const leftTrace = readAssistantTracePayload(left);
  const rightTrace = readAssistantTracePayload(right);
  const leftText = (leftTrace?.text ?? left.content).replace(/\s+/g, ' ').trim();
  const rightText = (rightTrace?.text ?? right.content).replace(/\s+/g, ' ').trim();
  return leftText.length > 0 && leftText === rightText;
}

export function areLikelySameNearbyUserMessage(left: ChatMessage, right: ChatMessage): boolean {
  if (left.role !== 'user' || right.role !== 'user') {
    return false;
  }

  if (left.content !== right.content) {
    return false;
  }

  const leftRawContent = Array.isArray(left.rawContent) ? left.rawContent : [];
  const rightRawContent = Array.isArray(right.rawContent) ? right.rawContent : [];
  const leftDisplayText =
    leftRawContent.length > 0 ? extractDisplayText(leftRawContent) : left.content.trim();
  const rightDisplayText =
    rightRawContent.length > 0 ? extractDisplayText(rightRawContent) : right.content.trim();
  if (leftDisplayText !== rightDisplayText) {
    return false;
  }

  return areInputImagesEquivalent(
    leftRawContent.length > 0 ? extractInputImages(leftRawContent) : [],
    rightRawContent.length > 0 ? extractInputImages(rightRawContent) : [],
  );
}

function areInputImagesEquivalent(
  left: ChatInputImageItem[],
  right: ChatInputImageItem[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => {
    const candidate = right[index];
    return (
      candidate?.artifactId === item.artifactId &&
      candidate?.detail === item.detail &&
      candidate?.fileId === item.fileId &&
      candidate?.fileName === item.fileName &&
      candidate?.imageUrl === item.imageUrl &&
      candidate?.mimeType === item.mimeType
    );
  });
}
