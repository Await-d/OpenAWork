import { useEffect, useMemo, useState } from 'react';
import { useHandoffStore, useLayerStore } from '../../../../../stores/team/team-events.js';
import {
  subscribeSessionRunState,
  type SessionRunState,
} from '../../../../../utils/session/session-list-events.js';
import type {
  AgentTeamsSidebarTeam,
  AgentTeamsWorkspaceGroup,
} from '../../data/team-runtime-types.js';
import { formatSidebarTeamStatus } from '../../data/team-runtime-status.js';
import {
  collectSessionScope,
  isHandoffInSessionScope,
} from '../../data/team-runtime-session-scope.js';

type SidebarRunStateOverride = SessionRunState;
type LiveTreeRunStateOverride = Extract<SessionRunState, 'running' | 'paused'>;

const ACTIVE_HANDOFF_STATES = new Set(['pending', 'claimed', 'running']);

function applyRunStateOverridesToWorkspaceGroups(
  workspaceGroups: AgentTeamsWorkspaceGroup[],
  localRunStateOverrides: ReadonlyMap<string, SidebarRunStateOverride>,
  liveTreeRunStateOverrides: ReadonlyMap<string, LiveTreeRunStateOverride>,
): AgentTeamsWorkspaceGroup[] {
  if (localRunStateOverrides.size === 0 && liveTreeRunStateOverrides.size === 0) {
    return workspaceGroups;
  }

  return workspaceGroups.map((group) => ({
    ...group,
    sessions: group.sessions.map((session) => {
      const localOverride = localRunStateOverrides.get(session.id);
      const liveTreeOverride = liveTreeRunStateOverrides.get(session.id);
      const nextStatus = resolveDisplayedSessionStatus({
        baseStatus: session.status,
        liveTreeOverride,
        localOverride,
      });
      if (nextStatus === session.status) {
        return session;
      }

      return {
        ...session,
        status: nextStatus,
        subtitle: formatSidebarTeamStatus(nextStatus),
      };
    }),
  }));
}

function resolveDisplayedSessionStatus(input: {
  baseStatus: AgentTeamsSidebarTeam['status'];
  liveTreeOverride?: LiveTreeRunStateOverride;
  localOverride?: SidebarRunStateOverride;
}): AgentTeamsSidebarTeam['status'] {
  if (input.liveTreeOverride === 'running' || input.localOverride === 'running') {
    return 'running';
  }
  if (input.liveTreeOverride === 'paused' || input.localOverride === 'paused') {
    return 'paused';
  }
  if (
    input.localOverride === 'idle' &&
    input.baseStatus !== 'completed' &&
    input.baseStatus !== 'failed' &&
    input.baseStatus !== 'paused'
  ) {
    return 'idle';
  }
  return input.baseStatus;
}

function deriveLiveTreeRunStateOverrides(input: {
  sessions: AgentTeamsSidebarTeam[];
  nodes: ReturnType<typeof useLayerStore.getState>['nodes'];
  handoffs: ReturnType<typeof useHandoffStore.getState>['handoffs'];
}): Map<string, LiveTreeRunStateOverride> {
  const handoffEntries = Array.from(input.handoffs.values());
  const nodeEntries = Array.from(input.nodes.values());
  const overrides = new Map<string, LiveTreeRunStateOverride>();

  for (const session of input.sessions) {
    if (session.isSharedSession === true) {
      continue;
    }

    const sessionScope = collectSessionScope(session.id, nodeEntries);
    let hasPausedHandoff = false;
    let hasActiveHandoff = false;
    let hasRunningDescendantNode = false;

    for (const node of nodeEntries) {
      if (!sessionScope.has(node.sessionId)) {
        continue;
      }
      if (node.sessionId !== session.id && node.state === 'running') {
        hasRunningDescendantNode = true;
        break;
      }
    }

    for (const handoff of handoffEntries) {
      if (!isHandoffInSessionScope(handoff, sessionScope)) {
        continue;
      }

      if (
        handoff.paused === true &&
        handoff.state !== 'completed' &&
        handoff.state !== 'failed' &&
        handoff.state !== 'cancelled'
      ) {
        hasPausedHandoff = true;
      }

      if (ACTIVE_HANDOFF_STATES.has(handoff.state) && handoff.paused !== true) {
        hasActiveHandoff = true;
      }
    }

    if (hasActiveHandoff || hasRunningDescendantNode) {
      overrides.set(session.id, 'running');
    } else if (hasPausedHandoff) {
      overrides.set(session.id, 'paused');
    }
  }

  return overrides;
}

export interface TeamSessionListRuntimeState {
  effectiveWorkspaceGroups: AgentTeamsWorkspaceGroup[];
}

export function useTeamSessionListRuntimeState(
  workspaceGroups: AgentTeamsWorkspaceGroup[],
): TeamSessionListRuntimeState {
  const handoffs = useHandoffStore((state) => state.handoffs);
  const nodes = useLayerStore((state) => state.nodes);
  const [runStateOverrides, setRunStateOverrides] = useState<Map<string, SidebarRunStateOverride>>(
    () => new Map(),
  );
  const baseAllSessions = useMemo(
    () => workspaceGroups.flatMap((group) => group.sessions),
    [workspaceGroups],
  );
  const liveTreeRunStateOverrides = useMemo(
    () =>
      deriveLiveTreeRunStateOverrides({
        sessions: baseAllSessions,
        nodes,
        handoffs,
      }),
    [baseAllSessions, handoffs, nodes],
  );
  const effectiveWorkspaceGroups = useMemo(
    () =>
      applyRunStateOverridesToWorkspaceGroups(
        workspaceGroups,
        runStateOverrides,
        liveTreeRunStateOverrides,
      ),
    [liveTreeRunStateOverrides, runStateOverrides, workspaceGroups],
  );
  useEffect(() => {
    const sessionsById = new Map(
      workspaceGroups.flatMap((group) => group.sessions.map((session) => [session.id, session])),
    );
    const liveSessionIds = new Set(
      workspaceGroups.flatMap((group) => group.sessions.map((session) => session.id)),
    );
    setRunStateOverrides((previous) => {
      if (previous.size === 0) {
        return previous;
      }

      let changed = false;
      const next = new Map(previous);
      for (const [sessionId, overrideState] of next.entries()) {
        if (!liveSessionIds.has(sessionId)) {
          next.delete(sessionId);
          changed = true;
          continue;
        }

        const freshSession = sessionsById.get(sessionId);
        if (!freshSession) {
          continue;
        }

        const freshStatus = freshSession.status;
        if (
          freshStatus === overrideState ||
          freshStatus === 'completed' ||
          freshStatus === 'failed'
        ) {
          next.delete(sessionId);
          changed = true;
          continue;
        }
      }
      return changed ? next : previous;
    });
  }, [workspaceGroups]);

  useEffect(() => {
    return subscribeSessionRunState((sessionId, state) => {
      setRunStateOverrides((previous) => {
        const next = new Map(previous);
        next.set(sessionId, state);
        return next;
      });
    });
  }, []);

  return {
    effectiveWorkspaceGroups,
  };
}
