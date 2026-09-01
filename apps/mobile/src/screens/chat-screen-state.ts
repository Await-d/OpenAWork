import type { MobileChatMessage } from '../chat/chat-message-content.js';

export interface MobileChatMessageState extends MobileChatMessage {
  streaming?: boolean;
}

export function reconcileMobileChatMessages<Message extends MobileChatMessageState>(
  previousMessages: readonly Message[],
  snapshotMessages: readonly Message[],
): Message[] {
  const previousById = new Map(previousMessages.map((message) => [message.id, message]));
  const activeLocalUser = findActiveLocalUser(previousMessages);
  const seenIds = new Set<string>();
  const reconciled: Message[] = [];

  for (const snapshotMessage of snapshotMessages) {
    if (seenIds.has(snapshotMessage.id)) {
      continue;
    }
    seenIds.add(snapshotMessage.id);
    const previousMessage = previousById.get(snapshotMessage.id);
    const resolvedMessage =
      previousMessage?.streaming === true
        ? previousMessage
        : activeLocalUser &&
            snapshotMessage.role === 'user' &&
            snapshotMessage.content === activeLocalUser.content
          ? activeLocalUser
          : snapshotMessage;
    seenIds.add(resolvedMessage.id);
    reconciled.push(resolvedMessage);
  }

  const localStreamingIds = new Set<string>();
  for (let index = 0; index < previousMessages.length; index += 1) {
    const message = previousMessages[index];
    if (!message?.streaming) {
      continue;
    }

    localStreamingIds.add(message.id);
    const precedingMessage = previousMessages[index - 1];
    if (precedingMessage?.role === 'user') {
      localStreamingIds.add(precedingMessage.id);
    }
  }

  for (const message of previousMessages) {
    if (localStreamingIds.has(message.id) && !seenIds.has(message.id)) {
      seenIds.add(message.id);
      reconciled.push(message);
    }
  }

  return reconciled;
}

function findActiveLocalUser<Message extends MobileChatMessageState>(
  messages: readonly Message[],
): Message | null {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    const nextMessage = messages[index + 1];
    if (message?.role === 'user' && nextMessage?.streaming === true) {
      return message;
    }
  }

  return null;
}

export interface ChatScreenSessionState<Message, Activity, Artifact> {
  activities: Activity[];
  artifactHistory: Artifact[];
  historyLoading: boolean;
  messages: Message[];
  sending: boolean;
}

export function buildChatScreenSessionResetState<
  Message,
  Activity,
  Artifact,
>(): ChatScreenSessionState<Message, Activity, Artifact> {
  return {
    activities: [],
    artifactHistory: [],
    historyLoading: true,
    messages: [],
    sending: false,
  };
}

export function buildChatScreenStaleSendAbortState<Message, Activity, Artifact>(
  state: ChatScreenSessionState<Message, Activity, Artifact>,
): ChatScreenSessionState<Message, Activity, Artifact> {
  return {
    ...state,
    sending: false,
  };
}
