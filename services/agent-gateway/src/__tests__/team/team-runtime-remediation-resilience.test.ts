/**
 * Regression (§0.113, remediation per-candidate isolation):
 * runTeamRuntimeRemediation('quality-review-pending') loops over pending pm2
 * review candidates and awaits reconcilePm2QualityReview per candidate. That
 * function can REJECT (its own catch does SQLite + audit writes that may throw
 * — proven by §0.101, which wrapped the watcher's mirror loop). The remediation
 * loop had no per-candidate guard, so one rejecting candidate aborted the whole
 * run — starving the rest AND 500-ing the manual remediation route (the caller
 * skips its audit log too). The loop now isolates per candidate, counting a
 * throw as a failed candidate. We mock the reconciler so one of two candidates
 * rejects and assert the run still resolves and still processes the healthy one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReconcilerModule from '../../handoff/runner/pm2-quality-review-reconciler.js';
import type * as RemediationModule from '../../team/team-runtime-remediation-policy.js';

const POISON_HANDOFF_ID = 'h-pm2-poison';
const HEALTHY_HANDOFF_ID = 'h-pm2-healthy';

const reconciledHandoffIds: string[] = [];

function candidate(handoffId: string): ReconcilerModule.Pm2QualityReviewCandidate {
  return {
    handoffId,
    lastError: null,
    lastAttemptAtMs: null,
    nextAttemptAtMs: null,
    readyNow: true,
    sessionId: 's-1',
    userId: 'u-1',
  };
}

vi.mock('../../handoff/runner/pm2-quality-review-reconciler.js', () => ({
  // Two ready candidates (poison first so we prove the loop continues past it).
  listPm2HandoffsReadyForQualityReview: () => [
    candidate(POISON_HANDOFF_ID),
    candidate(HEALTHY_HANDOFF_ID),
  ],
  listPm2HandoffsPendingQualityReview: () => [
    candidate(POISON_HANDOFF_ID),
    candidate(HEALTHY_HANDOFF_ID),
  ],
  reconcilePm2QualityReview: async (input: { pm2HandoffId: string }) => {
    if (input.pm2HandoffId === POISON_HANDOFF_ID) {
      throw new Error('simulated reconcile rejection (audit write threw)');
    }
    reconciledHandoffIds.push(input.pm2HandoffId);
    return { status: 'completed' as const };
  },
}));

let remediation: typeof RemediationModule;

beforeEach(async () => {
  reconciledHandoffIds.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  remediation = await import('../../team/team-runtime-remediation-policy.js');
});

describe('runTeamRuntimeRemediation quality-review-pending per-candidate resilience', () => {
  it('单个候选 reconcile 抛错时不中断整轮，其余候选仍被处理且计为失败', async () => {
    let result: RemediationModule.TeamRuntimeRemediationResult | undefined;

    // Must not reject despite the poison candidate's reconcile throwing.
    await expect(
      (async () => {
        result = await remediation.runTeamRuntimeRemediation({
          code: 'quality-review-pending',
          sessionIds: ['s-1'],
          userId: 'u-1',
        });
      })(),
    ).resolves.toBeUndefined();

    // The healthy candidate was still reconciled — the loop continued.
    expect(reconciledHandoffIds).toContain(HEALTHY_HANDOFF_ID);
    expect(reconciledHandoffIds).not.toContain(POISON_HANDOFF_ID);
    // The poison candidate was counted as a failed candidate, not lost.
    expect(result?.failedSessionIds).toContain(POISON_HANDOFF_ID);
    // The healthy candidate's completion was still tallied.
    expect(result?.completedCount).toBe(1);
    expect(console.warn).toHaveBeenCalled();
  });
});
