import type { Message, MessageContent } from '@openAwork/shared';
import { buildMemoryInjectionBlock, extractMemoriesFromText } from '@openAwork/agent-core';
import {
  hasExtractionLog,
  insertExtractionLog,
  listEnabledMemoriesForInjection,
  readMemorySettings,
  upsertExtractedMemories,
} from './memory-store.js';
import { listSessionMessagesByRequestScope, listSessionMessagesV2 } from './message-v2-adapter.js';

function readWorkspaceRootFromMetadata(metadataJson: string): string | null {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    return typeof metadata['workingDirectory'] === 'string' ? metadata['workingDirectory'] : null;
  } catch {
    return null;
  }
}

function extractTextContent(content: MessageContent): string | null {
  if (content.type !== 'text') {
    return null;
  }

  const normalized = content.text.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildMemoryBlockForSession(userId: string, metadataJson: string): string | null {
  const settings = readMemorySettings(userId);
  if (!settings.enabled) {
    return null;
  }

  const memories = listEnabledMemoriesForInjection(userId, settings.minConfidence);
  if (memories.length === 0) {
    return null;
  }

  return buildMemoryInjectionBlock(memories, {
    enabled: true,
    maxTokenBudget: settings.maxTokenBudget,
    minConfidence: settings.minConfidence,
    workspaceRoot: readWorkspaceRootFromMetadata(metadataJson),
  });
}

export function buildMemoryExtractionTextFromMessages(messages: Message[]): string {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) => message.content.map(extractTextContent))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n\n');
}

export function buildMemoryExtractionTextForRequest(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): string {
  return buildMemoryExtractionTextFromMessages(listSessionMessagesByRequestScope(input));
}

export function buildMemoryExtractionTextForSession(input: {
  legacyMessagesJson?: string;
  sessionId: string;
  userId: string;
}): string {
  return buildMemoryExtractionTextFromMessages(
    listSessionMessagesV2({
      sessionId: input.sessionId,
      userId: input.userId,
      statuses: ['final', 'error'],
    }),
  );
}

export function autoExtractMemoriesForRequest(input: {
  clientRequestId: string;
  metadataJson: string;
  sessionId: string;
  userId: string;
}): { created: number; duplicates: number; skipped: boolean; updated: number } {
  const settings = readMemorySettings(input.userId);
  if (!settings.enabled || !settings.autoExtract) {
    return { created: 0, duplicates: 0, skipped: true, updated: 0 };
  }

  if (hasExtractionLog(input.userId, input.sessionId, input.clientRequestId)) {
    return { created: 0, duplicates: 0, skipped: true, updated: 0 };
  }

  const text = buildMemoryExtractionTextForRequest(input);
  if (text.trim().length === 0) {
    insertExtractionLog(input.userId, input.sessionId, input.clientRequestId, 0);
    return { created: 0, duplicates: 0, skipped: true, updated: 0 };
  }

  const workspaceRoot = readWorkspaceRootFromMetadata(input.metadataJson);
  const candidates = extractMemoriesFromText(text);
  const result = upsertExtractedMemories(input.userId, candidates, workspaceRoot);
  insertExtractionLog(
    input.userId,
    input.sessionId,
    input.clientRequestId,
    result.created + result.updated,
  );
  return {
    created: result.created,
    duplicates: result.duplicates,
    skipped: false,
    updated: result.updated,
  };
}
