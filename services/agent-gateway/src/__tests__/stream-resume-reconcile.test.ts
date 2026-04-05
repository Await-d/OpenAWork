import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockRunModelRoundResult = {
  shouldStop: boolean;
  statusCode: number;
  stopReason: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  usageOccurredAt?: number;
};

const {
  appendSessionMessageMock,
  clearInFlightStreamRequestMock,
  clearSessionRuntimeThreadMock,
  executeMock,
  getAnyInFlightStreamRequestForSessionMock,
  persistFileDiffsMock,
  persistMonthlyUsageRecordMock,
  persistRunEventMock,
  registerInFlightStreamRequestMock,
  reconcileMock,
  resolveStreamModelRouteMock,
  resolveStreamRequestUpstreamRetryMock,
  runModelRoundMock,
  upsertSessionRuntimeThreadMock,
} = vi.hoisted(() => ({
  appendSessionMessageMock: vi.fn(() => ({ id: 'msg-1' })),
  clearInFlightStreamRequestMock: vi.fn(),
  clearSessionRuntimeThreadMock: vi.fn(),
  executeMock: vi.fn(),
  getAnyInFlightStreamRequestForSessionMock: vi.fn(() => undefined),
  persistFileDiffsMock: vi.fn(),
  persistMonthlyUsageRecordMock: vi.fn(),
  persistRunEventMock: vi.fn(),
  registerInFlightStreamRequestMock: vi.fn(),
  reconcileMock: vi.fn(),
  resolveStreamModelRouteMock: vi.fn(),
  resolveStreamRequestUpstreamRetryMock: vi.fn(
    (input: { requestData: Record<string, unknown> }) => input.requestData,
  ),
  runModelRoundMock: vi.fn<() => Promise<MockRunModelRoundResult>>(async () => ({
    shouldStop: true,
    stopReason: 'end_turn',
    statusCode: 200,
  })),
  upsertSessionRuntimeThreadMock: vi.fn(),
}));

vi.mock('../db.js', () => {
  return {
    WORKSPACE_ROOT: '/home/await/project/OpenAWork',
    WORKSPACE_ACCESS_RESTRICTED: false,
    WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
    redis: {
      del: vi.fn(async () => 0),
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
    },
    sqliteAll: vi.fn(() => []),
    sqliteGet: () => undefined,
    sqliteRun: () => undefined,
  };
});

vi.mock('../tool-sandbox.js', () => ({
  createDefaultSandbox: () => ({
    execute: executeMock,
  }),
  reconcileResumedTaskChildSession: reconcileMock,
}));

vi.mock('../session-message-store.js', () => ({
  appendSessionMessage: appendSessionMessageMock,
  listSessionMessagesByRequestScope: vi.fn(() => []),
  truncateSessionMessagesAfter: vi.fn(),
}));

vi.mock('../session-run-events.js', () => ({
  persistSessionRunEventForRequest: persistRunEventMock,
  subscribeSessionRunEvents: vi.fn(() => () => undefined),
}));

vi.mock('../session-file-diff-store.js', () => ({
  persistSessionFileDiffs: persistFileDiffsMock,
}));

vi.mock('../usage-records-store.js', () => ({
  persistMonthlyUsageRecord: persistMonthlyUsageRecordMock,
}));

vi.mock('../routes/stream-cancellation.js', () => ({
  clearInFlightStreamRequest: clearInFlightStreamRequestMock,
  getAnyInFlightStreamRequestForSession: getAnyInFlightStreamRequestForSessionMock,
  registerInFlightStreamRequest: registerInFlightStreamRequestMock,
}));

vi.mock('../session-runtime-thread-store.js', () => ({
  clearSessionRuntimeThread: clearSessionRuntimeThreadMock,
  SESSION_RUNTIME_THREAD_HEARTBEAT_MS: 5_000,
  touchSessionRuntimeThread: vi.fn(),
  upsertSessionRuntimeThread: upsertSessionRuntimeThreadMock,
}));

vi.mock('../routes/capabilities.js', () => ({
  buildCapabilityContext: vi.fn(() => ''),
}));

vi.mock('../routes/stream-system-prompts.js', () => ({
  buildRequestScopedSystemPrompts: vi.fn(() => []),
}));

