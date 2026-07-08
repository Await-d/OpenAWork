import type { TeamRuntimeSessionRecord } from '@openAwork/web-client';
import type {
  HandoffEntry,
  HandoffState,
  LayerNode,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import type { EdgeView, LayerNodeView } from './LayerFlowPipeline.js';
import {
  FLOW_LAYERS,
  isActiveHandoffState,
  isFlowLayer,
  normalizeFlowNodeState,
  normalizeFlowRoleLayer,
  resolveFlowHandoffSessionId,
} from './layer-flow-state.js';

export type LayerFlowDensityMode = 'active' | 'all';
export type LayerFlowDetailMode = 'session' | 'thread';

export function buildSnapshotNodes(sessions: readonly TeamRuntimeSessionRecord[]): LayerNode[] {
  const result: LayerNode[] = [];
  for (const session of sessions) {
    const roleLayer = normalizeFlowRoleLayer(session.roleLayer ?? session.roleInstance?.roleLayer);
    if (!roleLayer || !isFlowLayer(roleLayer)) {
      continue;
    }
    result.push({
      parentSessionId: session.parentSessionId,
      roleLayer,
      sessionId: session.id,
      state: normalizeFlowNodeState(session.paused ? 'paused' : session.stateStatus),
      ...(session.roleInstance?.rootSessionId
        ? { rootSessionId: session.roleInstance.rootSessionId }
        : {}),
      ...(session.roleInstance?.personaKey ? { personaKey: session.roleInstance.personaKey } : {}),
      ...(session.roleInstance?.displayName
        ? { displayName: session.roleInstance.displayName }
        : {}),
      ...(session.title ? { title: session.title } : {}),
    });
  }
  return result;
}

export function mergeLayerNodes(
  snapshotNodes: readonly LayerNode[],
  liveNodes: ReadonlyMap<string, LayerNode>,
): Map<string, LayerNode> {
  const next = new Map<string, LayerNode>();
  for (const node of snapshotNodes) {
    next.set(node.sessionId, node);
  }
  for (const node of liveNodes.values()) {
    next.set(node.sessionId, {
      ...next.get(node.sessionId),
      ...node,
    });
  }
  return next;
}

export function buildLayerViews(
  scopedHandoffs: ReadonlyMap<string, HandoffEntry>,
  scopedNodes: ReadonlyMap<string, LayerNode>,
  densityMode: LayerFlowDensityMode,
  selectedSessionId: string | null,
): LayerNodeView[] {
  const entries = Array.from(scopedHandoffs.values());
  const views = FLOW_LAYERS.map((layer) => {
    const inbound = entries.filter((handoff) => handoff.toRoleLayer === layer);
    inbound.sort((a, b) => b.updatedAt - a.updatedAt);
    const latest = inbound[0] ?? null;
    let sessionId = latest ? resolveFlowHandoffSessionId(latest, scopedNodes) : null;

    if (!sessionId) {
      for (const node of scopedNodes.values()) {
        if (node.roleLayer === layer) {
          sessionId = node.sessionId;
          break;
        }
      }
    }

    const matchedNode = sessionId ? (scopedNodes.get(sessionId) ?? null) : null;
    const state: HandoffState | 'idle' = latest?.state ?? matchedNode?.state ?? 'idle';
    const layerNodes = Array.from(scopedNodes.values()).filter((node) => node.roleLayer === layer);
    const handoffSessionIds = new Set(
      inbound
        .map((handoff) => resolveFlowHandoffSessionId(handoff, scopedNodes))
        .filter((sid): sid is string => sid !== null),
    );
    const existingSessionIds = new Set(layerNodes.map((node) => node.sessionId));

    for (const sid of handoffSessionIds) {
      if (!existingSessionIds.has(sid)) {
        layerNodes.push({
          sessionId: sid,
          roleLayer: layer,
          parentSessionId: null,
          state: latest?.state ?? 'idle',
          personaKey: null,
          displayName: null,
        });
      }
    }

    return {
      layer,
      sessionId,
      state,
      active: latest ? isActiveHandoffState(latest.state) : false,
      inboundCount: inbound.length,
      roleInstances: layerNodes.map((node) => ({
        sessionId: node.sessionId,
        displayName: node.displayName ?? null,
        personaKey: node.personaKey ?? null,
        state: node.state,
      })),
    };
  });

  if (densityMode === 'all') {
    return views;
  }

  return views.filter(
    (view) =>
      view.active ||
      view.inboundCount > 0 ||
      view.sessionId !== null ||
      view.sessionId === selectedSessionId,
  );
}

export function buildLayerEdges(scopedHandoffs: ReadonlyMap<string, HandoffEntry>): EdgeView[] {
  const entries = Array.from(scopedHandoffs.values());
  const result: EdgeView[] = [];
  for (let i = 0; i < FLOW_LAYERS.length - 1; i += 1) {
    const from = FLOW_LAYERS[i];
    const to = FLOW_LAYERS[i + 1];
    if (!from || !to) {
      continue;
    }
    const matching = entries
      .filter((handoff) => handoff.fromRoleLayer === from && handoff.toRoleLayer === to)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const latest = matching[0] ?? null;
    result.push({
      fromIndex: i,
      toIndex: i + 1,
      latest,
      active: latest ? isActiveHandoffState(latest.state) : false,
      state: latest?.state ?? 'idle',
    });
  }
  return result;
}

export function buildSessionTitleById(
  sessions: readonly TeamRuntimeSessionRecord[],
  scopedNodes: ReadonlyMap<string, LayerNode>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const session of sessions) {
    if (session.title?.trim()) {
      map.set(session.id, session.title);
    }
  }
  for (const node of scopedNodes.values()) {
    if (node.title?.trim()) {
      map.set(node.sessionId, node.title);
    }
    if (node.displayName?.trim() && !map.has(node.sessionId)) {
      map.set(node.sessionId, node.displayName);
    }
  }
  return map;
}

