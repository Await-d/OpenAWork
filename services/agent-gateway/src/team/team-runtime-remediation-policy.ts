import { sqliteAll } from '../infra/db.js';
import {
  reconcileSessionRuntime,
} from '../session/session-runtime-reconciler.js';
import { SESSION_RUNTIME_THREAD_STALE_AFTER_MS } from '../session/session-runtime-thread-store.js';
import {
  listPm2HandoffsPendingQualityReview,
  listPm2HandoffsReadyForQualityReview,
  reconcilePm2QualityReview,
  type ReconcilePm2QualityReviewResult,
} from '../handoff/runner/pm2-quality-review-reconciler.js';
import {
  isRecoverableFailedHandoff,
  retryFailedHandoff,
} from '../handoff/store/handoff-store.js';

export const TEAM_RUNTIME_REMEDIATION_CODES = [
  'handoff-failure',
  'quality-review-pending',
  'stale-runtime-threads',
  'stale-decisions',
] as const;

export type TeamRuntimeRemediationCode = (typeof TEAM_RUNTIME_REMEDIATION_CODES)[number];

export interface TeamRuntimeRemediationResult {
  code: TeamRuntimeRemediationCode;
  completedCount?: number;
  failedSessionIds: string[];
  noopCount?: number;
  pausedCount: number;
  reclaimedCount?: number;
  resetCount: number;
  retryableErrorCount?: number;
  staleCandidateCount: number;
}

export function isTeamRuntimeRemediationCode(value: string): value is TeamRuntimeRemediationCode {
  return (TEAM_RUNTIME_REMEDIATION_CODES as readonly string[]).includes(value);
}

export function getTeamRuntimeRemediationSummary(
  code: TeamRuntimeRemediationCode,
  count: number,
): string {
  if (code === 'handoff-failure') {
    return `runtime remediation: retry recoverable failed handoffs (${count})`;
  }
  if (code === 'quality-review-pending') {
    return `runtime remediation: retry pending quality reviews (${count})`;
  }
  if (code === 'stale-runtime-threads') {
    return `runtime remediation: reconcile stale threads (${count})`;
  }
  return `runtime remediation: release stale decisions (${count})`;
}

export async function runTeamRuntimeRemediation(input: {
  code: TeamRuntimeRemediationCode;
  force?: boolean;
  handoffId?: string;
  nowMs?: number;
  sessionIds: string[];
  userId: string;
}): Promise<TeamRuntimeRemediationResult> {
  if (input.code === 'handoff-failure') {
    return runFailedHandoffRemediation({
      code: input.code,
      sessionIds: input.sessionIds,
      userId: input.userId,
    });
  }
  if (input.code === 'quality-review-pending') {
    return runPendingQualityReviewRemediation({
      code: input.code,
      force: input.force,
      handoffId: input.handoffId,
      nowMs: input.nowMs,
      sessionIds: input.sessionIds,
      userId: input.userId,
    });
  }

  const staleCandidateRows = await collectRemediationCandidates(input);
  let resetCount = 0;
  let pausedCount = 0;
  const failedSessionIds: string[] = [];

  for (const row of staleCandidateRows) {
    try {
      const result = await reconcileSessionRuntime({
        nowMs: input.nowMs ?? Date.now(),
        sessionId: row.session_id,
        userId: input.userId,
      });
      if (result.wasReset) {
        resetCount += 1;
      } else if (result.status === 'paused') {
        pausedCount += 1;
      }
    } catch {
      failedSessionIds.push(row.session_id);
    }
  }

  return {
    code: input.code,
    failedSessionIds,
    pausedCount,
    resetCount,
    staleCandidateCount: staleCandidateRows.length,
  };
}

async function runFailedHandoffRemediation(input: {
  code: 'handoff-failure';
  sessionIds: string[];
  userId: string;
}): Promise<TeamRuntimeRemediationResult> {
  if (input.sessionIds.length === 0) {
    return {
      code: input.code,
      failedSessionIds: [],
      pausedCount: 0,
      resetCount: 0,
      staleCandidateCount: 0,
    };
  }

  const rows = sqliteAll<{
    failure_reason: string | null;
    id: string;
    payload_json: string | null;
    to_role_layer: string;
  }>(
    `SELECT id
          , failure_reason
          , payload_json
          , to_role_layer
       FROM handoff_records
      WHERE user_id = ?
        AND state = 'failed'
        AND (from_session_id IN (${input.sessionIds.map(() => '?').join(',')}) OR to_session_id IN (${input.sessionIds.map(() => '?').join(',')}))`,
    [input.userId, ...input.sessionIds, ...input.sessionIds],
  ).filter((row) =>
    isRecoverableFailedHandoff({
      failureReason: row.failure_reason,
      payloadJson: row.payload_json,
      toRoleLayer: row.to_role_layer,
    }),
  );

  let retriedCount = 0;
  const failedSessionIds: string[] = [];
  for (const row of rows) {
    if (retryFailedHandoff({ userId: input.userId, handoffId: row.id })) {
      retriedCount += 1;
    } else {
      failedSessionIds.push(row.id);
    }
  }

  return {
    code: input.code,
    completedCount: 0,
    failedSessionIds,
    noopCount: 0,
    pausedCount: 0,
    reclaimedCount: 0,
    resetCount: retriedCount,
    retryableErrorCount: 0,
    staleCandidateCount: rows.length,
  };
}

