import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  clearSessionRuntimeThreadMock: vi.fn(),
  getAnyInFlightStreamRequestForSessionMock: vi.fn(),
  hasFreshSessionRuntimeThreadMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocked.sqliteGetMock,
  sqliteRun: mocked.sqliteRunMock,
}));

vi.mock('../routes/stream-cancellation.js', () => ({
  getAnyInFlightStreamRequestForSession: mocked.getAnyInFlightStreamRequestForSessionMock,
}));

vi.mock('../session-runtime-thread-store.js', () => ({
  clearSessionRuntimeThread: mocked.clearSessionRuntimeThreadMock,
  hasFreshSessionRuntimeThread: mocked.hasFreshSessionRuntimeThreadMock,
}));

import {
  hasPendingSessionInteraction,
  reconcileSessionStateStatus,
  resolveSessionInteractionStateUpdate,
} from '../session-runtime-state.js';

describe('session-runtime-state', () => {
  beforeEach(() => {
    mocked.clearSessionRuntimeThreadMock.mockReset();
    mocked.getAnyInFlightStreamRequestForSessionMock.mockReset();
    mocked.hasFreshSessionRuntimeThreadMock.mockReset();
    mocked.sqliteGetMock.mockReset();
    mocked.sqliteRunMock.mockReset();
  });

  it('resets stale running sessions to idle', () => {
    mocked.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM sessions')) {
        return { state_status: 'running' };
      }
      if (query.includes('FROM permission_requests')) {
        return { count: 0 };
      }
      if (query.includes('FROM question_requests')) {
        return { count: 0 };
      }
      return undefined;
    });
    mocked.getAnyInFlightStreamRequestForSessionMock.mockReturnValue(undefined);
    mocked.hasFreshSessionRuntimeThreadMock.mockReturnValue(false);

    const result = reconcileSessionStateStatus({ sessionId: 'ses-stale', userId: 'user-1' });

    expect(result).toMatchObject({
      previousStatus: 'running',
      sessionContext: {
        sessionId: 'ses-stale',
        status: 'idle',
        revision: 0,
      },
      status: 'idle',
      wasReset: true,
    });
    expect(result.sessionContext?.updatedAt).toEqual(expect.any(Number));
    expect(mocked.clearSessionRuntimeThreadMock).toHaveBeenCalledWith({
      sessionId: 'ses-stale',
      userId: 'user-1',
    });
    expect(mocked.sqliteRunMock).toHaveBeenCalledWith(
      "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      ['ses-stale', 'user-1'],
    );
  });

  it('keeps paused sessions with pending interactions paused', () => {
    mocked.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM sessions')) {
        return { state_status: 'paused' };
      }
      if (query.includes('FROM permission_requests')) {
        return { count: 1 };
      }
      if (query.includes('FROM question_requests')) {
        return { count: 0 };
      }
      return undefined;
    });
    mocked.getAnyInFlightStreamRequestForSessionMock.mockReturnValue(undefined);
    mocked.hasFreshSessionRuntimeThreadMock.mockReturnValue(false);

    const result = reconcileSessionStateStatus({ sessionId: 'ses-paused', userId: 'user-1' });

    expect(result).toMatchObject({
      previousStatus: 'paused',
      sessionContext: {
        sessionId: 'ses-paused',
        status: 'paused',
        revision: 0,
      },
      status: 'paused',
      wasReset: false,
    });
    expect(result.sessionContext?.updatedAt).toEqual(expect.any(Number));
    expect(mocked.sqliteRunMock).not.toHaveBeenCalled();
  });

  it('resets paused sessions without pending interactions back to idle', () => {
    mocked.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM sessions')) {
        return { state_status: 'paused' };
      }
      if (query.includes('FROM permission_requests')) {
        return { count: 0 };
      }
      if (query.includes('FROM question_requests')) {
        return { count: 0 };
      }
      return undefined;
    });
    mocked.getAnyInFlightStreamRequestForSessionMock.mockReturnValue(undefined);
    mocked.hasFreshSessionRuntimeThreadMock.mockReturnValue(false);

    const result = reconcileSessionStateStatus({ sessionId: 'ses-paused-stale', userId: 'user-1' });

    expect(result).toMatchObject({
      previousStatus: 'paused',
      sessionContext: {
        sessionId: 'ses-paused-stale',
        status: 'idle',
        revision: 0,
      },
      status: 'idle',
      wasReset: true,
    });
    expect(result.sessionContext?.updatedAt).toEqual(expect.any(Number));
    expect(mocked.clearSessionRuntimeThreadMock).toHaveBeenCalledWith({
      sessionId: 'ses-paused-stale',
      userId: 'user-1',
    });
    expect(mocked.sqliteRunMock).toHaveBeenCalledWith(
      "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      ['ses-paused-stale', 'user-1'],
    );
  });

  it('promotes running sessions with pending questions to paused', () => {
    mocked.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM sessions')) {
        return { state_status: 'running' };
      }
      if (query.includes('FROM permission_requests')) {
        return { count: 0 };
      }
      if (query.includes('FROM question_requests')) {
        return { count: 1 };
      }
      return undefined;
    });
    mocked.getAnyInFlightStreamRequestForSessionMock.mockReturnValue(undefined);
    mocked.hasFreshSessionRuntimeThreadMock.mockReturnValue(false);

    const result = reconcileSessionStateStatus({ sessionId: 'ses-question', userId: 'user-1' });

    expect(result).toMatchObject({
      previousStatus: 'running',
      sessionContext: {
        sessionId: 'ses-question',
        status: 'paused',
        revision: 0,
      },
      status: 'paused',
      wasReset: false,
    });
    expect(result.sessionContext?.updatedAt).toEqual(expect.any(Number));
    expect(mocked.sqliteRunMock).toHaveBeenCalledWith(
      "UPDATE sessions SET state_status = 'paused', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      ['ses-question', 'user-1'],
    );
  });

  it('promotes running sessions with pending permissions to paused', () => {
    mocked.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM sessions')) {
        return { state_status: 'running' };
      }
      if (query.includes('FROM permission_requests')) {
        return { count: 1 };
      }
      if (query.includes('FROM question_requests')) {
        return { count: 0 };
      }
      return undefined;
    });
    mocked.getAnyInFlightStreamRequestForSessionMock.mockReturnValue(undefined);
    mocked.hasFreshSessionRuntimeThreadMock.mockReturnValue(false);

    const result = reconcileSessionStateStatus({ sessionId: 'ses-permission', userId: 'user-1' });

    expect(result).toMatchObject({
      previousStatus: 'running',
      sessionContext: {
        sessionId: 'ses-permission',
        status: 'paused',
        revision: 0,
      },
      status: 'paused',
      wasReset: false,
    });
    expect(result.sessionContext?.updatedAt).toEqual(expect.any(Number));
    expect(mocked.sqliteRunMock).toHaveBeenCalledWith(
      "UPDATE sessions SET state_status = 'paused', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      ['ses-permission', 'user-1'],
    );
  });

  it('treats pending ExitPlanMode approval questions as pending session interaction', () => {
    mocked.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM permission_requests')) {
        return { count: 0 };
      }
      if (query.includes('FROM question_requests')) {
        return { count: 1 };
      }
      return undefined;
    });

    expect(hasPendingSessionInteraction('ses-plan-mode')).toBe(true);
  });

  it('keeps sessions running when a fresh runtime thread heartbeat exists', () => {
    mocked.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('FROM sessions')) {
        return { state_status: 'running' };
      }
      return undefined;
    });
    mocked.getAnyInFlightStreamRequestForSessionMock.mockReturnValue(undefined);
    mocked.hasFreshSessionRuntimeThreadMock.mockReturnValue(true);

    const result = reconcileSessionStateStatus({ sessionId: 'ses-live', userId: 'user-1' });

    expect(result).toMatchObject({
      previousStatus: 'running',
      sessionContext: {
        sessionId: 'ses-live',
        status: 'busy',
        revision: 0,
      },
      status: 'running',
      wasReset: false,
    });
    expect(result.sessionContext?.updatedAt).toEqual(expect.any(Number));
    expect(mocked.sqliteRunMock).not.toHaveBeenCalled();
  });

  it('resolves rejected permission replies back to idle instead of staying paused', () => {
    expect(
      resolveSessionInteractionStateUpdate({
        type: 'permission_replied',
        requestId: 'perm-1',
        decision: 'reject',
        eventId: 'evt-1',
        runId: 'run-1',
        occurredAt: 1,
      }),
    ).toEqual({
      shouldKeepPausedState: false,
      status: 'idle',
    });
  });

  it('resolves dismissed question replies back to idle instead of staying paused', () => {
    expect(
      resolveSessionInteractionStateUpdate({
        type: 'question_replied',
        requestId: 'question-1',
        status: 'dismissed',
        eventId: 'evt-2',
        runId: 'run-2',
        occurredAt: 2,
      }),
    ).toEqual({
      shouldKeepPausedState: false,
      status: 'idle',
    });
  });
});
