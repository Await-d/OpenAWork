import type {
  HandoffEntry,
  LayerNode,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import {
  collectSessionScope,
  isHandoffInSessionScope,
} from '../../data/team-runtime-session-scope.js';

export interface TeamStatusBarStats {
  activeLayers: TeamRoleLayer[];
  cancelled: number;
  completed: number;
  elapsedMs: number | null;
  estimatedRemainingMs: number | null;
  failed: number;
  pending: number;
  progress: number;
  running: number;
  total: number;
}

export function filterHandoffsForStatusBar(
  handoffs: Iterable<HandoffEntry>,
  nodes: Iterable<LayerNode>,
  selectedSessionId?: string | null,
): HandoffEntry[] {
  const entries = Array.from(handoffs);
  if (!selectedSessionId) {
    return entries;
  }

  const sessionScope = collectSessionScope(selectedSessionId, nodes);
  return entries.filter((handoff) => isHandoffInSessionScope(handoff, sessionScope));
}

export function computeTeamStatusBarStats(handoffs: Iterable<HandoffEntry>): TeamStatusBarStats {
  let pending = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let earliestStart: number | null = null;
  const activeLayers = new Set<TeamRoleLayer>();

  for (const handoff of handoffs) {
    if (
      handoff.paused === true &&
      handoff.state !== 'completed' &&
      handoff.state !== 'failed' &&
      handoff.state !== 'cancelled'
    ) {
      pending += 1;
      continue;
    }

    if (handoff.state === 'pending') {
      pending += 1;
      continue;
    }

    if (handoff.state === 'running' || handoff.state === 'claimed') {
      running += 1;
      activeLayers.add(handoff.toRoleLayer);
      const startedAt = handoff.startedAt ?? handoff.updatedAt;
      if (earliestStart === null || startedAt < earliestStart) {
        earliestStart = startedAt;
      }
      continue;
    }

    if (handoff.state === 'completed') {
      completed += 1;
      continue;
    }

    if (handoff.state === 'failed') {
      failed += 1;
      continue;
    }

    if (handoff.state === 'cancelled') {
      cancelled += 1;
    }
  }

  const total = pending + running + completed + failed + cancelled;
  const progress = total > 0 ? completed / total : 0;
  const elapsedMs = earliestStart != null ? Date.now() - earliestStart : null;
  const remaining = Math.max(total - completed, 0);
  const averageTaskMs = completed > 0 && elapsedMs !== null ? elapsedMs / completed : null;
  const estimatedRemainingMs =
    remaining === 0 ? 0 : averageTaskMs !== null ? remaining * averageTaskMs : null;

  return {
    activeLayers: Array.from(activeLayers),
    cancelled,
    completed,
    elapsedMs,
    estimatedRemainingMs,
    failed,
    pending,
    progress,
    running,
    total,
  };
}
