/**
 * 命名事件过滤契约测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-17：`Framing.sseEvents` 只放行白名单事件，且过滤态下非 `message`
 * 事件携带的 `[DONE]` 需要保留（它是该通道的终止边界）。
 */

import { describe, it, expect } from 'vitest';
import { Effect, Stream } from 'effect';
import * as Framing from '../framing.js';

const encode = (text: string) => new TextEncoder().encode(text);

const collect = (framing: Framing.Framing<string>, text: string) =>
  Effect.runPromise(Stream.runCollect(framing.frame(Stream.fromIterable([encode(text)]))));

const stream = [
  'event: response.output_text.delta',
  'data: {"delta":"a"}',
  '',
  'event: response.completed',
  'data: {"id":"1"}',
  '',
  'event: done',
  'data: [DONE]',
  '',
  'data: null',
  '',
  'data: : keepalive',
  '',
  '',
].join('\n');

describe('Framing.sseEvents', () => {
  it('只放行白名单内的命名事件', async () => {
    const frames = await collect(
      Framing.sseEvents(new Set(['response.output_text.delta', 'done'])),
      stream,
    );

    expect(frames).toHaveLength(2);
    // 非 message 事件会被注入 `type`，便于协议层按事件名分派
    expect(frames[0]).toBe('{"delta":"a","type":"response.output_text.delta"}');
    expect(frames[1]).toBe('[DONE]');
  });

  it('过滤态下保留非 message 事件携带的 [DONE]', async () => {
    const frames = await collect(
      Framing.sseEvents(new Set(['done'])),
      'event: done\ndata: [DONE]\n\n',
    );

    expect(frames).toEqual(['[DONE]']);
  });
});

describe('Framing.sse 既有语义不变', () => {
  it('丢弃 [DONE] 与空/保活负载，但保留全部命名事件', async () => {
    const frames = await collect(Framing.sse, stream);

    expect(frames).not.toContain('[DONE]');
    expect(frames).not.toContain('null');
    expect(frames).not.toContain(': keepalive');
    expect(frames).toContain('{"delta":"a","type":"response.output_text.delta"}');
    expect(frames).toContain('{"id":"1","type":"response.completed"}');
  });

  it('includeDone 时保留默认事件名下的 [DONE]', async () => {
    const frames = await collect(Framing.sseWithDone, 'data: [DONE]\n\n');

    expect(frames).toEqual(['[DONE]']);
  });
});
