/**
 * Shadow-diff tests — assert that semantically equivalent inputs to
 * the legacy `parseUpstreamDataLine` (which consumes raw upstream SSE
 * data lines) and the new `runUpstreamStream` (which consumes AI SDK
 * `fullStream` parts) produce the same OpenAWork `StreamChunk`
 * sequences in the same order.
 *
 * Why this matters:
 *   - Phase B will toggle production traffic between the two paths
 *     behind `OPENAWORK_RUNTIME_UPSTREAM=v2`. Any drift between the
 *     two — extra `thinking_end`, missing `tool_call_delta`, mistyped
 *     `stopReason` — would surface as user-visible bugs.
 *   - We cannot replay literal upstream wire bytes through both paths
 *     (the SDK abstracts wire format). Instead we craft *equivalent*
 *     payloads on each side and compare the canonical chunk stream.
 *
 * Coverage today (chat_completions / OpenAI-compatible):
 *   - Plain text delta sequence + `[DONE]` finalisation.
 *   - Streaming tool-call accumulation (incl. zero-length opener).
 *   - Mixed reasoning + text + finish.
 *
 * NOT covered:
 *   - Anthropic-style content_block_* events (legacy parses them via
 *     `parseAnthropicMessagesData`; AI SDK's anthropic provider emits
 *     V2 `tool-input-*` parts directly — we already test that path
 *     in `v2-runtime-upstream.test.ts`).
 *   - Responses API protocol (no AI SDK provider yet; gateway-side
 *     already covered by `parseResponsesApiData`).
 */

import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV2 } from 'ai/test';
import type { StreamChunk } from '@openAwork/shared';

// `routes/stream-protocol.ts` re-exports `buildGatewayToolDefinitions`
// from `../tool-definitions.js`, which transitively imports the full
// gateway tool graph (sqlite, lsp, etc.). The shadow tests only
// exercise the pure parser, so we stub the heavy module before
// importing the parser to keep the test runtime light.
vi.mock('../tool-definitions.js', () => ({
  buildGatewayToolDefinitions: () => [],
  getVisibleToolName: (name: string) => name,
}));

const { createStreamParseState, parseUpstreamDataLine } = await import(
  '../routes/stream-protocol.js'
);
const { runUpstreamStream } = await import('../v2-runtime/upstream/index.js');
type V2LanguageModel = import('../v2-runtime/upstream/index.js').V2LanguageModel;

function buildMockModel(parts: ReadonlyArray<unknown>): V2LanguageModel {
  return new MockLanguageModelV2({
    doStream: async () => ({
      stream: new ReadableStream<unknown>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }) as never,
      rawCall: { rawPrompt: null, rawSettings: {} },
      warnings: [],
    }),
  }) as unknown as V2LanguageModel;
}

async function collectV2(model: V2LanguageModel): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const ev of runUpstreamStream({
    model,
    messages: [{ role: 'user', content: 'q' }],
  })) {
    chunks.push(ev);
  }
  return chunks;
}

function collectLegacy(dataLines: ReadonlyArray<string>): StreamChunk[] {
  const state = createStreamParseState('run-shadow');
  const chunks: StreamChunk[] = [];
  for (const line of dataLines) {
    chunks.push(...parseUpstreamDataLine(line, state));
  }
  return chunks;
}

/**
 * Reduce a chunk list to the comparison projection used in shadow
 * tests: only the `type` discriminator + the salient shape fields.
 * This drops timing-only metadata (`occurredAt`, `runId`, `agentId`,
 * `eventId`) which legitimately differs between the two paths.
 */
function project(chunks: StreamChunk[]): Array<Record<string, unknown>> {
  return chunks.map((c) => {
    switch (c.type) {
      case 'text_delta':
        return { type: c.type, delta: c.delta };
      case 'thinking_start':
        return { type: c.type };
      case 'thinking_delta':
        return { type: c.type, delta: c.delta };
      case 'thinking_end':
        return { type: c.type };
      case 'tool_call_delta':
        return {
          type: c.type,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          inputDelta: c.inputDelta,
        };
      case 'done':
        return { type: c.type, stopReason: c.stopReason };
      case 'error':
        return { type: c.type, code: c.code };
      default:
        return { type: c.type };
    }
  });
}

describe('shadow-diff: chat_completions plain text', () => {
  it('emits the same (text_delta..., done) sequence on both paths', async () => {
    const v2 = await collectV2(
      buildMockModel([
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hello' },
        { type: 'text-delta', id: 't1', delta: ', world' },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        },
      ]),
    );

    const legacy = collectLegacy([
      JSON.stringify({
        choices: [{ delta: { content: 'Hello' } }],
      }),
      JSON.stringify({
        choices: [{ delta: { content: ', world' } }],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
      }),
      '[DONE]',
    ]);

    expect(project(v2)).toEqual(project(legacy));
  });
});

describe('shadow-diff: streaming tool call', () => {
  it('produces matching tool_call_delta sequence + done(tool_use)', async () => {
    const v2 = await collectV2(
      buildMockModel([
        { type: 'tool-input-start', id: 'call-1', toolName: 'read' },
        { type: 'tool-input-delta', id: 'call-1', delta: '{"path":' },
        { type: 'tool-input-delta', id: 'call-1', delta: '"a.ts"}' },
        { type: 'tool-input-end', id: 'call-1' },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        },
      ]),
    );

    // Legacy upstream sends three deltas: name binding (id+name+empty
    // args), then two argument chunks. The legacy parser produces a
    // tool_call_delta on every chunk (name binding emits an empty
    // inputDelta in the same way the v2 path does).
    const legacy = collectLegacy([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  function: { name: 'read', arguments: '' },
                },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"path":' } }],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      }),
      '[DONE]',
    ]);

    expect(project(v2)).toEqual(project(legacy));
  });
});

describe('shadow-diff: reasoning + text', () => {
  it('emits matching thinking_start/delta/end + text_delta + done', async () => {
    const v2 = await collectV2(
      buildMockModel([
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'plan' },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'OK' },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        },
      ]),
    );

    // The legacy chat_completions wire format places reasoning into
    // `delta.reasoning_content` (string). The parser routes that to
    // thinking_start (lazy) + thinking_delta, and emits thinking_end
    // automatically when text content arrives in a later chunk.
    const legacy = collectLegacy([
      JSON.stringify({ choices: [{ delta: { reasoning_content: 'plan' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'OK' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      '[DONE]',
    ]);

    const v2Types = project(v2).map((c) => c['type']);
    const legacyTypes = project(legacy).map((c) => c['type']);
    expect(v2Types).toEqual(legacyTypes);
  });
});
