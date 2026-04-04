import type { RunEvent } from '@openAwork/shared';
import { parseAssistantEventContent, type ChatMessage } from './support.js';

export function shouldShowMessageInTranscript(message: ChatMessage): boolean {
  if (message.role !== 'assistant') {
    return true;
  }

  const assistantEvent = parseAssistantEventContent(message.content);
  if (!assistantEvent) {
    return true;
  }

  return assistantEvent.kind !== 'compaction';
}

export function filterTranscriptMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => shouldShowMessageInTranscript(message));
}

export function shouldShowRunEventInTranscript(event: RunEvent): boolean {
  return event.type !== 'compaction';
}
