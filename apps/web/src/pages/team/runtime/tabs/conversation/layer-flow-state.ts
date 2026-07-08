import type {
  HandoffEntry,
  HandoffState,
  LayerNode,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';

export const FLOW_LAYERS: readonly TeamRoleLayer[] = [
  'reception',
  'pm1',
  'pm2',
  'executor',
  'reviewer',
];

export const STATE_COLOR: Record<string, string> = {
  idle: 'var(--fg-muted)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--accent)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-muted)',
};

export const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const ACTIVE_STATES = new Set<HandoffState>(['pending', 'claimed', 'running']);
const FLOW_LAYER_SET = new Set<TeamRoleLayer>(FLOW_LAYERS);

export function isActiveHandoffState(state: HandoffState): boolean {
  return ACTIVE_STATES.has(state);
}

export function isFlowLayer(layer: TeamRoleLayer): boolean {
  return FLOW_LAYER_SET.has(layer);
}

export function normalizeFlowRoleLayer(value: string | null | undefined): TeamRoleLayer | null {
  switch (value) {
    case 'reception':
    case 'pm1':
    case 'pm2':
    case 'executor':
    case 'reviewer':
      return value;
    default:
      return null;
  }
}

export function normalizeFlowNodeState(value: string | null | undefined): HandoffState | 'idle' {
  switch (value) {
    case 'pending':
    case 'claimed':
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return value;
    case 'paused':
      return 'claimed';
    default:
      return 'idle';
  }
}

export function resolveFlowHandoffSessionId(
  handoff: HandoffEntry,
  nodes: ReadonlyMap<string, LayerNode>,
): string | null {
  if (handoff.toSessionId) {
    return handoff.toSessionId;
  }

  const explicitNode = handoff.sessionId ? (nodes.get(handoff.sessionId) ?? null) : null;
  if (explicitNode?.roleLayer === handoff.toRoleLayer) {
    return handoff.sessionId ?? null;
  }

  const nodeList = Array.from(nodes.values());
  const directChild = handoff.fromSessionId
    ? nodeList.find(
        (node) =>
          node.parentSessionId === handoff.fromSessionId && node.roleLayer === handoff.toRoleLayer,
      )
    : null;
  if (directChild) {
    return directChild.sessionId;
  }

  const sessionChild = handoff.sessionId
    ? nodeList.find(
        (node) =>
          node.parentSessionId === handoff.sessionId && node.roleLayer === handoff.toRoleLayer,
      )
    : null;
  if (sessionChild) {
    return sessionChild.sessionId;
  }

  const scopedLayerMatch = nodeList.find(
    (node) => node.roleLayer === handoff.toRoleLayer && node.sessionId !== handoff.fromSessionId,
  );
  return scopedLayerMatch?.sessionId ?? handoff.sessionId ?? null;
}
