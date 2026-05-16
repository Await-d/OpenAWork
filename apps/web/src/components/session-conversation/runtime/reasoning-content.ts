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

export interface ReasoningBlockWithTiming {
  text: string;
  startedAt?: number;
  endedAt?: number;
}

export function extractReasoningBlocks(
  rawContent: unknown[],
  extractTextFragments: (value: unknown) => string[],
): string[] {
  return extractReasoningBlocksWithTimings(rawContent, extractTextFragments).map(
    (entry) => entry.text,
  );
}

export function extractReasoningBlocksWithTimings(
  rawContent: unknown[],
  extractTextFragments: (value: unknown) => string[],
): ReasoningBlockWithTiming[] {
  const fragments = rawContent.flatMap((item) =>
    extractReasoningFragmentsWithTimings(item, extractTextFragments),
  );
  const normalized = fragments
    .map((entry) => ({
      text: normalizeReasoningText(entry.text),
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    }))
    .filter((entry) => entry.text.length > 0);

  // Dedupe by text while keeping the first matching timing.
  const seen = new Set<string>();
  const result: ReasoningBlockWithTiming[] = [];
  for (const entry of normalized) {
    if (seen.has(entry.text)) continue;
    seen.add(entry.text);
    result.push(entry);
  }
  return result;
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

function extractReasoningFragmentsWithTimings(
  value: unknown,
  extractTextFragments: (value: unknown) => string[],
): ReasoningBlockWithTiming[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      extractReasoningFragmentsWithTimings(item, extractTextFragments),
    );
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

  if (block.length === 0) {
    return [];
  }

  const startedAt =
    typeof content['startedAt'] === 'number' && Number.isFinite(content['startedAt'])
      ? (content['startedAt'] as number)
      : undefined;
  const endedAt =
    typeof content['endedAt'] === 'number' && Number.isFinite(content['endedAt'])
      ? (content['endedAt'] as number)
      : undefined;

  return [{ text: block, startedAt, endedAt }];
}

function formatReasoningBlockForPlainText(text: string): string {
  return `_Thinking:_\n\n${text}`;
}
