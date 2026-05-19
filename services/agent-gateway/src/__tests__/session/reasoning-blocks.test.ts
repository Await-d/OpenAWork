import { describe, expect, it, vi } from 'vitest';
import {
  appendReasoningChunk,
  closeAllOpenReasoningBlocks,
  extractReasoningEntries,
  extractReasoningTexts,
  markReasoningBlockEnded,
} from '../../session/reasoning-blocks.js';

describe('reasoning-blocks', () => {
  it('keeps different reasoning summaries in separate blocks', () => {
    const blocks = [
      {
        type: 'thinking_delta' as const,
        delta: '先比较方案差异。',
        itemId: 'rs_1',
        outputIndex: 0,
        summaryIndex: 0,
      },
      {
        type: 'thinking_delta' as const,
        delta: '再检查边界条件。',
        itemId: 'rs_1',
        outputIndex: 0,
        summaryIndex: 1,
      },
    ].reduce(
      (current, chunk) => appendReasoningChunk(current, chunk),
      [] as ReturnType<typeof seed>,
    );

    expect(extractReasoningTexts(blocks)).toEqual(['先比较方案差异。', '再检查边界条件。']);
  });

  it('appends repeated deltas into the same reasoning block', () => {
    const blocks = seed();
    const next = appendReasoningChunk(
      appendReasoningChunk(blocks, {
        delta: '第一段',
        itemId: 'rs_1',
        outputIndex: 0,
        summaryIndex: 0,
      }),
      {
        delta: '继续补充',
        itemId: 'rs_1',
        outputIndex: 0,
        summaryIndex: 0,
      },
    );

    expect(extractReasoningTexts(next)).toEqual(['第一段继续补充']);
  });

  it('marks the matching identity-keyed block ended without touching siblings', () => {
    const blocks = [
      { key: 'item:rs_1:output:0:summary:0', text: '先比较方案差异。' },
      { key: 'item:rs_1:output:0:summary:1', text: '再检查边界条件。' },
    ];

    const next = markReasoningBlockEnded(blocks, {
      itemId: 'rs_1',
      outputIndex: 0,
      summaryIndex: 0,
      occurredAt: 1700000000000,
    });

    expect(next).toEqual([
      { key: 'item:rs_1:output:0:summary:0', text: '先比较方案差异。', endedAt: 1700000000000 },
      { key: 'item:rs_1:output:0:summary:1', text: '再检查边界条件。' },
    ]);
  });

  it('records startedAt on first delta but leaves later deltas untouched', () => {
    const clock = vi.fn<() => number>();
    clock.mockReturnValueOnce(1700000000000);
    clock.mockReturnValueOnce(1700000005000);
    const first = appendReasoningChunk(
      [],
      { delta: '第一段', itemId: 'rs_1', outputIndex: 0, summaryIndex: 0 },
      { now: clock },
    );
    const second = appendReasoningChunk(
      first,
      { delta: '续写', itemId: 'rs_1', outputIndex: 0, summaryIndex: 0 },
      { now: clock },
    );

    expect(first[0]?.startedAt).toBe(1700000000000);
    expect(second[0]?.startedAt).toBe(1700000000000);
    expect(clock).toHaveBeenCalledTimes(1);
  });

  it('closeAllOpenReasoningBlocks closes only blocks without endedAt', () => {
    const blocks = [
      { key: 'legacy:0', text: '思考1' },
      { key: 'item:rs_1:output:0:summary:0', text: '思考2', endedAt: 1700000000000 },
    ];
    const next = closeAllOpenReasoningBlocks(blocks, { now: () => 1700000099000 });

    expect(next).toEqual([
      { key: 'legacy:0', text: '思考1', endedAt: 1700000099000 },
      { key: 'item:rs_1:output:0:summary:0', text: '思考2', endedAt: 1700000000000 },
    ]);
  });

  it('extractReasoningEntries preserves startedAt/endedAt and filters empty', () => {
    const entries = extractReasoningEntries([
      { key: 'a', text: '   ', startedAt: 1, endedAt: 2 },
      { key: 'b', text: '保留', startedAt: 10, endedAt: 20 },
      { key: 'c', text: '只有起始', startedAt: 30 },
    ]);

    expect(entries).toEqual([
      { text: '保留', startedAt: 10, endedAt: 20 },
      { text: '只有起始', startedAt: 30, endedAt: undefined },
    ]);
  });

  it('records Anthropic signature on the matching block via providerMetadata', () => {
    const blocks = [
      { key: 'item:rs_1:output:0:summary:0', text: '思考1' },
      { key: 'item:rs_1:output:1:summary:0', text: '思考2' },
    ];
    const next = markReasoningBlockEnded(blocks, {
      itemId: 'rs_1',
      outputIndex: 0,
      summaryIndex: 0,
      occurredAt: 1700000010000,
      providerMetadata: { signature: 'sig-abc' },
    });
    expect(next[0]).toMatchObject({
      key: 'item:rs_1:output:0:summary:0',
      endedAt: 1700000010000,
      signature: 'sig-abc',
    });
    // The other block must not receive the signature.
    expect(next[1]).toMatchObject({ key: 'item:rs_1:output:1:summary:0' });
    expect(next[1]?.signature).toBeUndefined();
  });

  it('extractReasoningEntries surfaces signature when present', () => {
    const blocks = [
      { key: 'a', text: '内容', signature: 'sig-1' },
      { key: 'b', text: '另一段' },
    ];
    expect(extractReasoningEntries(blocks)).toEqual([
      { text: '内容', startedAt: undefined, endedAt: undefined, signature: 'sig-1' },
      { text: '另一段', startedAt: undefined, endedAt: undefined },
    ]);
  });

  it('closes every still-open block when the end chunk has no identity hint', () => {
    const blocks = [
      { key: 'legacy:0', text: '第一段思考' },
      { key: 'item:rs_1:output:0:summary:0', text: '第二段思考', endedAt: 1700000000000 },
      { key: 'item:rs_1:output:0:summary:1', text: '第三段思考' },
    ];

    const next = markReasoningBlockEnded(blocks, { occurredAt: 1700000010000 });

    expect(next.map((b) => ({ key: b.key, endedAt: b.endedAt }))).toEqual([
      { key: 'legacy:0', endedAt: 1700000010000 },
      { key: 'item:rs_1:output:0:summary:0', endedAt: 1700000000000 },
      { key: 'item:rs_1:output:0:summary:1', endedAt: 1700000010000 },
    ]);
  });
});

function seed() {
  return [] as Array<{ key: string; text: string }>;
}
