export interface MobileChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function normalizeMobileChatMessages(rawMessages: unknown): MobileChatMessage[] {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  return rawMessages.flatMap((rawMessage) => {
    const normalized = normalizeMobileChatMessage(rawMessage);
    return normalized ? [normalized] : [];
  });
}

export function extractRuntimeTextDelta(value: unknown): string {
  return collectTextFragments(value).join('');
}

function normalizeMobileChatMessage(rawMessage: unknown): MobileChatMessage | null {
  if (!rawMessage || typeof rawMessage !== 'object') {
    return null;
  }

  const record = rawMessage as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : null;
  const role =
    record['role'] === 'user' || record['role'] === 'assistant' || record['role'] === 'tool'
      ? record['role']
      : null;

  if (!id || !role) {
    return null;
  }

  const content = normalizeMobileMessageContent(record['content']);
  if (content.length === 0) {
    return null;
  }

  return {
    id,
    role: role === 'user' ? 'user' : 'assistant',
    content,
  };
}

function normalizeMobileMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  return collectTextFragments(content).join('\n').trim();
}

function collectTextFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    const fragments = value.flatMap((item) => collectTextFragments(item));
    return fragments;
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const type = record['type'];

  if (
    (type === 'text' || type === 'input_text' || type === 'output_text') &&
    typeof record['text'] === 'string'
  ) {
    return record['text'].trim().length > 0 ? [record['text']] : [];
  }

  const candidateFields = [
    record['text'],
    record['content'],
    record['markdown'],
    record['value'],
    record['title'],
    record['path'],
    record['command'],
    record['output'],
  ];

  const fragments = candidateFields.flatMap((item) => collectTextFragments(item));
  return fragments;
}
