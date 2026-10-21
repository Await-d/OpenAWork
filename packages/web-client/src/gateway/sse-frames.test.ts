import { describe, expect, it } from 'vitest';
import { createSseFrameParser } from './sse-frames.js';

describe('createSseFrameParser', () => {
  it('parses event and data fields from a single frame', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('event: partial\ndata: {"index":0}\n\n');

    expect(frames).toEqual([{ data: '{"index":0}', event: 'partial' }]);
  });

  it('returns every complete frame contained in one chunk', () => {
    const parser = createSseFrameParser();
    const frames = parser.push(
      'event: partial\ndata: {"index":0}\n\nevent: done\ndata: {"ok":true}\n\n',
    );

    expect(frames).toEqual([
      { data: '{"index":0}', event: 'partial' },
      { data: '{"ok":true}', event: 'done' },
    ]);
  });

  it('buffers a frame that is split across chunks', () => {
    const parser = createSseFrameParser();

    expect(parser.push('event: partial\ndata: {"in')).toEqual([]);
    expect(parser.push('dex":1}\n\n')).toEqual([{ data: '{"index":1}', event: 'partial' }]);
  });

  it('tolerates CRLF line endings and the optional space after the colon', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('event:done\r\ndata:{"ok":true}\r\n\r\n');

    expect(frames).toEqual([{ data: '{"ok":true}', event: 'done' }]);
  });

  it('joins multi-line data fields with newlines', () => {
    const parser = createSseFrameParser();
    const frames = parser.push('data: line-1\ndata: line-2\n\n');

    expect(frames).toEqual([{ data: 'line-1\nline-2', event: null }]);
  });

  it('ignores heartbeat comments and frames without payload', () => {
    const parser = createSseFrameParser();

    expect(parser.push(': heartbeat\n\n')).toEqual([]);
    expect(parser.push('event: ping\n\n')).toEqual([]);
  });

  it('flushes a trailing frame that never got a blank line', () => {
    const parser = createSseFrameParser();
    expect(parser.push('event: done\ndata: {"ok":true}')).toEqual([]);
    expect(parser.flush()).toEqual([{ data: '{"ok":true}', event: 'done' }]);
    expect(parser.flush()).toEqual([]);
  });
});
