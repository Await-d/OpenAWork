import { beforeEach, describe, expect, it, vi } from 'vitest';

const { appendSessionMessageMock, executeMock, persistRunEventMock, reconcileMock } = vi.hoisted(
  () => ({
    appendSessionMessageMock: vi.fn(() => ({ id: 'msg-1' })),
    executeMock: vi.fn(),
    persistRunEventMock: vi.fn(),
    reconcileMock: vi.fn(),
  }),
);

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
  truncateSessionMessagesAfter: vi.fn(),
}));

vi.mock('../session-run-events.js', () => ({
  persistSessionRunEventForRequest: persistRunEventMock,
  subscribeSessionRunEvents: vi.fn(() => () => undefined),
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
  resolveStreamModelRoute: vi.fn(),
  setPersistedSessionStateStatus: vi.fn(),
  streamRequestSchema: {
    parse: (value: unknown) => value,
  },
}));

vi.mock('../routes/stream-model-round.js', () => ({
  runModelRound: vi.fn(async () => ({ shouldStop: true, stopReason: 'end_turn', statusCode: 200 })),
}));

describe('resume reconcile fallback', () => {
  beforeEach(() => {
    appendSessionMessageMock.mockReset();
    appendSessionMessageMock.mockReturnValue({ id: 'msg-1' });
    executeMock.mockReset();
    persistRunEventMock.mockReset();
    reconcileMock.mockReset();
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
        requestData: { clientRequestId: 'resume-client-2', message: 'resume child task' },
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
        observability: {
          presentedToolName: 'Agent',
          canonicalToolName: 'call_omo_agent',
          toolSurfaceProfile: 'claude_code_default',
          adapterVersion: '1.0.0',
        },
      }),
      { clientRequestId: 'resume-client-2' },
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
        requestData: { clientRequestId: 'resume-client-3', message: 'resume child task' },
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
  });
});
