/**
 * Helpers for accumulating ordered chat-message parts during streaming.
 *
 * Background
 * ----------
 * Live streaming events arrive in three flavours: `text_delta`,
 * `thinking_delta`, and `tool_call_delta`. The legacy live-render code paths
 * appended each kind into a *separate* React state slot (string buffer, block
 * array, tool-call map) and only re-assembled them at render time using
 * `partsFromAssistantTrace`, which forced a fixed `reasoning → text → tool`
 * ordering. That made interleaved sequences (e.g. `tool → text → tool`)
 * collapse into a non-faithful render, and produced a visible mismatch with
 * the gateway's persisted ordering after a refresh.
 *
 * The helpers here let us mirror the wire-arrival ordering directly:
 * each delta extends the trailing same-kind segment when possible, otherwise
 * it opens a new segment positioned at the current end of the list. The
 * resulting `ChatMessagePart[]` is consumed by the live renderer (so the UI
 * matches the wire order) and by `closeCurrentStreamingRoundIntoMessage`
 * (so committed round messages also reflect that order before the gateway
 * refresh replaces them with persisted truth).
 */
import type { StreamThinkingChunk } from '@openAwork/shared';
import type { ChatMessagePart } from './support.js';
import type { StreamingThinkingBlock } from './streaming-thinking.js';

/**
 * Build a stable identity key for a reasoning chunk so subsequent deltas of
 * the *same* reasoning block extend a single segment. Mirrors the keying
 * logic in `streaming-thinking.ts` and the gateway's
 * `buildReasoningBlockKey` so wire-key shapes line up across the boundary.
 */
function streamingThinkingBlockKey(
  chunk: Pick<StreamThinkingChunk, 'itemId' | 'outputIndex' | 'summaryIndex'>,
): string {
  if (typeof chunk.itemId === 'string' && chunk.itemId.trim().length > 0) {
    return `item:${chunk.itemId}:output:${chunk.outputIndex ?? -1}:summary:${chunk.summaryIndex ?? -1}`;
  }
  if (typeof chunk.outputIndex === 'number' || typeof chunk.summaryIndex === 'number') {
    return `indexed:${chunk.outputIndex ?? -1}:summary:${chunk.summaryIndex ?? -1}`;
  }
  return 'legacy:0';
}

interface ReasoningSegmentMeta {
  /** Stable key derived from the chunk's identity fields. */
  blockKey: string;
}

/**
 * Append a `text_delta` to the ordered segment list, extending the trailing
 * text segment if present (so chained text deltas coalesce into one part).
 */
export function appendStreamingTextDelta(
  segments: ChatMessagePart[],
  delta: string,
  messageId: string,
): ChatMessagePart[] {
  if (delta.length === 0) return segments;
  const next = segments.slice();
  const last = next[next.length - 1];
  if (last && last.type === 'text') {
    next[next.length - 1] = { ...last, text: last.text + delta };
    return next;
  }
  next.push({
    id: `${messageId}:text:${countByType(next, 'text')}`,
    type: 'text',
    text: delta,
  });
  return next;
}

/**
 * Append a `thinking_delta` chunk to the ordered segment list.
 *
 * Ordering rule (must match the gateway's persistence ordering): only the
 * *trailing* segment is considered for in-place extension. If the last
 * segment is a reasoning segment with the same `blockKey`, we extend it;
 * otherwise a new reasoning segment is opened at the current end of the
 * list, even if an *earlier* segment shares the same `blockKey`. This
 * preserves the wire-arrival ordering when the LLM interleaves reasoning,
 * text, and tool calls (e.g. reasoning_A → text → reasoning_A continues
 * → tool: rendered as [reasoning_A_part1, text, reasoning_A_part2, tool],
 * not [reasoning_A_combined, text, tool]).
 *
 * `metaByPartId` carries the `blockKey` per reasoning part so we can match
 * later deltas without leaking it into the public `ChatMessagePart` shape.
 */
