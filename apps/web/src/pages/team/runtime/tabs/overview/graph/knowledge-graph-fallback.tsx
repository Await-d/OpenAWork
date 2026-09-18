import type { JSX } from 'react';
import type { GraphNodeModel } from './knowledge-graph-model.js';
import './knowledge-graph-a11y.css';

export interface KnowledgeGraphFallbackProps {
  readonly nodes: readonly GraphNodeModel[];
  readonly onSelectNode: (nodeId: string) => void;
}

/**
 * 画布不可用时的降级面板：以真实按钮列出节点，保证功能与无障碍可达性不因渲染器失败而丢失。
 */
export function KnowledgeGraphFallback({
  nodes,
  onSelectNode,
}: KnowledgeGraphFallbackProps): JSX.Element {
  return (
    <div className="workspace-knowledge-graph-fallback" role="note">
      <span className="workspace-knowledge-graph-fallback-title">图谱画布暂不可用</span>
      <span className="workspace-knowledge-graph-fallback-description">
        可直接从节点列表查看知识详情。
      </span>
      <div className="workspace-knowledge-graph-fallback-list">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className="workspace-knowledge-graph-fallback-node"
            onClick={() => onSelectNode(node.id)}
          >
            {node.label}
          </button>
        ))}
      </div>
    </div>
  );
}
