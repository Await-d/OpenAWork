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

export function shouldAttemptAttachToSession(input: AttachStreamEligibilityInput): boolean {
  return (
    Boolean(input.currentSessionId) &&
    input.isPageActive &&
    !input.streaming &&
    input.isSessionSnapshotReady &&
    input.sessionModesHydrated &&
    (input.sessionStateStatus === 'running' ||
      input.recoveryActiveStreamPresent ||
      input.activeGatewayStreamSessionId === input.currentSessionId)
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
