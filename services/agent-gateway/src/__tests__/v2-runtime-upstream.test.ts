import { describe, expect, it } from 'vitest';
import { MockLanguageModelV3 as MockLanguageModelV2 } from 'ai/test';
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

function buildMockModel(
  parts: ReadonlyArray<unknown>,
  onDoStream?: (options: unknown) => void,
): V2LanguageModel {
  return new MockLanguageModelV2({
    doStream: async (options: unknown) => {
      onDoStream?.(options);
      return {
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
      };
    },
  }) as unknown as V2LanguageModel;
}

async function collectChunks(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
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
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 2 } },
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
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
      },
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
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
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

    const done = chunks.find((c): c is Extract<StreamChunk, { type: 'done' }> => c.type === 'done');
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
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
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

  // Regression: OpenAI Responses adapter attaches `openai.itemId`
  // (`fc_xxx`) on the resolved `tool-call` part. The runner must
  // surface it as a closer `tool_call_delta` so the round accumulator
  // can persist it and later replay `function_call.id` on round 2 —
  // without it, OpenAI re-keys the function_call item and the
  // upstream prompt-cache prefix from this point on misses on every
  // subsequent request (the original bug report: "搜索工具调用后
  // 缓存全失").
  it('emits a closer tool_call_delta carrying providerMetadata when present', async () => {
    const model = buildMockModel([
      {
        type: 'tool-input-start',
        id: 'call_websearch',
        toolName: 'web_search',
      },
      {
        type: 'tool-input-delta',
        id: 'call_websearch',
        toolName: 'web_search',
        delta: '{"query":"r"}',
      },
      {
        type: 'tool-input-end',
        id: 'call_websearch',
        toolName: 'web_search',
      },
      {
        // The resolved tool-call event carries the OpenAI itemId
        // alongside the call_id; downstream must keep both.
        type: 'tool-call',
        toolCallId: 'call_websearch',
        toolName: 'web_search',
        input: { query: 'r' },
        providerMetadata: { openai: { itemId: 'fc_websearch_001' } },
      },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
      },
    ] as unknown as Parameters<typeof buildMockModel>[0]);

    const chunks = await collectChunks(
      runUpstreamStream({ model, messages: [{ role: 'user', content: '?' }] }),
    );
    const toolDeltas = chunks.filter(
      (c): c is Extract<StreamChunk, { type: 'tool_call_delta' }> => c.type === 'tool_call_delta',
    );
    // opener (zero-length) + 1 streaming delta + closer (zero-length)
    // carrying providerMetadata. The closer MUST NOT re-emit the
    // already-streamed input or the JSON would double up.
    expect(toolDeltas).toHaveLength(3);
    const closer = toolDeltas[2]!;
    expect(closer.toolCallId).toBe('call_websearch');
    expect(closer.inputDelta).toBe('');
    expect(closer.providerMetadata).toEqual({ openai: { itemId: 'fc_websearch_001' } });
  });

  it('does not emit an extra closer delta when tool-call carries no providerMetadata', async () => {
    const model = buildMockModel([
      {
        type: 'tool-input-start',
        id: 'call-3',
        toolName: 'read',
      },
      {
        type: 'tool-input-delta',
        id: 'call-3',
        toolName: 'read',
        delta: '{"path":"a"}',
      },
      {
        type: 'tool-input-end',
        id: 'call-3',
        toolName: 'read',
      },
      {
        type: 'tool-call',
        toolCallId: 'call-3',
        toolName: 'read',
        input: { path: 'a' },
        // No providerMetadata — the streaming closer must not fire.
      },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
      },
    ]);

    const chunks = await collectChunks(
      runUpstreamStream({ model, messages: [{ role: 'user', content: '?' }] }),
    );
    const toolDeltas = chunks.filter(
      (c): c is Extract<StreamChunk, { type: 'tool_call_delta' }> => c.type === 'tool_call_delta',
    );
    // opener + 1 streaming delta. No closer because no metadata.
    expect(toolDeltas).toHaveLength(2);
    expect(toolDeltas.every((c) => c.providerMetadata === undefined)).toBe(true);
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
    // Legacy parser parity: upstream stream-runner errors surface as
    // `MODEL_ERROR` + `status: 502` so SSE consumers and verifiers see
    // the same error shape they did before the v2 SDK migration.
    expect(errorChunk?.code).toBe('MODEL_ERROR');
    expect((errorChunk as unknown as { status?: number })?.status).toBe(502);
    expect(errorChunk?.message).toContain('upstream blew up');
  });

  it('adds empty reasoning parts for DeepSeek assistant history', async () => {
    const calls: unknown[] = [];
    const model = buildMockModel(
      [
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
        },
      ],
      (options) => calls.push(options),
    );

    await collectChunks(
      runUpstreamStream({
        model,
        modelId: 'deepseek-chat',
        providerType: 'deepseek',
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'answer' },
        ],
      }),
    );

    const settings = calls[0] as { prompt?: Array<{ role: string; content: unknown }> };
    expect(settings.prompt?.[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'answer' },
        { type: 'reasoning', text: '' },
      ],
    });
  });

  it('applies request overrides to AI SDK stream settings', async () => {
    const calls: unknown[] = [];
    const model = buildMockModel(
      [
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
        },
      ],
      (options) => calls.push(options),
    );

    await collectChunks(
      runUpstreamStream({
        model,
        modelId: 'anthropic/claude-sonnet-4-5',
        providerType: 'openrouter',
        messages: [{ role: 'user', content: 'q' }],
        temperature: 0.7,
        maxOutputTokens: 4096,
        topP: 0.8,
        requestOverrides: {
          temperature: 0.2,
          maxTokens: 1234,
          topP: 0.9,
          frequencyPenalty: 0.4,
          presencePenalty: 0.5,
          body: {
            extra_body_flag: true,
            top_p: 1,
          },
          omitBodyKeys: ['temperature', 'top_p', 'presence_penalty'],
        },
      }),
    );

    const settings = calls[0] as Record<string, unknown>;
    expect(settings['temperature']).toBeUndefined();
    expect(settings['topP']).toBeUndefined();
    expect(settings['presencePenalty']).toBeUndefined();
    expect(settings['maxOutputTokens']).toBe(1234);
    expect(settings['frequencyPenalty']).toBe(0.4);
    expect(settings['providerOptions']).toMatchObject({
      openrouter: {
        usage: { include: true },
        body: {
          extra_body_flag: true,
        },
      },
    });
    const openrouterOptions = (
      settings['providerOptions'] as Record<string, Record<string, Record<string, unknown>>>
    )['openrouter'];
    expect((openrouterOptions?.body ?? {})['top_p']).toBeUndefined();
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
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 5 }, outputTokens: { total: 7 } },
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
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 2 } },
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