export function buildLayerDetailTeam(view: LayerNodeView): AgentTeamsSidebarTeam | null {
  if (!view.sessionId) {
    return null;
  }
  const identity = getRoleLayerIdentity(view.layer);
  return {
    id: view.sessionId,
    status: flowStateToTeamStatus(view.state),
    subtitle: `${identity.label} 层`,
    title: `${identity.label} 会话`,
  };
}

export function buildHandoffDetailTeam(
  entry: HandoffEntry,
  threadSessionId: string | null,
): AgentTeamsSidebarTeam | null {
  if (!threadSessionId) {
    return null;
  }
  return {
    id: threadSessionId,
    status: flowStateToTeamStatus(entry.state),
    subtitle: `${getRoleLayerIdentity(entry.fromRoleLayer).label} → ${
      getRoleLayerIdentity(entry.toRoleLayer).label
    }`,
    title: entry.summary ?? '跨层线程',
  };
}

export function buildHandoffReuseBadge(
  selectedHandoff: HandoffEntry | null,
  selectedSessionId: string | null,
  scopedHandoffs: ReadonlyMap<string, HandoffEntry>,
  scopedNodes: ReadonlyMap<string, LayerNode>,
): string | null {
  const targetSessionId = selectedHandoff
    ? resolveFlowHandoffSessionId(selectedHandoff, scopedNodes)
    : null;
  const threadSessionId = targetSessionId ?? selectedHandoff?.fromSessionId ?? selectedSessionId;
  const reuseCount =
    threadSessionId && selectedHandoff
      ? Array.from(scopedHandoffs.values()).filter(
          (entry) => resolveFlowHandoffSessionId(entry, scopedNodes) === threadSessionId,
        ).length
      : 0;

  return reuseCount > 1 ? `当前轮次 · 第 ${reuseCount} 轮（复用会话）` : null;
}

function flowStateToTeamStatus(state: HandoffState | 'idle'): AgentTeamsSidebarTeam['status'] {
  switch (state) {
    case 'failed':
      return 'failed';
    case 'running':
    case 'claimed':
    case 'pending':
      return 'running';
    case 'cancelled':
      return 'paused';
    case 'completed':
    case 'idle':
      return 'completed';
    default:
      return 'completed';
  }
}