vi.mock('../routes/stream.js', () => ({
  buildWorkspaceContext: vi.fn(async () => null),
  buildStreamToolObservability: vi.fn((input: { presentedToolName: string }) => ({
    presentedToolName: input.presentedToolName,
    canonicalToolName: input.presentedToolName === 'Agent' ? 'call_omo_agent' : 'bash',
    toolSurfaceProfile: 'openawork',
    adapterVersion: '1.0.0',
  })),
  createRunEventMeta: vi.fn(() => ({ eventId: 'evt-1', runId: 'run-1', occurredAt: 1 })),
  createStreamExecutionContext: vi.fn((clientRequestId, nextRound, requestData) => ({
    clientRequestId,
    nextRound,
    requestData,
  })),
  createTaskRuntimeGuardContext: vi.fn(() => ({
    lastToolSignature: null,
    maxConsecutiveRepeatedToolCalls: 0,
    repeatedToolSignatureCount: 0,
  })),
  createToolResultRequestId: vi.fn(() => 'tool-result-request-1'),
  executeToolCalls: vi.fn(),
  getEnabledTools: vi.fn(() => []),
  handleStreamRequest: vi.fn(),
  isWebSearchEnabled: vi.fn(() => false),
  loadSessionContext: vi.fn(() => ({ legacyMessagesJson: '[]', metadataJson: '{}' })),
  loadSessionUser: vi.fn(() => ({ email: 'user-1@example.com' })),
  resolveStreamRequestUpstreamRetry: resolveStreamRequestUpstreamRetryMock,
  resolveStreamModelRoute: resolveStreamModelRouteMock,
  setPersistedSessionStateStatus: vi.fn(),
  streamRequestSchema: {
    parse: (value: unknown) => value,
  },
}));

vi.mock('../routes/stream-model-round.js', () => ({
  runModelRound: runModelRoundMock,
}));

