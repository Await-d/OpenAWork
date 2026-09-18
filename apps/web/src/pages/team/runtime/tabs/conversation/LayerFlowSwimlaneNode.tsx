/**
 * 260916-层级可视化重构 · T-02 · 泳道节点卡片
 *
 * 单条 handoff 在泳道画布上的落点：状态色编码 + 来源→目标路由 + 摘要 + 重试标记。
 */

import type { CSSProperties } from 'react';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import { STATE_COLOR, STATE_LABELS } from './layer-flow-state.js';
import {
  SWIMLANE_NODE_HEIGHT,
  SWIMLANE_NODE_WIDTH,
  swimlaneNodeLeft,
  type SwimlaneNode,
} from './layer-flow-swimlane-model.js';

type NodeStyle = CSSProperties & {
  '--node-color': string;
};

export interface LayerFlowSwimlaneNodeProps {
  /** 当前列宽（自适应）：决定节点在列内的水平居中位置。 */
  columnWidth: number;
  /** 聚焦链之外的节点：淡化但不隐藏，保持轨迹上下文。 */
  dim: boolean;
  /** 所属泳道的中心 y（由自适应布局算出，空泳道折叠后不再等距）。 */
  laneCenterY: number;
  node: SwimlaneNode;
  onSelect: (handoffId: string) => void;
  selected: boolean;
  timeLabel: string;
}

export function LayerFlowSwimlaneNode({
  columnWidth,
  dim,
  laneCenterY,
  node,
  onSelect,
  selected,
  timeLabel,
}: LayerFlowSwimlaneNodeProps) {
  const style: NodeStyle = {
    '--node-color': STATE_COLOR[node.state] ?? 'var(--fg-muted)',
    left: swimlaneNodeLeft(node.columnIndex, columnWidth),
    // 用最小高度而不是固定高度：多语言/长摘要撑高时不会被裁切；定位仍按基准高度居中
    minHeight: SWIMLANE_NODE_HEIGHT,
    top: laneCenterY - SWIMLANE_NODE_HEIGHT / 2,
    width: SWIMLANE_NODE_WIDTH,
  };
  const from = getRoleLayerIdentity(node.fromLayer);
  const to = getRoleLayerIdentity(node.layer);
  const routeLabel = `${from.short} → ${to.short}`;
  const stateLabel = STATE_LABELS[node.state] ?? node.state;
  const summary = node.summary?.trim()
    ? node.summary.trim()
    : `${from.short}层向${to.short}层发起交接`;

  return (
    <button
      type="button"
      className="team-conv-swimlane-node"
      data-active={node.active ? 'true' : 'false'}
      data-dim={dim ? 'true' : 'false'}
      data-layer={node.layer}
      data-selected={selected ? 'true' : 'false'}
      data-state={node.state}
      data-swimlane-handoff={node.handoffId}
      onClick={() => onSelect(node.handoffId)}
      style={style}
      title={`${routeLabel} · ${stateLabel} · ${timeLabel}\n${summary}`}
    >
      <span className="team-conv-swimlane-node__head">
        <span className="team-conv-swimlane-node__route">{routeLabel}</span>
        <span className="team-conv-swimlane-node__time">{timeLabel}</span>
      </span>
      <span className="team-conv-swimlane-node__summary">{summary}</span>
      <span className="team-conv-swimlane-node__foot">
        <span className="team-conv-swimlane-node__state">{stateLabel}</span>
        {node.retryCount > 0 ? (
          <span className="team-conv-swimlane-node__retry">重试 ×{node.retryCount}</span>
        ) : null}
      </span>
    </button>
  );
}
