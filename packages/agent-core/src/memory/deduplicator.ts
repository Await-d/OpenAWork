import type { MemoryEntry, ExtractedMemoryCandidate } from './types.js';
import { normalizeMemoryKey } from './helpers.js';

export interface DeduplicationResult {
  toCreate: ExtractedMemoryCandidate[];
  toUpdate: Array<{ existingId: string; candidate: ExtractedMemoryCandidate }>;
  duplicates: ExtractedMemoryCandidate[];
}

export function deduplicateMemories(
  candidates: ExtractedMemoryCandidate[],
  existing: MemoryEntry[],
): DeduplicationResult {
  const existingByNormalizedKey = new Map<string, MemoryEntry>();
  for (const entry of existing) {
    existingByNormalizedKey.set(`${entry.type}:${normalizeMemoryKey(entry.key)}`, entry);
  }

  const toCreate: ExtractedMemoryCandidate[] = [];
  const toUpdate: Array<{ existingId: string; candidate: ExtractedMemoryCandidate }> = [];
  const duplicates: ExtractedMemoryCandidate[] = [];

  for (const candidate of candidates) {
    const normalizedKey = `${candidate.type}:${normalizeMemoryKey(candidate.key)}`;
    const match = existingByNormalizedKey.get(normalizedKey);

    if (!match) {
      toCreate.push(candidate);
      continue;
    }

    if (match.value.trim() === candidate.value.trim()) {
      duplicates.push(candidate);
      continue;
    }

    if (candidate.confidence >= match.confidence) {
      toUpdate.push({ existingId: match.id, candidate });
    } else {
      duplicates.push(candidate);
    }
  }

  return { toCreate, toUpdate, duplicates };
}
