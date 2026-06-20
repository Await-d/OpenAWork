export interface QualityReviewDispositionInput {
  escalationRound: number;
  /**
   * 完整的评审判定结果，用于精确路由失败分流。
   * - `execution-protocol-failure`：交付协议未完成（completed 但缺 result_json）
   * - `implementation-failure`：执行层任务失败（failed/cancelled）或代码质量问题
   * - `planning-failure`：规划层问题
   */
  overallVerdict?: 'pass' | 'implementation-failure' | 'planning-failure' | 'execution-protocol-failure';
  qualityIssues: string[];
  qualityReviewPassed: boolean;
  specIssues: string[];
  specReviewPassed: boolean;
}

export type QualityReviewDisposition =
  | {
      action: 'redispatch';
      code: 'quality-review-redispatch';
      reason: string;
      severity: 'warning';
    }
  | {
      action: 'return-to-c';
      code: 'quality-review-return-to-c';
      reason: string;
      severity: 'warning';
    }
  | {
      action: 'escalate-to-user';
      code: 'quality-review-escalate-to-user';
      reason: string;
      severity: 'error';
    };

export function deriveQualityReviewDisposition(
  input: QualityReviewDispositionInput,
): QualityReviewDisposition {
  // 1. 已重试 ≥ 4 轮 → 升级用户（无论失败类型）
  // 前 3 轮可以 return-to-c / redispatch 自动修正，第 4 轮才真正升级用户。
  // 给团队充分的自动修正机会，避免过早停止导致用户体验中断。
  if (input.escalationRound >= 4) {
    return {
      action: 'escalate-to-user',
      code: 'quality-review-escalate-to-user',
      reason: `已自动修正 ${input.escalationRound} 轮仍未通过，需要用户介入`,
      severity: 'error',
    };
  }

  // 2. Spec Review 未通过 → 退回 PM1（规划型失败）
  if (!input.specReviewPassed) {
    return {
      action: 'return-to-c',
      code: 'quality-review-return-to-c',
      reason: `Spec Review 未通过：${input.specIssues.join('；')}`,
      severity: 'warning',
    };
  }

  // 3. execution-protocol-failure：交付协议未完成（completed 但缺 result_json）→
  //    这不是代码质量问题，是执行层 runner 未正确写入产物。重派前应记录
  //    更精确的 reason，便于排查。
  if (input.overallVerdict === 'execution-protocol-failure') {
    return {
      action: 'redispatch',
      code: 'quality-review-redispatch',
      reason: `执行协议失败（交付物缺失）：${input.qualityIssues.join('；')}`,
      severity: 'warning',
    };
  }

  // 4. implementation-failure 或 quality review 未通过 → 重派（实现型失败）
  return {
    action: 'redispatch',
    code: 'quality-review-redispatch',
    reason: `Quality Review 未通过：${input.qualityIssues.join('；')}`,
    severity: 'warning',
  };
}

export interface TeamRuntimeHealthInput {
  architectureReviewBlockedCount: number;
  currentFailedHandoffCount: number;
  recoverableFailedHandoffCount: number;
  decidingInteractionCount: number;
  latencyViolationCount: number;
  pendingInteractionCount: number;
  qualityReviewPendingCount: number;
  qualityReviewRetryableErrorCount: number;
  qualityReviewEscalateToUserCount: number;
  qualityReviewRedispatchCount: number;
  qualityReviewReturnToCCount: number;
  recentTeamEventsConnectionCount: number;
  recentTeamEventsListenerCount: number;
  staleDecidingInteractionCount: number;
  staleRuntimeThreadCount: number;
}

export interface TeamRuntimeHealth {
  reasons: string[];
  status: 'critical' | 'degraded' | 'healthy';
}

export interface TeamRuntimeAlert {
  code:
    | 'architecture-review-blocked'
    | 'handoff-failure'
    | 'latency-violation'
    | 'pending-decisions'
    | 'quality-review-pending'
    | 'quality-review-escalate-to-user'
    | 'quality-review-redispatch'
    | 'quality-review-return-to-c'
    | 'stale-decisions'
    | 'stale-runtime-threads'
    | 'team-events-connection'
    | 'telemetry-disabled';
  message: string;
  remediable?: boolean;
  severity: 'critical' | 'warning' | 'info';
  suggestedAction: string;
}

