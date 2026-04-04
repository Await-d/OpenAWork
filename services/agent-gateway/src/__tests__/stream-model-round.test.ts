import { TextEncoder } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, StreamChunk } from '@openAwork/shared';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import type { PersistedCompactionMemory } from '../compaction-metadata.js';
import type { UpstreamChatMessage } from '../session-message-store.js';

interface PreparedConversationMockResult {
  compaction?: {
    eventSummary: string;
    omittedMessages: number;
    persistedMemory: PersistedCompactionMemory;
    recentMessagesKept: number;
    signature: string;
    structuredSummary: string;
  };
  messages: UpstreamChatMessage[];
}

const mocks = vi.hoisted(() => ({
  appendSessionMessageMock: vi.fn(),
  buildPreparedUpstreamConversationMock: vi.fn<
    (
      messages: Message[],
      options?: number | { maxMessages?: number; persistedMemory?: unknown },
    ) => PreparedConversationMockResult
  >(() => ({ messages: [] as UpstreamChatMessage[] })),
  buildRoundSystemMessagesMock: vi.fn(() => []),
  buildUpstreamConversationMock: vi.fn<
    (messages: Message[], maxMessages?: number) => UpstreamChatMessage[]
  >(() => []),
  buildUpstreamRequestBodyMock: vi.fn(() => ({})),
  createRequestSnapshotRefMock: vi.fn(() => 'snapshot-ref'),
  createStreamErrorChunkMock: vi.fn(() => ({ type: 'error' })),
  createStreamParseStateMock: vi.fn(() => ({
    nextEventSequence: 1,
    sawFinishReason: false,
    stopReason: 'cancelled',
  })),
  createRunEventMetaMock: vi.fn(() => ({
    eventId: 'evt-cancel',
    runId: 'run-cancel',
    occurredAt: 123,
  })),
  fetchUpstreamStreamWithRetryMock: vi.fn(),
  hasToolOutputReferenceMock: vi.fn(() => false),
  listSessionMessagesMock: vi.fn<() => Message[]>(() => []),
  parseUpstreamFrameMock: vi.fn<(frame: string) => StreamChunk[]>(() => [
    { type: 'text_delta', delta: '部分回答' },
  ]),
  persistSessionSnapshotMock: vi.fn(),
  readPersistedCompactionMemoryMock: vi.fn<
    (metadataJson: string) => PersistedCompactionMemory | null
  >(() => null),
  readUpstreamErrorMock: vi.fn(),
  resolveEofRoundDecisionMock: vi.fn(() => ({ stopReason: 'end_turn' })),
}));

vi.mock('../session-message-store.js', () => ({
  appendSessionMessage: mocks.appendSessionMessageMock,
  buildPreparedUpstreamConversation: (
    messages: Message[],
    options?: number | { maxMessages?: number },
  ) =>
    mocks.buildPreparedUpstreamConversationMock(
      messages,
      typeof options === 'number' ? options : options,
    ),
  buildUpstreamConversation: mocks.buildUpstreamConversationMock,
  hasToolOutputReference: mocks.hasToolOutputReferenceMock,
  listSessionMessages: mocks.listSessionMessagesMock,
}));

vi.mock('../compaction-metadata.js', () => ({
  readPersistedCompactionMemory: mocks.readPersistedCompactionMemoryMock,
}));

vi.mock('../modified-files-summary.js', () => ({
  buildModifiedFilesSummaryContent: vi.fn(() => null),
}));

vi.mock('../session-snapshot-store.js', () => ({
  persistSessionSnapshot: mocks.persistSessionSnapshotMock,
  createRequestSnapshotRef: mocks.createRequestSnapshotRefMock,
}));

vi.mock('../routes/stream-completion.js', () => ({
  resolveEofRoundDecision: mocks.resolveEofRoundDecisionMock,
}));

vi.mock('../routes/upstream-error.js', () => ({
  readUpstreamError: mocks.readUpstreamErrorMock,
}));

vi.mock('../routes/upstream-request.js', () => ({
  buildUpstreamRequestBody: mocks.buildUpstreamRequestBodyMock,
}));

