import type { RunEvent, SessionContextRecord } from '@openAwork/shared';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { getAnyInFlightStreamRequestForSession } from '../routes/stream-cancellation.js';
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

const DECIDING_INTERACTION_TIMEOUT_SQL = "datetime('now', '-10 minutes')";

export interface SessionRuntimeReconciliationResult {
  previousStatus: PersistedSessionStateStatus | null;
  sessionContext: SessionContextRecord | null;
  status: PersistedSessionStateStatus | null;
  wasReset: boolean;
}

export type SessionInteractionRunEvent = Extract<
  RunEvent,
  {
    type: 'permission_asked' | 'permission_replied' | 'question_asked' | 'question_replied';
  }
>;

export function resolveSessionInteractionStateUpdate(event: SessionInteractionRunEvent): {
  shouldKeepPausedState: boolean;
  status: PersistedSessionStateStatus;
} {
  switch (event.type) {
    case 'permission_asked':
    case 'question_asked': {
      return {
        shouldKeepPausedState: true,
        status: 'paused',
      };
    }
    case 'permission_replied': {
      return {
        shouldKeepPausedState: false,
        status: event.decision === 'reject' ? 'idle' : 'running',
      };
    }
    case 'question_replied': {
      return {
        shouldKeepPausedState: false,
        status: event.status === 'dismissed' ? 'idle' : 'running',
      };
    }
  }
}

export function toSessionContextStatus(
  status: PersistedSessionStateStatus | null,
): SessionContextRecord['status'] {
  if (status === 'running') {
    return 'busy';
  }
  if (status === 'paused') {
    return 'paused';
  }
  return 'idle';
}

export function buildSessionContextRecord(input: {
  clientSurface?: string;
  currentRunId?: string;
  parentSessionId?: string;
  planRef?: string;
  revision?: number;
  rootSessionId?: string;
  sessionId: string;
  status: PersistedSessionStateStatus | null;
  updatedAt?: number;
}): SessionContextRecord {
  return {
    sessionId: input.sessionId,
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.rootSessionId ? { rootSessionId: input.rootSessionId } : {}),
    status: toSessionContextStatus(input.status),
    ...(input.currentRunId ? { currentRunId: input.currentRunId } : {}),
    ...(input.planRef ? { planRef: input.planRef } : {}),
    ...(input.clientSurface ? { clientSurface: input.clientSurface } : {}),
    revision: input.revision ?? 0,
    updatedAt: input.updatedAt ?? Date.now(),
  };
}

function normalizePersistedSessionStateStatus(value: string): PersistedSessionStateStatus {
  if (value === 'running' || value === 'paused') {
    return value;
  }

  return 'idle';
}

function releaseStaleDecidingSessionRecords(sessionId: string): void {
  for (const table of ['permission_requests', 'question_requests'] as const) {
    sqliteRun(
      `UPDATE ${table}
       SET status = 'pending', updated_at = datetime('now')
       WHERE session_id = ? AND status = 'deciding' AND updated_at < ${DECIDING_INTERACTION_TIMEOUT_SQL}`,
      [sessionId],
    );
  }
}

function countPendingSessionRecords(
  table: 'permission_requests' | 'question_requests',
  sessionId: string,
): number {
  return (
    sqliteGet<CountRow>(
      `SELECT COUNT(1) AS count FROM ${table} WHERE session_id = ? AND status IN ('pending', 'deciding')`,
      [sessionId],
    )?.count ?? 0
  );
}

export function hasPendingSessionInteraction(sessionId: string): boolean {
  releaseStaleDecidingSessionRecords(sessionId);
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
      sessionContext: null,
      status: null,
      wasReset: false,
    };
  }

  const previousStatus = normalizePersistedSessionStateStatus(row.state_status);

  if (getAnyInFlightStreamRequestForSession({ sessionId: input.sessionId, userId: input.userId })) {
    return {
      previousStatus,
      sessionContext: buildSessionContextRecord({
        sessionId: input.sessionId,
        status: previousStatus,
      }),
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
      sessionContext: buildSessionContextRecord({
        sessionId: input.sessionId,
        status: previousStatus,
      }),
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
      sessionContext: buildSessionContextRecord({ sessionId: input.sessionId, status: 'paused' }),
      status: 'paused',
      wasReset: false,
    };
  }

  if (previousStatus === 'idle') {
    clearSessionRuntimeThread({ sessionId: input.sessionId, userId: input.userId });
    return {
      previousStatus,
      sessionContext: buildSessionContextRecord({
        sessionId: input.sessionId,
        status: previousStatus,
      }),
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
    sessionContext: buildSessionContextRecord({ sessionId: input.sessionId, status: 'idle' }),
    status: 'idle',
    wasReset: true,
  };
}
