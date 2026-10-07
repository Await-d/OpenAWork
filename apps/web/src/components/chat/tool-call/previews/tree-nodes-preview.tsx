import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useIsInsideExpandedToolCard } from '../shared/tool-card-expansion.js';

/* ── list nodes preview (indented file tree) ── */

/**
 * 单个工具卡片内最多渲染的树节点行数。
 *
 * 旧实现里展开卡片会强制全展开且无法折叠，上万节点的工作区会一次性铺满 DOM。
 */
const MAX_TREE_ROWS = 400;

/**
 * 渲染预算：在**本次渲染内**共享的可变计数器。
 *
 * 刻意用局部对象而不是 `useRef`：React 渲染是纯函数，重渲染与 StrictMode 的
 * 双调用都会从同一个初始值重新计数，因此不存在「扣减结果累积到下一次渲染」的
 * 副作用问题。
 */
interface RenderBudget {
  remaining: number;
  omitted: number;
}

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
  budget,
}: {
  node: TreeNode;
  depth: number;
  defaultExpanded: boolean;
  budget: RenderBudget;
}) {
  const isDir = isDirectoryNode(node);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isInsideExpandedCard = useIsInsideExpandedToolCard();
  // 卡片展开态下默认全展开，但**仍可折叠**。旧实现把 `interactive` 绑定成
  // `!isInsideExpandedCard`，于是展开卡片里的目录既点不动，又把用户偏好
  // `defaultExpanded` 彻底忽略。
  const [expanded, setExpanded] = useState(defaultExpanded || isInsideExpandedCard);
  const effectiveExpanded = expanded;
  const toggle = () => setExpanded((prev) => !prev);
  const interactive = isDir && hasChildren;

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
          {isDir ? (effectiveExpanded ? '▾' : '▸') : '·'}
        </span>
        <span className="tool-call-tree-name">{node.name}</span>
        {isDir && node.children && (
          <span className="tool-call-tree-count">({node.children.length})</span>
        )}
      </div>
      {effectiveExpanded &&
        Array.isArray(node.children) &&
        renderRows(node.children, depth + 1, defaultExpanded, budget)}
    </>
  );
}

/**
 * 按行预算渲染一层节点。超出上限的部分不渲染，并只由最外层输出一行省略提示。
 */
function renderRows(
  list: TreeNode[],
  depth: number,
  defaultExpanded: boolean,
  budget: RenderBudget,
): ReactNode[] {
  const rows: ReactNode[] = [];

  for (let i = 0; i < list.length; i += 1) {
    const node = list[i];
    if (!node) continue;
    if (budget.remaining <= 0) {
      budget.omitted += 1;
      continue;
    }
    budget.remaining -= 1;
    rows.push(
      <TreeNodeRow
        key={`${node.name}-${depth}-${i}`}
        node={node}
        depth={depth}
        defaultExpanded={defaultExpanded}
        budget={budget}
      />,
    );
  }

  if (depth === 0 && budget.omitted > 0) {
    rows.push(
      <div key="__omitted" className="tool-call-search-meta">
        已省略 {budget.omitted} 个条目（单卡上限 {MAX_TREE_ROWS} 行）
      </div>,
    );
  }

  return rows;
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

  const budget: RenderBudget = { remaining: MAX_TREE_ROWS, omitted: 0 };

  return (
    <div className="tool-call-tree">
      {renderRows(data.nodes, 0, defaultExpanded, budget)}
      {data.visited !== undefined && (
        <div className="tool-call-search-meta">共 {data.visited} 个条目 · 点击目录展开</div>
      )}
    </div>
  );
}
