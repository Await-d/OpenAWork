import { TextEncoder } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, StreamChunk } from '@openAwork/shared';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import type { PersistedCompactionMemory } from '../compaction-metadata.js';
import type {
  PreparedUpstreamConversationReport,
  UpstreamChatMessage,
} from '../session-message-store.js';

interface PreparedConversationMockResult {
  messages: UpstreamChatMessage[];
  compactionSummary: string | null;
  report?: PreparedUpstreamConversationReport;
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
  >(() => ({ messages: [] as UpstreamChatMessage[], compactionSummary: null })),
  buildRoundSystemMessagesMock: vi.fn<() => Array<{ role: 'system'; content: string }>>(() => []),
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
  hasCompactionMarkerMock: vi.fn(() => false),
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
  writeAuditLogMock: vi.fn(),
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
  hasCompactionMarker: mocks.hasCompactionMarkerMock,
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
  writeAuditLog: mocks.writeAuditLogMock,
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
    mocks.hasCompactionMarkerMock.mockReset();
    mocks.hasCompactionMarkerMock.mockReturnValue(false);
    mocks.listSessionMessagesMock.mockReset();
    mocks.updateSessionMessagesStatusByRequestScopeMock.mockReset();
    mocks.buildPreparedUpstreamConversationMock.mockReset();
    mocks.buildPreparedUpstreamConversationMock.mockImplementation((messages: Message[]) => ({
      messages: mocks.buildUpstreamConversationMock(messages),
      compactionSummary: null,
    }));
    mocks.parseUpstreamFrameMock.mockReset();
    mocks.upsertArtifactsFromAssistantMessageMock.mockReset();
    mocks.persistSessionSnapshotMock.mockClear();
    mocks.readLastCompactionLlmSummaryMock.mockReset();
    mocks.readLastCompactionLlmSummaryMock.mockReturnValue(undefined);
    mocks.readPersistedCompactionMemoryMock.mockReset();
    mocks.readPersistedCompactionMemoryMock.mockReturnValue(null);
    mocks.readUpstreamErrorMock.mockClear();
    mocks.resolveEofRoundDecisionMock.mockClear();
    mocks.writeAuditLogMock.mockReset();
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
      injectedPrompt: null,
      capabilityContext: null,
      lspGuidance: null,
      dialogueModePrompt: null,
      yoloModePrompt: null,
      companionPrompt: null,
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
      injectedPrompt: null,
      capabilityContext: null,
      lspGuidance: null,
      dialogueModePrompt: null,
      yoloModePrompt: null,
      companionPrompt: null,
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
      messages: [{ role: 'user', content: 'continued' }],
      compactionSummary: 'durable summary',
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
      injectedPrompt: null,
      capabilityContext: null,
      lspGuidance: null,
      dialogueModePrompt: null,
      yoloModePrompt: null,
      companionPrompt: null,
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

