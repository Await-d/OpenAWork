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
  /**
   * OpenAI Chat 兼容网关的思维链字段名（`reasoning_content` / `reasoning` /
   * `reasoning_text`）。持久化后在后续轮次按同名写回上游。
   */
  reasoningField?: string;
  /** 结构化思维链条目（上游 `reasoning_details`），部分网关要求原样回传。 */
  reasoningDetails?: ReadonlyArray<unknown>;
  /** 上述元数据的命名空间（路由 `providerMetadataKey`，缺省按 `openai` 处理）。 */
  providerMetadataKey?: string;
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
  const endedAt = chunk.occurredAt ?? Date.now();
  const signature = chunk.providerMetadata?.signature;
  const reasoningField = chunk.providerMetadata?.reasoningField;
  const reasoningDetails = chunk.providerMetadata?.reasoningDetails;
  const providerMetadataKey = chunk.providerMetadata?.providerMetadataKey;
  const hasOpenAIMeta =
    (typeof reasoningField === 'string' && reasoningField.length > 0) ||
    Array.isArray(reasoningDetails);
  if (previousBlocks.length === 0) {
    // OpenAI Chat 的「只有结构化条目、没有正文 delta」响应没有块可挂：
    // 落一个占位块，让元数据能持久化并在后续轮次回传。
    if (!hasOpenAIMeta) return previousBlocks;
    return [
      {
        key: buildReasoningBlockKey(chunk),
        text: '',
        endedAt,
        ...(typeof reasoningField === 'string' && reasoningField.length > 0
          ? { reasoningField }
          : {}),
        ...(Array.isArray(reasoningDetails) ? { reasoningDetails } : {}),
        ...(typeof providerMetadataKey === 'string' && providerMetadataKey.length > 0
          ? { providerMetadataKey }
          : {}),
      },
    ];
  }
  const hasIdentity =
    (typeof chunk.itemId === 'string' && chunk.itemId.trim().length > 0) ||
    typeof chunk.outputIndex === 'number' ||
    typeof chunk.summaryIndex === 'number';

  const finalize = (block: ReasoningBlock): ReasoningBlock => ({
    ...block,
    ...(block.endedAt ? {} : { endedAt }),
    ...(typeof signature === 'string' && signature.length > 0 ? { signature } : {}),
  });

  const result = (() => {
    if (!hasIdentity) {
      return previousBlocks.map((block) => (block.endedAt && !signature ? block : finalize(block)));
    }
    const targetKey = buildReasoningBlockKey(chunk);
    return previousBlocks.map((block) => (block.key === targetKey ? finalize(block) : block));
  })();

  // OpenAI Chat 家族的思维链元数据是「响应级」的：挂到第一个块上
  // （与 native-message-bridge 的 index === 0 约定一致），避免多块时重复。
  const first = result[0];
  if (first === undefined || !hasOpenAIMeta) {
    return result;
  }
  return [
    {
      ...first,
      ...(typeof reasoningField === 'string' && reasoningField.length > 0
        ? { reasoningField }
        : {}),
      ...(Array.isArray(reasoningDetails) ? { reasoningDetails } : {}),
      ...(typeof providerMetadataKey === 'string' && providerMetadataKey.length > 0
        ? { providerMetadataKey }
        : {}),
    },
    ...result.slice(1),
  ];
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
  /** OpenAI Chat 家族：思维链字段名（历史回传时按同名写回）。 */
  reasoningField?: string;
  /** OpenAI Chat 家族：结构化思维链条目（部分网关要求原样回传）。 */
  reasoningDetails?: ReadonlyArray<unknown>;
  /** 上述元数据的命名空间（路由 `providerMetadataKey`，缺省按 `openai` 处理）。 */
  providerMetadataKey?: string;
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
      ...(typeof block.reasoningField === 'string' && block.reasoningField.length > 0
        ? { reasoningField: block.reasoningField }
        : {}),
      ...(Array.isArray(block.reasoningDetails)
        ? { reasoningDetails: block.reasoningDetails }
        : {}),
      ...(typeof block.providerMetadataKey === 'string' && block.providerMetadataKey.length > 0
        ? { providerMetadataKey: block.providerMetadataKey }
        : {}),
    }))
    .filter((entry) => entry.text.length > 0);
}

export function joinReasoningTexts(blocks: ReasoningBlock[]): string {
  return extractReasoningTexts(blocks).join('\n\n');
}
