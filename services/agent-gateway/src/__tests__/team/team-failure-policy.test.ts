import { describe, expect, it } from 'vitest';
import {
  deriveTeamRuntimeAlerts,
  deriveQualityReviewDisposition,
  deriveTeamRuntimeHealth,
} from '../../team/team-failure-policy.js';

describe('deriveQualityReviewDisposition', () => {
  it('超过重试阈值时升级给用户', () => {
    expect(
      deriveQualityReviewDisposition({
        escalationRound: 4,
        qualityIssues: ['测试失败'],
        qualityReviewPassed: false,
        specIssues: [],
        specReviewPassed: true,
      }),
    ).toMatchObject({
      action: 'escalate-to-user',
      code: 'quality-review-escalate-to-user',
      severity: 'error',
    });
  });

  it('spec review 失败时退回 c 层', () => {
    expect(
      deriveQualityReviewDisposition({
        escalationRound: 0,
        qualityIssues: [],
        qualityReviewPassed: true,
        specIssues: ['遗漏验收场景'],
        specReviewPassed: false,
      }),
    ).toMatchObject({
      action: 'return-to-c',
      code: 'quality-review-return-to-c',
      severity: 'warning',
    });
  });

  it('quality review 失败时重派', () => {
    expect(
      deriveQualityReviewDisposition({
        escalationRound: 0,
        overallVerdict: 'implementation-failure',
        qualityIssues: ['测试失败'],
        qualityReviewPassed: false,
        specIssues: [],
        specReviewPassed: true,
      }),
    ).toMatchObject({
      action: 'redispatch',
      code: 'quality-review-redispatch',
      severity: 'warning',
    });
  });

  it('execution-protocol-failure 时重派且 reason 包含交付物缺失', () => {
    const result = deriveQualityReviewDisposition({
      escalationRound: 0,
      overallVerdict: 'execution-protocol-failure',
      qualityIssues: ['h-xxx 缺少执行结果 artifact/summary'],
      qualityReviewPassed: false,
      specIssues: [],
      specReviewPassed: true,
    });
    expect(result.action).toBe('redispatch');
    expect(result.reason).toContain('执行协议失败（交付物缺失）');
  });

  it('implementation-failure（子任务 failed/cancelled）时重派且 reason 为 Quality Review 未通过', () => {
    const result = deriveQualityReviewDisposition({
      escalationRound: 0,
      overallVerdict: 'implementation-failure',
      qualityIssues: ['h-xxx 子任务执行失败（失败原因：stream 被取消）'],
      qualityReviewPassed: false,
      specIssues: [],
      specReviewPassed: true,
    });
    expect(result.action).toBe('redispatch');
    expect(result.reason).toContain('Quality Review 未通过');
  });
});

describe('deriveTeamRuntimeHealth', () => {
  it('architecture/handoff/stale thread 任一存在时为 critical', () => {
    expect(
      deriveTeamRuntimeHealth({
        architectureReviewBlockedCount: 0,
        currentFailedHandoffCount: 1,
        recoverableFailedHandoffCount: 1,
        decidingInteractionCount: 0,
        latencyViolationCount: 0,
        pendingInteractionCount: 0,
        qualityReviewPendingCount: 0,
        qualityReviewRetryableErrorCount: 0,
        qualityReviewEscalateToUserCount: 0,
        qualityReviewRedispatchCount: 0,
        qualityReviewReturnToCCount: 0,
        recentTeamEventsConnectionCount: 0,
        recentTeamEventsListenerCount: 0,
        staleDecidingInteractionCount: 0,
        staleRuntimeThreadCount: 0,
      }),
    ).toMatchObject({
      status: 'critical',
      reasons: ['handoff_failure=1', 'recoverable_handoff_failure=1'],
    });
  });

  it('只有 latency / pending interaction / listener 时为 degraded', () => {
    expect(
      deriveTeamRuntimeHealth({
        architectureReviewBlockedCount: 0,
        currentFailedHandoffCount: 0,
        recoverableFailedHandoffCount: 0,
        decidingInteractionCount: 1,
        latencyViolationCount: 1,
        pendingInteractionCount: 2,
        qualityReviewPendingCount: 0,
        qualityReviewRetryableErrorCount: 0,
        qualityReviewEscalateToUserCount: 0,
        qualityReviewRedispatchCount: 0,
        qualityReviewReturnToCCount: 0,
        recentTeamEventsConnectionCount: 0,
        recentTeamEventsListenerCount: 1,
        staleDecidingInteractionCount: 0,
        staleRuntimeThreadCount: 0,
      }),
    ).toMatchObject({
      status: 'degraded',
    });
  });

  it('没有风险时为 healthy', () => {
    expect(
      deriveTeamRuntimeHealth({
        architectureReviewBlockedCount: 0,
        currentFailedHandoffCount: 0,
        recoverableFailedHandoffCount: 0,
        decidingInteractionCount: 0,
        latencyViolationCount: 0,
        pendingInteractionCount: 0,
        qualityReviewPendingCount: 0,
        qualityReviewRetryableErrorCount: 0,
        qualityReviewEscalateToUserCount: 0,
        qualityReviewRedispatchCount: 0,
        qualityReviewReturnToCCount: 0,
        recentTeamEventsConnectionCount: 0,
        recentTeamEventsListenerCount: 0,
        staleDecidingInteractionCount: 0,
        staleRuntimeThreadCount: 0,
      }),
    ).toEqual({
      reasons: [],
      status: 'healthy',
    });
  });
});

