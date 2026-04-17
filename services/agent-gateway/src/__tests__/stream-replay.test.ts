import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionMessageByRequestIdMock: vi.fn(),
  listSessionMessagesByRequestScopeMock: vi.fn(),
  listSessionPermissionRunEventsMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  redis: {
    del: vi.fn(async () => 0),
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
  },
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(() => undefined),
}));

vi.mock('../message-v2-adapter.js', () => ({
  getSessionMessageByRequestId: mocks.getSessionMessageByRequestIdMock,
  listSessionMessagesByRequestScope: mocks.listSessionMessagesByRequestScopeMock,
}));

vi.mock('../session-permission-events.js', () => ({
  listSessionPermissionRunEvents: mocks.listSessionPermissionRunEventsMock,
}));

describe('replayPersistedAssistantResponse', () => {
  beforeEach(() => {
    mocks.getSessionMessageByRequestIdMock.mockReset();
    mocks.listSessionMessagesByRequestScopeMock.mockReset();
    mocks.listSessionPermissionRunEventsMock.mockReset();
  });

  it('prefers durable tool_result.toolName during replay', async () => {
    mocks.getSessionMessageByRequestIdMock.mockReturnValue({
      status: 'final',
      message: { content: [{ type: 'text', text: 'done' }] },
    });
    mocks.listSessionMessagesByRequestScopeMock.mockReturnValue([
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'call-1',
            toolName: 'codesearch',
            clientRequestId: 'req-1',
            output: 'snippet',
            isError: false,
            fileDiffs: [
              {
                file: '/repo/example.ts',
                before: 'const a = 1;',
                after: 'const a = 2;',
                additions: 1,
                deletions: 1,
                status: 'modified',
                clientRequestId: 'req-1',
                toolCallId: 'call-1',
                toolName: 'codesearch',
              },
            ],
            observability: {
              presentedToolName: 'CodeSearch',
              canonicalToolName: 'codesearch',
            },
          },
        ],
      },
    ]);
    mocks.listSessionPermissionRunEventsMock.mockReturnValue([]);

    const { replayPersistedAssistantResponse } = await import('../routes/stream.js');
    const chunks: unknown[] = [];

    const replayed = replayPersistedAssistantResponse({
      clientRequestId: 'req-1',
      runId: 'run-1',
      sessionId: 'session-1',
      userId: 'user-1',
      writeChunk: (chunk) => chunks.push(chunk),
    });

    expect(replayed).toBe(true);
    expect(chunks[0]).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-1',
      toolName: 'codesearch',
      clientRequestId: 'req-1',
      output: 'snippet',
      isError: false,
      fileDiffs: [
        {
          file: '/repo/example.ts',
          before: 'const a = 1;',
          after: 'const a = 2;',
          additions: 1,
          deletions: 1,
          status: 'modified',
          clientRequestId: 'req-1',
          toolCallId: 'call-1',
          toolName: 'codesearch',
        },
      ],
      observability: {
        presentedToolName: 'CodeSearch',
        canonicalToolName: 'codesearch',
      },
    });
  });
});
