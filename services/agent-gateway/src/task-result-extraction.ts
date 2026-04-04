import type { Message } from '@openAwork/shared';

const INTERNAL_CLIENT_REQUEST_ID_KEY = '__openAworkClientRequestId';

function isAssistantUiEventText(value: string): boolean {
  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { source?: unknown; type?: unknown };
    return parsed.type === 'assistant_event' && parsed.source === 'openawork_internal';
  } catch {
    return false;
  }
}

function extractMessageText(message: Message): string {
  return message.content
    .filter(
      (content): content is Extract<Message['content'][number], { type: 'text' }> =>
        content.type === 'text',
    )
    .map((content) => content.text)
    .join('\n')
    .trim();
}

function isIgnorableAssistantUiEventMessage(message: Message): boolean {
  if (message.role !== 'assistant' || message.content.length === 0) {
    return false;
  }

  return message.content.every((content) => {
    if (content.type !== 'text') {
      return false;
    }

    const text = content.text.trim();
    return text.length === 0 || isAssistantUiEventTextForMessage(text, message);
  });
}

function isAssistantUiEventTextForMessage(value: string, message: Message): boolean {
  if (isAssistantUiEventText(value)) {
    return true;
  }

  const clientRequestId = (message as Message & { [INTERNAL_CLIENT_REQUEST_ID_KEY]?: unknown })[
    INTERNAL_CLIENT_REQUEST_ID_KEY
  ];
  if (typeof clientRequestId !== 'string') {
    return false;
  }

  if (
    !clientRequestId.startsWith('assistant_event:') &&
    !clientRequestId.startsWith('task-reminder:')
  ) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { type?: unknown };
    return parsed.type === 'assistant_event';
  } catch {
    return false;
  }
}

function normalizeExtractedChildSummary(value: string): string {
  return value.replace(/^\[(?:错误|Error):\s*[^\]]+\]\s*/iu, '').trim();
}

export function extractLatestChildSessionSummary(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') {
      continue;
    }

    if (isIgnorableAssistantUiEventMessage(message)) {
      continue;
    }

    const text = extractMessageText(message);
    if (text.length > 0) {
      return normalizeExtractedChildSummary(text);
    }
  }

  return '';
}
