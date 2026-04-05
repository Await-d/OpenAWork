import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  expirePendingPermissionRequestsMock: vi.fn(),
  expirePendingQuestionRequestsMock: vi.fn(),
  reconcileResumedTaskChildSessionMock: vi.fn(),
  reconcileTimedOutTaskChildSessionIfExpiredMock: vi.fn(),
  reconcileSessionStateStatusMock: vi.fn(),
  terminateTaskChildSessionAsTimeoutMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  WORKSPACE_ACCESS_RESTRICTED: false,
  sqliteAll: mocked.sqliteAllMock,
}));

vi.mock('../routes/permissions.js', () => ({
  expirePendingPermissionRequests: mocked.expirePendingPermissionRequestsMock,
}));

vi.mock('../routes/questions.js', () => ({
  expirePendingQuestionRequests: mocked.expirePendingQuestionRequestsMock,
}));

vi.mock('../tool-sandbox.js', () => ({
  reconcileResumedTaskChildSession: mocked.reconcileResumedTaskChildSessionMock,
  reconcileTimedOutTaskChildSessionIfExpired: mocked.reconcileTimedOutTaskChildSessionIfExpiredMock,
  terminateTaskChildSessionAsTimeout: mocked.terminateTaskChildSessionAsTimeoutMock,
}));

vi.mock('../session-runtime-state.js', () => ({
  reconcileSessionStateStatus: mocked.reconcileSessionStateStatusMock,
}));

import {
  reconcileAllSessionRuntimes,
  reconcileSessionRuntime,
} from '../session-runtime-reconciler.js';

describe('session-runtime-reconciler', () => {
  beforeEach(() => {
    mocked.sqliteAllMock.mockReset();
    mocked.expirePendingPermissionRequestsMock.mockReset();
    mocked.expirePendingQuestionRequestsMock.mockReset();
    mocked.reconcileResumedTaskChildSessionMock.mockReset();
    mocked.reconcileTimedOutTaskChildSessionIfExpiredMock.mockReset();
    mocked.reconcileSessionStateStatusMock.mockReset();
    mocked.terminateTaskChildSessionAsTimeoutMock.mockReset();
    mocked.expirePendingPermissionRequestsMock.mockReturnValue(0);
    mocked.expirePendingQuestionRequestsMock.mockReturnValue(0);
    mocked.reconcileTimedOutTaskChildSessionIfExpiredMock.mockResolvedValue(false);
    mocked.terminateTaskChildSessionAsTimeoutMock.mockResolvedValue(false);
  });

  it('reconciles parent task graph when a stale child session is reset', async () => {
    mocked.reconcileSessionStateStatusMock.mockReturnValue({
      previousStatus: 'running',
      status: 'idle',
      wasReset: true,
    });

    const result = await reconcileSessionRuntime({ sessionId: 'child-1', userId: 'user-1' });

    expect(result).toEqual({
      previousStatus: 'running',
      status: 'idle',
      wasReset: true,
    });
    expect(mocked.reconcileResumedTaskChildSessionMock).toHaveBeenCalledWith({
      childSessionId: 'child-1',
      pendingInteraction: false,
      statusCode: 500,
      userId: 'user-1',
    });
  });

  it('skips parent task reconciliation when no reset happens', async () => {
    mocked.reconcileSessionStateStatusMock.mockReturnValue({
      previousStatus: 'paused',
      status: 'paused',
      wasReset: false,
    });

    await reconcileSessionRuntime({ sessionId: 'child-1', userId: 'user-1' });

    expect(mocked.reconcileResumedTaskChildSessionMock).not.toHaveBeenCalled();
  });

  it('prefers timeout reconciliation when a stale child deadline is already expired', async () => {
    mocked.reconcileSessionStateStatusMock.mockReturnValue({
      previousStatus: 'running',
      status: 'idle',
      wasReset: true,
    });
    mocked.reconcileTimedOutTaskChildSessionIfExpiredMock.mockResolvedValue(true);

    const result = await reconcileSessionRuntime({
      nowMs: 123,
      sessionId: 'child-timeout-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      previousStatus: 'running',
      status: 'idle',
      wasReset: true,
    });
    expect(mocked.reconcileTimedOutTaskChildSessionIfExpiredMock).toHaveBeenCalledWith({
      childSessionId: 'child-timeout-1',
      nowMs: 123,
      userId: 'user-1',
    });
    expect(mocked.reconcileResumedTaskChildSessionMock).not.toHaveBeenCalled();
  });

  it('expires pending interactions before runtime reconciliation and terminates timed out child sessions', async () => {
    mocked.reconcileSessionStateStatusMock.mockReturnValue({
      previousStatus: 'paused',
      status: 'idle',
      wasReset: false,
    });
    mocked.expirePendingPermissionRequestsMock.mockReturnValue(1);

    await reconcileSessionRuntime({ nowMs: 456, sessionId: 'child-paused-1', userId: 'user-1' });

    expect(mocked.expirePendingPermissionRequestsMock).toHaveBeenCalledWith({
      nowMs: 456,
      sessionId: 'child-paused-1',
    });
    expect(mocked.expirePendingQuestionRequestsMock).toHaveBeenCalledWith({
      nowMs: 456,
      sessionId: 'child-paused-1',
    });
    expect(mocked.terminateTaskChildSessionAsTimeoutMock).toHaveBeenCalledWith({
      childSessionId: 'child-paused-1',
      userId: 'user-1',
    });
  });

  it('batch-reconciles startup candidates and tracks resets/pauses/failures', async () => {
    mocked.sqliteAllMock.mockReturnValue([
      { id: 'ses-reset', user_id: 'user-1' },
      { id: 'ses-paused', user_id: 'user-2' },
      { id: 'ses-fail', user_id: 'user-3' },
    ]);
    mocked.reconcileSessionStateStatusMock
      .mockReturnValueOnce({ previousStatus: 'running', status: 'idle', wasReset: true })
      .mockReturnValueOnce({ previousStatus: 'running', status: 'paused', wasReset: false })
      .mockImplementationOnce(() => {
        throw new Error('boom');
      });

    const result = await reconcileAllSessionRuntimes();

    expect(result).toEqual({
      candidateCount: 3,
      failedSessionIds: ['ses-fail'],
      pausedCount: 1,
      resetCount: 1,
    });
    expect(mocked.reconcileResumedTaskChildSessionMock).toHaveBeenCalledTimes(1);
    expect(mocked.reconcileResumedTaskChildSessionMock).toHaveBeenCalledWith({
      childSessionId: 'ses-reset',
      pendingInteraction: false,
      statusCode: 500,
      userId: 'user-1',
    });
  });
});
