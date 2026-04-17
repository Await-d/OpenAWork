import { appendSessionMessageV2 as appendSessionMessage } from './message-v2-adapter.js';
import { maybeAutoTitle } from './session-title.js';

export interface PersistStreamUserMessageInput {
  clientRequestId: string;
  displayMessage?: string;
  legacyMessagesJson: string;
  message: string;
  sessionId: string;
  userId: string;
}

export function persistStreamUserMessage(input: PersistStreamUserMessageInput): string {
  const text = input.displayMessage ?? input.message;
  appendSessionMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'user',
    content: [{ type: 'text', text }],
    legacyMessagesJson: input.legacyMessagesJson,
    clientRequestId: input.clientRequestId,
  });
  maybeAutoTitle({ sessionId: input.sessionId, userId: input.userId, text });
  return text;
}
