import type { HandoffEntry } from '../../../stores/team/team-events.js';
import type { TeamPageMode } from '../runtime/hooks/use-team-page-state.js';

export function resolveEffectiveTeamPageMode(
  baseMode: TeamPageMode,
  isSelectedTeamPaused: boolean,
): TeamPageMode {
  if (isSelectedTeamPaused) {
    return 'paused';
  }
  return baseMode === 'paused' ? 'running' : baseMode;
}

export function countRuntimeTreeHandoffs(handoffs: HandoffEntry[]): {
  activeCount: number;
  staleCount: number;
} {
  let activeCount = 0;
  let staleCount = 0;

  for (const handoff of handoffs) {
    if (handoff.state === 'pending' || handoff.state === 'claimed' || handoff.state === 'running') {
      activeCount += 1;
    }
    if (handoff.state === 'pending' || handoff.state === 'claimed') {
      staleCount += 1;
    }
  }

  return { activeCount, staleCount };
}
