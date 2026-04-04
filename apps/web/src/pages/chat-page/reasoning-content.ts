export function buildReadableAssistantText(text: string, reasoningBlocks?: string[]): string {
  return [...(reasoningBlocks ?? []).map((item) => formatReasoningBlockForPlainText(item)), text]
    .filter((item) => item.trim().length > 0)
    .join('\n\n');
}

export function collectTextCandidateFields(content: Record<string, unknown>): unknown[] {
  return [
    content['text'],
    content['content'],
    content['details'],
    content['markdown'],
    content['reasoning'],
    content['reasoningText'],
    content['summary'],
    content['title'],
    content['path'],
    content['command'],
    content['value'],
  ];
}

export function extractReasoningBlocks(
  rawContent: unknown[],
  extractTextFragments: (value: unknown) => string[],
): string[] {
  const blocks = rawContent
    .flatMap((item) => extractReasoningFragments(item, extractTextFragments))
    .map((item) => normalizeReasoningText(item))
    .filter((item) => item.length > 0);

  return blocks.filter((item, index) => blocks.indexOf(item) === index);
}

export function isReasoningRecord(content: Record<string, unknown>): boolean {
  const type = content['type'];
  const field = content['field'];

  return (
    type === 'reasoning' ||
    type === 'thinking' ||
    type === 'thought' ||
    type === 'thoughts' ||
    field === 'reasoning_content' ||
    field === 'reasoning_details'
  );
}

export function normalizeReasoningText(value: string): string {
  return value.replaceAll('[REDACTED]', '').trim();
}

function extractReasoningFragments(
  value: unknown,
  extractTextFragments: (value: unknown) => string[],
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractReasoningFragments(item, extractTextFragments));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const content = value as Record<string, unknown>;
  if (!isReasoningRecord(content)) {
    return [];
  }

  const block = collectTextCandidateFields(content)
    .flatMap((item) => extractTextFragments(item))
    .join('\n')
    .trim();

  return block.length > 0 ? [block] : [];
}

function formatReasoningBlockForPlainText(text: string): string {
  return `_Thinking:_\n\n${text}`;
}
