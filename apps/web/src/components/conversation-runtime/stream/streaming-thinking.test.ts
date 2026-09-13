import { describe, expect, it } from 'vitest';
import {
  appendStreamingThinkingChunk,
  buildStreamingThinkingChunkDeliveryKey,
  extractStreamingThinkingEndedFlags,
  extractStreamingThinkingTexts,
  markStreamingThinkingChunkEnded,
} from './streaming-thinking.js';
import { appendStreamingTextDelta, appendStreamingThinkingDelta } from './streaming-segments.js';
import type { ChatMessagePart, ChatReasoningPart } from '../messages/support.js';

describe('流式思考块顺序', () => {
  it('同内容但不同事件 ID 的思考分片不会被去重为同一个事件', () => {
    const first = buildStreamingThinkingChunkDeliveryKey({
      delta: '相同内容',
      eventId: 'event-1',
      itemId: 'r1',
    });
    const second = buildStreamingThinkingChunkDeliveryKey({
      delta: '相同内容',
      eventId: 'event-2',
      itemId: 'r1',
    });

    expect(first).not.toBe(second);
    expect(
      buildStreamingThinkingChunkDeliveryKey({
        delta: '相同内容',
        eventId: 'event-1',
        itemId: 'r1',
      }),
    ).toBe(first);
  });

  it('同一思考身份结束后重新开始时保留两个块', () => {
    let blocks = appendStreamingThinkingChunk([], { delta: 'A', itemId: 'r1' }, { now: () => 1 });
    blocks = markStreamingThinkingChunkEnded(blocks, { itemId: 'r1', occurredAt: 10 });
    blocks = appendStreamingThinkingChunk(blocks, { delta: 'B', itemId: 'r1' }, { now: () => 20 });

    expect(extractStreamingThinkingTexts(blocks)).toEqual(['A', 'B']);
    expect(extractStreamingThinkingEndedFlags(blocks)).toEqual([true, false]);
  });

  it('文本打断同一思考身份时保持两个思考块', () => {
    let blocks = appendStreamingThinkingChunk([], { delta: 'A', itemId: 'r1' });
    blocks = appendStreamingThinkingChunk(
      blocks,
      { delta: 'B', itemId: 'r1' },
      { forceNewBlock: true },
    );
    expect(extractStreamingThinkingTexts(blocks)).toEqual(['A', 'B']);
  });

  it('文本打断同一思考身份时，thinkingBlocks 与有序 reasoning parts 数量和顺序一致', () => {
    const messageId = 'message-order-regression';
    const reasoningMeta = new Map<string, { blockKey: string }>();
    let blocks = appendStreamingThinkingChunk([], { delta: '先想', itemId: 'r1' });
    let segments: ChatMessagePart[] = appendStreamingThinkingDelta(
      [],
      reasoningMeta,
      { delta: '先想', itemId: 'r1' },
      messageId,
    );

    segments = appendStreamingTextDelta(segments, '回答', messageId);
    blocks = appendStreamingThinkingChunk(
      blocks,
      { delta: '后想', itemId: 'r1' },
      {
        forceNewBlock: true,
      },
    );
    segments = appendStreamingThinkingDelta(
      segments,
      reasoningMeta,
      { delta: '后想', itemId: 'r1' },
      messageId,
    );

    const reasoningParts = segments.filter(
      (part): part is ChatReasoningPart => part.type === 'reasoning',
    );
    expect(reasoningParts.map((part) => part.text)).toEqual(['先想', '后想']);
    expect(extractStreamingThinkingTexts(blocks)).toEqual(['先想', '后想']);
    expect(blocks).toHaveLength(reasoningParts.length);
  });
});