vi.mock('../routes/stream-protocol.js', () => ({
  createStreamParseState: mocks.createStreamParseStateMock,
  parseUpstreamFrame: mocks.parseUpstreamFrameMock,
  ResponsesUpstreamEventError: class ResponsesUpstreamEventError extends Error {
    code = 'MOCK';
  },
}));

vi.mock('../routes/stream-system-prompts.js', () => ({
  buildRoundSystemMessages: mocks.buildRoundSystemMessagesMock,
}));

vi.mock('../routes/stream.js', () => ({
  createRunEventMeta: mocks.createRunEventMetaMock,
  createStreamErrorChunk: mocks.createStreamErrorChunkMock,
}));

vi.mock('../routes/upstream-stream-retry.js', () => ({
  fetchUpstreamStreamWithRetry: mocks.fetchUpstreamStreamWithRetryMock,
}));

describe('runModelRound', () => {
  beforeEach(() => {
    mocks.appendSessionMessageMock.mockReset();
    mocks.buildRoundSystemMessagesMock.mockClear();
    mocks.buildUpstreamConversationMock.mockClear();
    mocks.buildUpstreamRequestBodyMock.mockClear();
    mocks.createRequestSnapshotRefMock.mockClear();
    mocks.createStreamErrorChunkMock.mockClear();
    mocks.createStreamParseStateMock.mockClear();
    mocks.createRunEventMetaMock.mockClear();
    mocks.fetchUpstreamStreamWithRetryMock.mockReset();
    mocks.hasToolOutputReferenceMock.mockClear();
    mocks.listSessionMessagesMock.mockReset();
    mocks.buildPreparedUpstreamConversationMock.mockReset();
    mocks.buildPreparedUpstreamConversationMock.mockImplementation((messages: Message[]) => ({
      messages: mocks.buildUpstreamConversationMock(messages),
    }));
    mocks.parseUpstreamFrameMock.mockReset();
    mocks.persistSessionSnapshotMock.mockClear();
    mocks.readPersistedCompactionMemoryMock.mockReset();
    mocks.readPersistedCompactionMemoryMock.mockReturnValue(null);
    mocks.readUpstreamErrorMock.mockClear();
    mocks.resolveEofRoundDecisionMock.mockClear();
  });

  it('includes error messages in upstream history and persists partial assistant output on cancellation', async () => {
    const encoder = new TextEncoder();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    let readCount = 0;

    mocks.listSessionMessagesMock.mockReturnValue([
      {
        id: 'assistant-error-1',
        role: 'assistant',
        createdAt: 1,
        content: [{ type: 'text', text: '[错误: MODEL_ERROR] 先前失败' }],
      },
    ]);
    mocks.fetchUpstreamStreamWithRetryMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            readCount += 1;
            if (readCount === 1) {
              return { done: false, value: encoder.encode('data: first\n\n') };
            }
            throw abortError;
          },
        }),
      },
    });
    mocks.parseUpstreamFrameMock.mockImplementation((frame: string) =>
      frame.includes('data:') ? [{ type: 'text_delta', delta: '部分回答' }] : [],
    );

    const { runModelRound } = await import('../routes/stream-model-round.js');
    const wl = new WorkflowLogger();
    const ctx = createRequestContext('TEST', '/stream', {}, 'local');

    const result = await runModelRound({
      clientRequestId: 'req-1',
      enabledTools: [],
      eventSequence: { value: 1 },
      requestData: {
        clientRequestId: 'req-1',
        maxTokens: 1024,
        message: '继续执行',
        temperature: 0,
        upstreamRetryMaxRetries: 2,
      },
      round: 0,
      route: {
        apiKey: '',
        apiBaseUrl: 'https://example.invalid',
        maxTokens: 1024,
        model: 'test-model',
        requestOverrides: {},
        supportsThinking: false,
        temperature: 0,
        upstreamProtocol: 'responses',
        variant: undefined,
      },
      runId: 'run-cancel',
      signal: new AbortController().signal,
      sessionContext: { legacyMessagesJson: '[]', metadataJson: '{}' },
      sessionId: 'session-1',
      transport: 'SSE',
      turnFileDiffs: undefined,
      userId: 'user-1',
      wl,
      ctx,
      workspaceCtx: null,
      requestSystemPrompts: [],
      writeChunk: vi.fn(),
    });

    expect(mocks.listSessionMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['final', 'error'] }),
    );
    expect(mocks.fetchUpstreamStreamWithRetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        retryOptions: expect.objectContaining({ maxAttempts: 3 }),
      }),
    );
    expect(mocks.appendSessionMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        userId: 'user-1',
        role: 'assistant',
        clientRequestId: 'req-1',
        content: [{ type: 'text', text: '部分回答' }],
      }),
    );
    expect(result.stopReason).toBe('cancelled');
  });

  it('reads persisted compaction memory and returns prepared compaction payload', async () => {
    mocks.listSessionMessagesMock.mockReturnValue([
      {
        id: 'user-1',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', text: '继续执行' }],
      },
    ]);
    mocks.readPersistedCompactionMemoryMock.mockReturnValue({
      schemaVersion: 1,
      coveredUntilMessageId: 'assistant-2',
      updatedAt: 1,
      compactionCount: 2,
      summarizedMessages: 6,
      lastTrigger: 'automatic',
      userGoals: ['已有目标'],
      assistantProgress: ['已有进展'],
      toolActivity: [],
      filesReferenced: [],
      latestUserRequest: '已有请求',
      lastCompactionSignature: 'persisted-sig',
    });
    mocks.buildPreparedUpstreamConversationMock.mockReturnValue({
      messages: [{ role: 'system', content: 'durable summary' }],
      compaction: {
        eventSummary: '已自动压缩新增的 2 条较早消息',
        omittedMessages: 6,
        persistedMemory: {
          schemaVersion: 1,
          coveredUntilMessageId: 'assistant-3',
          updatedAt: 2,
          compactionCount: 3,
          summarizedMessages: 8,
          lastTrigger: 'automatic',
          userGoals: ['已有目标', '新增目标'],
          assistantProgress: ['已有进展', '新增进展'],
          toolActivity: [],
          filesReferenced: [],
          latestUserRequest: '新增请求',
          lastCompactionSignature: 'new-sig',
        },
        recentMessagesKept: 4,
        signature: 'new-sig',
        structuredSummary: 'Durable session compaction memory (automatic compaction).',
      },
    });
    mocks.fetchUpstreamStreamWithRetryMock.mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
    });
    mocks.readUpstreamErrorMock.mockResolvedValue({
      code: 'UPSTREAM_ERROR',
      message: 'upstream failed',
    });

    const { runModelRound } = await import('../routes/stream-model-round.js');
    const wl = new WorkflowLogger();
    const ctx = createRequestContext('TEST', '/stream', {}, 'local');

    const result = await runModelRound({
      clientRequestId: 'req-2',
      enabledTools: [],
      eventSequence: { value: 1 },
      requestData: {
        clientRequestId: 'req-2',
        maxTokens: 1024,
        message: '继续执行',
        temperature: 0,
      },
      round: 1,
      route: {
        apiKey: '',
        apiBaseUrl: 'https://example.invalid',
        maxTokens: 1024,
        model: 'test-model',
        requestOverrides: {},
        supportsThinking: false,
        temperature: 0,
        upstreamProtocol: 'responses',
        variant: undefined,
      },
      runId: 'run-compaction',
      signal: new AbortController().signal,
      sessionContext: {
        legacyMessagesJson: '[]',
        metadataJson: '{"compactionMemory":{"coveredUntilMessageId":"assistant-2"}}',
      },
      sessionId: 'session-2',
      transport: 'SSE',
      turnFileDiffs: undefined,
      userId: 'user-1',
      wl,
      ctx,
      workspaceCtx: null,
      requestSystemPrompts: [],
      writeChunk: vi.fn(),
    });

    expect(mocks.readPersistedCompactionMemoryMock).toHaveBeenCalledWith(
      '{"compactionMemory":{"coveredUntilMessageId":"assistant-2"}}',
    );
    expect(mocks.buildPreparedUpstreamConversationMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        persistedMemory: expect.objectContaining({
          coveredUntilMessageId: 'assistant-2',
        }),
      }),
    );
    expect(result.compaction).toMatchObject({
      omittedMessages: 6,
      recentMessagesKept: 4,
      signature: 'new-sig',
    });
  });
});