export function appendStreamingThinkingDelta(
  segments: ChatMessagePart[],
  metaByPartId: Map<string, ReasoningSegmentMeta>,
  chunk: Pick<StreamThinkingChunk, 'delta' | 'itemId' | 'outputIndex' | 'summaryIndex' | 'occurredAt'>,
  messageId: string,
): ChatMessagePart[] {
  if (chunk.delta.length === 0) return segments;
  const blockKey = streamingThinkingBlockKey(chunk);
  const last = segments[segments.length - 1];
  const lastMeta = last && last.type === 'reasoning' ? metaByPartId.get(last.id) : undefined;
  if (last && last.type === 'reasoning' && lastMeta?.blockKey === blockKey) {
    const next = segments.slice();
    next[next.length - 1] = {
      ...last,
      text: last.text + chunk.delta,
      ...(last.startedAt === undefined && typeof chunk.occurredAt === 'number'
        ? { startedAt: chunk.occurredAt }
        : {}),
    };
    return next;
  }
  const next = segments.slice();
  const newPartId = `${messageId}:reasoning:${countByType(next, 'reasoning')}`;
  metaByPartId.set(newPartId, { blockKey });
  next.push({
    id: newPartId,
    type: 'reasoning',
    text: chunk.delta,
    ...(typeof chunk.occurredAt === 'number' ? { startedAt: chunk.occurredAt } : {}),
  });
  return next;
}

/**
 * Mark every reasoning segment that shares the chunk's `blockKey` as ended,
 * recording `endedAt` so the UI can render duration. Marking *all* matching
 * segments matters now that a single reasoning block may be split across
 * multiple non-contiguous segments (when text/tool segments interleave) —
 * otherwise the earlier slices would render as "still thinking" forever.
 * No-op if no segment matches.
 */
export function markStreamingReasoningSegmentEnded(
  segments: ChatMessagePart[],
  metaByPartId: Map<string, ReasoningSegmentMeta>,
  chunk: { itemId?: string; outputIndex?: number; summaryIndex?: number; occurredAt?: number },
): ChatMessagePart[] {
  const blockKey = streamingThinkingBlockKey(chunk);
  const endedAt = chunk.occurredAt ?? Date.now();
  let mutated = false;
  const next = segments.map((segment) => {
    if (!segment || segment.type !== 'reasoning') return segment;
    const meta = metaByPartId.get(segment.id);
    if (meta?.blockKey !== blockKey) return segment;
    if (segment.endedAt !== undefined) return segment;
    mutated = true;
    return { ...segment, endedAt };
  });
  return mutated ? next : segments;
}

/**
 * Append or update a tool segment for a `tool_call_delta`. Each `toolCallId`
 * gets exactly one segment, positioned where it first appeared in the wire
 * stream. Subsequent argument deltas update the tool's `input` (parsed) on
 * that same segment.
 */
