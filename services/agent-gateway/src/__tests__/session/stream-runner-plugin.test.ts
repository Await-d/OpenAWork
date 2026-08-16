import { Effect, Stream } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import * as OpenAI from '@openAwork/opencode-llm/providers/openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runUpstreamStream } from '../../v2-runtime/upstream/stream-runner.js';

const model = OpenAI.chat('test-model');

afterEach(() => vi.restoreAllMocks());

describe('native stream generation settings', () => {
  it('passes generation and override fields to the native request', async () => {
    let request: OpenCodeLLM.LLMRequest | undefined;
    vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockImplementation((value) => {
      request = value;
      return Stream.fromIterable([OpenCodeLLM.LLMEvent.finish({ reason: 'stop' })]);
    });

    const values = await Effect.runPromise(
      Stream.runCollect(
        runUpstreamStream({
          model,
          messages: [OpenCodeLLM.Message.user('q')],
          temperature: 0.7,
          maxOutputTokens: 512,
          requestOverrides: { temperature: 0.2, maxTokens: 123 },
        }),
      ),
    );

    expect(Array.from(values).some((value) => value.type === 'done')).toBe(true);
    expect(request?.generation?.temperature).toBe(0.2);
    expect(request?.generation?.maxTokens).toBe(123);
  });

  it('honors omitBodyKeys when building native generation', async () => {
    let request: OpenCodeLLM.LLMRequest | undefined;
    vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockImplementation((value) => {
      request = value;
      return Stream.fromIterable([OpenCodeLLM.LLMEvent.finish({ reason: 'stop' })]);
    });

    await Effect.runPromise(
      Stream.runDrain(
        runUpstreamStream({
          model,
          messages: [OpenCodeLLM.Message.user('q')],
          temperature: 0.7,
          maxOutputTokens: 512,
          requestOverrides: { omitBodyKeys: ['temperature', 'max_tokens'] },
        }),
      ),
    );

    expect(request?.generation?.temperature).toBeUndefined();
    expect(request?.generation?.maxTokens).toBeUndefined();
  });
});
