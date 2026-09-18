/**
 * 知识图谱 · 画布舞台。
 *
 * 只负责「画布 + 缩放浮层 + 右侧检查器槽位」的布局与画布 props 透传；
 * 状态与业务流程留在 `WorkspaceKnowledgeGraphView`，检查器由调用方以 `inspector` 注入。
 */

import type { JSX, ReactNode } from 'react';
import type { KnowledgeGraph } from '../../data/build-knowledge-graph.js';
import {
  KnowledgeGraphCanvas,
  type KnowledgeGraphColorMode,
  type KnowledgeGraphLabelDensity,
} from './graph/knowledge-graph-canvas.js';
import type { GraphViewportSize } from './graph/knowledge-graph-layout.js';
import { GraphBtn } from './workspace-knowledge-graph-controls.js';

export interface WorkspaceKnowledgeGraphStageProps {
  readonly colorMode: KnowledgeGraphColorMode;
  readonly graph: KnowledgeGraph;
  readonly labelDensity: KnowledgeGraphLabelDensity;
  readonly pan: { x: number; y: number };
  readonly resetVersion: number;
  readonly selectedNodeId: string | null;
  readonly collapsedIds: ReadonlySet<string>;
  readonly counts: ReadonlyMap<string, number>;
  readonly zoom: number;
  readonly inspector: ReactNode;
  readonly capacityBlockedIds?: ReadonlySet<string>;
  readonly onPanChange: (pan: { x: number; y: number }) => void;
  readonly onResetView: () => void;
  readonly onSelectNode: (nodeId: string) => void;
  readonly onToggleExpand: (nodeId: string) => void;
  readonly onViewportSizeChange?: (size: GraphViewportSize) => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
}

export function WorkspaceKnowledgeGraphStage({
  capacityBlockedIds,
  collapsedIds,
  colorMode,
  counts,
  graph,
  inspector,
  labelDensity,
  onPanChange,
  onResetView,
  onSelectNode,
  onToggleExpand,
  onViewportSizeChange,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  pan,
  resetVersion,
  selectedNodeId,
  zoom,
}: WorkspaceKnowledgeGraphStageProps): JSX.Element {
  return (
    <div className="workspace-knowledge-graph-layout">
      <div className="workspace-knowledge-graph-canvas-shell">
        <KnowledgeGraphCanvas
          capacityBlockedIds={capacityBlockedIds}
          collapsedIds={collapsedIds}
          colorMode={colorMode}
          counts={counts}
          graph={graph}
          labelDensity={labelDensity}
          pan={pan}
          resetVersion={resetVersion}
          selectedNodeId={selectedNodeId}
          zoom={zoom}
          onPanChange={onPanChange}
          onSelectNode={onSelectNode}
          onToggleExpand={onToggleExpand}
          onViewportSizeChange={onViewportSizeChange}
          onZoomChange={onZoomChange}
        />
        <div className="workspace-knowledge-graph-canvas-overlay-top-left">
          <div className="workspace-knowledge-graph-zoom-cluster">
            <GraphBtn label="−" title="缩小" onClick={onZoomOut} />
            <span className="workspace-knowledge-graph-zoom-display">
              {Math.round(zoom * 100)}%
            </span>
            <GraphBtn label="+" title="放大" onClick={onZoomIn} />
            <GraphBtn label="复位" onClick={onResetView} />
          </div>
        </div>
      </div>
      {inspector}
    </div>
  );
}
