/**
 * 261101-记忆确认写入与周期整理：`upsertExtractedMemories` 已从「直接写 memories」改为
 * 「逐候选创建待确认提议」。旧回归（per-record write isolation）的断言基于「写 memories
 * 表」，不再成立，故改写为验证**提议语义**：
 *   1. 普通长期候选 → 创建提议（不再写 memories）；
 *   2. 临时 / 一次性候选 → 不建提议（transient 计数）；
 *   3. 可疑敏感信息候选 → 不建提议（blocked 计数，安全扫描先拦）；
 *   4. 低置信候选仍进 reviewed（策略判定照旧），但提议由上游决定。
 *
 * 通过 mock 治理层的 `createMemoryProposal` 精确控制 outcome，验证壳层的归类映射。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedMemoryCandidate, MemorySettings } from '@openAwork/agent-core';
import type * as MemoryExtractionStoreModule from '../../memory/memory-extraction-store.js';
import type { CreateMemoryProposalOutcome } from '../../memory/governance/memory-proposal-store.js';

const SETTINGS: MemorySettings = {
  enabled: true,
  autoExtract: true,
  maxTokenBudget: 2000,
  minConfidence: 0.3,
  autoWriteMinConfidence: 0.65,
  reviewLowConfidence: true,
};

// 记录每次提议请求的 payload，供断言候选是否被提交。
const proposedPayloads: Array<{ key: string; outcome: CreateMemoryProposalOutcome }> = [];
let nextOutcome: CreateMemoryProposalOutcome = 'created';

vi.mock('../../memory/governance/memory-proposal-store.js', () => ({
  createMemoryProposal: (input: { payload: { key?: string } }) => {
    const key = input.payload.key ?? '';
    proposedPayloads.push({ key, outcome: nextOutcome });
    return nextOutcome === 'created'
      ? { outcome: 'created', proposal: { id: `p-${key}` } }
      : { outcome: nextOutcome, detail: 'mock' };
  },
}));

vi.mock('../../memory/governance/memory-scope-resolver.js', () => ({
  resolveProposalScopeForSession: () => ({ type: 'user', id: 'u-1' }),
  resolveAllowedInjectionScopes: () => ['user:u-1'],
  resolveAllowedInjectionScopeObjects: () => [{ type: 'user', id: 'u-1' }],
  isChannelSessionMetadata: () => false,
}));

let memoryStore: typeof MemoryExtractionStoreModule;

beforeEach(async () => {
  proposedPayloads.length = 0;
  nextOutcome = 'created';
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  memoryStore = await import('../../memory/memory-extraction-store.js');
});

describe('upsertExtractedMemories 提议语义', () => {
  it('长期候选逐条创建提议，created 计实际提议数', () => {
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'preference', key: 'editor', value: '以后统一用 Vim 键位', confidence: 0.9 },
      { type: 'fact', key: 'lang', value: '默认使用 TypeScript', confidence: 0.9 },
    ];

    const result = memoryStore.upsertExtractedMemories('u-1', candidates, null, SETTINGS);

    expect(proposedPayloads.map((p) => p.key)).toEqual(['editor', 'lang']);
    expect(result.proposed).toBe(2);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
  });

  it('临时 / 一次性候选不产生提议（transient）', () => {
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'fact', key: 'debug', value: '这次先临时改一下配置', confidence: 0.9 },
    ];

    const result = memoryStore.upsertExtractedMemories('u-1', candidates, null, SETTINGS);

    expect(proposedPayloads).toEqual([]);
    expect(result.proposed).toBe(0);
    expect(result.transient).toBe(1);
  });

  it('疑似敏感信息候选被策略拒绝，不产生提议（rejected）', () => {
    const candidates: ExtractedMemoryCandidate[] = [
      {
        type: 'fact',
        key: 'secret',
        // 带长期语义（“以后”）以越过「值不值得问」过滤，命中敏感信息策略分支。
        value: '以后请使用 api_key = sk-abcdefghijklmnopqrstuvwxyz123456',
        confidence: 0.95,
      },
    ];

    const result = memoryStore.upsertExtractedMemories('u-1', candidates, null, SETTINGS);

    expect(proposedPayloads).toEqual([]);
    expect(result.rejected).toBe(1);
    expect(result.proposed).toBe(0);
  });

  it('低置信候选仍进 reviewed（策略判定照旧），但提议由上游决定', () => {
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'preference', key: 'style.response', value: '以后回复尽量短。', confidence: 0.6 },
    ];

    const result = memoryStore.upsertExtractedMemories('u-1', candidates, null, SETTINGS);

    expect(result.reviewed).toBe(1);
    expect(result.decisions[0]?.reason).toBe('low_confidence');
  });

  it('命中重复抑制时计入 suppressed 而非 proposed', () => {
    nextOutcome = 'duplicate';
    const candidates: ExtractedMemoryCandidate[] = [
      { type: 'preference', key: 'editor', value: '以后统一用 Vim 键位', confidence: 0.9 },
    ];

    const result = memoryStore.upsertExtractedMemories('u-1', candidates, null, SETTINGS);

    expect(result.proposed).toBe(0);
    expect(result.suppressed).toBe(1);
  });
});
