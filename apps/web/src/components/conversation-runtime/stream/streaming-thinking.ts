import type { StreamThinkingChunk, StreamThinkingEndChunk } from '@openAwork/shared';

export interface StreamingThinkingBlock {
  key: string;
  text: string;
  /** UNIX millis recorded on the first delta of this block. */
  startedAt?: number;
  /** UNIX millis recorded when `thinking_end` for this block arrived. */
  endedAt?: number;
}

const LEGACY_THINKING_BLOCK_KEY = 'legacy:0';

function buildStreamingThinkingBlockKey(
  chunk: Pick<StreamThinkingChunk, 'itemId' | 'outputIndex' | 'summaryIndex'>,
): string {
  if (typeof chunk.itemId === 'string' && chunk.itemId.trim().length > 0) {
    return `item:${chunk.itemId}:output:${chunk.outputIndex ?? -1}:summary:${chunk.summaryIndex ?? -1}`;
  }

  if (typeof chunk.outputIndex === 'number' || typeof chunk.summaryIndex === 'number') {
    return `indexed:${chunk.outputIndex ?? -1}:summary:${chunk.summaryIndex ?? -1}`;
  }

  return LEGACY_THINKING_BLOCK_KEY;
}

export function appendStreamingThinkingChunk(
  previousBlocks: StreamingThinkingBlock[],
  chunk: Pick<StreamThinkingChunk, 'delta' | 'itemId' | 'outputIndex' | 'summaryIndex'>,
  options?: { now?: () => number },
): StreamingThinkingBlock[] {
  if (chunk.delta.length === 0) {
    return previousBlocks;
  }

  const now = options?.now ?? Date.now;
  const blockKey = buildStreamingThinkingBlockKey(chunk);
  const existingIndex = previousBlocks.findIndex((block) => block.key === blockKey);
  if (existingIndex === -1) {
    return [...previousBlocks, { key: blockKey, text: chunk.delta, startedAt: now() }];
  }

  return previousBlocks.map((block, index) =>
    index === existingIndex ? { ...block, text: `${block.text}${chunk.delta}` } : block,
  );
}

/**
 * Mark a streaming reasoning block as ended given a `thinking_end` chunk.
 * - With identity (itemId/outputIndex/summaryIndex): only the matching block is closed.
 * - Without identity (e.g. OpenAI Chat Completions single-stream thinking): all
 *   still-open blocks are closed.
 */
export function markStreamingThinkingChunkEnded(
  previousBlocks: StreamingThinkingBlock[],
  chunk: Pick<StreamThinkingEndChunk, 'itemId' | 'outputIndex' | 'summaryIndex' | 'occurredAt'>,
): StreamingThinkingBlock[] {
  if (previousBlocks.length === 0) return previousBlocks;
  const endedAt = chunk.occurredAt ?? Date.now();
  const hasIdentity =
    (typeof chunk.itemId === 'string' && chunk.itemId.trim().length > 0) ||
    typeof chunk.outputIndex === 'number' ||
    typeof chunk.summaryIndex === 'number';

  if (!hasIdentity) {
    return previousBlocks.map((block) => (block.endedAt ? block : { ...block, endedAt }));
  }

  const targetKey = buildStreamingThinkingBlockKey(chunk);
  return previousBlocks.map((block) =>
    block.key === targetKey && !block.endedAt ? { ...block, endedAt } : block,
  );
}

export function extractStreamingThinkingTexts(blocks: StreamingThinkingBlock[]): string[] {
  return blocks.map((block) => block.text).filter((text) => text.trim().length > 0);
}

export function joinStreamingThinkingTexts(blocks: StreamingThinkingBlock[]): string {
  return extractStreamingThinkingTexts(blocks).join('\n\n');
}

/**
 * Project the boolean ended-flag in the same order as `extractStreamingThinkingTexts`,
 * so the UI can pair text with its end state by index.
 */
export function extractStreamingThinkingEndedFlags(blocks: StreamingThinkingBlock[]): boolean[] {
  return blocks
    .filter((block) => block.text.trim().length > 0)
    .map((block) => block.endedAt !== undefined);
}

/** Duration in millis (rounded down) for blocks that have both startedAt and endedAt; -1 otherwise. */
export function extractStreamingThinkingDurations(blocks: StreamingThinkingBlock[]): number[] {
  return blocks
    .filter((block) => block.text.trim().length > 0)
    .map((block) => {
      if (typeof block.startedAt !== 'number' || typeof block.endedAt !== 'number') {
        return -1;
      }
      const delta = block.endedAt - block.startedAt;
      return delta < 0 ? -1 : delta;
    });
}
