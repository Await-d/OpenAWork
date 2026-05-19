import type { StreamThinkingChunk, StreamThinkingEndChunk } from '@openAwork/shared';

export interface ReasoningBlock {
  key: string;
  text: string;
  /** UNIX millis recorded on first delta; absent when block was carried over from history. */
  startedAt?: number;
  /** UNIX millis recorded when the upstream signalled the block was complete. */
  endedAt?: number;
  /**
   * Anthropic extended-thinking signature for this block. Persisted on the
   * matching ReasoningPart's `metadata.anthropic.signature` and replayed on
   * subsequent turns so Anthropic accepts the thinking block.
   */
  signature?: string;
}

const LEGACY_REASONING_BLOCK_KEY = 'legacy:0';

export function buildReasoningBlockKey(
  chunk: Pick<StreamThinkingChunk, 'itemId' | 'outputIndex' | 'summaryIndex'>,
): string {
  if (typeof chunk.itemId === 'string' && chunk.itemId.trim().length > 0) {
    return `item:${chunk.itemId}:output:${chunk.outputIndex ?? -1}:summary:${chunk.summaryIndex ?? -1}`;
  }

  if (typeof chunk.outputIndex === 'number' || typeof chunk.summaryIndex === 'number') {
    return `indexed:${chunk.outputIndex ?? -1}:summary:${chunk.summaryIndex ?? -1}`;
  }

  return LEGACY_REASONING_BLOCK_KEY;
}

export function appendReasoningChunk(
  previousBlocks: ReasoningBlock[],
  chunk: Pick<StreamThinkingChunk, 'delta' | 'itemId' | 'outputIndex' | 'summaryIndex'>,
  options?: { now?: () => number },
): ReasoningBlock[] {
  if (chunk.delta.length === 0) {
    return previousBlocks;
  }

  const now = options?.now ?? Date.now;
  const blockKey = buildReasoningBlockKey(chunk);
  const existingIndex = previousBlocks.findIndex((block) => block.key === blockKey);
  if (existingIndex === -1) {
    return [...previousBlocks, { key: blockKey, text: chunk.delta, startedAt: now() }];
  }

  return previousBlocks.map((block, index) =>
    index === existingIndex ? { ...block, text: `${block.text}${chunk.delta}` } : block,
  );
}

/**
 * Force-close every still-open reasoning block. Used as a fail-safe when the
 * upstream stream ends abruptly (cancellation, network error) before emitting
 * `thinking_end` for outstanding blocks.
 */
export function closeAllOpenReasoningBlocks(
  previousBlocks: ReasoningBlock[],
  options?: { now?: () => number },
): ReasoningBlock[] {
  if (previousBlocks.length === 0) return previousBlocks;
  const now = options?.now ?? Date.now;
  const endedAt = now();
  return previousBlocks.map((block) => (block.endedAt ? block : { ...block, endedAt }));
}

/**
 * Mark the matching reasoning block (or all open blocks if the end chunk has no
 * identity hint) as ended. The match strategy mirrors `appendReasoningChunk`:
 * - If the end chunk carries `itemId`/`outputIndex`/`summaryIndex`, only the
 *   block sharing the same composite key is marked.
 * - Otherwise (e.g. OpenAI Chat Completions which uses a single ongoing
 *   thinking stream), every still-open block is closed.
 */
export function markReasoningBlockEnded(
  previousBlocks: ReasoningBlock[],
  chunk: Pick<
    StreamThinkingEndChunk,
    'itemId' | 'outputIndex' | 'summaryIndex' | 'occurredAt' | 'providerMetadata'
  >,
): ReasoningBlock[] {
  if (previousBlocks.length === 0) return previousBlocks;
  const endedAt = chunk.occurredAt ?? Date.now();
  const signature = chunk.providerMetadata?.signature;
  const hasIdentity =
    (typeof chunk.itemId === 'string' && chunk.itemId.trim().length > 0) ||
    typeof chunk.outputIndex === 'number' ||
    typeof chunk.summaryIndex === 'number';

  const finalize = (block: ReasoningBlock): ReasoningBlock => ({
    ...block,
    ...(block.endedAt ? {} : { endedAt }),
    ...(typeof signature === 'string' && signature.length > 0 ? { signature } : {}),
  });

  if (!hasIdentity) {
    return previousBlocks.map((block) => (block.endedAt && !signature ? block : finalize(block)));
  }

  const targetKey = buildReasoningBlockKey(chunk);
  return previousBlocks.map((block) => (block.key === targetKey ? finalize(block) : block));
}

export function extractReasoningTexts(blocks: ReasoningBlock[]): string[] {
  return blocks.map((block) => block.text.trim()).filter((text) => text.length > 0);
}

export interface ReasoningEntry {
  text: string;
  startedAt?: number;
  endedAt?: number;
  /** Anthropic extended-thinking signature (when present). */
  signature?: string;
}

/**
 * Same filter rule as `extractReasoningTexts` (drops empty trimmed text) but
 * preserves the originating block's `startedAt`/`endedAt` so persistence layers
 * can record full thinking duration metadata.
 */
export function extractReasoningEntries(blocks: ReasoningBlock[]): ReasoningEntry[] {
  return blocks
    .map((block) => ({
      text: block.text.trim(),
      startedAt: block.startedAt,
      endedAt: block.endedAt,
      ...(typeof block.signature === 'string' && block.signature.length > 0
        ? { signature: block.signature }
        : {}),
    }))
    .filter((entry) => entry.text.length > 0);
}

export function joinReasoningTexts(blocks: ReasoningBlock[]): string {
  return extractReasoningTexts(blocks).join('\n\n');
}
