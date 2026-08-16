import type { ChatRenderEntry } from '../../../../components/chat/message/chat-message-group-list.js';

export function mergeStreamingEntryIntoHistoricalEntries(
  historicalRenderedMessageEntries: ChatRenderEntry[],
  streamingRenderedMessageEntry: ChatRenderEntry | null,
  activeStreamMessageId: string | null,
  activeStreamClientRequestId: string | null,
): ChatRenderEntry[] {
  if (!streamingRenderedMessageEntry) {
    return historicalRenderedMessageEntries;
  }

  if (activeStreamMessageId) {
    const streamingTargetIndex = historicalRenderedMessageEntries.findIndex(
      (entry) => entry.message.id === activeStreamMessageId,
    );
    if (streamingTargetIndex !== -1) {
      return historicalRenderedMessageEntries.map((entry, index) =>
        index === streamingTargetIndex ? streamingRenderedMessageEntry : entry,
      );
    }
  }

  const streamingMessage = streamingRenderedMessageEntry.message;
  if (streamingMessage.role === 'assistant' && activeStreamClientRequestId) {
    for (let i = historicalRenderedMessageEntries.length - 1; i >= 0; i--) {
      const entry = historicalRenderedMessageEntries[i]!;
      const existingMessage = entry.message;
      if (existingMessage.role !== 'assistant') continue;

      if (existingMessage.clientRequestId === activeStreamClientRequestId) {
        return historicalRenderedMessageEntries.map((entry, index) =>
          index === i ? streamingRenderedMessageEntry : entry,
        );
      }
    }
  }

  return [...historicalRenderedMessageEntries, streamingRenderedMessageEntry];
}
