import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';

const OPTIMISTIC_MESSAGE_MATCH_WINDOW_MS = 120_000;

export function mergeOptimisticUserMessage(
  messages: ChatMessage[],
  optimisticUserMessage: ChatMessage | null,
): ChatMessage[] {
  const deduplicatedMessages: ChatMessage[] = [];
  const seenIds = new Set<string>();

  for (const message of messages) {
    if (seenIds.has(message.id)) {
      continue;
    }
    seenIds.add(message.id);
    deduplicatedMessages.push(message);
  }

  if (!optimisticUserMessage || seenIds.has(optimisticUserMessage.id)) {
    return deduplicatedMessages;
  }

  const hasServerEquivalent = [...deduplicatedMessages]
    .reverse()
    .some((message) => areEquivalentOptimisticUserMessage(message, optimisticUserMessage));

  return hasServerEquivalent
    ? deduplicatedMessages
    : [...deduplicatedMessages, optimisticUserMessage];
}

function areEquivalentOptimisticUserMessage(
  candidate: ChatMessage,
  optimistic: ChatMessage,
): boolean {
  if (candidate.role !== 'user' || optimistic.role !== 'user') {
    return false;
  }

  if (
    candidate.clientRequestId &&
    optimistic.clientRequestId &&
    candidate.clientRequestId === optimistic.clientRequestId
  ) {
    return true;
  }

  if (candidate.content !== optimistic.content) {
    return false;
  }

  const candidateCreatedAt = toComparableTimestamp(candidate.createdAt);
  const optimisticCreatedAt = toComparableTimestamp(optimistic.createdAt);
  if (candidateCreatedAt === null || optimisticCreatedAt === null) {
    return true;
  }

  return Math.abs(candidateCreatedAt - optimisticCreatedAt) <= OPTIMISTIC_MESSAGE_MATCH_WINDOW_MS;
}

function toComparableTimestamp(value: number | string | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }

    const parsedValue = Date.parse(value);
    return Number.isNaN(parsedValue) ? null : parsedValue;
  }

  return null;
}
