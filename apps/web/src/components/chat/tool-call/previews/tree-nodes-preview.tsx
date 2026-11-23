import { useState } from 'react';
import { FileTypeIcon, FolderTypeIcon } from '@openAwork/shared-ui';
import {
  parseDirectoryTree,
  type DirectoryTreeBundle,
  type DirectoryTreeNode,
} from '../shared/directory-listing.js';
import { useIsInsideExpandedToolCard } from '../shared/tool-card-expansion.js';
import './list-directory.css';

export type TreeNode = DirectoryTreeNode;
export type TreeNodesBundle = DirectoryTreeBundle;
export const extractTreeNodesFromOutput = parseDirectoryTree;

const MAX_TREE_ROWS = 400;

function isDirectory(node: TreeNode): boolean {
  return node.type === 'dir' || node.type === 'directory' || Boolean(node.children?.length);
}

interface VisibleRow {
  node: TreeNode;
  level: number;
  key: string;
  expanded: boolean;
}

function collectRows(
  nodes: TreeNode[],
  overrides: Readonly<Record<string, boolean>>,
  initiallyExpanded: boolean,
  rowLimit: number,
) {
  const rows: VisibleRow[] = [];
  let limited = false;
  function walk(items: TreeNode[], level: number, parent: string) {
    for (const [index, node] of items.entries()) {
      if (rows.length === rowLimit) {
        limited = true;
        return;
      }
      const key = `${parent}/${index}:${node.name}`;
      const expanded = overrides[key] ?? initiallyExpanded;
      rows.push({ node, level, key, expanded });
      if (expanded && node.children?.length) walk(node.children, level + 1, key);
    }
  }
  walk(nodes, 0, '');
  return { rows, limited };
}

function countNodes(nodes: TreeNode[]): { files: number; directories: number } {
  let files = 0;
  let directories = 0;
  for (const node of nodes) {
    if (isDirectory(node)) directories += 1;
    else files += 1;
    const children = countNodes(node.children ?? []);
    files += children.files;
    directories += children.directories;
  }
  return { files, directories };
}

function DirectoryRow({ row, toggle }: { row: VisibleRow; toggle: () => void }) {
  const { node, level, expanded } = row;
  const directory = isDirectory(node);
  const interactive = directory && Boolean(node.children?.length);
  const content = (
    <>
      <span className="tool-call-tree-glyph" aria-hidden="true">
        {interactive ? (expanded ? '▾' : '▸') : '·'}
      </span>
      <span className="list-directory-icon" aria-hidden="true">
        {directory ? (
          <FolderTypeIcon name={node.name} open={interactive && expanded} />
        ) : (
          <FileTypeIcon path={node.path ?? node.name} name={node.name} />
        )}
      </span>
      <span className="tool-call-tree-name">{node.name}</span>
      {directory && (
        <span className="tool-call-tree-count">
          {node.children === undefined
            ? '未展开'
            : node.children.length === 0
              ? '空目录'
              : `(${node.children.length})`}
        </span>
      )}
    </>
  );
  const props = {
    className: 'tool-call-tree-row list-directory-row',
    'data-kind': directory ? 'dir' : 'file',
    'data-expanded': interactive ? String(expanded) : undefined,
    style: {
      paddingInlineStart: `calc(var(--spacing-2) + ${Math.min(level, 8)} * var(--spacing-3))`,
    },
    title: node.path ?? node.name,
  };
  return (
    <li>
      {interactive ? (
        <button {...props} type="button" aria-expanded={expanded} onClick={toggle}>
          {content}
        </button>
      ) : (
        <div {...props}>{content}</div>
      )}
    </li>
  );
}

export function TreeNodesPreview({
  data,
  defaultExpanded = false,
}: {
  data: TreeNodesBundle;
  defaultExpanded?: boolean;
}) {
  const insideExpandedCard = useIsInsideExpandedToolCard();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [rowLimit, setRowLimit] = useState(MAX_TREE_ROWS);
  const { rows, limited } = collectRows(
    data.nodes,
    overrides,
    defaultExpanded || insideExpandedCard,
    rowLimit,
  );
  const counts = countNodes(data.nodes);
  return (
    <section className="tool-call-tree list-directory" aria-label="目录清单">
      <header className="list-directory-header">
        {data.path && <code className="list-directory-root">{data.path}</code>}
        <div className="list-directory-meta">
          <span>
            已返回 {counts.directories} 个目录 · {counts.files} 个文件
          </span>
          {data.visited !== undefined && <span>已访问 {data.visited} 个条目</span>}
          {data.depth !== undefined && <span>遍历深度 {data.depth} · 更深层内容未读取</span>}
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="tool-call-inline-empty">（未返回目录条目）</div>
      ) : (
        <ul className="list-directory-rows">
          {rows.map((row) => (
            <DirectoryRow
              key={row.key}
              row={row}
              toggle={() => setOverrides((prev) => ({ ...prev, [row.key]: !row.expanded }))}
            />
          ))}
        </ul>
      )}
      {limited && (
        <div className="list-directory-pagination">
          <span role="status">当前显示 {rows.length} 行，还有更多已返回条目。</span>
          <button
            type="button"
            className="list-directory-load-more"
            onClick={() => setRowLimit((limit) => limit + MAX_TREE_ROWS)}
          >
            加载更多（最多 {MAX_TREE_ROWS} 行）
          </button>
        </div>
      )}
      {data.truncated && (
        <div className="list-directory-notice" role="status">
          目录输出已截断，清单不完整。
        </div>
      )}
    </section>
  );
}
