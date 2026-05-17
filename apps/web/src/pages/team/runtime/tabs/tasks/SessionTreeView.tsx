/**
 * 260515-team-phase-b · T-13
 *
 * Session 树可视化：展示五层 session 的 parent→child 关系。
 * 嵌入右侧面板任务 Tab 中。
 */

import { useMemo, type CSSProperties } from 'react';
import {
  useLayerStore,
  type LayerNode,
  type TeamRoleLayer,
} from '../../../../../stores/team-events.js';

const TREE_CONTAINER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 12,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 78%, var(--bg))',
};

const TREE_DEPTH_INDENT = 14;

const NODE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
  fontSize: 12,
};

interface OrderedLayerNode {
  node: LayerNode;
  depth: number;
}

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  reviewer: '评审',
};

const STATE_ICONS: Record<string, string> = {
  idle: '○',
  pending: '◌',
  claimed: '◐',
  running: '●',
  completed: '✓',
  failed: '✗',
  cancelled: '⊘',
};

export interface SessionTreeViewProps {
  onSelectSession?: (sessionId: string) => void;
}

export function SessionTreeView({ onSelectSession }: SessionTreeViewProps) {
  const nodes = useLayerStore((s) => s.nodes);

  const orderedNodes = useMemo<OrderedLayerNode[]>(() => {
    const arr = Array.from(nodes.values());
    const layerOrder: TeamRoleLayer[] = ['reception', 'pm1', 'pm2', 'executor', 'reviewer', 'user'];
    const byParent = new Map<string | null, LayerNode[]>();
    for (const node of arr) {
      const siblings = byParent.get(node.parentSessionId) ?? [];
      siblings.push(node);
      byParent.set(node.parentSessionId, siblings);
    }

    for (const siblings of byParent.values()) {
      siblings.sort((a, b) => layerOrder.indexOf(a.roleLayer) - layerOrder.indexOf(b.roleLayer));
    }

    const ordered: OrderedLayerNode[] = [];
    const visited = new Set<string>();
    const visit = (parentSessionId: string | null, depth: number) => {
      const siblings = byParent.get(parentSessionId) ?? [];
      for (const node of siblings) {
        if (visited.has(node.sessionId)) continue;
        visited.add(node.sessionId);
        ordered.push({ node, depth });
        visit(node.sessionId, depth + 1);
      }
    };

    visit(null, 0);
    for (const node of arr) {
      if (!visited.has(node.sessionId)) {
        ordered.push({ node, depth: 0 });
      }
    }

    return ordered;
  }, [nodes]);

  if (orderedNodes.length === 0) {
    return (
      <div style={TREE_CONTAINER_STYLE}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          暂无活跃的团队 session 树。创建 handoff 后这里会显示五层结构。
        </span>
      </div>
    );
  }

  return (
    <div style={TREE_CONTAINER_STYLE}>
      <span
        style={{
          fontSize: 11,
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Session 树（{orderedNodes.length} 节点）
      </span>
      {orderedNodes.map(({ node, depth }) => (
        <button
          key={node.sessionId}
          type="button"
          className="team-v2-control team-v2-task-card"
          style={{
            ...NODE_STYLE,
            cursor: onSelectSession ? 'pointer' : 'default',
            marginLeft: depth > 0 ? depth * TREE_DEPTH_INDENT : 0,
          }}
          onClick={() => onSelectSession?.(node.sessionId)}
          title={`Session: ${node.sessionId}`}
        >
          <span style={{ fontSize: 14 }}>{STATE_ICONS[node.state] ?? '?'}</span>
          <span style={{ fontWeight: 700 }}>{LAYER_LABELS[node.roleLayer]}</span>
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>
            {node.sessionId.slice(0, 8)}…
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: node.state === 'running' ? 'var(--success, #22c55e)' : 'var(--text-3)',
            }}
          >
            {node.state}
          </span>
        </button>
      ))}
    </div>
  );
}
