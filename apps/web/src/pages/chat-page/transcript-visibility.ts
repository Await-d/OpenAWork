import type { RunEvent } from '@openAwork/shared';
import { parseAssistantEventContent, type ChatMessage } from './support.js';

export function shouldShowMessageInTranscript(message: ChatMessage): boolean {
  if (message.role !== 'assistant') {
    return true;
  }

  const assistantEvent = parseAssistantEventContent(message.content);
  return !assistantEvent;
}

export function filterTranscriptMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => shouldShowMessageInTranscript(message));
}

export function shouldShowRunEventInTranscript(event: RunEvent): boolean {
  return (
    event.type !== 'compaction' &&
    event.type !== 'audit_ref' &&
    event.type !== 'permission_asked' &&
    event.type !== 'permission_replied' &&
    event.type !== 'question_asked' &&
    event.type !== 'question_replied' &&
    event.type !== 'session_child' &&
    event.type !== 'task_update'
  );
}
