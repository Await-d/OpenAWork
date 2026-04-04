export type CompactionTrigger = 'automatic' | 'manual';

export interface CompactionSummaryFields {
  assistantProgress: string[];
  filesReferenced: string[];
  latestUserRequest?: string;
  toolActivity: string[];
  userGoals: string[];
}

export interface PersistedCompactionMemory {
  assistantProgress: string[];
  compactionCount: number;
  coveredUntilMessageId: string;
  filesReferenced: string[];
  lastCompactionSignature?: string;
  lastTrigger: CompactionTrigger;
  latestUserRequest?: string;
  schemaVersion: 1;
  summarizedMessages: number;
  toolActivity: string[];
  updatedAt: number;
  userGoals: string[];
}

export interface CompactionMetadataInput {
  omittedMessages?: number;
  persistedMemory?: PersistedCompactionMemory;
  recentMessagesKept?: number;
  signature?: string;
  summary: string;
  trigger: CompactionTrigger;
}

export interface PersistedCompactionMemoryMergeInput {
  coveredUntilMessageId: string;
  fields: CompactionSummaryFields;
  newlySummarizedMessages: number;
  signature?: string;
  trigger: CompactionTrigger;
}

export function mergeCompactionMetadata(
  metadataJson: string,
  input: CompactionMetadataInput,
): Record<string, unknown> {
  const base = parseMetadata(metadataJson);
  return {
    ...base,
    lastCompactionAt: Date.now(),
    lastCompactionSummary: input.summary,
    lastCompactionTrigger: input.trigger,
    ...(typeof input.omittedMessages === 'number'
      ? { lastCompactionOmittedMessages: input.omittedMessages }
      : {}),
    ...(typeof input.recentMessagesKept === 'number'
      ? { lastCompactionRecentMessages: input.recentMessagesKept }
      : {}),
    ...(typeof input.signature === 'string' && input.signature.length > 0
      ? { lastCompactionSignature: input.signature }
      : {}),
    ...(input.persistedMemory ? { compactionMemory: input.persistedMemory } : {}),
  };
}

export function readPersistedCompactionMemory(
  metadataJson: string,
): PersistedCompactionMemory | null {
  const metadata = parseMetadata(metadataJson);
  return parsePersistedCompactionMemory(metadata['compactionMemory']);
}

export function mergePersistedCompactionMemory(
  existing: PersistedCompactionMemory | null,
  input: PersistedCompactionMemoryMergeInput,
): PersistedCompactionMemory {
  const newlySummarizedMessages = Math.max(0, input.newlySummarizedMessages);

  return {
    schemaVersion: 1,
    coveredUntilMessageId: input.coveredUntilMessageId,
    updatedAt: Date.now(),
    compactionCount:
      (existing?.compactionCount ?? 0) + (newlySummarizedMessages > 0 || !existing ? 1 : 0),
    summarizedMessages: (existing?.summarizedMessages ?? 0) + newlySummarizedMessages,
    lastTrigger: input.trigger,
    ...(typeof input.signature === 'string' && input.signature.length > 0
      ? { lastCompactionSignature: input.signature }
      : existing?.lastCompactionSignature
        ? { lastCompactionSignature: existing.lastCompactionSignature }
        : {}),
    userGoals: mergeUniqueStrings(existing?.userGoals, input.fields.userGoals, 4),
    assistantProgress: mergeUniqueStrings(
      existing?.assistantProgress,
      input.fields.assistantProgress,
      6,
    ),
    toolActivity: mergeUniqueStrings(existing?.toolActivity, input.fields.toolActivity, 6),
    filesReferenced: mergeUniqueStrings(existing?.filesReferenced, input.fields.filesReferenced, 8),
    latestUserRequest: input.fields.latestUserRequest ?? existing?.latestUserRequest,
  };
}

export function renderPersistedCompactionMemory(input: {
  memory: PersistedCompactionMemory;
  omittedMessages: number;
  recentMessagesKept: number;
  trigger: CompactionTrigger;
}): string {
  return [
    `Durable session compaction memory (${input.trigger} compaction).`,
    `- Current omitted messages represented: ${input.omittedMessages}`,
    `- Recent verbatim messages kept: ${input.recentMessagesKept}`,
    `- Total compaction passes: ${input.memory.compactionCount}`,
    `- Cumulative summarized messages: ${input.memory.summarizedMessages}`,
    `- Covered until message id: ${input.memory.coveredUntilMessageId}`,
    '',
    formatSummarySection('User goals', input.memory.userGoals),
    '',
    formatSummarySection('Assistant progress and decisions', input.memory.assistantProgress),
    '',
    formatSummarySection('Tool activity', input.memory.toolActivity),
    '',
    formatSummarySection('Files referenced', input.memory.filesReferenced),
    '',
    formatSummarySection(
      'Latest summarized user request',
      input.memory.latestUserRequest ? [input.memory.latestUserRequest] : [],
    ),
  ]
    .join('\n')
    .trim();
}

function parseMetadata(metadataJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function parsePersistedCompactionMemory(value: unknown): PersistedCompactionMemory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const coveredUntilMessageId =
    typeof record['coveredUntilMessageId'] === 'string' ? record['coveredUntilMessageId'] : null;
  if (!coveredUntilMessageId) {
    return null;
  }

  return {
    schemaVersion: 1,
    coveredUntilMessageId,
    updatedAt: typeof record['updatedAt'] === 'number' ? record['updatedAt'] : Date.now(),
    compactionCount: typeof record['compactionCount'] === 'number' ? record['compactionCount'] : 0,
    summarizedMessages:
      typeof record['summarizedMessages'] === 'number' ? record['summarizedMessages'] : 0,
    lastTrigger: record['lastTrigger'] === 'manual' ? 'manual' : 'automatic',
    lastCompactionSignature:
      typeof record['lastCompactionSignature'] === 'string'
        ? record['lastCompactionSignature']
        : undefined,
    userGoals: readStringArray(record['userGoals'], 4),
    assistantProgress: readStringArray(record['assistantProgress'], 6),
    toolActivity: readStringArray(record['toolActivity'], 6),
    filesReferenced: readStringArray(record['filesReferenced'], 8),
    latestUserRequest:
      typeof record['latestUserRequest'] === 'string' ? record['latestUserRequest'] : undefined,
  };
}

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return mergeUniqueStrings(
    undefined,
    value.filter((item): item is string => typeof item === 'string'),
    limit,
  );
}

function mergeUniqueStrings(
  base: string[] | undefined,
  incoming: string[],
  limit: number,
): string[] {
  const merged = [...(base ?? []), ...incoming]
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const deduped: string[] = [];
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const value = merged[index];
    if (!value || deduped.includes(value)) {
      continue;
    }
    deduped.unshift(value);
    if (deduped.length >= limit) {
      break;
    }
  }
  return deduped;
}

function formatSummarySection(title: string, lines: string[]): string {
  if (lines.length === 0) {
    return `${title}:\n- None recorded.`;
  }
  return `${title}:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}
