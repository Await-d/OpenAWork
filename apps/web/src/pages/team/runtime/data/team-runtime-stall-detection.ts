import type { HandoffEntry, HandoffEvent, LayerNode } from '../../../../stores/team/team-events.js';
import { SUBSTATES_C, SUBSTATES_D, SUBSTATES_RECEPTION } from './substates.js';

const ALLOWED_WAITING_SUBSTATES = new Set<string>([
  SUBSTATES_C.CLARIFYING,
  SUBSTATES_D.AWAITING_EG,
  SUBSTATES_RECEPTION.AWAITING_DOWNSTREAM,
]);

interface ClarificationLike {
  fromSessionId: string;
  sessionId: string;
  status: 'answered' | 'dismissed' | 'pending';
}

export interface PendingInteractionSnapshotLike {
  pendingPermissionBySession: ReadonlyMap<string, unknown>;
  pendingQuestionBySession: ReadonlyMap<string, unknown>;
}

function parseIsoTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isScopeEmpty(sessionScope: ReadonlySet<string> | null | undefined): boolean {
  return !sessionScope;
}

function matchesScope(
  sessionScope: ReadonlySet<string> | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  if (isScopeEmpty(sessionScope)) {
    return true;
  }
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionScope.has(sessionId);
}

function matchesHandoffScope(
  sessionScope: ReadonlySet<string> | null | undefined,
  handoff: Pick<HandoffEntry, 'fromSessionId' | 'sessionId' | 'toSessionId'>,
): boolean {
  return (
    matchesScope(sessionScope, handoff.fromSessionId) ||
    matchesScope(sessionScope, handoff.toSessionId ?? undefined) ||
    matchesScope(sessionScope, handoff.sessionId)
  );
}

export function isAllowedWaitingSubstate(substate: string | null | undefined): boolean {
  return typeof substate === 'string' && ALLOWED_WAITING_SUBSTATES.has(substate);
}

export function countPendingItemsInScope(
  entries: ReadonlyMap<string, unknown>,
  sessionScope?: ReadonlySet<string> | null,
): number {
  let count = 0;
  for (const sessionId of entries.keys()) {
    if (matchesScope(sessionScope, sessionId)) {
      count += 1;
    }
  }
  return count;
}

export function resolvePendingInteractionCountsInScope(
  snapshot: PendingInteractionSnapshotLike,
  sessionScope?: ReadonlySet<string> | null,
): {
  pendingPermissionCount: number;
  pendingQuestionCount: number;
} {
  return {
    pendingPermissionCount: countPendingItemsInScope(
      snapshot.pendingPermissionBySession,
      sessionScope,
    ),
    pendingQuestionCount: countPendingItemsInScope(snapshot.pendingQuestionBySession, sessionScope),
  };
}

export function hasAllowedWaitingState(input: {
  clarifications?: Iterable<ClarificationLike>;
  nodes?: Iterable<Pick<LayerNode, 'sessionId' | 'substate'>>;
  pendingPermissionCount?: number;
  pendingQuestionCount?: number;
  sessionScope?: ReadonlySet<string> | null;
}): boolean {
  if ((input.pendingPermissionCount ?? 0) > 0 || (input.pendingQuestionCount ?? 0) > 0) {
    return true;
  }

  for (const clarification of input.clarifications ?? []) {
    if (clarification.status !== 'pending') {
      continue;
    }
    if (
      matchesScope(input.sessionScope, clarification.sessionId) ||
      matchesScope(input.sessionScope, clarification.fromSessionId)
    ) {
      return true;
    }
  }

  for (const node of input.nodes ?? []) {
    if (!matchesScope(input.sessionScope, node.sessionId)) {
      continue;
    }
    if (isAllowedWaitingSubstate(node.substate)) {
      return true;
    }
  }

  return false;
}

export function isRuntimeStalled(input: {
  lastActivityAgoMs: number | null;
  running: boolean;
  thresholdMs: number;
  waitingAllowed?: boolean;
}): boolean {
  if (!input.running) {
    return false;
  }
  if (input.waitingAllowed) {
    return false;
  }
  return input.lastActivityAgoMs !== null && input.lastActivityAgoMs > input.thresholdMs;
}

export function resolveScopeLatestActivityAtMs(input: {
  events?: Iterable<Pick<HandoffEvent, 'sessionId' | 'timestamp'>>;
  fallbackUpdatedAt?: string | null;
  handoffs?: Iterable<
    Pick<HandoffEntry, 'fromSessionId' | 'sessionId' | 'toSessionId' | 'updatedAt'>
  >;
  sessionScope?: ReadonlySet<string> | null;
}): number | null {
  let latest = parseIsoTimestampMs(input.fallbackUpdatedAt);

  for (const handoff of input.handoffs ?? []) {
    if (!isScopeEmpty(input.sessionScope) && !matchesHandoffScope(input.sessionScope, handoff)) {
      continue;
    }
    if (latest === null || handoff.updatedAt > latest) {
      latest = handoff.updatedAt;
    }
  }

  for (const event of input.events ?? []) {
    if (!matchesScope(input.sessionScope, event.sessionId)) {
      continue;
    }
    if (latest === null || event.timestamp > latest) {
      latest = event.timestamp;
    }
  }

  return latest;
}

export function resolveSessionScopeStallState(input: {
  clarifications?: Iterable<ClarificationLike>;
  events?: Iterable<Pick<HandoffEvent, 'sessionId' | 'timestamp'>>;
  fallbackUpdatedAt?: string | null;
  handoffs?: Iterable<
    Pick<HandoffEntry, 'fromSessionId' | 'sessionId' | 'toSessionId' | 'updatedAt'>
  >;
  nodes?: Iterable<Pick<LayerNode, 'sessionId' | 'substate'>>;
  pendingPermissionCount?: number;
  pendingQuestionCount?: number;
  running: boolean;
  sessionScope?: ReadonlySet<string> | null;
  thresholdMs: number;
}): {
  latestActivityAtMs: number | null;
  lastActivityAgoMs: number | null;
  stalled: boolean;
  waitingAllowed: boolean;
} {
  const latestActivityAtMs = resolveScopeLatestActivityAtMs({
    events: input.events,
    fallbackUpdatedAt: input.fallbackUpdatedAt,
    handoffs: input.handoffs,
    sessionScope: input.sessionScope,
  });
  const lastActivityAgoMs =
    latestActivityAtMs === null ? null : Math.max(0, Date.now() - latestActivityAtMs);
  const waitingAllowed = hasAllowedWaitingState({
    clarifications: input.clarifications,
    nodes: input.nodes,
    pendingPermissionCount: input.pendingPermissionCount,
    pendingQuestionCount: input.pendingQuestionCount,
    sessionScope: input.sessionScope,
  });
  const stalled = isRuntimeStalled({
    lastActivityAgoMs,
    running: input.running,
    thresholdMs: input.thresholdMs,
    waitingAllowed,
  });
  return {
    latestActivityAtMs,
    lastActivityAgoMs,
    stalled,
    waitingAllowed,
  };
}
