import { useState, type KeyboardEvent } from 'react';
import { useIsInsideExpandedToolCard } from '../shared/tool-card-expansion.js';

/* ── list nodes preview (indented file tree) ── */

export interface TreeNode {
  name: string;
  type?: 'file' | 'dir' | 'directory';
  children?: TreeNode[];
}

export interface TreeNodesBundle {
  path?: string;
  visited?: number;
  nodes: TreeNode[];
}

export function extractTreeNodesFromOutput(output: unknown): TreeNodesBundle | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const nodes = record.nodes;
  if (!Array.isArray(nodes)) return null;
  return {
    path: typeof record.path === 'string' ? record.path : undefined,
    visited: typeof record.visitedEntries === 'number' ? record.visitedEntries : undefined,
    nodes: nodes as TreeNode[],
  };
}

function isDirectoryNode(node: TreeNode): boolean {
  if (node.type === 'dir' || node.type === 'directory') return true;
  return Array.isArray(node.children) && node.children.length > 0;
}

function TreeNodeRow({
  node,
  depth,
  defaultExpanded,
}: {
  node: TreeNode;
  depth: number;
  defaultExpanded: boolean;
}) {
  const isDir = isDirectoryNode(node);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isInsideExpandedCard = useIsInsideExpandedToolCard();
  const effectiveExpanded = expanded || isInsideExpandedCard;
  const toggle = () => setExpanded((prev) => !prev);
  const interactive = isDir && hasChildren && !isInsideExpandedCard;

  return (
    <>
      <div
        className="tool-call-tree-row"
        data-kind={isDir ? 'dir' : 'file'}
        data-expanded={isDir && hasChildren ? (effectiveExpanded ? 'true' : 'false') : undefined}
        style={{
          paddingLeft: depth * 12 + 6,
          cursor: interactive ? 'pointer' : 'default',
        }}
        {...(interactive
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-expanded': effectiveExpanded,
              onClick: toggle,
              onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggle();
                }
              },
            }
          : {})}
      >
        <span className="tool-call-tree-glyph" aria-hidden="true">
          {isDir ? (interactive ? (effectiveExpanded ? '▾' : '▸') : '▸') : '·'}
        </span>
        <span className="tool-call-tree-name">{node.name}</span>
        {isDir && node.children && (
          <span className="tool-call-tree-count">({node.children.length})</span>
        )}
      </div>
      {effectiveExpanded &&
        Array.isArray(node.children) &&
        node.children.map((child, idx) => (
          <TreeNodeRow
            key={`${child.name}-${idx}`}
            node={child}
            depth={depth + 1}
            defaultExpanded={false}
          />
        ))}
    </>
  );
}

export function TreeNodesPreview({
  data,
  defaultExpanded = false,
}: {
  data: TreeNodesBundle;
  defaultExpanded?: boolean;
}) {
  if (data.nodes.length === 0) {
    return <div className="tool-call-inline-empty">（目录为空）</div>;
  }
  // Per user request: default-collapse every directory so the card stays
  // compact even on huge workspaces. Each row exposes (count) so users can
  // gauge size before clicking to expand.
  return (
    <div className="tool-call-tree">
      {data.nodes.map((node, idx) => (
        <TreeNodeRow
          key={`${node.name}-${idx}`}
          node={node}
          depth={0}
          defaultExpanded={defaultExpanded}
        />
      ))}
      {data.visited !== undefined && (
        <div className="tool-call-search-meta">共 {data.visited} 个条目 · 点击目录展开</div>
      )}
    </div>
  );
}
