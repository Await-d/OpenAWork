import { Effect, Stream } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import * as OpenAI from '@openAwork/opencode-llm/providers/openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runUpstreamStream } from '../../v2-runtime/upstream/stream-runner.js';

const model = OpenAI.chat('test-model');

const collect = async <A>(stream: Stream.Stream<A, never>): Promise<readonly A[]> => {
  const values = await Effect.runPromise(Stream.runCollect(stream));
  return Array.from(values);
};

afterEach(() => vi.restoreAllMocks());

describe('native stream idle timeout', () => {
  it('resets the deadline after each native event', async () => {
    vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockReturnValue(
      Stream.fromIterable([
        OpenCodeLLM.LLMEvent.textDelta({ id: 'text-1', text: 'one' }),
        OpenCodeLLM.LLMEvent.textDelta({ id: 'text-1', text: 'two' }),
        OpenCodeLLM.LLMEvent.finish({ reason: 'stop' }),
      ]),
    );
    const values = await collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('q')],
        idleTimeoutMs: 100,
      }),
    );
    expect(values.some((value) => value.type === 'done')).toBe(true);
    expect(values.some((value) => value.type === 'error' && value.code === 'STREAM_STALL')).toBe(
      false,
    );
  });

  it('emits STREAM_STALL when a native source remains open', async () => {
    vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockReturnValue(
      Stream.concat(
        Stream.make(OpenCodeLLM.LLMEvent.textDelta({ id: 'text-1', text: 'one' })),
        Stream.never,
      ),
    );
    const values = await collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('q')],
        idleTimeoutMs: 15,
      }),
    );
    expect(values.some((value) => value.type === 'error' && value.code === 'STREAM_STALL')).toBe(
      true,
    );
  });
});