  it('writes a non-error upstream transformation audit before sending upstream', async () => {
    mocks.listSessionMessagesMock.mockReturnValue([
      {
        id: 'user-1',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', text: '继续执行' }],
      },
    ]);
    mocks.buildPreparedUpstreamConversationMock.mockReturnValue({
      messages: [{ role: 'user', content: '继续执行' }],
      compactionSummary: null,
      report: {
        inputMessageCount: 1,
        normalizedMessageCount: 1,
        artifactFilteredCount: 0,
        historySinceBoundaryCount: 1,
        boundaryTrimmedMessageCount: 0,
        selectedHistoryCount: 1,
        safeWindowTrimmedMessageCount: 0,
        compactSummaryInjected: false,
        assistantUiEventFilteredCount: 0,
        modifiedFilesSummaryInjectedCount: 0,
        toolResultCount: 0,
        referencedToolOutputCount: 0,
        assistantToolCallCount: 0,
        upstreamMessageCount: 1,
      },
    });
    mocks.buildRoundSystemMessagesMock.mockReturnValue([{ role: 'system', content: 'sys' }]);
    mocks.buildUpstreamRequestBodyMock.mockReturnValue({
      model: 'test-model',
      input: [],
      stream: true,
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

    await runModelRound({
      clientRequestId: 'req-audit',
      enabledTools: [],
      eventSequence: { value: 1 },
      requestData: {
        clientRequestId: 'req-audit',
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
        requestOverrides: { body: { foo: 'bar' }, omitBodyKeys: ['temperature'] },
        supportsThinking: false,
        temperature: 0,
        upstreamProtocol: 'responses',
        variant: undefined,
      },
      runId: 'run-audit',
      signal: new AbortController().signal,
      sessionContext: { legacyMessagesJson: '[]', metadataJson: '{}' },
      sessionId: 'session-audit',
      transport: 'SSE',
      turnFileDiffs: undefined,
      userId: 'user-1',
      wl,
      ctx,
      workspaceCtx: 'workspace ctx',
      injectedPrompt: 'request ctx',
      capabilityContext: null,
      lspGuidance: null,
      dialogueModePrompt: null,
      yoloModePrompt: null,
      companionPrompt: null,
      writeChunk: vi.fn(),
    });

    expect(mocks.writeAuditLogMock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetchUpstreamStreamWithRetryMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );

    expect(mocks.writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'llm',
        sourceName: 'UPSTREAM_TRANSFORM',
        requestId: 'req-audit',
        isError: false,
        input: expect.objectContaining({
          model: 'test-model',
          round: 0,
          transformationReport: expect.objectContaining({
            protocol: 'responses',
            workspaceContextInjected: true,
            injectedPromptActive: true,
            capabilityContextActive: false,
            lspGuidanceActive: false,
            dialogueModeActive: false,
            yoloModeActive: false,
            companionPromptActive: false,
            requestOverrideBodyKeys: ['foo'],
            omittedBodyKeys: ['temperature'],
            prepared: expect.objectContaining({
              inputMessageCount: 1,
              upstreamMessageCount: 1,
            }),
          }),
        }),
        output: expect.objectContaining({
          message: 'upstream transformation report',
          protocol: 'responses',
          requestBodyKeys: expect.arrayContaining(['input', 'model', 'stream']),
        }),
      }),
    );
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
      injectedPrompt: null,
      capabilityContext: null,
      lspGuidance: null,
      dialogueModePrompt: null,
      yoloModePrompt: null,
      companionPrompt: null,
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

  it('skips metadata fallback when a compaction marker is already present', async () => {
    mocks.listSessionMessagesMock.mockReturnValue([
      {
        id: 'marker-1',
        role: 'assistant',
        createdAt: 1,
        content: [{ type: 'text', text: 'hidden marker' }],
      },
      {
        id: 'user-1',
        role: 'user',
        createdAt: 2,
        content: [{ type: 'text', text: '继续执行' }],
      },
    ]);
    mocks.hasCompactionMarkerMock.mockReturnValue(true);
    mocks.buildPreparedUpstreamConversationMock.mockReturnValue({
      messages: [{ role: 'user', content: 'continued' }],
      compactionSummary: 'marker summary',
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

    await runModelRound({
      clientRequestId: 'req-marker',
      enabledTools: [],
      eventSequence: { value: 1 },
      requestData: {
        clientRequestId: 'req-marker',
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
      runId: 'run-marker',
      signal: new AbortController().signal,
      sessionContext: {
        legacyMessagesJson: '[]',
        metadataJson:
          '{"compactionMemory":{"coveredUntilMessageId":"assistant-2"},"lastCompactionLlmSummary":"legacy summary"}',
      },
      sessionId: 'session-marker',
      transport: 'SSE',
      turnFileDiffs: undefined,
      userId: 'user-1',
      wl,
      ctx,
      workspaceCtx: null,
      injectedPrompt: null,
      capabilityContext: null,
      lspGuidance: null,
      dialogueModePrompt: null,
      yoloModePrompt: null,
      companionPrompt: null,
      writeChunk: vi.fn(),
    });

    expect(mocks.readPersistedCompactionMemoryMock).not.toHaveBeenCalled();
    expect(mocks.readLastCompactionLlmSummaryMock).not.toHaveBeenCalled();
    expect(mocks.buildPreparedUpstreamConversationMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        contextWindow: 128_000,
      }),
    );
    expect(mocks.buildPreparedUpstreamConversationMock.mock.calls.at(-1)?.[1]).not.toMatchObject({
      persistedMemory: expect.anything(),
    });
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
      injectedPrompt: null,
      capabilityContext: null,
      lspGuidance: null,
      dialogueModePrompt: null,
      yoloModePrompt: null,
      companionPrompt: null,
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

  it('forwards request-scoped thinking settings into upstream request construction', async () => {
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
      clientRequestId: 'req-thinking',
      enabledTools: [],
      eventSequence: { value: 1 },
      requestData: {
        clientRequestId: 'req-thinking',
        maxTokens: 1024,
        message: '请深度推理',
        reasoningEffort: 'high',
        temperature: 0,
        thinkingEnabled: true,
      },
      round: 0,
      route: {
        apiKey: '',
        apiBaseUrl: 'https://example.invalid',
        contextWindow: 128_000,
        maxTokens: 1024,
        model: 'o3',
        providerType: 'openai',
        requestOverrides: {},
        supportsThinking: true,
        temperature: 0,
        upstreamProtocol: 'responses',
        variant: undefined,
      },
      runId: 'run-thinking',
      signal: new AbortController().signal,
      sessionContext: { legacyMessagesJson: '[]', metadataJson: '{}' },
      sessionId: 'session-1',
      transport: 'SSE',
      turnFileDiffs: undefined,
      userId: 'user-1',
      wl,
      ctx,
      workspaceCtx: null,
      injectedPrompt: null,
      capabilityContext: null,
      lspGuidance: null,
      dialogueModePrompt: null,
      yoloModePrompt: null,
      companionPrompt: null,
      writeChunk: vi.fn(),
    });

    expect(mocks.buildUpstreamRequestBodyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        thinking: {
          enabled: true,
          effort: 'high',
          providerType: 'openai',
          supportsThinking: true,
        },
      }),
    );
  });
});
