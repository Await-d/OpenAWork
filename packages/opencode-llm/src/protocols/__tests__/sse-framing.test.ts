import { Effect, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { eventError, sseFraming, type SseFramingOptions } from '../shared.js';
import type { LLMError } from '../../schema/index.js';

const encode = (text: string) => new TextEncoder().encode(text);

const framesOf = (text: string) =>
  Effect.runPromise(
    sseFraming(Stream.fromIterable([encode(text)])).pipe(
      Stream.runFold(
        () => [] as string[],
        (items, frame) => [...items, frame],
      ),
    ),
  );

/**
 * 模拟真实网络分包：异步生成器每次 pull 只交付一个 chunk。
 * 同步 `Stream.fromIterable` 会被批量喂入解析器，掩盖 `retry:` 截断类缺陷。
 */
const chunkedBytes = (chunks: ReadonlyArray<string>): Stream.Stream<Uint8Array, LLMError> =>
  Stream.fromAsyncIterable(
    (async function* () {
      for (const chunk of chunks) yield encode(chunk);
    })(),
    (error) => eventError('sse-framing-test', 'chunk stream failed', String(error)),
  );

const framesOfChunks = (chunks: ReadonlyArray<string>, options?: SseFramingOptions) =>
  Effect.runPromise(
    sseFraming(chunkedBytes(chunks), options).pipe(
      Stream.runFold(
        () => [] as string[],
        (items, frame) => [...items, frame],
      ),
    ),
  );

describe('sseFraming', () => {
  it('drops a bare null flush between events without aborting the stream', async () => {
    const frames = await framesOf('data: {"delta":"a"}\n\ndata: null\n\ndata: {"delta":"b"}\n\n');

    expect(frames).toEqual(['{"delta":"a"}', '{"delta":"b"}']);
  });

  it('drops a bare null flush after [DONE]', async () => {
    const frames = await framesOf('data: {"delta":"a"}\n\ndata: [DONE]\n\ndata: null\n\n');

    expect(frames).toEqual(['{"delta":"a"}']);
  });

  it('drops empty frames and [DONE] keep-alives', async () => {
    const frames = await framesOf('data: {"delta":"a"}\n\ndata:\n\ndata: [DONE]\n\n');

    expect(frames).toEqual(['{"delta":"a"}']);
  });

  it('keeps a null literal nested inside a payload', async () => {
    const frames = await framesOf('data: {"delta":null}\n\n');

    expect(frames).toEqual(['{"delta":null}']);
  });

  it('忽略 retry: 控制帧，不截断其后的事件', async () => {
    const frames = await framesOfChunks([
      'data: {"delta":"a"}\n\n',
      'retry: 3000\n\n',
      'data: {"delta":"b"}\n\n',
      'data: [DONE]\n\n',
    ]);

    expect(frames).toEqual(['{"delta":"a"}', '{"delta":"b"}']);
  });

  it('retry: 作为首包时也不丢任何事件', async () => {
    const frames = await framesOfChunks([
      'retry: 3000\n\n',
      'data: {"delta":"a"}\n\n',
      'data: {"delta":"b"}\n\n',
    ]);

    expect(frames).toEqual(['{"delta":"a"}', '{"delta":"b"}']);
  });

  it('includeDone 保留 [DONE] 终止哨兵（openai-chat 依赖它停止读取）', async () => {
    const frames = await framesOfChunks(
      ['data: {"delta":"a"}\n\n', 'data: [DONE]\n\n', 'data: null\n\n'],
      { includeDone: true },
    );

    expect(frames).toEqual(['{"delta":"a"}', '[DONE]']);
  });

  it('忽略 Vertex 合作模型的 `data: : keepalive` 心跳', async () => {
    const frames = await framesOfChunks([
      'data: : keepalive\n\n',
      'data: {"delta":"a"}\n\n',
      'data: : keepalive\n\n',
      'data: {"delta":"b"}\n\n',
    ]);

    expect(frames).toEqual(['{"delta":"a"}', '{"delta":"b"}']);
  });
});
