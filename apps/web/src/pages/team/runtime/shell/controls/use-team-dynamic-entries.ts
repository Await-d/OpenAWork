import { useMemo } from 'react';
import type { TeamRuntimeSessionRecord } from '@openAwork/web-client';
import type { LayerNode } from '../../../../../stores/team/team-events.js';
import {
  useClarificationStore,
  useLayerStore,
  useTeamNotificationStore,
} from '../../../../../stores/team/team-events.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { collectSessionScope } from '../../data/team-runtime-session-scope.js';
import {
  buildClarificationPushEvents,
  buildTeamDynamicEntries,
  filterPendingClarificationsForScope,
  filterTeamDynamicEventsForScope,
  type TeamDynamicEntry,
} from './team-dynamic-events.js';

interface TeamDynamicScopeNode {
  id: string;
  parentSessionId: string | null;
}

export function buildTeamDynamicScopeNodes(input: {
  layerNodes: Iterable<Pick<LayerNode, 'parentSessionId' | 'sessionId'>>;
  sessions: Array<Pick<TeamRuntimeSessionRecord, 'id' | 'parentSessionId'>>;
}): TeamDynamicScopeNode[] {
  const merged = new Map<string, TeamDynamicScopeNode>();

  for (const session of input.sessions) {
    merged.set(session.id, {
      id: session.id,
      parentSessionId: session.parentSessionId,
    });
  }

  for (const node of input.layerNodes) {
    const existing = merged.get(node.sessionId);
    merged.set(node.sessionId, {
      id: node.sessionId,
      parentSessionId: node.parentSessionId ?? existing?.parentSessionId ?? null,
    });
  }

  return Array.from(merged.values());
}

export function useTeamDynamicEntries(receptionSessionId: string | null): TeamDynamicEntry[] {
  const { sessions } = useTeamRuntimeReferenceViewData();
  const events = useTeamNotificationStore((state) => state.events);
  const clarificationItems = useClarificationStore((state) => state.items);
  const layerNodes = useLayerStore((state) => state.nodes);

  const dynamicScopeNodes = useMemo(
    () =>
      buildTeamDynamicScopeNodes({
        sessions,
        layerNodes: layerNodes.values(),
      }),
    [layerNodes, sessions],
  );

  const dynamicSessionScope = useMemo(
    () => (receptionSessionId ? collectSessionScope(receptionSessionId, dynamicScopeNodes) : null),
    [dynamicScopeNodes, receptionSessionId],
  );

  const scopedEvents = useMemo(
    () =>
      receptionSessionId
        ? filterTeamDynamicEventsForScope(events, dynamicSessionScope, receptionSessionId)
        : [],
    [dynamicSessionScope, events, receptionSessionId],
  );

  const scopedClarificationItems = useMemo(
    () =>
      receptionSessionId
        ? filterPendingClarificationsForScope(
            clarificationItems,
            dynamicSessionScope,
            receptionSessionId,
          )
        : [],
    [clarificationItems, dynamicSessionScope, receptionSessionId],
  );

  const clarificationEvents = useMemo(
    () => buildClarificationPushEvents(scopedClarificationItems, scopedEvents),
    [scopedClarificationItems, scopedEvents],
  );

  return useMemo(
    () => buildTeamDynamicEntries([...scopedEvents, ...clarificationEvents]),
    [clarificationEvents, scopedEvents],
  );
}
