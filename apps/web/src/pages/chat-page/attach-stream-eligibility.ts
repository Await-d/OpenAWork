import type { SessionStateStatus } from './session-runtime.js';

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
  return (
    !input.currentSessionId ||
    !input.isPageActive ||
    (!input.isSessionSnapshotReady && !input.sessionModesHydrated) ||
    (input.sessionStateStatus !== 'running' &&
      !input.recoveryActiveStreamPresent &&
      input.activeGatewayStreamSessionId !== input.currentSessionId)
  );
}
