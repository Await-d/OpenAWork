import { TextEncoder } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, StreamChunk } from '@openAwork/shared';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import type { PersistedCompactionMemory } from '../compaction-metadata.js';
import type { UpstreamChatMessage } from '../session-message-store.js';

interface PreparedConversationMockResult {
  messages: UpstreamChatMessage[];
}

const mocks = vi.hoisted(() => ({
  appendSessionMessageMock: vi.fn(),
  buildPreparedUpstreamConversationMock: vi.fn<
    (
      messages: Message[],
      options?:
        | number
        | {
            contextWindow?: number;
            llmCompactionSummary?: string;
            maxMessages?: number;
            persistedMemory?: unknown;
          },
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
  isUpstreamContextOverflowErrorMock: vi.fn(() => false),
  listSessionMessagesMock: vi.fn<() => Message[]>(() => []),
  updateSessionMessagesStatusByRequestScopeMock: vi.fn(),
  parseUpstreamFrameMock: vi.fn<(frame: string) => StreamChunk[]>(() => [
    { type: 'text_delta', delta: '部分回答' },
  ]),
  upsertArtifactsFromAssistantMessageMock: vi.fn(),
  persistSessionSnapshotMock: vi.fn(),
  readLastCompactionLlmSummaryMock: vi.fn<(metadataJson: string) => string | undefined>(
    () => undefined,
  ),
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
    options?:
      | number
      | {
          contextWindow?: number;
          llmCompactionSummary?: string;
          maxMessages?: number;
          persistedMemory?: unknown;
        },
  ) =>
    mocks.buildPreparedUpstreamConversationMock(
      messages,
      typeof options === 'number' ? options : options,
    ),
  buildUpstreamConversation: mocks.buildUpstreamConversationMock,
  hasToolOutputReference: mocks.hasToolOutputReferenceMock,
  listSessionMessages: mocks.listSessionMessagesMock,
  updateSessionMessagesStatusByRequestScope: mocks.updateSessionMessagesStatusByRequestScopeMock,
}));

vi.mock('../compaction-metadata.js', () => ({
  readLastCompactionLlmSummary: mocks.readLastCompactionLlmSummaryMock,
  readPersistedCompactionMemory: mocks.readPersistedCompactionMemoryMock,
}));

vi.mock('../modified-files-summary.js', () => ({
  buildModifiedFilesSummaryContent: vi.fn(() => null),
}));

vi.mock('../assistant-content-artifacts.js', () => ({
  upsertArtifactsFromAssistantMessage: mocks.upsertArtifactsFromAssistantMessageMock,
}));

vi.mock('../session-snapshot-store.js', () => ({
  persistSessionSnapshot: mocks.persistSessionSnapshotMock,
  createRequestSnapshotRef: mocks.createRequestSnapshotRefMock,
}));

vi.mock('../routes/stream-completion.js', () => ({
  resolveEofRoundDecision: mocks.resolveEofRoundDecisionMock,
}));

