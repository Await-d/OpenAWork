import { describe, expect, it } from 'vitest';
import { MockLanguageModelV2 } from 'ai/test';
import type { StreamChunk } from '@openAwork/shared';
import {
  buildAISdkProvider,
  runUpstreamStream,
  type V2LanguageModel,
} from '../v2-runtime/upstream/index.js';

// ─── Provider factory ───────────────────────────────────────────────

describe('buildAISdkProvider', () => {
  it('builds an Anthropic provider for the "anthropic" provider type', () => {
    const built = buildAISdkProvider({
      providerType: 'anthropic',
      apiKey: 'test',
      name: 'anthropic-test',
    });
    expect(built.protocol).toBe('anthropic_messages');
    const model = built.languageModel('claude-sonnet-4');
    expect(model).toBeTruthy();
    expect(typeof (model as { modelId?: string }).modelId).toBe('string');
  });

  it('falls back to OpenAI-compatible for unknown vendors', () => {
    const built = buildAISdkProvider({
      providerType: 'qwen-plus',
      apiKey: 'test',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    expect(built.protocol).toBe('chat_completions');
    const model = built.languageModel('qwen-max');
    expect(model).toBeTruthy();
  });

  it('routes the openai providerType through openai-compatible too', () => {
    const built = buildAISdkProvider({
      providerType: 'openai',
      apiKey: 'test',
    });
    expect(built.protocol).toBe('chat_completions');
  });
});

// ─── Stream runner ──────────────────────────────────────────────────
//
// `MockLanguageModelV2` from `ai/test` lets us script a deterministic
// stream of fullStream parts and observe how the runner translates each
// one into the OpenAWork StreamChunk taxonomy.

function buildMockModel(parts: ReadonlyArray<unknown>): V2LanguageModel {
  return new MockLanguageModelV2({
    doStream: async () => ({
      stream: new ReadableStream<unknown>({
        start(controller) {
          for (const part of parts) {
            controller.enqueue(part);
          }
          controller.close();
        },
      }) as never,
      rawCall: { rawPrompt: null, rawSettings: {} },
      warnings: [],
    }),
  }) as unknown as V2LanguageModel;
}

async function collectChunks(
  iter: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const ev of iter) {
    out.push(ev);
  }
  return out;
}

describe('runUpstreamStream', () => {
  it('emits text_delta chunks for each AI SDK text-delta part', async () => {
    const model = buildMockModel([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Hello' },
      { type: 'text-delta', id: 't1', delta: ', world' },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      },
    ]);

    const chunks = await collectChunks(
      runUpstreamStream({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        runId: 'run-1',
      }),
    );

    const types = chunks.map((c) => c.type);
    expect(types).toContain('text_delta');
    const textDeltas = chunks.filter(
      (c): c is Extract<StreamChunk, { type: 'text_delta' }> => c.type === 'text_delta',
    );
    expect(textDeltas.map((c) => c.delta)).toEqual(['Hello', ', world']);
    const last = chunks[chunks.length - 1]!;
    expect(last.type).toBe('done');
    if (last.type === 'done') {
      expect(last.stopReason).toBe('end_turn');
    }
  });

  it('translates reasoning parts into thinking_start / thinking_delta / thinking_end', async () => {
    // AI SDK V2 `doStream` parts use the `delta` field; the fullStream
    // normaliser exposes that as `text` to consumers (matching how
    // text-delta works). Our fixture mirrors the doStream wire format.
    const model = buildMockModel([
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'plan' },
      { type: 'reasoning-end', id: 'r1' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    ]);

    const chunks = await collectChunks(
      runUpstreamStream({ model, messages: [{ role: 'user', content: 'q' }] }),
    );
    const types = chunks.map((c) => c.type);
    expect(types).toContain('thinking_start');
    expect(types).toContain('thinking_delta');
    expect(types).toContain('thinking_end');

    const thinkingDelta = chunks.find(
      (c): c is Extract<StreamChunk, { type: 'thinking_delta' }> => c.type === 'thinking_delta',
    );
    expect(thinkingDelta?.delta).toBe('plan');
  });

  it('translates tool input deltas into tool_call_delta chunks', async () => {
    const model = buildMockModel([
      {
        type: 'tool-input-start',
        id: 'call-1',
        toolName: 'read',
      },
      {
        type: 'tool-input-delta',
        id: 'call-1',
        toolName: 'read',
        delta: '{"path":',
      },
      {
        type: 'tool-input-delta',
        id: 'call-1',
        toolName: 'read',
        delta: '"a.ts"}',
      },
      {
        type: 'tool-input-end',
        id: 'call-1',
        toolName: 'read',
      },
      {
        type: 'finish',
        finishReason: 'tool-calls',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    ]);

    const chunks = await collectChunks(
      runUpstreamStream({ model, messages: [{ role: 'user', content: '?' }] }),
    );
    const toolDeltas = chunks.filter(
      (c): c is Extract<StreamChunk, { type: 'tool_call_delta' }> => c.type === 'tool_call_delta',
    );
    // 1 zero-length opener (mirrors Anthropic content_block_start type=tool_use)
    // + 2 streaming deltas.
    expect(toolDeltas).toHaveLength(3);
    expect(toolDeltas[0]!.toolCallId).toBe('call-1');
    expect(toolDeltas[0]!.toolName).toBe('read');
    expect(toolDeltas[0]!.inputDelta).toBe('');
    expect(toolDeltas.map((c) => c.inputDelta).join('')).toBe('{"path":"a.ts"}');

    const done = chunks.find(
      (c): c is Extract<StreamChunk, { type: 'done' }> => c.type === 'done',
    );
    expect(done?.stopReason).toBe('tool_use');
  });

  it('emits a synthetic opener + JSON delta for upstreams that only send tool-call', async () => {
    // Some upstreams (legacy OpenAI function_call) skip tool-input-* and
    // only emit a single `tool-call` part with the resolved input.
    // The runner must register the (id, name) pair and forward the
    // serialised input so accumulators see a complete call.
    const model = buildMockModel([
      {
        type: 'tool-call',
        toolCallId: 'call-2',
        toolName: 'edit',
        input: { path: 'b.ts', content: 'x' },
      },
      {
        type: 'finish',
        finishReason: 'tool-calls',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    ]);

    const chunks = await collectChunks(
      runUpstreamStream({ model, messages: [{ role: 'user', content: '?' }] }),
    );
    const toolDeltas = chunks.filter(
      (c): c is Extract<StreamChunk, { type: 'tool_call_delta' }> => c.type === 'tool_call_delta',
    );
    expect(toolDeltas).toHaveLength(2);
    expect(toolDeltas[0]!.inputDelta).toBe('');
    expect(toolDeltas[0]!.toolCallId).toBe('call-2');
    expect(toolDeltas[0]!.toolName).toBe('edit');
    expect(JSON.parse(toolDeltas[1]!.inputDelta)).toEqual({ path: 'b.ts', content: 'x' });
  });

  // NOTE: `tool-error` and `abort` are TextStreamPart events synthesised
  // by AI SDK at the run-tools-transformation layer (when a tool
  // execute() throws or an AbortSignal fires). They are NOT
  // LanguageModelV2StreamPart members and cannot be injected through
  // `MockLanguageModelV2.doStream`. The runner's switch case still
  // handles them — coverage moves to integration tests once Phase B.1
  // wires the runner into the production stream path.

  it('surfaces upstream errors as error chunks', async () => {
    const model = buildMockModel([
      {
        type: 'error',
        error: new Error('upstream blew up'),
      },
    ]);

    const chunks = await collectChunks(
      runUpstreamStream({ model, messages: [{ role: 'user', content: 'q' }] }),
    );
    const errorChunk = chunks.find(
      (c): c is Extract<StreamChunk, { type: 'error' }> => c.type === 'error',
    );
    expect(errorChunk?.code).toBe('UPSTREAM_ERROR');
    expect(errorChunk?.message).toContain('upstream blew up');
  });

  it('fires onFinish with totalUsage propagated from the V2 finish event', async () => {
    // The mock emits V2-level stream parts; AI SDK wraps them into
    // higher-level `finish-step` + `finish` events that the runner
    // observes via `result.fullStream`.
    const model = buildMockModel([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'ok' },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
      },
    ]);

    const usages: Array<{ inputTokens: number | undefined; outputTokens: number | undefined }> = [];
    await collectChunks(
      runUpstreamStream({
        model,
        messages: [{ role: 'user', content: 'q' }],
        onFinish: ({ usage }) => {
          usages.push({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
        },
      }),
    );

    // AI SDK fires both `finish-step` (per round) and `finish`
    // (overall) so onFinish may be called more than once; both must
    // surface the same totals derived from the V2 `usage` payload.
    expect(usages.length).toBeGreaterThan(0);
    for (const u of usages) {
      expect(u).toEqual({ inputTokens: 5, outputTokens: 7 });
    }
  });

  it('does not throw when the onFinish callback throws', async () => {
    const model = buildMockModel([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'ok' },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      },
    ]);

    // The runner swallows callback errors so a buggy telemetry hook
    // can never poison the stream consumer.
    await expect(
      collectChunks(
        runUpstreamStream({
          model,
          messages: [{ role: 'user', content: 'q' }],
          onFinish: () => {
            throw new Error('telemetry exploded');
          },
        }),
      ),
    ).resolves.toBeDefined();
  });
});