describe('deriveTeamRuntimeAlerts', () => {
  it('critical 场景会生成 stale/handoff alerts', () => {
    const alerts = deriveTeamRuntimeAlerts({
      architectureReviewBlockedCount: 0,
      currentFailedHandoffCount: 1,
      recoverableFailedHandoffCount: 1,
      health: { reasons: ['handoff_failure=1'], status: 'critical' },
      latencyViolationCount: 0,
      pendingInteractionCount: 0,
      qualityReviewPendingCount: 0,
      qualityReviewRetryableErrorCount: 0,
      qualityReviewEscalateToUserCount: 0,
      qualityReviewRedispatchCount: 0,
      qualityReviewReturnToCCount: 0,
      recentTeamEventsConnectionCount: 0,
      staleDecidingInteractionCount: 0,
      staleRuntimeThreadCount: 1,
      telemetryEnabled: true,
    });

    expect(alerts.map((alert) => alert.code)).toEqual(
      expect.arrayContaining(['handoff-failure', 'stale-runtime-threads']),
    );
  });

  it('telemetry 未启用时追加 info alert', () => {
    const alerts = deriveTeamRuntimeAlerts({
      architectureReviewBlockedCount: 0,
      currentFailedHandoffCount: 0,
      recoverableFailedHandoffCount: 0,
      health: { reasons: [], status: 'healthy' },
      latencyViolationCount: 0,
      pendingInteractionCount: 0,
      qualityReviewPendingCount: 0,
      qualityReviewRetryableErrorCount: 0,
      qualityReviewEscalateToUserCount: 0,
      qualityReviewRedispatchCount: 0,
      qualityReviewReturnToCCount: 0,
      recentTeamEventsConnectionCount: 0,
      staleDecidingInteractionCount: 0,
      staleRuntimeThreadCount: 0,
      telemetryEnabled: false,
    });

    expect(alerts).toContainEqual(
      expect.objectContaining({
        code: 'telemetry-disabled',
        severity: 'info',
      }),
    );
  });

  it('stale deciding 会生成专用 alert', () => {
    const alerts = deriveTeamRuntimeAlerts({
      architectureReviewBlockedCount: 0,
      currentFailedHandoffCount: 0,
      recoverableFailedHandoffCount: 0,
      health: { reasons: ['stale_decisions=1'], status: 'degraded' },
      latencyViolationCount: 0,
      pendingInteractionCount: 0,
      qualityReviewPendingCount: 0,
      qualityReviewRetryableErrorCount: 0,
      qualityReviewEscalateToUserCount: 0,
      qualityReviewRedispatchCount: 0,
      qualityReviewReturnToCCount: 0,
      recentTeamEventsConnectionCount: 0,
      staleDecidingInteractionCount: 1,
      staleRuntimeThreadCount: 0,
      telemetryEnabled: true,
    });

    expect(alerts).toContainEqual(
      expect.objectContaining({
        code: 'stale-decisions',
        severity: 'warning',
      }),
    );
  });

  it('quality review 分流会生成专用 alert 与 health reason', () => {
    const health = deriveTeamRuntimeHealth({
      architectureReviewBlockedCount: 0,
      currentFailedHandoffCount: 0,
      recoverableFailedHandoffCount: 0,
      decidingInteractionCount: 0,
      latencyViolationCount: 0,
      pendingInteractionCount: 0,
      qualityReviewPendingCount: 0,
      qualityReviewRetryableErrorCount: 0,
      qualityReviewEscalateToUserCount: 1,
      qualityReviewRedispatchCount: 1,
      qualityReviewReturnToCCount: 1,
      recentTeamEventsConnectionCount: 0,
      recentTeamEventsListenerCount: 0,
      staleDecidingInteractionCount: 0,
      staleRuntimeThreadCount: 0,
    });

    expect(health).toMatchObject({ status: 'critical' });
    expect(health.reasons).toEqual(
      expect.arrayContaining([
        'quality_review_redispatch=1',
        'quality_review_return_to_c=1',
        'quality_review_escalate_to_user=1',
      ]),
    );

    const alerts = deriveTeamRuntimeAlerts({
      architectureReviewBlockedCount: 0,
      currentFailedHandoffCount: 0,
      recoverableFailedHandoffCount: 0,
      health,
      latencyViolationCount: 0,
      pendingInteractionCount: 0,
      qualityReviewPendingCount: 0,
      qualityReviewRetryableErrorCount: 0,
      qualityReviewEscalateToUserCount: 1,
      qualityReviewRedispatchCount: 1,
      qualityReviewReturnToCCount: 1,
      recentTeamEventsConnectionCount: 0,
      staleDecidingInteractionCount: 0,
      staleRuntimeThreadCount: 0,
      telemetryEnabled: true,
    });

    expect(alerts.map((alert) => alert.code)).toEqual(
      expect.arrayContaining([
        'quality-review-redispatch',
        'quality-review-return-to-c',
        'quality-review-escalate-to-user',
      ]),
    );
  });

  it('quality review pending 会生成专用可修复告警', () => {
    const health = deriveTeamRuntimeHealth({
      architectureReviewBlockedCount: 0,
      currentFailedHandoffCount: 0,
      recoverableFailedHandoffCount: 0,
      decidingInteractionCount: 0,
      latencyViolationCount: 0,
      pendingInteractionCount: 0,
      qualityReviewPendingCount: 2,
      qualityReviewRetryableErrorCount: 1,
      qualityReviewEscalateToUserCount: 0,
      qualityReviewRedispatchCount: 0,
      qualityReviewReturnToCCount: 0,
      recentTeamEventsConnectionCount: 0,
      recentTeamEventsListenerCount: 0,
      staleDecidingInteractionCount: 0,
      staleRuntimeThreadCount: 0,
    });
    expect(health.status).toBe('degraded');
    expect(health.reasons).toEqual(
      expect.arrayContaining(['quality_review_pending=2', 'quality_review_retryable_error=1']),
    );

    const alerts = deriveTeamRuntimeAlerts({
      architectureReviewBlockedCount: 0,
      currentFailedHandoffCount: 0,
      recoverableFailedHandoffCount: 0,
      health,
      latencyViolationCount: 0,
      pendingInteractionCount: 0,
      qualityReviewPendingCount: 2,
      qualityReviewRetryableErrorCount: 1,
      qualityReviewEscalateToUserCount: 0,
      qualityReviewRedispatchCount: 0,
      qualityReviewReturnToCCount: 0,
      recentTeamEventsConnectionCount: 0,
      staleDecidingInteractionCount: 0,
      staleRuntimeThreadCount: 0,
      telemetryEnabled: true,
    });

    expect(alerts).toContainEqual(
      expect.objectContaining({
        code: 'quality-review-pending',
        remediable: true,
        severity: 'warning',
      }),
    );
  });
});
