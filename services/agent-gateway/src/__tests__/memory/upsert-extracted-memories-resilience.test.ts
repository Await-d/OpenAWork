/**
 * Regression (§0.104, per-record write isolation): upsertExtractedMemories
 * applies each deduplicated candidate via an unguarded createMemory /
 * updateMemory SQLite write. Without per-candidate isolation one row throwing
 * (DB lock / disk error / constraint) aborted the remaining candidates AND —
 * because the returned counts were derived from the PLANNED arrays — reported
 * writes that never happened. The loops now isolate per candidate and count
 * only actual successes. We mock db.js so one candidate's INSERT throws and
 * assert the others are still written and `created` reflects real successes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedMemoryCandidate, MemorySettings } from '@openAwork/agent-core';
import type * as MemoryExtractionStoreModule from '../../memory/memory-extraction-store.js';

const POISON_KEY = 'poison-key';
const insertedKeys: string[] = [];
const SETTINGS: MemorySettings = {
  enabled: true,
  autoExtract: true,
  maxTokenBudget: 2000,
  minConfidence: 0.3,
  autoWriteMinConfidence: 0.65,
  reviewLowConfidence: true,
};

vi.mock('../../infra/db.js', () => ({
  // No existing memories → every candidate routes to the create path.
  sqliteAll: () => [],
  sqliteGet: () => undefined,
  // memories INSERT params: [id, userId, type, key, value, ...]; throw for the
  // poison key only so we can prove the loop continues past it.
  sqliteRun: (_sql: string, params: unknown[] = []) => {
    const key = params[3];
    if (key === POISON_KEY) {
      throw new Error('simulated memory INSERT failure');
    }
    if (typeof key === 'string') {
      insertedKeys.push(key);
    }
  },
}));

let memoryStore: typeof MemoryExtractionStoreModule;

beforeEach(async () => {
  insertedKeys.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  memoryStore = await import('../../memory/memory-extraction-store.js');
});

describe('upsertExtractedMemories per-candidate resilience', () => {
  it('单个候选写入抛错时不中断，其余候选仍写入且 created 只计实际成功数', () => {
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'fact', key: 'good-1', value: 'v1', confidence: 0.9 },
      { type: 'fact', key: POISON_KEY, value: 'v2', confidence: 0.9 },
      { type: 'fact', key: 'good-2', value: 'v3', confidence: 0.9 },
    ];

    // Must not throw despite the poison candidate's INSERT failing.
    const result = memoryStore.upsertExtractedMemories('u-1', candidates, null, SETTINGS);

    // Two healthy candidates were written; the poison one was skipped.
    expect(insertedKeys).toContain('good-1');
    expect(insertedKeys).toContain('good-2');
    expect(insertedKeys).not.toContain(POISON_KEY);
    // created counts only ACTUAL successes (2), not the planned 3.
    expect(result.created).toBe(2);
    expect(console.warn).toHaveBeenCalled();
  });

  it('低置信候选进入审阅且不会写入数据库', () => {
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'preference', key: 'style.response', value: '回复尽量短。', confidence: 0.6 },
    ];

    const result = memoryStore.upsertExtractedMemories('u-1', candidates, null, SETTINGS);

    expect(insertedKeys).toEqual([]);
    expect(result.created).toBe(0);
    expect(result.reviewed).toBe(1);
    expect(result.decisions[0]?.reason).toBe('low_confidence');
  });

  it('疑似敏感信息候选被拒绝且不会写入数据库', () => {
    const candidates: ExtractedMemoryCandidate[] = [
      {
        type: 'fact',
        key: 'secret',
        value: 'api_key = sk-abcdefghijklmnopqrstuvwxyz123456',
        confidence: 0.95,
      },
    ];

    const result = memoryStore.upsertExtractedMemories('u-1', candidates, null, SETTINGS);

    expect(insertedKeys).toEqual([]);
    expect(result.created).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.decisions[0]?.reason).toBe('sensitive_information');
  });
});
