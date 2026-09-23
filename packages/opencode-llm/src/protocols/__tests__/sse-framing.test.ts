import { Effect, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import { sseFraming } from '../shared.js';

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
});
