/**
 * 知识图谱 · 画布顶层覆盖层（无障碍节点层 / 不可用回退 / 焦点邻域计数）。
 *
 * 从 `knowledge-graph-canvas.tsx` 拆出：均为纯展示，依赖 `GraphNodeModel[]` 与少量标签，
 * 不触碰 G6 实例或图数据，让画布宿主只保留实例与视口职责。
 */

import type { JSX } from 'react';
import { KnowledgeGraphA11yLayer } from './knowledge-graph-a11y.js';
import { KnowledgeGraphFallback } from './knowledge-graph-fallback.js';
import type { GraphNodeModel } from './knowledge-graph-model.js';

export interface KnowledgeGraphCanvasOverlaysProps {
  readonly nodes: readonly GraphNodeModel[];
  readonly selectedNodeId: string | null;
  readonly focusAnnouncement: string | null;
  /** 焦点邻域计数；`null` 表示当前无焦点、不显示计数。 */
  readonly focusCount: number | null;
  readonly capacityBlockedIds?: ReadonlySet<string>;
  /** WebGL 与默认渲染器都失败时改画可聚焦的节点回退面板。 */
  readonly unavailable: boolean;
  readonly onSelectNode: (nodeId: string) => void;
}

export function KnowledgeGraphCanvasOverlays({
  nodes,
  selectedNodeId,
  focusAnnouncement,
  focusCount,
  capacityBlockedIds,
  unavailable,
  onSelectNode,
}: KnowledgeGraphCanvasOverlaysProps): JSX.Element {
  if (unavailable) {
    return <KnowledgeGraphFallback nodes={nodes} onSelectNode={onSelectNode} />;
  }
  return (
    <>
      <KnowledgeGraphA11yLayer
        nodes={nodes}
        selectedNodeId={selectedNodeId}
        focusAnnouncement={focusAnnouncement}
        capacityBlockedIds={capacityBlockedIds}
        onSelectNode={onSelectNode}
      />
      {focusCount === null ? null : (
        <span className="workspace-knowledge-graph-focus-count">邻域 {focusCount}</span>
      )}
    </>
  );
}
