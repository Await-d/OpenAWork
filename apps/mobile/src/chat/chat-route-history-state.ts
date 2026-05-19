export interface ChatRouteHistoryState<Message> {
  input: string;
  loadingHistory: boolean;
  messages: Message[];
}

export function buildChatRouteHistoryResetState<Message>(options: {
  hasSessionId: boolean;
}): ChatRouteHistoryState<Message> {
  return {
    input: '',
    loadingHistory: options.hasSessionId,
    messages: [],
  };
}

export function buildChatRouteHistoryLocalHydrationState<Message>(options: {
  draft: string;
  messages: Message[];
}): ChatRouteHistoryState<Message> {
  return {
    input: options.draft,
    loadingHistory: true,
    messages: options.messages,
  };
}

export function buildChatRouteHistoryReadyState<Message>(options: {
  input: string;
  messages: Message[];
}): ChatRouteHistoryState<Message> {
  return {
    input: options.input,
    loadingHistory: false,
    messages: options.messages,
  };
}
