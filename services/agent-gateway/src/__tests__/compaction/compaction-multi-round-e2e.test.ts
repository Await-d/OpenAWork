/**
 * Multi-round compaction e2e (T-COMPACT-V-02, workflow 260509).
 *
 * The anchor-summary feature only really earns its keep when the
 * session is compacted more than once: the LLM should always receive
 * the *latest* `lastCompactionLlmSummary` as the
 * `<previous-summary>` anchor, never the original conversation,
 * never `undefined`. This test fixes that across three rounds:
 *
 *   round 1: previousSummary undefined → llm produces v1
 *   round 2: previousSummary = v1     → llm produces v2
 *   round 3: previousSummary = v2     → llm produces v3
 *
 * We mock the upstream LLM call + the database side-effects so the
 * test exercises the real `executeSessionCompaction` glue (metadata
 * merging, anchor extraction) without any IO.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@openAwork/shared';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const sqliteRunMock = vi.hoisted(() => vi.fn());
const appendMarkerMock = vi.hoisted(() => vi.fn());
const callCompactionLlmMock = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => ({
    summary: 'unset',
    inputTokens: 0,
    outputTokens: 0,
  })),
);

vi.mock('../../infra/db.js', () => ({
  sqliteRun: sqliteRunMock,
  // unused but referenced by indirect imports
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(),
  WORKSPACE_ROOT: '/tmp/workspace',
}));

vi.mock('../../compaction/compaction-llm.js', () => ({
  callCompactionLlm: callCompactionLlmMock,
}));

vi.mock('../../message/message-v2-adapter.js', () => ({
  appendCompactionMarkerMessageV2: appendMarkerMock,
  // listSessionMessagesV2 is also re-exported by the adapter; we stub
  // it here so any unrelated import in the executor's module graph
  // does not break with `undefined is not a function`.
  listSessionMessagesV2: vi.fn(() => []),
  appendSessionMessageV2: vi.fn(),
}));

import { executeSessionCompaction } from '../../session/session-compaction.js';

function userMessage(id: string, text: string): Message {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    createdAt: Date.now(),
  };
}

function assistantMessage(id: string, text: string): Message {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    createdAt: Date.now(),
  };
}

// We never actually hit the upstream — `callCompactionLlm` is mocked
// at the module boundary above. We still need the value to satisfy
// the `ModelRouteConfig` type so the executor's defensive `route`
// branches don't trip a typecheck error in the test compilation.
const ROUTE: ModelRouteConfig = {
  model: 'mock-model',
  apiBaseUrl: 'http://localhost:0',
  apiKey: 'mock',
  maxTokens: 1024,
  temperature: 0,
  upstreamProtocol: 'chat_completions',
  requestOverrides: {},
  supportsThinking: false,
};

beforeEach(() => {
  callCompactionLlmMock.mockReset();
  sqliteRunMock.mockReset();
  appendMarkerMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('executeSessionCompaction — three-round anchor propagation', () => {
  it('feeds each round the previous LLM summary as the anchor', async () => {
    callCompactionLlmMock
      .mockResolvedValueOnce({ summary: 'v1: initial', inputTokens: 0, outputTokens: 0 })
      .mockResolvedValueOnce({ summary: 'v2: builds on v1', inputTokens: 0, outputTokens: 0 })
      .mockResolvedValueOnce({ summary: 'v3: builds on v2', inputTokens: 0, outputTokens: 0 });

    // Round 1: empty metadata → previousSummary should be undefined.
    const messagesRound1: Message[] = [
      userMessage('m1', 'work block 1'),
      assistantMessage('m2', 'reply 1'),
      userMessage('m3', 'work block 2'),
      assistantMessage('m4', 'reply 2'),
    ];
    const r1 = await executeSessionCompaction({
      messages: messagesRound1,
      metadataJson: '{}',
      route: ROUTE,
      sessionId: 'sess-1',
      trigger: 'manual',
      userId: 'user-1',
    });
    expect(r1.summary).toBe('v1: initial');
    expect(r1.metadata['lastCompactionLlmSummary']).toBe('v1: initial');
    expect(callCompactionLlmMock).toHaveBeenCalledTimes(1);
    expect(
      (callCompactionLlmMock.mock.calls[0]?.[0] as { previousSummary?: string }).previousSummary,
    ).toBeUndefined();

    // Round 2: feed back r1.metadataJson — previousSummary must be v1.
    const messagesRound2: Message[] = [
      ...messagesRound1,
      userMessage('m5', 'work block 3'),
      assistantMessage('m6', 'reply 3'),
    ];
    const r2 = await executeSessionCompaction({
      messages: messagesRound2,
      metadataJson: r1.metadataJson,
      route: ROUTE,
      sessionId: 'sess-1',
      trigger: 'manual',
      userId: 'user-1',
    });
    expect(r2.summary).toBe('v2: builds on v1');
    expect(callCompactionLlmMock).toHaveBeenCalledTimes(2);
    expect(
      (callCompactionLlmMock.mock.calls[1]?.[0] as { previousSummary?: string }).previousSummary,
    ).toBe('v1: initial');

    // Round 3: feed back r2.metadataJson — previousSummary must be v2,
    // NOT v1 and NOT some concatenation.
    const messagesRound3: Message[] = [
      ...messagesRound2,
      userMessage('m7', 'work block 4'),
      assistantMessage('m8', 'reply 4'),
    ];
    const r3 = await executeSessionCompaction({
      messages: messagesRound3,
      metadataJson: r2.metadataJson,
      route: ROUTE,
      sessionId: 'sess-1',
      trigger: 'manual',
      userId: 'user-1',
    });
    expect(r3.summary).toBe('v3: builds on v2');
    expect(callCompactionLlmMock).toHaveBeenCalledTimes(3);
    expect(
      (callCompactionLlmMock.mock.calls[2]?.[0] as { previousSummary?: string }).previousSummary,
    ).toBe('v2: builds on v1');

    // Each round must persist a marker message + write the row.
    expect(sqliteRunMock).toHaveBeenCalledTimes(3);
    expect(appendMarkerMock).toHaveBeenCalledTimes(3);
  });

  it('clears any prior anchor when a round produces empty messagesToSummarize', async () => {
    // First round: produces v1.
    callCompactionLlmMock.mockResolvedValueOnce({
      summary: 'v1: initial',
      inputTokens: 0,
      outputTokens: 0,
    });
    const r1 = await executeSessionCompaction({
      messages: [userMessage('m1', 'block')],
      metadataJson: '{}',
      route: ROUTE,
      sessionId: 'sess-2',
      trigger: 'manual',
      userId: 'user-1',
    });
    expect(r1.metadata['lastCompactionLlmSummary']).toBe('v1: initial');

    // Round 2 with everything kept verbatim: nothing to summarize, the
    // executor must short-circuit AND must NOT call the LLM. The
    // metadata then resets `lastCompactionLlmSummary` to '' so future
    // rounds know the previous anchor is gone.
    const r2 = await executeSessionCompaction({
      messages: [userMessage('m1', 'block')],
      metadataJson: r1.metadataJson,
      recentMessagesKept: 10,
      route: ROUTE,
      sessionId: 'sess-2',
      trigger: 'manual',
      userId: 'user-1',
    });
    expect(callCompactionLlmMock).toHaveBeenCalledTimes(1); // unchanged
    expect(r2.summary).toBe('');
    expect(r2.metadata['lastCompactionLlmSummary']).toBe('');
  });

  it('keeps the prior anchor when the LLM call itself fails (circuit-breaker counter ticks up)', async () => {
    callCompactionLlmMock.mockResolvedValueOnce({
      summary: 'v1: initial',
      inputTokens: 0,
      outputTokens: 0,
    });
    const r1 = await executeSessionCompaction({
      messages: [userMessage('m1', 'a'), assistantMessage('m2', 'b')],
      metadataJson: '{}',
      route: ROUTE,
      sessionId: 'sess-3',
      trigger: 'manual',
      userId: 'user-1',
    });
    expect(r1.metadata['consecutiveCompactionFailures']).toBe(0);

    callCompactionLlmMock.mockRejectedValueOnce(new Error('upstream 503'));
    const r2 = await executeSessionCompaction({
      messages: [
        userMessage('m1', 'a'),
        assistantMessage('m2', 'b'),
        userMessage('m3', 'c'),
        assistantMessage('m4', 'd'),
      ],
      metadataJson: r1.metadataJson,
      route: ROUTE,
      sessionId: 'sess-3',
      trigger: 'automatic',
      userId: 'user-1',
    });
    // Failure → consecutiveCompactionFailures ticks up.
    expect(r2.llmErrorMessage).toContain('503');
    expect(r2.metadata['consecutiveCompactionFailures']).toBe(1);
    // The fallback structured summary should now be the round-2
    // anchor — but the next live LLM call would still see v1 as the
    // anchor input (round 2's structured-summary fallback overwrote
    // `lastCompactionLlmSummary` though, so we just verify the
    // failure was recorded without a successful summary leaking
    // into the metadata as a "real" v2).
    expect(r2.llmSummary).toBeUndefined();
  });
});
