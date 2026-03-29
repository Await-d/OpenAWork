import { describe, expect, it } from 'vitest';
import { splitStreamingMarkdownIntoSegments } from './streaming-markdown-chunks.js';

describe('splitStreamingMarkdownIntoSegments', () => {
  it('moves completed paragraph blocks into the stable prefix', () => {
    const result = splitStreamingMarkdownIntoSegments('# 标题\n\n第一段\n\n第二段进行中');

    expect(result.stableBlocks).toEqual(['# 标题', '第一段']);
    expect(result.activeTail).toBe('第二段进行中');
  });

  it('keeps an open fenced code block in the active tail', () => {
    const result = splitStreamingMarkdownIntoSegments('```ts\nconst a = 1;');

    expect(result.stableBlocks).toEqual([]);
    expect(result.activeTail).toBe('```ts\nconst a = 1;');
  });

  it('flushes a closed fenced code block into the stable prefix', () => {
    const result = splitStreamingMarkdownIntoSegments('```ts\nconst a = 1;\n```\n\n后续段落');

    expect(result.stableBlocks).toEqual(['```ts\nconst a = 1;\n```']);
    expect(result.activeTail).toBe('后续段落');
  });

  it('preserves markdown hard-break spaces inside stable blocks', () => {
    const result = splitStreamingMarkdownIntoSegments('第一行  \n\n第二段');

    expect(result.stableBlocks).toEqual(['第一行  ']);
    expect(result.activeTail).toBe('第二段');
  });
});
