import type { ChatRenderEntry } from '../../../../components/chat/message/chat-message-group-list.js';

export function mergeStreamingEntryIntoHistoricalEntries(
  historicalRenderedMessageEntries: ChatRenderEntry[],
  streamingRenderedMessageEntry: ChatRenderEntry | null,
  activeStreamMessageId: string | null,
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

  return [...historicalRenderedMessageEntries, streamingRenderedMessageEntry];
}
