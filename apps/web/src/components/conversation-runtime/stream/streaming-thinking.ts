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
  options?: { forceNewBlock?: boolean; now?: () => number },
): StreamingThinkingBlock[] {
  if (chunk.delta.length === 0) {
    return previousBlocks;
  }

  const now = options?.now ?? Date.now;
  const blockKey = buildStreamingThinkingBlockKey(chunk);
  const lastIndex = previousBlocks.length - 1;
  const lastBlock = previousBlocks[lastIndex];
  if (!options?.forceNewBlock && lastBlock?.key === blockKey && lastBlock.endedAt === undefined) {
    return previousBlocks.map((block, index) =>
      index === lastIndex ? { ...block, text: `${block.text}${chunk.delta}` } : block,
    );
  }

  const matchingBlocks = previousBlocks.filter(
    (block) => block.key === blockKey || block.key.startsWith(`${blockKey}#`),
  );
  const nextKey = matchingBlocks.length === 0 ? blockKey : `${blockKey}#${matchingBlocks.length}`;
  return [...previousBlocks, { key: nextKey, text: chunk.delta, startedAt: now() }];
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
  let targetIndex = -1;
  for (let index = previousBlocks.length - 1; index >= 0; index -= 1) {
    const block = previousBlocks[index]!;
    if ((block.key === targetKey || block.key.startsWith(`${targetKey}#`)) && !block.endedAt) {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) return previousBlocks;
  return previousBlocks.map((block, index) =>
    index === targetIndex ? { ...block, endedAt } : block,
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
