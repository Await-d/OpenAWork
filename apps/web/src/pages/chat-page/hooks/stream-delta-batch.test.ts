import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamThinkingChunk } from '@openAwork/shared';
import type { ChatMessagePart } from '../../../components/conversation-runtime/messages/support.js';
import {
  appendStreamingThinkingDelta,
  appendStreamingTextDelta,
  markStreamingReasoningSegmentEnded,
  upsertStreamingToolSegment,
} from '../../../components/conversation-runtime/stream/streaming-segments.js';
import {
  appendStreamingThinkingChunk,
  joinStreamingThinkingTexts,
  markStreamingThinkingChunkEnded,
} from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import * as streamingSegments from '../../../components/conversation-runtime/stream/streaming-segments.js';
import * as streamingThinking from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import { createStreamDeltaBatch } from './stream-delta-batch.js';

const empty = () => ({
  segments: [] as ChatMessagePart[],
  thinkingBlocks: [] as StreamingThinkingBlock[],
  thinking: '',
});
const thinking = (delta: string, itemId = 'a', occurredAt = 100): StreamThinkingChunk => ({
  type: 'thinking_delta',
  delta,
  itemId,
  occurredAt,
});

afterEach(() => vi.restoreAllMocks());

describe('stream delta batch', () => {
  it('queues dense deltas without touching published snapshots and drains the tail once', () => {
    const batch = createStreamDeltaBatch();
    const initial = empty();
    Object.freeze(initial.segments);
    Object.freeze(initial.thinkingBlocks);
    const meta = new Map<string, { blockKey: string }>();
    for (let index = 0; index < 1000; index += 1) batch.appendText('x', 'm');
    expect(initial.segments).toEqual([]);
    const first = batch.drain(initial, meta);
    expect(first.segments).toEqual([{ id: 'm:text', type: 'text', text: 'x'.repeat(1000) }]);
    Object.freeze(first.segments);
    Object.freeze(first.segments[0]);
    batch.appendText('tail', 'm');
    const final = batch.drain(first, meta);
    expect(first.segments[0]).toHaveProperty('text', 'x'.repeat(1000));
    expect(final.segments[0]).toHaveProperty('text', `${'x'.repeat(1000)}tail`);
    expect(batch.drain(final, meta)).toBe(final);
  });

  it('matches immediate accumulation across interleaved identities, whitespace and ended blocks', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);
    const batch = createStreamDeltaBatch();
    let actual = empty();
    let expected = empty();
    const actualMeta = new Map<string, { blockKey: string }>();
    const expectedMeta = new Map<string, { blockKey: string }>();
    const appendThinking = (chunk: StreamThinkingChunk) => {
      batch.appendThinking(Object.freeze(chunk), 'm');
      expected.thinkingBlocks = appendStreamingThinkingChunk(expected.thinkingBlocks, chunk, {
        forceNewBlock: expected.segments.at(-1)?.type !== 'reasoning',
      });
      expected.thinking = joinStreamingThinkingTexts(expected.thinkingBlocks);
      expected.segments = appendStreamingThinkingDelta(expected.segments, expectedMeta, chunk, 'm');
    };
    const appendText = (delta: string) => {
      batch.appendText(delta, 'm');
      expected.segments = appendStreamingTextDelta(expected.segments, delta, 'm');
    };
    const drain = () => {
      actual = batch.drain(actual, actualMeta);
      expect(actual).toEqual(expected);
    };
    appendThinking(thinking(' '));
    appendThinking(thinking('a'));
    appendThinking(thinking('b'));
    appendText('text');
    appendThinking(thinking('c'));
    appendThinking(thinking('d'));
    appendThinking(thinking('e'));
    appendThinking(thinking('other', 'b'));
    appendThinking(thinking('more', 'b'));
    drain();
    const end = { itemId: 'b', occurredAt: 150 };
    for (const [state, meta] of [
      [actual, actualMeta],
      [expected, expectedMeta],
    ] as const) {
      state.thinkingBlocks = markStreamingThinkingChunkEnded(state.thinkingBlocks, end);
      state.segments = markStreamingReasoningSegmentEnded(state.segments, meta, end);
    }
    appendThinking(thinking('after end', 'b'));
    appendThinking(thinking('again', 'b'));
    drain();
    const tool = { toolCallId: 'tool', toolName: 'bash', input: {} };
    actual.segments = upsertStreamingToolSegment(actual.segments, tool);
    expected.segments = upsertStreamingToolSegment(expected.segments, tool);
    appendText('after tool');
    appendThinking(thinking('late', 'a'));
    drain();
  });

  it('does bounded immutable accumulation work for a dense uninterrupted frame', () => {
    const appendText = vi.spyOn(streamingSegments, 'appendStreamingTextDelta');
    const appendReasoning = vi.spyOn(streamingSegments, 'appendStreamingThinkingDelta');
    const appendBlock = vi.spyOn(streamingThinking, 'appendStreamingThinkingChunk');
    const join = vi.spyOn(streamingThinking, 'joinStreamingThinkingTexts');
    const batch = createStreamDeltaBatch();
    for (let index = 0; index < 1000; index += 1) batch.appendText('x', 'm');
    for (let index = 0; index < 1000; index += 1) batch.appendThinking(thinking('y'), 'm');
    expect(appendText).not.toHaveBeenCalled();
    expect(appendBlock).not.toHaveBeenCalled();
    const result = batch.drain(empty(), new Map());
    expect(result.thinking).toBe('y'.repeat(1000));
    expect(appendText).toHaveBeenCalledTimes(1);
    expect(appendReasoning).toHaveBeenCalledTimes(2);
    expect(appendBlock).toHaveBeenCalledTimes(2);
    expect(join).toHaveBeenCalledTimes(1);
  });

  it('preserves first arrival timestamps and late occurredAt in a merged run', () => {
    vi.spyOn(Date, 'now').mockReturnValue(7);
    const batch = createStreamDeltaBatch();
    batch.appendThinking({ type: 'thinking_delta', delta: 'a' }, 'm');
    batch.appendThinking({ type: 'thinking_delta', delta: 'b' }, 'm');
    batch.appendThinking({ type: 'thinking_delta', delta: 'c', occurredAt: 9 }, 'm');
    const result = batch.drain(empty(), new Map());
    expect(result.thinkingBlocks[0]).toMatchObject({ text: 'abc', startedAt: 7 });
    expect(result.segments[0]).toMatchObject({ text: 'abc', startedAt: 9 });
  });
});
