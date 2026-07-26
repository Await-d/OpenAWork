import type { RunEvent } from '@openAwork/shared';
import {
  deduplicateCompactionMessages,
  parseAssistantEventContent,
  readCompactionTranscriptState,
  type ChatMessage,
} from './support.js';

/**
 * Main transcript visibility.
 *
 * Most operational assistant-event cards (permission / task / audit …) stay
 * out of the chat stream and live in side panels. Compaction is the exception:
 * users need an in-stream marker when context was automatically or manually
 * compressed, otherwise the conversation appears to "silently jump".
 */
export function shouldShowMessageInTranscript(message: ChatMessage): boolean {
  if (message.role !== 'assistant') {
    return true;
  }

  const compaction = readCompactionTranscriptState(message);
  if (compaction) {
    // The raw marker is an upstream boundary, not a second visible card.
    return compaction.source !== 'marker';
  }

  const assistantEvent = parseAssistantEventContent(message.content);
  if (assistantEvent) {
    return assistantEvent.kind === 'compaction';
  }

  return true;
}

export function filterTranscriptMessages(messages: ChatMessage[]): ChatMessage[] {
  return deduplicateCompactionMessages(messages).filter((message) =>
    shouldShowMessageInTranscript(message),
  );
}

export function shouldShowRunEventInTranscript(event: RunEvent): boolean {
  // Compaction is intentionally surfaced in the main chat stream.
  if (event.type === 'compaction') {
    return true;
  }

  return (
    event.type !== 'audit_ref' &&
    event.type !== 'permission_asked' &&
    event.type !== 'permission_replied' &&
    event.type !== 'question_asked' &&
    event.type !== 'question_replied' &&
    event.type !== 'session_child' &&
    event.type !== 'task_update' &&
    event.type !== 'tool_search'
  );
}

export function isTranscriptCompactionMessage(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false;
  return readCompactionTranscriptState(message) !== null;
}
