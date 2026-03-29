import type { Message } from '@openAwork/shared';

function isAssistantUiEventText(value: string): boolean {
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
    return text.length === 0 || isAssistantUiEventText(text);
  });
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
