export interface MobileChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoningBlocks?: string[];
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

export function extractRuntimeThinkingDelta(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  return collectReasoningFragments(value).join('');
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

  const normalizedContent = normalizeMobileMessageContent(record['content']);
  if (
    normalizedContent.content.length === 0 &&
    (normalizedContent.reasoningBlocks?.length ?? 0) === 0
  ) {
    return null;
  }

  return {
    id,
    role: role === 'user' ? 'user' : 'assistant',
    content: normalizedContent.content,
    ...(normalizedContent.reasoningBlocks && normalizedContent.reasoningBlocks.length > 0
      ? { reasoningBlocks: normalizedContent.reasoningBlocks }
      : {}),
  };
}

function normalizeMobileMessageContent(content: unknown): {
  content: string;
  reasoningBlocks?: string[];
} {
  if (typeof content === 'string') {
    const assistantTrace = parseAssistantTraceContent(content);
    if (assistantTrace) {
      return {
        content: buildAssistantTraceText(assistantTrace),
        ...(assistantTrace.reasoningBlocks.length > 0
          ? { reasoningBlocks: assistantTrace.reasoningBlocks }
          : {}),
      };
    }
    return { content };
  }

  const text = collectTextFragments(content).join('\n').trim();
  const reasoningBlocks = collectReasoningFragments(content)
    .map((item) => normalizeReasoningText(item))
    .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index);

  return {
    content: text,
    ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
  };
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

  if (isReasoningRecord(record)) {
    return [];
  }

  if (
    (type === 'text' || type === 'input_text' || type === 'output_text') &&
    typeof record['text'] === 'string'
  ) {
    return record['text'].trim().length > 0 ? [record['text']] : [];
  }

  const candidateFields = [
    record['text'],
    record['content'],
    record['details'],
    record['markdown'],
    record['summary'],
    record['value'],
    record['title'],
    record['path'],
    record['command'],
    record['output'],
  ];

  const fragments = candidateFields.flatMap((item) => collectTextFragments(item));
  return fragments;
}

function collectReasoningFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectReasoningFragments(item));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (!isReasoningRecord(record)) {
    return [];
  }

  return collectReasoningCandidateFields(record).flatMap((item) => collectTextFragments(item));
}

function collectReasoningCandidateFields(record: Record<string, unknown>): unknown[] {
  return [
    record['text'],
    record['content'],
    record['details'],
    record['markdown'],
    record['reasoning'],
    record['reasoningText'],
    record['summary'],
    record['value'],
  ];
}

function isReasoningRecord(record: Record<string, unknown>): boolean {
  const type = record['type'];
  const field = record['field'];

  return (
    type === 'reasoning' ||
    type === 'thinking' ||
    type === 'thought' ||
    type === 'thoughts' ||
    field === 'reasoning_content' ||
    field === 'reasoning_details'
  );
}

function normalizeReasoningText(value: string): string {
  return value.replaceAll('[REDACTED]', '').trim();
}

function parseAssistantTraceContent(content: string): {
  content: string;
  reasoningBlocks: string[];
  toolNames: string[];
} | null {
  try {
    const parsed = JSON.parse(content) as {
      type?: unknown;
      payload?: {
        text?: unknown;
        reasoningBlocks?: unknown;
        toolCalls?: unknown;
      };
    };

    if (parsed.type !== 'assistant_trace' || !parsed.payload) {
      return null;
    }

    const text = typeof parsed.payload.text === 'string' ? parsed.payload.text : '';
    const reasoningBlocks = Array.isArray(parsed.payload.reasoningBlocks)
      ? parsed.payload.reasoningBlocks
          .filter((item): item is string => typeof item === 'string')
          .map((item) => normalizeReasoningText(item))
          .filter((item) => item.length > 0)
      : [];
    const toolNames = Array.isArray(parsed.payload.toolCalls)
      ? parsed.payload.toolCalls.flatMap((item) => {
          if (!item || typeof item !== 'object') {
            return [];
          }
          const toolCall = item as Record<string, unknown>;
          return typeof toolCall.toolName === 'string' ? [toolCall.toolName] : [];
        })
      : [];

    return { content: text, reasoningBlocks, toolNames };
  } catch {
    return null;
  }
}

function buildAssistantTraceText(trace: { content: string; toolNames: string[] }): string {
  const toolLines = trace.toolNames.map((toolName) => `工具：${toolName}`);
  return [trace.content, ...toolLines].filter((item) => item.trim().length > 0).join('\n\n');
}
