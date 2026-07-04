import type {
  ExtractedMemoryCandidate,
  MemoryCandidateDecision,
  MemorySettings,
} from '@openAwork/agent-core';
import { deduplicateMemories, evaluateMemoryCandidateForPersistence } from '@openAwork/agent-core';
import { createMemory, listMemories, updateMemory } from './memory-store.js';
import { scanMemoryWriteContent } from './memory-security-scanner.js';

export interface UpsertExtractedMemoriesResult {
  readonly created: number;
  readonly updated: number;
  readonly duplicates: number;
  readonly blocked: number;
  readonly reviewed: number;
  readonly rejected: number;
  readonly decisions: readonly MemoryCandidateDecision[];
}

function scanCandidate(candidate: ExtractedMemoryCandidate): boolean {
  const scanKey = scanMemoryWriteContent(candidate.key);
  const scanValue = scanMemoryWriteContent(candidate.value);
  return scanKey.ok && scanValue.ok;
}

export function upsertExtractedMemories(
  userId: string,
  candidates: readonly ExtractedMemoryCandidate[],
  workspaceRoot: string | null = null,
  settings: MemorySettings,
): UpsertExtractedMemoriesResult {
  const persistableCandidates: ExtractedMemoryCandidate[] = [];
  const decisions: MemoryCandidateDecision[] = [];
  let blocked = 0;
  let reviewed = 0;
  let rejected = 0;

  for (const candidate of candidates) {
    if (!scanCandidate(candidate)) {
      blocked += 1;
      continue;
    }

    const decision = evaluateMemoryCandidateForPersistence(candidate, settings);
    decisions.push(decision);

    switch (decision.status) {
      case 'persist':
        persistableCandidates.push(candidate);
        break;
      case 'review':
        reviewed += 1;
        break;
      case 'reject':
        rejected += 1;
        break;
    }
  }

  const existing = listMemories(userId, { enabled: true, limit: 1000 });
  const result = deduplicateMemories(persistableCandidates, existing);

  let created = 0;
  for (const candidate of result.toCreate) {
    try {
      createMemory(userId, {
        type: candidate.type,
        key: candidate.key,
        value: candidate.value,
        source: 'auto_extracted',
        confidence: candidate.confidence,
        priority: 30,
        workspaceRoot,
      });
      created += 1;
    } catch (err) {
      console.warn(
        `[memory-store] 自动抽取记忆写入失败，已跳过该条：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  let updated = 0;
  for (const { existingId, candidate } of result.toUpdate) {
    try {
      updateMemory(userId, existingId, {
        value: candidate.value,
      });
      updated += 1;
    } catch (err) {
      console.warn(
        `[memory-store] 自动抽取记忆更新失败，已跳过该条：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return {
    created,
    updated,
    duplicates: result.duplicates.length,
    blocked,
    reviewed,
    rejected,
    decisions,
  };
}
