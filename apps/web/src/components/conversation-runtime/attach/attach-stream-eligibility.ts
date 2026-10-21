import type { SessionStateStatus } from '../session/session-runtime.js';

export interface AttachStreamEligibilityInput {
  activeGatewayStreamSessionId: string | null;
  currentSessionId: string | null;
  isPageActive: boolean;
  isSessionSnapshotReady: boolean;
  recoveryActiveStreamPresent: boolean;
  sessionModesHydrated: boolean;
  sessionStateStatus: SessionStateStatus | null;
  streaming: boolean;
}

/** beforeRetry 的三态裁决：继续 / 延后重排（不消耗次数） / 放弃。 */
export type AttachRetryVerdict = 'proceed' | 'defer' | 'abort';

/** attach effect 每次运行时的处置分支。 */
export type AttachEffectDisposition = 'proceed' | 'skip' | 'cancel_retry' | 'terminal';

export function shouldAttemptAttachToSession(input: AttachStreamEligibilityInput): boolean {
  return (
    Boolean(input.currentSessionId) &&
    input.isPageActive &&
    !input.streaming &&
    input.isSessionSnapshotReady &&
    input.sessionModesHydrated &&
    (input.sessionStateStatus === 'running' ||
      input.recoveryActiveStreamPresent ||
      /**
       * 客户端本地的「活跃流」提示（`useGatewayClient` 的快照，跨刷新存于
       * sessionStorage）。它只是**提示**：网关权威答案在 `recoveryActiveStreamPresent`。
       *
       * 因此会话已被明确判为 `idle` 时必须忽略它：陈旧提示会让一个**已停止**的会话
       * 反复满足 attach 条件，每次 effect 重跑都走一遍
       * 「attach → 网关回「无活跃流」→ settleAsEnded → 全量重拉 recovery」，
       * 表现为「什么都没做，界面自己刷新了」。`sessionStateStatus` 尚未收敛
       * （null）时仍保留该提示，用于刷新后抢先续接真正在跑的流。
       */
      (input.sessionStateStatus !== 'idle' &&
        input.activeGatewayStreamSessionId === input.currentSessionId))
  );
}

export function shouldResetAttachAttempt(input: AttachStreamEligibilityInput): boolean {
  // 只在会话真正结束时重置 attach 标记
  // 如果 sessionStateStatus 是 null（会话结束），才重置
  // 如果是 'idle' 但还有 streaming 或 recovery，不重置（避免流式完成后立即重置导致重复 attach）
  return (
    !input.currentSessionId ||
    !input.isPageActive ||
    (!input.isSessionSnapshotReady && !input.sessionModesHydrated) ||
    (input.sessionStateStatus === null &&
      !input.recoveryActiveStreamPresent &&
      input.activeGatewayStreamSessionId !== input.currentSessionId)
  );
}

/**
 * 只有会话切换（或尚未归属任何会话的重试遇到页面失活）才允许取消已排期的重试。
 * 没有待重试会话时永不取消；同一会话内 eligibility 的瞬时翻转不得取消重试，
 * 否则重连自身的恢复副作用会把退避定时器杀掉且无人重排。
 */
export function shouldCancelAttachRetry(input: {
  retryScheduledSessionId: string | null;
  currentSessionId: string | null;
  isPageActive: boolean;
}): boolean {
  if (input.retryScheduledSessionId === null) {
    return false;
  }
  if (!input.isPageActive) {
    return true;
  }
  return input.retryScheduledSessionId !== input.currentSessionId;
}

/**
 * 会话确认结束的判定：显式 idle + 无恢复流 + 网关无活跃流指向当前会话。
 * sessionStateStatus 为 null（尚未收敛）不算终态，避免把瞬时状态当成结束。
 */
export function isAttachStreamTerminal(input: AttachStreamEligibilityInput): boolean {
  return (
    Boolean(input.currentSessionId) &&
    input.isPageActive &&
    input.sessionStateStatus === 'idle' &&
    !input.recoveryActiveStreamPresent &&
    input.activeGatewayStreamSessionId !== input.currentSessionId
  );
}

/**
 * attach effect 的处置裁决，优先级：
 * cancel_retry（会话切换/页面失活）→ terminal（重试耗尽，或存在待触发重连且会话确认结束）
 * → skip → proceed。
 */
export function resolveAttachEffectDisposition(input: {
  eligibility: AttachStreamEligibilityInput;
  retryScheduledSessionId: string | null;
  retryExhausted: boolean;
}): AttachEffectDisposition {
  const { eligibility, retryExhausted, retryScheduledSessionId } = input;
  if (
    shouldCancelAttachRetry({
      retryScheduledSessionId,
      currentSessionId: eligibility.currentSessionId,
      isPageActive: eligibility.isPageActive,
    })
  ) {
    return 'cancel_retry';
  }
  const hasPendingReconnect = retryScheduledSessionId !== null || retryExhausted;
  if ((hasPendingReconnect && isAttachStreamTerminal(eligibility)) || retryExhausted) {
    return 'terminal';
  }
  if (!shouldAttemptAttachToSession(eligibility)) {
    return 'skip';
  }
  return 'proceed';
}
