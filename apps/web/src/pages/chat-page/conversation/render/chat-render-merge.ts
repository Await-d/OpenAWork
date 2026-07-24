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

  // ID match failed — this happens when a reload/reconcile has already
  // replaced the locally-generated streaming message ID with the server's
  // version. Check if the last historical assistant entry is for the same
  // logical message (by comparing content). If so, replace it instead of
  // appending a duplicate.
  const streamingMessage = streamingRenderedMessageEntry.message;
  if (streamingMessage.role === 'assistant') {
    for (let i = historicalRenderedMessageEntries.length - 1; i >= 0; i--) {
      const entry = historicalRenderedMessageEntries[i]!;
      const existingMessage = entry.message;
      if (existingMessage.role !== 'assistant') continue;

      // If the historical assistant message is still in streaming status,
      // it's the placeholder we should replace.
      if (existingMessage.status === 'streaming') {
        return historicalRenderedMessageEntries.map((e, index) =>
          index === i ? streamingRenderedMessageEntry : e,
        );
      }

      // If the historical assistant message has the same content (e.g. the
      // server already committed the final version via reload), don't
      // append a duplicate — just keep the historical version.
      if (
        existingMessage.content === streamingMessage.content &&
        existingMessage.content.length > 0
      ) {
        return historicalRenderedMessageEntries;
      }

      // Only check the most recent few assistant messages to avoid
      // scanning the entire history.
      break;
    }
  }

  return [...historicalRenderedMessageEntries, streamingRenderedMessageEntry];
}
