import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeMock, reconcileMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  reconcileMock: vi.fn(),
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

describe('resume reconcile fallback', () => {
  beforeEach(() => {
    executeMock.mockReset();
    reconcileMock.mockReset();
  });

  it('reconciles the parent task when approved permission execution throws before resume continuation', async () => {
    executeMock.mockRejectedValue(new Error('resume execute failed'));
    reconcileMock.mockResolvedValue(undefined);

    const { resumeApprovedPermissionRequest } = await import('../routes/stream.js');

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
});