describe('resume reconcile fallback', () => {
  beforeEach(() => {
    appendSessionMessageMock.mockReset();
    appendSessionMessageMock.mockReturnValue({ id: 'msg-1' });
    clearInFlightStreamRequestMock.mockReset();
    clearSessionRuntimeThreadMock.mockReset();
    executeMock.mockReset();
    getAnyInFlightStreamRequestForSessionMock.mockReset();
    getAnyInFlightStreamRequestForSessionMock.mockReturnValue(undefined);
    persistFileDiffsMock.mockReset();
    persistMonthlyUsageRecordMock.mockReset();
    persistRunEventMock.mockReset();
    registerInFlightStreamRequestMock.mockReset();
    reconcileMock.mockReset();
    resolveStreamModelRouteMock.mockReset();
    resolveStreamModelRouteMock.mockResolvedValue({
      inputPricePerMillion: 0.25,
      outputPricePerMillion: 1,
    });
    resolveStreamRequestUpstreamRetryMock.mockClear();
    runModelRoundMock.mockReset();
    runModelRoundMock.mockResolvedValue({
      shouldStop: true,
      stopReason: 'end_turn',
      statusCode: 200,
    });
    upsertSessionRuntimeThreadMock.mockReset();
  });

  it('reconciles the parent task when approved permission execution throws before resume continuation', async () => {
    executeMock.mockRejectedValue(new Error('resume execute failed'));
    reconcileMock.mockResolvedValue(undefined);

    const { resumeApprovedPermissionRequest } = await import('../routes/stream-runtime.js');

    await expect(
      resumeApprovedPermissionRequest({
        payload: {
          clientRequestId: 'resume-client-1',
          nextRound: 2,
          rawInput: { command: 'pwd' },
          requestData: { clientRequestId: 'resume-client-1', message: 'resume child task' },
          toolCallId: 'tool-call-1',
          toolName: 'bash',
        },
        sessionId: 'child-session-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('resume execute failed');

    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock).toHaveBeenCalledWith({
      childSessionId: 'child-session-1',
      pendingInteraction: false,
      statusCode: 500,
      userId: 'user-1',
    });
  });

  it('preserves observability when resuming an approved tool result', async () => {
    executeMock.mockResolvedValue({
      toolCallId: 'tool-call-1',
      toolName: 'Agent',
      output: { ok: true },
      isError: false,
      durationMs: 1,
    });
    reconcileMock.mockResolvedValue(undefined);

    const { resumeApprovedPermissionRequest } = await import('../routes/stream-runtime.js');

    await resumeApprovedPermissionRequest({
      payload: {
        clientRequestId: 'resume-client-2',
        nextRound: 2,
        rawInput: { description: 'delegate' },
        requestData: {
          clientRequestId: 'resume-client-2',
          message: 'resume child task',
          upstreamRetryMaxRetries: 2,
        },
        toolCallId: 'tool-call-1',
        toolName: 'Agent',
        observability: {
          presentedToolName: 'Agent',
          canonicalToolName: 'call_omo_agent',
          toolSurfaceProfile: 'claude_code_default',
          adapterVersion: '1.0.0',
        },
      },
      sessionId: 'child-session-2',
      userId: 'user-1',
    });

    expect(appendSessionMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            type: 'tool_result',
            toolName: 'Agent',
            resumedAfterApproval: true,
            observability: {
              presentedToolName: 'Agent',
              canonicalToolName: 'call_omo_agent',
              toolSurfaceProfile: 'claude_code_default',
              adapterVersion: '1.0.0',
            },
          }),
        ],
      }),
    );
    expect(persistRunEventMock).toHaveBeenCalledWith(
      'child-session-2',
      expect.objectContaining({
        type: 'tool_result',
        toolName: 'Agent',
        resumedAfterApproval: true,
        observability: {
          presentedToolName: 'Agent',
          canonicalToolName: 'call_omo_agent',
          toolSurfaceProfile: 'claude_code_default',
          adapterVersion: '1.0.0',
        },
      }),
      { clientRequestId: 'resume-client-2' },
    );
    expect(resolveStreamRequestUpstreamRetryMock).toHaveBeenCalledWith({
      metadataJson: '{}',
      requestData: {
        clientRequestId: 'resume-client-2',
        message: 'resume child task',
        upstreamRetryMaxRetries: 2,
      },
      userId: 'user-1',
    });
  });

  it('does not mark answered question resumes as approval resumes', async () => {
    const { resumeAnsweredQuestionRequest } = await import('../routes/stream-runtime.js');

    await resumeAnsweredQuestionRequest({
      payload: {
        clientRequestId: 'resume-question-1',
        nextRound: 2,
        rawInput: { header: '执行策略' },
        requestData: {
          clientRequestId: 'resume-question-1',
          message: 'resume answered question',
        },
        toolCallId: 'tool-call-question-1',
        toolName: 'question',
      },
      answerOutput: '已选择 workspace',
      sessionId: 'question-session-1',
      userId: 'user-1',
    });

    expect(appendSessionMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [
          expect.not.objectContaining({
            resumedAfterApproval: true,
          }),
        ],
      }),
    );
    expect(persistRunEventMock).toHaveBeenCalledWith(
      'question-session-1',
      expect.not.objectContaining({
        resumedAfterApproval: true,
      }),
      { clientRequestId: 'resume-question-1' },
    );
  });

  it('persists a usage run event when resume rounds report exact token usage', async () => {
    executeMock.mockResolvedValue({
      toolCallId: 'tool-call-usage',
      toolName: 'bash',
      output: { ok: true },
      isError: false,
      durationMs: 1,
    });
    runModelRoundMock.mockResolvedValue({
      shouldStop: true,
      stopReason: 'end_turn',
      statusCode: 200,
      usage: {
        inputTokens: 60_000,
        outputTokens: 3_000,
        totalTokens: 63_000,
      },
      usageOccurredAt: 123,
    });

    const { resumeApprovedPermissionRequest } = await import('../routes/stream-runtime.js');

    await resumeApprovedPermissionRequest({
      payload: {
        clientRequestId: 'resume-client-usage',
        nextRound: 2,
        rawInput: { command: 'pwd' },
        requestData: { clientRequestId: 'resume-client-usage', message: 'resume usage task' },
        toolCallId: 'tool-call-usage',
        toolName: 'bash',
      },
      sessionId: 'child-session-usage',
      userId: 'user-1',
    });

    expect(persistRunEventMock).toHaveBeenCalledWith(
      'child-session-usage',
      expect.objectContaining({
        type: 'usage',
        inputTokens: 60_000,
        outputTokens: 3_000,
        totalTokens: 63_000,
        round: 2,
      }),
      { clientRequestId: 'resume-client-usage' },
    );
    expect(persistMonthlyUsageRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        occurredAt: 123,
        usage: {
          inputTokens: 60_000,
          outputTokens: 3_000,
          totalTokens: 63_000,
        },
        userId: 'user-1',
      }),
    );
  });

  it('backfills observability and durable diff defaults when payload metadata is missing', async () => {
    executeMock.mockResolvedValue({
      toolCallId: 'tool-call-2',
      toolName: 'Agent',
      output: {
        filediff: {
          file: '/repo/example.ts',
          before: 'const before = true;',
          after: 'const after = true;',
        },
      },
      isError: false,
      durationMs: 1,
    });
    reconcileMock.mockResolvedValue(undefined);

    const { resumeApprovedPermissionRequest } = await import('../routes/stream-runtime.js');

    await resumeApprovedPermissionRequest({
      payload: {
        clientRequestId: 'resume-client-3',
        nextRound: 2,
        rawInput: { description: 'delegate' },
        requestData: {
          clientRequestId: 'resume-client-3',
          message: 'resume child task',
          upstreamRetryMaxRetries: 1,
        },
        toolCallId: 'tool-call-2',
        toolName: 'Agent',
      },
      sessionId: 'child-session-3',
      userId: 'user-1',
    });

    expect(appendSessionMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            type: 'tool_result',
            toolName: 'Agent',
            observability: {
              presentedToolName: 'Agent',
              canonicalToolName: 'call_omo_agent',
              toolSurfaceProfile: 'openawork',
              adapterVersion: '1.0.0',
            },
            fileDiffs: [
              expect.objectContaining({
                file: '/repo/example.ts',
                clientRequestId: 'resume-client-3',
                requestId: 'tool-result-request-1',
                toolCallId: 'tool-call-2',
                toolName: 'Agent',
                sourceKind: 'structured_tool_diff',
                guaranteeLevel: 'medium',
                observability: {
                  presentedToolName: 'Agent',
                  canonicalToolName: 'call_omo_agent',
                  toolSurfaceProfile: 'openawork',
                  adapterVersion: '1.0.0',
                },
              }),
            ],
          }),
        ],
      }),
    );
    expect(persistRunEventMock).toHaveBeenCalledWith(
      'child-session-3',
      expect.objectContaining({
        type: 'tool_result',
        toolName: 'Agent',
        observability: {
          presentedToolName: 'Agent',
          canonicalToolName: 'call_omo_agent',
          toolSurfaceProfile: 'openawork',
          adapterVersion: '1.0.0',
        },
        fileDiffs: [
          expect.objectContaining({
            sourceKind: 'structured_tool_diff',
            guaranteeLevel: 'medium',
          }),
        ],
      }),
      { clientRequestId: 'resume-client-3' },
    );
    expect(persistFileDiffsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'child-session-3',
        userId: 'user-1',
        clientRequestId: 'resume-client-3',
        requestId: 'tool-result-request-1',
        toolName: 'Agent',
        toolCallId: 'tool-call-2',
        diffs: [
          expect.objectContaining({
            file: '/repo/example.ts',
            sourceKind: 'structured_tool_diff',
            guaranteeLevel: 'medium',
            requestId: 'tool-result-request-1',
          }),
        ],
      }),
    );
    expect(resolveStreamRequestUpstreamRetryMock).toHaveBeenCalledWith({
      metadataJson: '{}',
      requestData: {
        clientRequestId: 'resume-client-3',
        message: 'resume child task',
        upstreamRetryMaxRetries: 1,
      },
      userId: 'user-1',
    });
  });

  it('registers resume execution as active and clears runtime markers after completion', async () => {
    executeMock.mockResolvedValue({
      toolCallId: 'tool-call-4',
      toolName: 'bash',
      output: { ok: true },
      isError: false,
      durationMs: 1,
    });
    reconcileMock.mockResolvedValue(undefined);

    const { resumeApprovedPermissionRequest } = await import('../routes/stream-runtime.js');

    await resumeApprovedPermissionRequest({
      payload: {
        clientRequestId: 'resume-client-4',
        nextRound: 2,
        rawInput: { command: 'pwd' },
        requestData: {
          clientRequestId: 'resume-client-4',
          message: 'resume child task',
          upstreamRetryMaxRetries: 1,
        },
        toolCallId: 'tool-call-4',
        toolName: 'bash',
      },
      sessionId: 'child-session-4',
      userId: 'user-1',
    });

    expect(registerInFlightStreamRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: 'resume-client-4',
        sessionId: 'child-session-4',
        userId: 'user-1',
        abortController: expect.any(AbortController),
        execution: expect.any(Promise),
      }),
    );
    expect(upsertSessionRuntimeThreadMock).toHaveBeenCalledWith({
      clientRequestId: 'resume-client-4',
      heartbeatAtMs: expect.any(Number),
      sessionId: 'child-session-4',
      startedAtMs: expect.any(Number),
      userId: 'user-1',
    });
    expect(clearSessionRuntimeThreadMock).toHaveBeenCalledWith({
      clientRequestId: 'resume-client-4',
      sessionId: 'child-session-4',
      userId: 'user-1',
    });
    expect(clearInFlightStreamRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientRequestId: 'resume-client-4',
        sessionId: 'child-session-4',
        execution: expect.any(Promise),
      }),
    );
  });
});