export function deriveTeamRuntimeHealth(input: TeamRuntimeHealthInput): TeamRuntimeHealth {
  const reasons: string[] = [];

  if (input.architectureReviewBlockedCount > 0) {
    reasons.push(`architecture_review=${input.architectureReviewBlockedCount}`);
  }
  if (input.currentFailedHandoffCount > 0) {
    reasons.push(`handoff_failure=${input.currentFailedHandoffCount}`);
    if (input.recoverableFailedHandoffCount > 0) {
      reasons.push(`recoverable_handoff_failure=${input.recoverableFailedHandoffCount}`);
    }
  }
  if (input.qualityReviewRedispatchCount > 0) {
    reasons.push(`quality_review_redispatch=${input.qualityReviewRedispatchCount}`);
  }
  if (input.qualityReviewPendingCount > 0) {
    reasons.push(`quality_review_pending=${input.qualityReviewPendingCount}`);
  }
  if (input.qualityReviewRetryableErrorCount > 0) {
    reasons.push(`quality_review_retryable_error=${input.qualityReviewRetryableErrorCount}`);
  }
  if (input.qualityReviewReturnToCCount > 0) {
    reasons.push(`quality_review_return_to_c=${input.qualityReviewReturnToCCount}`);
  }
  if (input.qualityReviewEscalateToUserCount > 0) {
    reasons.push(`quality_review_escalate_to_user=${input.qualityReviewEscalateToUserCount}`);
  }
  if (input.recentTeamEventsConnectionCount > 0) {
    reasons.push(`team_events_connection=${input.recentTeamEventsConnectionCount}`);
  }
  if (input.staleRuntimeThreadCount > 0) {
    reasons.push(`stale_runtime_threads=${input.staleRuntimeThreadCount}`);
  }
  if (input.decidingInteractionCount > 0) {
    reasons.push(`pending_decisions=${input.decidingInteractionCount}`);
  }
  if (input.staleDecidingInteractionCount > 0) {
    reasons.push(`stale_decisions=${input.staleDecidingInteractionCount}`);
  }

  if (
    input.architectureReviewBlockedCount > 0 ||
    input.currentFailedHandoffCount > 0 ||
    input.qualityReviewReturnToCCount > 0 ||
    input.qualityReviewEscalateToUserCount > 0 ||
    input.staleRuntimeThreadCount > 0
  ) {
    return {
      reasons,
      status: 'critical',
    };
  }

  if (
    input.latencyViolationCount > 0 ||
    input.qualityReviewPendingCount > 0 ||
    input.qualityReviewRetryableErrorCount > 0 ||
    input.qualityReviewRedispatchCount > 0 ||
    input.recentTeamEventsConnectionCount > 0 ||
    input.recentTeamEventsListenerCount > 0 ||
    input.pendingInteractionCount > 0 ||
    input.staleDecidingInteractionCount > 0
  ) {
    return {
      reasons,
      status: 'degraded',
    };
  }

  return {
    reasons,
    status: 'healthy',
  };
}