export function upsertStreamingToolSegment(
  segments: ChatMessagePart[],
  toolCall: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    status?: 'running' | 'paused' | 'completed' | 'failed';
    output?: unknown;
    isError?: boolean;
    pendingPermissionRequestId?: string;
    resumedAfterApproval?: boolean;
    kind?: 'agent' | 'mcp' | 'skill' | 'tool';
  },
): ChatMessagePart[] {
  const next = segments.slice();
  const matchIndex = next.findIndex(
    (segment) => segment.type === 'tool' && segment.toolCallId === toolCall.toolCallId,
  );
  if (matchIndex >= 0) {
    const existing = next[matchIndex];
    if (existing && existing.type === 'tool') {
      next[matchIndex] = {
        ...existing,
        toolName: toolCall.toolName || existing.toolName,
        input: toolCall.input,
        ...(toolCall.status ? { status: toolCall.status } : {}),
        ...(toolCall.output !== undefined ? { output: toolCall.output } : {}),
        ...(toolCall.isError !== undefined ? { isError: toolCall.isError } : {}),
        ...(toolCall.kind ? { kind: toolCall.kind } : {}),
        ...(toolCall.pendingPermissionRequestId
          ? { pendingPermissionRequestId: toolCall.pendingPermissionRequestId }
          : {}),
        ...(toolCall.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
      };
    }
    return next;
  }
  next.push({
    id: toolCall.toolCallId,
    type: 'tool',
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: toolCall.input,
    status: toolCall.status ?? 'running',
    ...(toolCall.kind ? { kind: toolCall.kind } : {}),
    ...(toolCall.output !== undefined ? { output: toolCall.output } : {}),
    ...(toolCall.isError !== undefined ? { isError: toolCall.isError } : {}),
    ...(toolCall.pendingPermissionRequestId
      ? { pendingPermissionRequestId: toolCall.pendingPermissionRequestId }
      : {}),
    ...(toolCall.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
  });
  return next;
}

/**
 * Update an existing tool segment with a tool_result payload. No-op if the
 * matching segment does not exist (which can happen for tool_results that
 * arrive before any tool_call_delta in attach scenarios — those are handled
 * by `upsertStreamingToolSegment` later).
 */
export function applyToolResultToStreamingSegment(
  segments: ChatMessagePart[],
  toolResult: {
    toolCallId: string;
    output?: unknown;
    isError?: boolean;
    status?: 'running' | 'paused' | 'completed' | 'failed';
    pendingPermissionRequestId?: string;
    resumedAfterApproval?: boolean;
  },
): ChatMessagePart[] {
  const next = segments.slice();
  const matchIndex = next.findIndex(
    (segment) => segment.type === 'tool' && segment.toolCallId === toolResult.toolCallId,
  );
  if (matchIndex < 0) return segments;
  const existing = next[matchIndex];
  if (existing && existing.type === 'tool') {
    next[matchIndex] = {
      ...existing,
      ...(toolResult.output !== undefined ? { output: toolResult.output } : {}),
      ...(toolResult.isError !== undefined ? { isError: toolResult.isError } : {}),
      ...(toolResult.status ? { status: toolResult.status } : {}),
      ...(toolResult.pendingPermissionRequestId !== undefined
        ? { pendingPermissionRequestId: toolResult.pendingPermissionRequestId }
        : {}),
      ...(toolResult.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
    };
  }
  return next;
}

function countByType(segments: ChatMessagePart[], type: ChatMessagePart['type']): number {
  let count = 0;
  for (const segment of segments) {
    if (segment.type === type) count += 1;
  }
  return count;
}

/**
 * Project the ordered segments back into a `StreamingThinkingBlock[]`
 * representation for code paths that still consume the legacy thinking
 * block array (e.g. duration extraction). Each reasoning segment maps to
 * one block with the same identity key.
 */
export function reasoningBlocksFromSegments(
  segments: ChatMessagePart[],
  metaByPartId: Map<string, ReasoningSegmentMeta>,
): StreamingThinkingBlock[] {
  const blocks: StreamingThinkingBlock[] = [];
  for (const segment of segments) {
    if (segment.type !== 'reasoning') continue;
    const meta = metaByPartId.get(segment.id);
    blocks.push({
      key: meta?.blockKey ?? `reasoning:${blocks.length}`,
      text: segment.text,
      ...(typeof segment.startedAt === 'number' ? { startedAt: segment.startedAt } : {}),
      ...(typeof segment.endedAt === 'number' ? { endedAt: segment.endedAt } : {}),
    });
  }
  return blocks;
}

/**
 * Extract the concatenated text content from text segments for legacy
 * consumers (e.g. token estimators, stream-reveal targets).
 */
export function textFromSegments(segments: ChatMessagePart[]): string {
  let combined = '';
  for (const segment of segments) {
    if (segment.type === 'text') combined += segment.text;
  }
  return combined;
}
