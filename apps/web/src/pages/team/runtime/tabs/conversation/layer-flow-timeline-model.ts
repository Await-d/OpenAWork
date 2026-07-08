import type { HandoffEntry, TeamRoleLayer } from '../../../../../stores/team/team-events.js';
import type { LayerFlowTimelineSection, SessionHandoffGroup } from './LayerFlowTimelinePanel.js';

const FLOW_TIMELINE_SECTION_ORDER: readonly TeamRoleLayer[] = [
  'pm1',
  'pm2',
  'executor',
  'reviewer',
  'reception',
];

export function buildLayerTimeline(
  scopedHandoffs: ReadonlyMap<string, HandoffEntry>,
): HandoffEntry[] {
  return Array.from(scopedHandoffs.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function buildLayerTimelineSections(
  timeline: readonly HandoffEntry[],
): LayerFlowTimelineSection[] {
  return FLOW_TIMELINE_SECTION_ORDER.map((layer) => {
    const groupMap = new Map<string, HandoffEntry[]>();
    for (const entry of timeline.filter((item) => item.toRoleLayer === layer)) {
      const key = entry.toSessionId ?? entry.sessionId ?? entry.id;
      const existing = groupMap.get(key);
      if (existing) {
        existing.push(entry);
      } else {
        groupMap.set(key, [entry]);
      }
    }

    const groups = Array.from(groupMap.entries())
      .map((entry): SessionHandoffGroup | null => {
        const [sessionId, entries] = entry;
        const sortedEntries = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
        const first = sortedEntries[0] ?? null;
        if (!first) {
          return null;
        }
        return {
          sessionId,
          entries: sortedEntries,
          toRoleLayer: first.toRoleLayer,
          fromRoleLayer: first.fromRoleLayer,
          state: first.state,
          summary: first.summary,
          updatedAt: first.updatedAt,
        };
      })
      .filter((group): group is SessionHandoffGroup => group !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return { groups, layer };
  }).filter((section) => section.groups.length > 0);
}
