import { describe, expect, it } from 'vitest';
import {
  appendStreamingThinkingChunk,
  extractStreamingThinkingEndedFlags,
  extractStreamingThinkingTexts,
  markStreamingThinkingChunkEnded,
} from './streaming-thinking.js';

describe('流式思考块顺序', () => {
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
});
