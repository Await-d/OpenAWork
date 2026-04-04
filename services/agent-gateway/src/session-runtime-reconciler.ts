import { sqliteAll } from './db.js';
import {
  reconcileSessionStateStatus,
  type SessionRuntimeReconciliationResult,
} from './session-runtime-state.js';
import {
  reconcileResumedTaskChildSession,
  reconcileTimedOutTaskChildSessionIfExpired,
} from './tool-sandbox.js';

interface SessionRuntimeCandidateRow {
  id: string;
  user_id: string;
}

export interface SessionRuntimeBatchReconciliationResult {
  candidateCount: number;
  failedSessionIds: string[];
  pausedCount: number;
  resetCount: number;
}

export async function reconcileSessionRuntime(input: {
  nowMs?: number;
  sessionId: string;
  userId: string;
}): Promise<SessionRuntimeReconciliationResult> {
  const reconciliation = reconcileSessionStateStatus(input);
  if (reconciliation.wasReset) {
    const reconciledAsTimeout = await reconcileTimedOutTaskChildSessionIfExpired({
      childSessionId: input.sessionId,
      nowMs: input.nowMs,
      userId: input.userId,
    });
    if (!reconciledAsTimeout) {
      await reconcileResumedTaskChildSession({
        childSessionId: input.sessionId,
        pendingInteraction: false,
        statusCode: 500,
        userId: input.userId,
      });
    }
  }

  return reconciliation;
}

export async function reconcileAllSessionRuntimes(): Promise<SessionRuntimeBatchReconciliationResult> {
  const candidates = sqliteAll<SessionRuntimeCandidateRow>(
    `SELECT DISTINCT s.id, s.user_id
     FROM sessions s
     LEFT JOIN session_runtime_threads threads ON threads.session_id = s.id
     LEFT JOIN permission_requests permissions ON permissions.session_id = s.id AND permissions.status = 'pending'
     LEFT JOIN question_requests questions ON questions.session_id = s.id AND questions.status = 'pending'
     WHERE s.state_status != 'idle'
        OR threads.session_id IS NOT NULL
        OR permissions.id IS NOT NULL
        OR questions.id IS NOT NULL`,
  );

  let pausedCount = 0;
  let resetCount = 0;
  const failedSessionIds: string[] = [];

  for (const candidate of candidates) {
    try {
      const reconciliation = await reconcileSessionRuntime({
        sessionId: candidate.id,
        userId: candidate.user_id,
      });
      if (reconciliation.wasReset) {
        resetCount += 1;
        continue;
      }
      if (reconciliation.status === 'paused' && reconciliation.previousStatus !== 'paused') {
        pausedCount += 1;
      }
    } catch {
      failedSessionIds.push(candidate.id);
    }
  }

  return {
    candidateCount: candidates.length,
    failedSessionIds,
    pausedCount,
    resetCount,
  };
}
