import type { HandoffEvent } from '../../../../stores/team/team-events.js';

export type TeamRuntimeHandoffContextTab = 'artifacts' | 'review' | 'health';

export interface TeamRuntimeHandoffContextInput {
  handoffId?: string | null;
  preferredTab: TeamRuntimeHandoffContextTab;
  sessionId?: string | null;
}

function resolveEventHandoffId(event: HandoffEvent): string | null {
  if (typeof event.payload['handoffId'] === 'string' && event.payload['handoffId'].length > 0) {
    return event.payload['handoffId'];
  }
  if (typeof event.taskId === 'string' && event.taskId.length > 0) {
    return event.taskId;
  }
  return null;
}

function resolveEventSessionId(event: HandoffEvent): string | null {
  if (
    typeof event.payload['fromSessionId'] === 'string' &&
    event.payload['fromSessionId'].length > 0
  ) {
    return event.payload['fromSessionId'];
  }
  if (typeof event.sessionId === 'string' && event.sessionId.length > 0) {
    return event.sessionId;
  }
  return null;
}

export function resolveTeamRuntimeTabFromBlockingReason(
  reason: string | null | undefined,
): TeamRuntimeHandoffContextTab {
  if (reason === 'review_failed_threshold') {
    return 'review';
  }
  if (reason === 'needs_clarification') {
    return 'artifacts';
  }
  if (reason === 'dispatch_context') {
    return 'artifacts';
  }
  if (reason === 'artifacts_context') {
    return 'artifacts';
  }
  return 'health';
}

export function extractTeamRuntimeHandoffContextFromEvent(
  event: HandoffEvent,
): TeamRuntimeHandoffContextInput {
  const reason = typeof event.payload['reason'] === 'string' ? event.payload['reason'] : null;
  return {
    handoffId: resolveEventHandoffId(event),
    preferredTab: resolveTeamRuntimeTabFromBlockingReason(reason),
    sessionId: resolveEventSessionId(event),
  };
}