vi.mock('../routes/upstream-error.js', () => ({
  isUpstreamContextOverflowError: mocks.isUpstreamContextOverflowErrorMock,
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

vi.mock('../audit-log.js', () => ({
  writeAuditLog: vi.fn(),
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
    mocks.updateSessionMessagesStatusByRequestScopeMock.mockReset();
    mocks.buildPreparedUpstreamConversationMock.mockReset();
    mocks.buildPreparedUpstreamConversationMock.mockImplementation((messages: Message[]) => ({
      messages: mocks.buildUpstreamConversationMock(messages),
    }));
    mocks.parseUpstreamFrameMock.mockReset();
    mocks.upsertArtifactsFromAssistantMessageMock.mockReset();
    mocks.persistSessionSnapshotMock.mockClear();
    mocks.readPersistedCompactionMemoryMock.mockReset();
    mocks.readPersistedCompactionMemoryMock.mockReturnValue(null);
    mocks.readUpstreamErrorMock.mockClear();
    mocks.resolveEofRoundDecisionMock.mockClear();
  });

  it('excludes error messages from upstream history and persists partial assistant output on cancellation', async () => {
    const encoder = new TextEncoder();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    let readCount = 0;
    const previousErrorMessage: Message = {
      id: 'assistant-error-1',
      role: 'assistant',
      createdAt: 1,
      content: [{ type: 'text', text: '[错误: MODEL_ERROR] 先前失败' }],
    };

    mocks.listSessionMessagesMock.mockImplementation((input?: { statuses?: string[] }) =>
      input?.statuses?.includes('final') ? [] : [previousErrorMessage],
    );
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
        contextWindow: 128_000,
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
      expect.objectContaining({ statuses: ['final'] }),
    );
    expect(mocks.buildPreparedUpstreamConversationMock).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        contextWindow: 128_000,
        llmCompactionSummary: undefined,
        persistedMemory: null,
      }),
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
    expect(mocks.upsertArtifactsFromAssistantMessageMock).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('cancelled');
  });

  it('upserts assistant artifacts only after a completed end_turn response', async () => {
    const encoder = new TextEncoder();
    let readCount = 0;

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
            return { done: true, value: undefined };
          },
        }),
      },
    });
    mocks.parseUpstreamFrameMock.mockImplementation((frame: string) =>
      frame.includes('data:')
        ? [{ type: 'text_delta', delta: '```html\n<div>Hello artifact</div>\n```' }]
        : [],
    );

    const { runModelRound } = await import('../routes/stream-model-round.js');
    const wl = new WorkflowLogger();
    const ctx = createRequestContext('TEST', '/stream', {}, 'local');

    const result = await runModelRound({
      clientRequestId: 'req-end-turn',
      enabledTools: [],
      eventSequence: { value: 1 },
      requestData: {
        clientRequestId: 'req-end-turn',
        maxTokens: 1024,
        message: '继续执行',
        temperature: 0,
      },
      round: 0,
      route: {
        apiKey: '',
        apiBaseUrl: 'https://example.invalid',
        contextWindow: 128_000,
        maxTokens: 1024,
        model: 'test-model',
        requestOverrides: {},
        supportsThinking: false,
        temperature: 0,
        upstreamProtocol: 'responses',
        variant: undefined,
      },
      runId: 'run-end-turn',
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

    expect(result.stopReason).toBe('end_turn');
    expect(mocks.upsertArtifactsFromAssistantMessageMock).toHaveBeenCalledWith({
      clientRequestId: 'req-end-turn',
      content: [{ type: 'text', text: '```html\n<div>Hello artifact</div>\n```' }],
      sessionId: 'session-1',
      userId: 'user-1',
    });
  });

  it('reads persisted compaction memory while preparing upstream conversation', async () => {
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
        contextWindow: 128_000,
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
        contextWindow: 128_000,
        llmCompactionSummary: undefined,
        persistedMemory: expect.objectContaining({
          coveredUntilMessageId: 'assistant-2',
        }),
      }),
    );
    expect(result.stopReason).toBe('error');
  });

  it('returns overflow recovery signal when upstream rejects oversized context', async () => {
    mocks.fetchUpstreamStreamWithRetryMock.mockResolvedValue({
      ok: false,
      status: 400,
      body: null,
    });
    mocks.readUpstreamErrorMock.mockResolvedValue({
      code: 'MODEL_ERROR',
      message: 'maximum context length exceeded',
    });
    mocks.isUpstreamContextOverflowErrorMock.mockReturnValue(true);

    const { runModelRound } = await import('../routes/stream-model-round.js');
    const wl = new WorkflowLogger();
    const ctx = createRequestContext('TEST', '/stream', {}, 'local');
    const writeChunk = vi.fn();

    const result = await runModelRound({
      clientRequestId: 'req-overflow',
      enabledTools: [],
      eventSequence: { value: 1 },
      requestData: {
        clientRequestId: 'req-overflow',
        maxTokens: 1024,
        message: '继续执行',
        temperature: 0,
      },
      round: 1,
      route: {
        apiKey: '',
        apiBaseUrl: 'https://example.invalid',
        contextWindow: 128_000,
        maxTokens: 1024,
        model: 'test-model',
        requestOverrides: {},
        supportsThinking: false,
        temperature: 0,
        upstreamProtocol: 'responses',
        variant: undefined,
      },
      runId: 'run-overflow',
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
      writeChunk,
    });

    expect(result.overflow).toBe(true);
    expect(result.shouldStop).toBe(false);
    expect(result.stopReason).toBe('error');
    expect(mocks.appendSessionMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
    expect(writeChunk).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('appends a synthetic continuation user prompt when requested', async () => {
    const encoder = new TextEncoder();
    let readCount = 0;
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
            return { done: true, value: undefined };
          },
        }),
      },
    });
    mocks.parseUpstreamFrameMock.mockImplementation((frame: string) =>
      frame.includes('data:') ? [{ type: 'done', stopReason: 'end_turn' }] : [],
    );

    const { runModelRound } = await import('../routes/stream-model-round.js');
    const wl = new WorkflowLogger();
    const ctx = createRequestContext('TEST', '/stream', {}, 'local');

    await runModelRound({
      clientRequestId: 'req-synthetic',
      enabledTools: [],
      eventSequence: { value: 1 },
      requestData: {
        clientRequestId: 'req-synthetic',
        maxTokens: 1024,
        message: '继续执行',
        temperature: 0,
      },
      round: 0,
      route: {
        apiKey: '',
        apiBaseUrl: 'https://example.invalid',
        contextWindow: 128_000,
        maxTokens: 1024,
        model: 'test-model',
        requestOverrides: {},
        supportsThinking: false,
        temperature: 0,
        upstreamProtocol: 'responses',
        variant: undefined,
      },
      runId: 'run-synthetic',
      signal: new AbortController().signal,
      sessionContext: { legacyMessagesJson: '[]', metadataJson: '{}' },
      sessionId: 'session-1',
      syntheticContinuationPrompt: 'Continue after compaction.',
      transport: 'SSE',
      turnFileDiffs: undefined,
      userId: 'user-1',
      wl,
      ctx,
      workspaceCtx: null,
      requestSystemPrompts: [],
      writeChunk: vi.fn(),
    });

    expect(mocks.buildUpstreamRequestBodyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Continue after compaction.' }),
        ]),
      }),
    );
  });
});
