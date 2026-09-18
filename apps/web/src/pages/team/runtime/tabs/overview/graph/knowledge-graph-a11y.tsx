import type { JSX } from 'react';
import type { GraphNodeModel } from './knowledge-graph-model.js';
import './knowledge-graph-a11y.css';

/**
 * 无障碍层节点上限：与 `WorkspaceKnowledgeGraphView` 的 `MAX_NODES = 1200` 一致。
 * 应用本身拒绝渲染超过 1200 个节点的图谱，这里再夹一次，防止上游传入超限数据时产生
 * 上千个隐藏焦点按钮拖垮 tab 顺序。
 */
export const KNOWLEDGE_GRAPH_A11Y_NODE_CAP = 1200;

export interface KnowledgeGraphA11yLayerProps {
  readonly nodes: readonly GraphNodeModel[];
  readonly selectedNodeId: string | null;
  readonly focusAnnouncement: string | null;
  /** 因视口容量不足被拒绝展开的节点：读屏文案说明「当前尺寸下无法展开」。 */
  readonly capacityBlockedIds?: ReadonlySet<string>;
  readonly onSelectNode: (nodeId: string) => void;
}

/**
 * canvas 渲染器（G6 v5 或旧 d3-force）不向无障碍树暴露任何节点，因此每个节点
 * 需要一个真正可聚焦的 `<button>`。该层纯展示：只消费 `GraphNodeModel[]`，
 * 不触碰图数据、G6 实例或全局状态。
 *
 * 节点顺序严格等于 `nodes` 顺序，保证屏幕阅读器遍历顺序稳定、可预测。
 */
export function KnowledgeGraphA11yLayer({
  nodes,
  selectedNodeId,
  focusAnnouncement,
  capacityBlockedIds,
  onSelectNode,
}: KnowledgeGraphA11yLayerProps): JSX.Element {
  const cappedNodes = nodes.slice(0, KNOWLEDGE_GRAPH_A11Y_NODE_CAP);

  return (
    <div className="knowledge-graph-a11y-layer">
      {cappedNodes.map((node) => {
        const capacityBlocked = capacityBlockedIds?.has(node.id) === true;
        return (
          <button
            key={node.id}
            type="button"
            className="knowledge-graph-a11y-node"
            aria-label={
              capacityBlocked
                ? `无法展开：${node.label}（当前容器尺寸下子节点过多）`
                : `选择节点：${node.label}`
            }
            aria-current={node.id === selectedNodeId ? 'true' : undefined}
            aria-disabled={capacityBlocked ? true : undefined}
            data-label={node.label}
            onClick={() => onSelectNode(node.id)}
          />
        );
      })}
      <div className="knowledge-graph-a11y-live" aria-live="polite" aria-atomic="true">
        {focusAnnouncement}
      </div>
    </div>
  );
}
