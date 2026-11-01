import type { Message } from '@openAwork/shared';
import type { SessionMessagesPage } from '@openAwork/web-client';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { normalizeChatMessages } from '../../../../components/conversation-runtime/messages/normalize-chat-messages.js';
import { filterTranscriptMessages } from '../../../../components/conversation-runtime/messages/transcript-visibility.js';
import { getComparableCreatedAt } from '../../../../components/conversation-runtime/messages/message-coercion.js';

export interface HistoryPageResult {
  messages: ChatMessage[];
  more: boolean;
}

export type LoadEarlierHistory = (targetMessageId?: string) => Promise<HistoryPageResult | null>;

export function prependHistoricalMessages(
  current: ChatMessage[],
  historical: ChatMessage[],
): ChatMessage[] {
  if (current.length === 0) return historical;
  const ids = new Set(current.map((message) => message.id));
  const first = current[0];
  const firstTime = getComparableCreatedAt(first?.createdAt);
  const overlapIndex = historical.findIndex((message) => message.id === first?.id);
  const older = historical.filter((message, index) => {
    if (ids.has(message.id)) return false;
    if (overlapIndex >= 0) return index < overlapIndex;
    const time = getComparableCreatedAt(message.createdAt);
    return (
      firstTime !== null &&
      time !== null &&
      (time < firstTime || (time === firstTime && message.id < (first?.id ?? '')))
    );
  });
  return older.length > 0 ? [...older, ...current] : current;
}

interface HistoryPagerOptions {
  readPage: (before: string | undefined) => Promise<SessionMessagesPage>;
  readMessages: () => ChatMessage[];
  isCurrent: () => boolean;
  publish: (messages: ChatMessage[], rawMessages: Message[], more: boolean) => void;
}

/** One pager belongs to one session-view epoch; cursors never cross views. */
export function createSessionHistoryPager(options: HistoryPagerOptions) {
  let before: string | undefined;
  let more = true;
  let boundary: Message[] = [];
  let loaded: ChatMessage[] = [];
  let flight: Promise<HistoryPageResult | null> | null = null;

  async function readEarlier(): Promise<HistoryPageResult | null> {
    let messages = prependHistoricalMessages(options.readMessages(), loaded);
    while (more && options.isCurrent()) {
      const page = await options.readPage(before);
      if (!options.isCurrent()) return null;
      const nextCursor = page.nextCursor;
      const hasNext = page.more && nextCursor !== undefined && nextCursor !== before;
      // Hold an incomplete leading turn until its user row arrives. Legacy tool
      // results can then be normalized with their assistant across page boundaries.
      const rows = [...page.messages, ...boundary];
      const firstUser = hasNext ? rows.findIndex((message) => message.role === 'user') : 0;
      const completeRows = firstUser < 0 ? [] : rows.slice(firstUser);
      const nextBoundary = firstUser < 0 ? rows : rows.slice(0, firstUser);
      const normalized = filterTranscriptMessages(normalizeChatMessages(completeRows));
      const next = prependHistoricalMessages(messages, normalized);
      before = nextCursor;
      more = hasNext;
      boundary = nextBoundary;
      loaded = prependHistoricalMessages(loaded, normalized);
      options.publish(normalized, completeRows, more);
      if (next !== messages || !more) return { messages: next, more };
      messages = next;
    }
    return options.isCurrent() ? { messages, more } : null;
  }

  function loadEarlier(): Promise<HistoryPageResult | null> {
    if (flight !== null) return flight;
    const request = readEarlier();
    flight = request;
    void request
      .finally(() => {
        if (flight === request) flight = null;
      })
      .catch(() => undefined);
    return request;
  }

  return {
    async load(targetMessageId?: string): Promise<HistoryPageResult | null> {
      let result = await loadEarlier();
      while (
        result !== null &&
        result.more &&
        targetMessageId !== undefined &&
        !result.messages.some((message) => message.id === targetMessageId)
      ) {
        result = await loadEarlier();
      }
      return options.isCurrent() ? result : null;
    },
  };
}