async function runPendingQualityReviewRemediation(input: {
  code: 'quality-review-pending';
  force?: boolean;
  handoffId?: string;
  nowMs?: number;
  sessionIds: string[];
  userId: string;
}): Promise<TeamRuntimeRemediationResult> {
  const sourceCandidates = input.handoffId
    ? listPm2HandoffsPendingQualityReview({
        nowMs: input.nowMs,
        sessionIds: input.sessionIds,
        userId: input.userId,
      })
    : listPm2HandoffsReadyForQualityReview({
        nowMs: input.nowMs,
        sessionIds: input.sessionIds,
        userId: input.userId,
      });

  const candidates = sourceCandidates
    .filter((candidate) => (input.handoffId ? candidate.handoffId === input.handoffId : true))
    .filter((candidate) => (input.handoffId && input.force ? true : candidate.readyNow));

  let completedCount = 0;
  const failedSessionIds: string[] = [];
  let noopCount = 0;
  let reclaimedCount = 0;
  let retryableErrorCount = 0;

  for (const candidate of candidates) {
    // Per-candidate resilience: reconcilePm2QualityReview can REJECT — its own
    // catch handler does SQLite + audit writes that may themselves throw
    // (proven by §0.101, which wrapped the watcher's mirror loop
    // reconcilePendingPm2QualityReviews for the same reason). The sibling stale
    // loop in this file is already per-candidate guarded; this one was not, so
    // one rejecting candidate aborted the whole remediation run — starving the
    // remaining candidates AND skipping the caller's audit log / 500-ing the
    // manual remediation route. Isolate per candidate: treat a throw as a
    // failed candidate (same as a `failed` outcome) + warn, and continue.
    let result: ReconcilePm2QualityReviewResult;
    try {
      result = await reconcilePm2QualityReview({
        ...(input.handoffId === candidate.handoffId && input.force ? { force: true } : {}),
        nowMs: input.nowMs,
        pm2HandoffId: candidate.handoffId,
        userId: input.userId,
      });
    } catch (err) {
      failedSessionIds.push(candidate.handoffId);
      console.warn(
        `[team-remediation] pm2 质量评审 ${candidate.handoffId} 协调抛错，计为失败并继续本轮：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }
    applyPendingQualityReviewOutcome(result, {
      completedCountRef: () => completedCount,
      failedSessionIds,
      handoffId: candidate.handoffId,
      noopCountRef: () => noopCount,
      reclaimedCountRef: () => reclaimedCount,
      retryableErrorCountRef: () => retryableErrorCount,
      setCompletedCount: (value) => {
        completedCount = value;
      },
      setNoopCount: (value) => {
        noopCount = value;
      },
      setReclaimedCount: (value) => {
        reclaimedCount = value;
      },
      setRetryableErrorCount: (value) => {
        retryableErrorCount = value;
      },
    });
  }

  return {
    code: input.code,
    completedCount,
    failedSessionIds,
    noopCount,
    pausedCount: 0,
    reclaimedCount,
    resetCount: completedCount + reclaimedCount + failedSessionIds.length,
    retryableErrorCount,
    staleCandidateCount: candidates.length,
  };
}

function applyPendingQualityReviewOutcome(
  result: ReconcilePm2QualityReviewResult,
  input: {
    completedCountRef: () => number;
    failedSessionIds: string[];
    handoffId: string;
    noopCountRef: () => number;
    reclaimedCountRef: () => number;
    retryableErrorCountRef: () => number;
    setCompletedCount: (value: number) => void;
    setNoopCount: (value: number) => void;
    setReclaimedCount: (value: number) => void;
    setRetryableErrorCount: (value: number) => void;
  },
): void {
  if (result.status === 'completed') {
    input.setCompletedCount(input.completedCountRef() + 1);
    return;
  }
  if (result.status === 'reclaimed') {
    input.setReclaimedCount(input.reclaimedCountRef() + 1);
    return;
  }
  if (result.status === 'failed') {
    input.failedSessionIds.push(input.handoffId);
    return;
  }
  if (result.status === 'retryable-error') {
    input.setRetryableErrorCount(input.retryableErrorCountRef() + 1);
    return;
  }
  input.setNoopCount(input.noopCountRef() + 1);
}

async function collectRemediationCandidates(input: {
  code: TeamRuntimeRemediationCode;
  sessionIds: string[];
}): Promise<Array<{ session_id: string }>> {
  if (input.sessionIds.length === 0) {
    return [];
  }

  if (input.code === 'stale-runtime-threads') {
    const staleBeforeMs = Date.now() - SESSION_RUNTIME_THREAD_STALE_AFTER_MS;
    return sqliteAll<{ session_id: string }>(
      `SELECT session_id
         FROM session_runtime_threads
        WHERE session_id IN (${input.sessionIds.map(() => '?').join(',')})
          AND heartbeat_at_ms < ?`,
      [...input.sessionIds, staleBeforeMs],
    );
  }

  return sqliteAll<{ session_id: string }>(
    `SELECT DISTINCT session_id
       FROM (
         SELECT session_id
           FROM permission_requests
          WHERE session_id IN (${input.sessionIds.map(() => '?').join(',')})
            AND status = 'deciding'
            AND updated_at < datetime('now', '-10 minutes')
         UNION ALL
         SELECT session_id
           FROM question_requests
          WHERE session_id IN (${input.sessionIds.map(() => '?').join(',')})
            AND status = 'deciding'
            AND updated_at < datetime('now', '-10 minutes')
       ) stale_sessions`,
    [...input.sessionIds, ...input.sessionIds],
  );
}
