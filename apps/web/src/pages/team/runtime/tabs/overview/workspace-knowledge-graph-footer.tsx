/**
 * 知识图谱 · 底部图例 + 状态条。
 *
 * 从 `WorkspaceKnowledgeGraphView` 拆出：只消费统计数字与当前筛选状态，不持有任何图数据。
 */

import type { JSX } from 'react';
import type { GraphRoleLayer } from '../../data/build-knowledge-graph.js';
import type { KnowledgeGraphLabelDensity } from './graph/knowledge-graph-canvas.js';
import type { LocalGraphDepth } from './workspace-knowledge-graph-toolbar.js';
import { GraphLegend } from './workspace-knowledge-graph-render.js';
import {
  labelDensityLabel,
  persistedCountLabel,
  roleLayerPreviewLabel,
} from './workspace-knowledge-graph-view-helpers.js';

export interface WorkspaceKnowledgeGraphFooterProps {
  readonly activeRoleLayer: GraphRoleLayer | null;
  readonly effectiveLocalGraphDepth: LocalGraphDepth;
  readonly labelDensity: KnowledgeGraphLabelDensity;
  readonly persistedNodeCount: number;
  readonly persistedTruncated: boolean;
  readonly persistedVisibleCount: number;
  readonly totalNodeCount: number;
  readonly visibleEdgeCount: number;
  readonly visibleNodeCount: number;
}

export function WorkspaceKnowledgeGraphFooter({
  activeRoleLayer,
  effectiveLocalGraphDepth,
  labelDensity,
  persistedNodeCount,
  persistedTruncated,
  persistedVisibleCount,
  totalNodeCount,
  visibleEdgeCount,
  visibleNodeCount,
}: WorkspaceKnowledgeGraphFooterProps): JSX.Element {
  return (
    <div className="workspace-knowledge-graph-footer">
      <GraphLegend />
      <span className="workspace-knowledge-graph-status-strip">
        可见 {visibleNodeCount} / 全图 {totalNodeCount} 节点 · {visibleEdgeCount} 关系 · 已入库{' '}
        {persistedCountLabel(persistedVisibleCount, persistedNodeCount, persistedTruncated)} ·{' '}
        {roleLayerPreviewLabel(activeRoleLayer)} · 局部图{' '}
        {effectiveLocalGraphDepth === 0 ? '关闭' : `${effectiveLocalGraphDepth} 跳`} · 标签{' '}
        {labelDensityLabel(labelDensity)}
      </span>
    </div>
  );
}
