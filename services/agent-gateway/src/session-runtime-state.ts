import { sqliteGet, sqliteRun } from './db.js';
import { getAnyInFlightStreamRequestForSession } from './routes/stream-cancellation.js';
import {
  clearSessionRuntimeThread,
  hasFreshSessionRuntimeThread,
} from './session-runtime-thread-store.js';

export type PersistedSessionStateStatus = 'idle' | 'paused' | 'running';

interface CountRow {
  count: number;
}

interface SessionStateRow {
  state_status: string;
}

export interface SessionRuntimeReconciliationResult {
  previousStatus: PersistedSessionStateStatus | null;
  status: PersistedSessionStateStatus | null;
  wasReset: boolean;
}

function normalizePersistedSessionStateStatus(value: string): PersistedSessionStateStatus {
  if (value === 'running' || value === 'paused') {
    return value;
  }

  return 'idle';
}

function countPendingSessionRecords(
  table: 'permission_requests' | 'question_requests',
  sessionId: string,
): number {
  return (
    sqliteGet<CountRow>(
      `SELECT COUNT(1) AS count FROM ${table} WHERE session_id = ? AND status = 'pending'`,
      [sessionId],
    )?.count ?? 0
  );
}

export function hasPendingSessionInteraction(sessionId: string): boolean {
  return (
    countPendingSessionRecords('permission_requests', sessionId) > 0 ||
    countPendingSessionRecords('question_requests', sessionId) > 0
  );
}

export function reconcileSessionStateStatus(input: {
  nowMs?: number;
  sessionId: string;
  userId: string;
}): SessionRuntimeReconciliationResult {
  const row = sqliteGet<SessionStateRow>(
    'SELECT state_status FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.sessionId, input.userId],
  );
  if (!row) {
    return {
      previousStatus: null,
      status: null,
      wasReset: false,
    };
  }

  const previousStatus = normalizePersistedSessionStateStatus(row.state_status);

  if (getAnyInFlightStreamRequestForSession({ sessionId: input.sessionId, userId: input.userId })) {
    return {
      previousStatus,
      status: previousStatus,
      wasReset: false,
    };
  }

  if (
    hasFreshSessionRuntimeThread({
      nowMs: input.nowMs,
      sessionId: input.sessionId,
      userId: input.userId,
    })
  ) {
    return {
      previousStatus,
      status: previousStatus,
      wasReset: false,
    };
  }

  if (hasPendingSessionInteraction(input.sessionId)) {
    clearSessionRuntimeThread({ sessionId: input.sessionId, userId: input.userId });
    if (previousStatus !== 'paused') {
      sqliteRun(
        "UPDATE sessions SET state_status = 'paused', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        [input.sessionId, input.userId],
      );
    }

    return {
      previousStatus,
      status: 'paused',
      wasReset: false,
    };
  }

  if (previousStatus === 'idle') {
    clearSessionRuntimeThread({ sessionId: input.sessionId, userId: input.userId });
    return {
      previousStatus,
      status: previousStatus,
      wasReset: false,
    };
  }

  clearSessionRuntimeThread({ sessionId: input.sessionId, userId: input.userId });
  sqliteRun(
    "UPDATE sessions SET state_status = 'idle', updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [input.sessionId, input.userId],
  );
  return {
    previousStatus,
    status: 'idle',
    wasReset: true,
  };
}
