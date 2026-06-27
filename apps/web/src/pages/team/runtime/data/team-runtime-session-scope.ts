import type { SessionTask } from '@openAwork/web-client';
import type {
  HandoffEntry,
  HandoffEvent,
  LayerNode,
} from '../../../../stores/team/team-events.js';

type SessionScopeNode =
  | Pick<LayerNode, 'parentSessionId' | 'sessionId'>
  | { id: string; parentSessionId: string | null };

function readNodeSessionId(node: SessionScopeNode): string {
  return 'sessionId' in node ? node.sessionId : node.id;
}

export function collectSessionScope(
  rootSessionId: string | null,
  nodes: Iterable<SessionScopeNode>,
): Set<string> {
  if (!rootSessionId) {
    return new Set<string>();
  }

  const scope = new Set<string>([rootSessionId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const node of nodes) {
      const sessionId = readNodeSessionId(node);
      if (!node.parentSessionId || scope.has(sessionId)) {
        continue;
      }
      if (scope.has(node.parentSessionId)) {
        scope.add(sessionId);
        changed = true;
      }
    }
  }

  return scope;
}

export function isSessionInScope(
  sessionId: string | null | undefined,
  sessionScope: Set<string>,
): boolean {
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionScope.has(sessionId);
}

export function isHandoffInSessionScope(
  handoff: Pick<HandoffEntry, 'fromSessionId' | 'sessionId' | 'toSessionId'>,
  sessionScope: Set<string>,
): boolean {
  return (
    isSessionInScope(handoff.fromSessionId, sessionScope) ||
    isSessionInScope(handoff.toSessionId ?? undefined, sessionScope) ||
    isSessionInScope(handoff.sessionId, sessionScope)
  );
}

export function isRuntimeTaskInSessionScope(
  task: Pick<SessionTask, 'sessionId'>,
  sessionScope: Set<string>,
): boolean {
  return isSessionInScope(task.sessionId, sessionScope);
}

export function countUnreadNotificationEventsInScope(
  events: ReadonlyArray<HandoffEvent>,
  readEventKeys: ReadonlySet<string>,
  sessionScope: Set<string> | null,
  getEventKey: (event: HandoffEvent) => string,
  fallbackUnreadCount: number,
): number {
  if (!sessionScope) {
    return fallbackUnreadCount;
  }

  return events.filter((event) => {
    const candidateSessionIds = [
      event.sessionId,
      typeof event.payload['sessionId'] === 'string' ? event.payload['sessionId'] : null,
      typeof event.payload['fromSessionId'] === 'string' ? event.payload['fromSessionId'] : null,
      typeof event.payload['toSessionId'] === 'string' ? event.payload['toSessionId'] : null,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (candidateSessionIds.length === 0) {
      return false;
    }

    return (
      candidateSessionIds.some((sessionId) => sessionScope.has(sessionId)) &&
      !readEventKeys.has(getEventKey(event))
    );
  }).length;
}
