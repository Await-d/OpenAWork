import { Effect, Stream } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import * as OpenAI from '@openAwork/opencode-llm/providers/openai';
import type { StreamChunk } from '@openAwork/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runUpstreamStream, sortToolsByName } from '../../v2-runtime/upstream/stream-runner.js';

const model = OpenAI.chat('test-model');

const collect = async <A>(stream: Stream.Stream<A, never>) => {
  const chunks = await Effect.runPromise(Stream.runCollect(stream));
  return Array.from(chunks);
};

const mockNativeStream = (events: readonly OpenCodeLLM.LLMEvent[]) =>
  vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockReturnValue(Stream.fromIterable(events));

afterEach(() => vi.restoreAllMocks());

describe('sortToolsByName', () => {
  it('returns tools in deterministic name order without mutating input', () => {
    const tools = {
      zebra: OpenCodeLLM.ToolDefinition.make({ name: 'zebra', description: '', inputSchema: {} }),
      alpha: OpenCodeLLM.ToolDefinition.make({ name: 'alpha', description: '', inputSchema: {} }),
    };
    const sorted = sortToolsByName(tools);
    expect(Object.keys(sorted ?? {})).toEqual(['alpha', 'zebra']);
    expect(Object.keys(tools)).toEqual(['zebra', 'alpha']);
  });
});

describe('runUpstreamStream', () => {
  it('maps native text, reasoning, tool and finish events', async () => {
    mockNativeStream([
      OpenCodeLLM.LLMEvent.textStart({ id: 'text-1' }),
      OpenCodeLLM.LLMEvent.textDelta({ id: 'text-1', text: 'Hello' }),
      OpenCodeLLM.LLMEvent.reasoningStart({ id: 'reason-1' }),
      OpenCodeLLM.LLMEvent.reasoningDelta({ id: 'reason-1', text: 'plan' }),
      OpenCodeLLM.LLMEvent.reasoningEnd({ id: 'reason-1' }),
      OpenCodeLLM.LLMEvent.toolInputStart({ id: 'call-1', name: 'read' }),
      OpenCodeLLM.LLMEvent.toolInputDelta({ id: 'call-1', name: 'read', text: '{"path":"a"}' }),
      OpenCodeLLM.LLMEvent.toolCall({ id: 'call-1', name: 'read', input: { path: 'a' } }),
      OpenCodeLLM.LLMEvent.finish({
        reason: 'tool-calls',
        usage: new OpenCodeLLM.Usage({ inputTokens: 4, outputTokens: 7, totalTokens: 11 }),
      }),
    ]);

    const chunks = await collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('read a')],
        runId: 'run-1',
      }),
    );

    expect(chunks.filter((chunk) => chunk.type === 'text_delta').map((chunk) =>
      chunk.type === 'text_delta' ? chunk.delta : '',
    )).toEqual(['Hello']);
    expect(chunks.some((chunk) => chunk.type === 'thinking_start')).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'thinking_delta')).toBe(true);
    expect(chunks.filter((chunk) => chunk.type === 'tool_call_delta')).toHaveLength(2);
    const done = chunks.find((chunk) => chunk.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type === 'done') expect(done.stopReason).toBe('tool_use');
  });

  it('forwards native usage once to onFinish', async () => {
    mockNativeStream([
      OpenCodeLLM.LLMEvent.finish({
        reason: 'stop',
        usage: new OpenCodeLLM.Usage({
          inputTokens: 5,
          outputTokens: 8,
          totalTokens: 13,
          reasoningTokens: 2,
          cacheReadInputTokens: 3,
          cacheWriteInputTokens: 1,
        }),
      }),
    ]);
    const finishes: unknown[] = [];

    await collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('q')],
        onFinish: (info) => finishes.push(info),
      }),
    );

    expect(finishes).toEqual([
      {
        finishReason: 'stop',
        usage: {
          inputTokens: 5,
          outputTokens: 8,
          totalTokens: 13,
          reasoningTokens: 2,
          cachedInputTokens: 3,
          inputTokenDetails: { cacheReadTokens: 3, cacheWriteTokens: 1 },
          outputTokenDetails: { reasoningTokens: 2 },
        },
      },
    ]);
  });

  it('maps native tool results and provider errors', async () => {
    mockNativeStream([
      OpenCodeLLM.LLMEvent.toolResult({
        id: 'call-1',
        name: 'read',
        result: { type: 'json', value: { ok: true } },
      }),
      OpenCodeLLM.LLMEvent.providerError({ message: 'provider failed' }),
    ]);

    const chunks = await collect(
      runUpstreamStream({ model, messages: [OpenCodeLLM.Message.user('q')] }),
    );
    const result = chunks.find((chunk) => chunk.type === 'tool_result');
    expect(result?.type).toBe('tool_result');
    if (result?.type === 'tool_result') {
      expect(result.output).toEqual({ ok: true });
      expect(result.isError).toBe(false);
    }
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(true);
  });

  it('emits a stable stall error after an idle native stream', async () => {
    vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockReturnValue(
      Stream.concat(Stream.make(OpenCodeLLM.LLMEvent.textDelta({ id: 'text-1', text: 'first' })), Stream.never),
    );

    const chunks = await collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('q')],
        idleTimeoutMs: 20,
      }),
    );
    const stall = chunks.find((chunk) => chunk.type === 'error' && chunk.code === 'STREAM_STALL');
    expect(stall?.type).toBe('error');
  });

  it('maps an external abort to an aborted error and stops pulling', async () => {
    const controller = new AbortController();
    vi.spyOn(OpenCodeLLM.LLMClient, 'stream').mockReturnValue(Stream.never);
    setTimeout(() => controller.abort(), 10);

    const chunks = await collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('q')],
        signal: controller.signal,
        idleTimeoutMs: 0,
      }),
    );
    const aborted = chunks.find((chunk) => chunk.type === 'error' && chunk.code === 'ABORTED');
    expect(aborted?.type).toBe('error');
    expect(
      chunks.filter((chunk) => chunk.type === 'error' && chunk.code === 'ABORTED'),
    ).toHaveLength(1);
    expect(chunks.some((chunk) => chunk.type === 'error' && chunk.code === 'STREAM_STALL')).toBe(
      false,
    );
  });

  it('passes native generation and HTTP override fields to LLMClient.request', async () => {
    const streamSpy = mockNativeStream([
      OpenCodeLLM.LLMEvent.finish({ reason: 'stop' }),
    ]);
    await collect(
      runUpstreamStream({
        model,
        messages: [OpenCodeLLM.Message.user('q')],
        temperature: 0.5,
        maxOutputTokens: 123,
        requestOverrides: {
          headers: { 'x-test': 'yes' },
          body: { extra: true },
        },
      }),
    );
    expect(streamSpy).toHaveBeenCalledTimes(1);
  });
});
