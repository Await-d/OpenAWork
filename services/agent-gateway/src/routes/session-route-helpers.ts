import type { Message, RunEvent } from '@openAwork/shared';
import type { SessionTodo } from '../todo-tools.js';

interface SessionResponseLike {
  id: string;
  state_status: string;
  metadata_json: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicSessionResponse extends SessionResponseLike {
  messages: Message[];
  runEvents: RunEvent[];
  todos: SessionTodo[];
}

export const MAX_IMPORTED_MESSAGES = 500;
export const MAX_IMPORTED_MESSAGES_BYTES = 512 * 1024;

export function toPublicSessionResponse(
  session: SessionResponseLike,
  messages: Message[],
  todos: SessionTodo[] = [],
  runEvents: RunEvent[] = [],
): PublicSessionResponse {
  return {
    id: session.id,
    state_status: session.state_status,
    metadata_json: session.metadata_json,
    title: session.title,
    created_at: session.created_at,
    updated_at: session.updated_at,
    messages,
    runEvents,
    todos,
  };
}

export function validateImportedMessagesPayload(
  messages: unknown[],
): { ok: true; serializedMessages: string } | { error: string; ok: false } {
  if (messages.length > MAX_IMPORTED_MESSAGES) {
    return { ok: false, error: `Import exceeds ${MAX_IMPORTED_MESSAGES} messages` };
  }

  const serializedMessages = JSON.stringify(messages);
  if (Buffer.byteLength(serializedMessages, 'utf8') > MAX_IMPORTED_MESSAGES_BYTES) {
    return { ok: false, error: `Import exceeds ${MAX_IMPORTED_MESSAGES_BYTES} bytes` };
  }

  return { ok: true, serializedMessages };
}
