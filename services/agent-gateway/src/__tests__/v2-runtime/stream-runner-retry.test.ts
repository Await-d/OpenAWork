import { Effect, Stream } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import * as OpenAI from '@openAwork/opencode-llm/providers/openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runUpstreamStream } from '../../v2-runtime/upstream/stream-runner.js';

const model = OpenAI.chat('test-model');

const collect = async <A>(stream: Stream.Stream<A, never>) => {
  const chunks = await Effect.runPromise(Stream.runCollect(stream));
  return Array.from(chunks);
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('runUpstreamStream retry policy', () => {
  it('retries transient upstream stream failures with exponential backoff', async () => {
    vi.useFakeTimers();
    const upstreamError = new OpenCodeLLM.LLMError({
      module: 'test',
      method: 'stream',
      reason: new OpenCodeLLM.ProviderInternalReason({
        _tag: 'ProviderInternal',
        message: 'temporary provider failure',
        status: 503,
      }),
    });
    let attempts = 0;
    const streamSpy = vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockImplementation(() => {
      attempts += 1;
      if (attempts < 3) return Stream.fail(upstreamError);
      return Stream.fromIterable([OpenCodeLLM.LLMEvent.finish({ reason: 'stop' })]);
    });

    const pending = collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('q')],
        idleTimeoutMs: 0,
        maxRetries: 2,
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(streamSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(streamSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(streamSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(streamSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(streamSpy).toHaveBeenCalledTimes(3);
    await pending;
  });

  it('does not retry non-retryable upstream failures', async () => {
    vi.useFakeTimers();
    const upstreamError = new OpenCodeLLM.LLMError({
      module: 'test',
      method: 'stream',
      reason: new OpenCodeLLM.InvalidRequestReason({
        _tag: 'InvalidRequest',
        message: 'invalid request',
      }),
    });
    const streamSpy = vi
      .spyOn(OpenCodeLLM.LLMClient, 'stream')
      .mockReturnValue(Stream.fail(upstreamError));

    const chunks = await collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('q')],
        idleTimeoutMs: 0,
        maxRetries: 2,
      }),
    );

    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(true);
  });

  it('retries transport failures before any upstream event', async () => {
    vi.useFakeTimers();
    const upstreamError = new OpenCodeLLM.LLMError({
      module: 'test',
      method: 'stream',
      reason: new OpenCodeLLM.TransportReason({
        _tag: 'Transport',
        message: 'connection reset by peer',
      }),
    });
    let attempts = 0;
    const streamSpy = vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) return Stream.fail(upstreamError);
      return Stream.fromIterable([OpenCodeLLM.LLMEvent.finish({ reason: 'stop' })]);
    });

    const pending = collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('q')],
        idleTimeoutMs: 0,
        maxRetries: 1,
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(streamSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(streamSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(streamSpy).toHaveBeenCalledTimes(2);
    await pending;
  });

  it('does not duplicate partial output after a later transient failure', async () => {
    vi.useFakeTimers();
    const upstreamError = new OpenCodeLLM.LLMError({
      module: 'test',
      method: 'stream',
      reason: new OpenCodeLLM.ProviderInternalReason({
        _tag: 'ProviderInternal',
        message: 'temporary provider failure',
        status: 503,
      }),
    });
    const streamSpy = vi
      .spyOn(OpenCodeLLM.LLMClient, 'stream')
      .mockReturnValue(
        Stream.concat(
          Stream.make(OpenCodeLLM.LLMEvent.textDelta({ id: 'text-1', text: 'partial' })),
          Stream.fail(upstreamError),
        ),
      );

    const chunks = await collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('q')],
        idleTimeoutMs: 0,
        maxRetries: 2,
      }),
    );

    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(
      chunks.filter((chunk) => chunk.type === 'text_delta' && chunk.delta === 'partial'),
    ).toHaveLength(1);
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(true);
  });
});
