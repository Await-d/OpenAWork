import {
  ARTIFACT_TYPE_CONFIG,
  detectArtifactContentType,
  type ArtifactContentType,
  type ArtifactMetadata,
  type ArtifactRecord,
} from '@openAwork/artifacts';
import type { MessageContent } from '@openAwork/shared';
import {
  createArtifact,
  listArtifactsBySession,
  updateArtifact,
} from './artifact-content-store.js';

const THINKING_LANGUAGES = new Set(['think', 'thinking', 'reasoning', 'thought', 'thoughts']);
const MIN_ARTIFACT_CONTENT_LENGTH = 24;

interface FenceBlock {
  blockIndex: number;
  content: string;
  language: string | null;
}

export interface AssistantArtifactDraft {
  blockIndex: number;
  content: string;
  language: string | null;
  metadata: ArtifactMetadata;
  title: string;
  type: ArtifactContentType;
}

export function extractAssistantArtifactDrafts(input: {
  clientRequestId: string;
  text: string;
}): AssistantArtifactDraft[] {
  const blocks = extractFenceBlocks(input.text);
  return blocks
    .filter((block) => shouldPersistFenceBlock(block))
    .map((block) => buildArtifactDraft(input.clientRequestId, block));
}

export function upsertArtifactsFromAssistantMessage(input: {
  clientRequestId: string;
  content: MessageContent[];
  sessionId: string;
  userId: string;
}): ArtifactRecord[] {
  const assistantText = input.content
    .flatMap((item) => (item.type === 'text' ? [item.text] : []))
    .join('\n\n')
    .trim();
  if (assistantText.length === 0) {
    return [];
  }

  const drafts = extractAssistantArtifactDrafts({
    clientRequestId: input.clientRequestId,
    text: assistantText,
  });
  if (drafts.length === 0) {
    return [];
  }

  const existingArtifacts = listArtifactsBySession(input.userId, input.sessionId);
  return drafts.flatMap((draft) => {
    const existingArtifact = findExistingArtifact(
      existingArtifacts,
      input.clientRequestId,
      draft.blockIndex,
    );
    if (existingArtifact) {
      const updatedArtifact = updateArtifact(input.userId, existingArtifact.id, {
        title: draft.title,
        content: draft.content,
        type: draft.type,
        metadata: draft.metadata,
        createdBy: 'agent',
        createdByNote: buildCreatedByNote(input.clientRequestId, draft.blockIndex),
      });
      return updatedArtifact ? [updatedArtifact] : [];
    }

    return [
      createArtifact(input.userId, {
        sessionId: input.sessionId,
        title: draft.title,
        content: draft.content,
        type: draft.type,
        metadata: draft.metadata,
        createdBy: 'agent',
        createdByNote: buildCreatedByNote(input.clientRequestId, draft.blockIndex),
      }),
    ];
  });
}

function extractFenceBlocks(text: string): FenceBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: FenceBlock[] = [];
  let current:
    | {
        blockIndex: number;
        delimiter: string;
        language: string | null;
        lines: string[];
      }
    | undefined;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})([^\n]*)$/u);
    if (!current) {
      if (!fenceMatch) {
        continue;
      }

      const delimiter = fenceMatch[1];
      const rawLanguage = fenceMatch[2] ?? '';
      if (!delimiter) {
        continue;
      }

      current = {
        blockIndex: blocks.length,
        delimiter,
        language: normalizeFenceLanguage(rawLanguage),
        lines: [],
      };
      continue;
    }

    const closePattern = new RegExp(`^\\s*${escapeForRegExp(current.delimiter)}\\s*$`, 'u');
    if (closePattern.test(line)) {
      blocks.push({
        blockIndex: current.blockIndex,
        content: current.lines.join('\n').trim(),
        language: current.language,
      });
      current = undefined;
      continue;
    }

    current.lines.push(line);
  }

  if (current && current.lines.length > 0) {
    blocks.push({
      blockIndex: current.blockIndex,
      content: current.lines.join('\n').trim(),
      language: current.language,
    });
  }

  return blocks;
}

function shouldPersistFenceBlock(block: FenceBlock): boolean {
  if (block.content.length < MIN_ARTIFACT_CONTENT_LENGTH) {
    return false;
  }

  if (block.language && THINKING_LANGUAGES.has(block.language)) {
    return false;
  }

  return true;
}

function buildArtifactDraft(clientRequestId: string, block: FenceBlock): AssistantArtifactDraft {
  const typeHint = resolveArtifactTypeHint(block.language);
  const type = detectArtifactContentType({
    content: block.content,
    hint: typeHint,
  });
  const fileExtension = ARTIFACT_TYPE_CONFIG[type].fileExtension;
  const shortRequestId = clientRequestId.slice(0, 8) || 'reply';
  const metadata: ArtifactMetadata = {
    sourceBlockIndex: block.blockIndex,
    sourceClientRequestId: clientRequestId,
    sourceKind: 'assistant_message_block',
    ...(block.language ? { sourceLanguage: block.language } : {}),
  };

  return {
    blockIndex: block.blockIndex,
    content: block.content,
    language: block.language,
    metadata,
    title: `assistant-${shortRequestId}-${String(block.blockIndex + 1).padStart(2, '0')}.${fileExtension}`,
    type,
  };
}

function resolveArtifactTypeHint(language: string | null): ArtifactContentType | null {
  if (!language) {
    return null;
  }

  if (language === 'html') {
    return 'html';
  }
  if (language === 'svg') {
    return 'svg';
  }
  if (language === 'react' || language === 'jsx' || language === 'tsx') {
    return 'react';
  }
  if (language === 'mermaid' || language === 'mmd') {
    return 'mermaid';
  }
  if (language === 'markdown' || language === 'md') {
    return 'markdown';
  }
  if (language === 'csv') {
    return 'csv';
  }

  return null;
}

function normalizeFenceLanguage(raw: string): string | null {
  const normalized = raw
    .trim()
    .split(/\s+/u)[0]
    ?.toLowerCase()
    .replace(/^language-/u, '');
  return normalized && normalized.length > 0 ? normalized : null;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function findExistingArtifact(
  artifacts: ArtifactRecord[],
  clientRequestId: string,
  blockIndex: number,
): ArtifactRecord | undefined {
  return artifacts.find((artifact) => {
    const sourceClientRequestId = artifact.metadata['sourceClientRequestId'];
    const sourceBlockIndex = artifact.metadata['sourceBlockIndex'];
    return sourceClientRequestId === clientRequestId && sourceBlockIndex === blockIndex;
  });
}

function buildCreatedByNote(clientRequestId: string, blockIndex: number): string {
  return `assistant:${clientRequestId}:block:${blockIndex}`;
}