export function deriveTeamRuntimeAlerts(input: {
  architectureReviewBlockedCount: number;
  currentFailedHandoffCount: number;
  recoverableFailedHandoffCount: number;
  health: TeamRuntimeHealth;
  latencyViolationCount: number;
  pendingInteractionCount: number;
  qualityReviewPendingCount: number;
  qualityReviewRetryableErrorCount: number;
  qualityReviewEscalateToUserCount: number;
  qualityReviewRedispatchCount: number;
  qualityReviewReturnToCCount: number;
  recentTeamEventsConnectionCount: number;
  staleDecidingInteractionCount: number;
  staleRuntimeThreadCount: number;
  telemetryEnabled: boolean;
}): TeamRuntimeAlert[] {
  const alerts: TeamRuntimeAlert[] = [];

  if (input.architectureReviewBlockedCount > 0) {
    alerts.push({
      code: 'architecture-review-blocked',
      message: `存在 ${input.architectureReviewBlockedCount} 条架构评审阻断，新的派发已被拦截。`,
      severity: 'critical',
      suggestedAction:
        '先查看 Health 页的运行时事件与 Architecture Review artifact，修正计划后再重试。',
    });
  }

  if (input.currentFailedHandoffCount > 0) {
    alerts.push({
      code: 'handoff-failure',
      message: `当前存在 ${input.currentFailedHandoffCount} 条 failed handoff 或失败分流事件。`,
      remediable: input.recoverableFailedHandoffCount > 0,
      severity: input.health.status === 'critical' ? 'critical' : 'warning',
      suggestedAction:
        input.recoverableFailedHandoffCount > 0
          ? `可执行“重试可恢复失败”（${input.recoverableFailedHandoffCount} 条），其余失败仍需结合评审结果与 PM2 分流原因人工定位。`
          : '当前 failed handoff 暂不适合自动重试，请优先结合评审结果与 PM2 分流原因人工处理。',
    });
  }

  if (input.qualityReviewRedispatchCount > 0) {
    alerts.push({
      code: 'quality-review-redispatch',
      message: `近期出现 ${input.qualityReviewRedispatchCount} 次实现型失败重派，PM2 正在尝试重新派发。`,
      severity: 'warning',
      suggestedAction:
        '优先检查 review_report 与执行层结果，确认是否是测试或实现层反复失败导致的自动重派。',
    });
  }

  if (input.qualityReviewPendingCount > 0) {
    alerts.push({
      code: 'quality-review-pending',
      message:
        input.qualityReviewRetryableErrorCount > 0
          ? `存在 ${input.qualityReviewPendingCount} 条待重试评审，其中 ${input.qualityReviewRetryableErrorCount} 条上次评审执行失败。`
          : `存在 ${input.qualityReviewPendingCount} 条待重试评审，PM2 仍在等待质量评审收口。`,
      remediable: true,
      severity: 'warning',
      suggestedAction:
        input.qualityReviewRetryableErrorCount > 0
          ? '可执行“立即重试评审”重新触发 PM2 质量评审；若仍失败，请检查 LLM 配置、评审输入和 review_report 产物。'
          : '可执行“立即重试评审”强制触发 PM2 质量评审收口，避免长时间停留在 running / reviewing。',
    });
  }

  if (input.qualityReviewReturnToCCount > 0) {
    alerts.push({
      code: 'quality-review-return-to-c',
      message: `近期出现 ${input.qualityReviewReturnToCCount} 次规划型失败退回 PM1，当前 spec/plan/tasks 可能需要重写。`,
      severity: 'warning',
      suggestedAction:
        '优先查看 review_report、Spec Review 问题列表与 PM1 规划结果，确认需求理解或架构设计是否有偏差。',
    });
  }

  if (input.qualityReviewEscalateToUserCount > 0) {
    alerts.push({
      code: 'quality-review-escalate-to-user',
      message: `近期有 ${input.qualityReviewEscalateToUserCount} 次评审失败已升级给用户，团队正等待人工介入。`,
      severity: 'critical',
      suggestedAction:
        '请直接介入当前任务：修改原始需求、补充约束，或确认是否继续推进当前实现路线。',
    });
  }

  if (input.staleRuntimeThreadCount > 0) {
    alerts.push({
      code: 'stale-runtime-threads',
      message: `检测到 ${input.staleRuntimeThreadCount} 条过期运行线程，可能存在中断或僵尸运行。`,
      remediable: true,
      severity: 'critical',
      suggestedAction: '优先检查对应 session 是否卡住；必要时取消任务或重新发起该层流程。',
    });
  }

  if (input.pendingInteractionCount > 0) {
    alerts.push({
      code: 'pending-decisions',
      message: `当前有 ${input.pendingInteractionCount} 条等待中的权限/问题交互。`,
      severity: 'warning',
      suggestedAction: '尽快处理等待中的权限确认或问题回答，避免流程长时间停滞。',
    });
  }

  if (input.staleDecidingInteractionCount > 0) {
    alerts.push({
      code: 'stale-decisions',
      message: `存在 ${input.staleDecidingInteractionCount} 条超时 deciding 交互，可能卡住等待链路。`,
      remediable: true,
      severity: 'warning',
      suggestedAction: '可执行“释放超时交互”修复，把过期 deciding 状态退回 pending，恢复正常等待。',
    });
  }

  if (input.latencyViolationCount > 0) {
    alerts.push({
      code: 'latency-violation',
      message: `当前存在 ${input.latencyViolationCount} 条延迟超阈值统计。`,
      severity: 'warning',
      suggestedAction: '优先查看 health 页的 latency 统计，排查 gateway、模型调用或前端连接延迟。',
    });
  }

  if (input.recentTeamEventsConnectionCount > 0) {
    alerts.push({
      code: 'team-events-connection',
      message: `team-events 通道近期出现 ${input.recentTeamEventsConnectionCount} 次连接异常。`,
      severity: 'warning',
      suggestedAction: '优先检查前端网络连接、gateway 可达性和 websocket 断连重连表现。',
    });
  }

  if (!input.telemetryEnabled) {
    alerts.push({
      code: 'telemetry-disabled',
      message: 'runtime telemetry 当前未启用，外部观测与告警可能不完整。',
      severity: 'info',
      suggestedAction: '如需要运行期告警与趋势追踪，请在部署环境启用 telemetry。',
    });
  }

  return alerts;
}
