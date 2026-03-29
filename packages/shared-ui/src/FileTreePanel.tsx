import { useState } from 'react';

export type FileTreeNodeKind = 'file' | 'directory';
export type FileTreeNodeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  status?: 'added' | 'modified' | 'deleted' | 'renamed';
  children?: FileTreeNode[];
  linesAdded?: number;
  linesDeleted?: number;
}

export interface FileTreePanelProps {
  nodes: FileTreeNode[];
  onFileClick?: (path: string) => void;
  onDiffClick?: (path: string) => void;
  onRevertClick?: (path: string) => void;
  onRevertAll?: () => void;
  viewMode?: 'tree' | 'list';
  onViewModeChange?: (mode: 'tree' | 'list') => void;
}

const STATUS_ICON: Record<string, string> = {
  added: '🆕',
  modified: '✏️',
  deleted: '🗑️',
  renamed: '↩️',
};

const STATUS_COLOR: Record<string, string> = {
  added: '#34d399',
  modified: '#60a5fa',
  deleted: '#f87171',
  renamed: '#facc15',
};

function LineDiff({ added, deleted }: { added?: number; deleted?: number }) {
  if (added === undefined && deleted === undefined) return null;
  return (
    <span style={{ fontSize: 10, flexShrink: 0, display: 'flex', gap: 3 }}>
      {added !== undefined && <span style={{ color: 'var(--success, #34d399)' }}>+{added}</span>}
      {deleted !== undefined && <span style={{ color: 'var(--danger, #f87171)' }}>-{deleted}</span>}
    </span>
  );
}

function ActionBtn({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      style={{
        fontSize: 10,
        padding: '0.1rem 0.35rem',
        background: 'var(--color-surface, var(--surface-2))',
        border: '1px solid var(--color-border, var(--border))',
        borderRadius: 4,
        color: 'var(--color-muted, var(--text-3))',
        cursor: 'pointer',
        flexShrink: 0,
        lineHeight: 1.4,
      }}
    >
      {label}
    </button>
  );
}

function FileRow({
  node,
  depth,
  expanded,
  onToggle,
  onFileClick,
  onDiffClick,
  onRevertClick,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: boolean;
  onToggle: (path: string) => void;
  onFileClick?: (path: string) => void;
  onDiffClick?: (path: string) => void;
  onRevertClick?: (path: string) => void;
}) {
  const isDir = node.type === 'directory';
  const statusColor = node.status ? STATUS_COLOR[node.status] : 'var(--color-text, #f1f5f9)';

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          paddingLeft: `${0.5 + depth * 1}rem`,
          paddingRight: '0.625rem',
          paddingTop: '0.25rem',
          paddingBottom: '0.25rem',
          borderBottom: '1px solid var(--color-border, #334155)22',
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (isDir) onToggle(node.path);
            else onFileClick?.(node.path);
          }}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            minWidth: 0,
            padding: 0,
          }}
        >
          <span
            style={{ fontSize: 10, color: 'var(--color-muted,#94a3b8)', width: 10, flexShrink: 0 }}
          >
            {isDir ? (expanded ? '▾' : '▸') : ''}
          </span>
          {node.status && !isDir ? (
            <span style={{ fontSize: 11, flexShrink: 0 }}>{STATUS_ICON[node.status]}</span>
          ) : (
            <span style={{ fontSize: 11, flexShrink: 0 }}>
              {isDir ? (expanded ? '📂' : '📁') : '📄'}
            </span>
          )}
          <span
            style={{
              fontSize: 12,
              fontFamily: 'monospace',
              color: statusColor,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: isDir ? 600 : 400,
            }}
          >
            {node.name}
          </span>
        </button>
        {!isDir && (
          <>
            <LineDiff added={node.linesAdded} deleted={node.linesDeleted} />
            {onDiffClick && (
              <ActionBtn label="diff" title="查看差异" onClick={() => onDiffClick(node.path)} />
            )}
            {onRevertClick && (
              <ActionBtn label="↺" title="还原" onClick={() => onRevertClick(node.path)} />
            )}
          </>
        )}
      </div>
      {isDir &&
        expanded &&
        node.children?.map((child) => (
          <FileRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onFileClick={onFileClick}
            onDiffClick={onDiffClick}
            onRevertClick={onRevertClick}
          />
        ))}
    </>
  );
}

function flattenFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  const result: FileTreeNode[] = [];
  function walk(ns: FileTreeNode[]) {
    for (const n of ns) {
      if (n.type === 'file') result.push(n);
      else if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return result;
}

export function FileTreePanel({
  nodes,
  onFileClick,
  onDiffClick,
  onRevertClick,
  onRevertAll,
  viewMode = 'tree',
  onViewModeChange,
}: FileTreePanelProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const dirs = new Set<string>();
    function collect(ns: FileTreeNode[]) {
      for (const n of ns) {
        if (n.type === 'directory') {
          dirs.add(n.path);
          if (n.children) collect(n.children);
        }
      }
    }
    collect(nodes);
    return dirs;
  });

  const toggleDir = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const flatFiles = flattenFiles(nodes);
  const changedCount = flatFiles.filter((f) => f.status).length;

  const btnStyle = (active: boolean) =>
    ({
      fontSize: 11,
      padding: '0.15rem 0.55rem',
      borderRadius: 4,
      border: '1px solid var(--color-border, #334155)',
      background: active ? 'var(--color-accent, #6366f1)22' : 'transparent',
      color: active ? 'var(--color-accent, #6366f1)' : 'var(--color-muted, #94a3b8)',
      cursor: 'pointer',
      fontWeight: active ? 600 : 400,
    }) as const;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--color-border, var(--border))',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--color-surface, var(--surface))',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.4rem 0.75rem',
          borderBottom: '1px solid var(--color-border, var(--border-subtle))',
          background: 'var(--color-bg, var(--header-bg))',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            style={btnStyle(viewMode === 'tree')}
            onClick={() => onViewModeChange?.('tree')}
          >
            树形
          </button>
          <button
            type="button"
            style={btnStyle(viewMode === 'list')}
            onClick={() => onViewModeChange?.('list')}
          >
            列表
          </button>
        </div>
        <span
          style={{
            fontSize: 10,
            color: 'var(--color-muted, var(--text-3))',
            flex: 1,
            paddingLeft: 6,
          }}
        >
          {changedCount} 个变更
        </span>
        {onRevertAll && (
          <button
            type="button"
            onClick={onRevertAll}
            style={{
              fontSize: 11,
              padding: '0.15rem 0.55rem',
              borderRadius: 4,
              border: '1px solid color-mix(in srgb, var(--danger, #f87171) 25%, transparent)',
              background: 'color-mix(in srgb, var(--danger, #f87171) 8%, transparent)',
              color: 'var(--danger, #f87171)',
              cursor: 'pointer',
            }}
          >
            全部还原
          </button>
        )}
      </div>

      {nodes.length === 0 ? (
        <div
          style={{
            padding: '1rem',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--color-muted, #94a3b8)',
          }}
        >
          暂无变更
        </div>
      ) : viewMode === 'tree' ? (
        <div style={{ paddingTop: 2, paddingBottom: 2 }}>
          {nodes.map((n) => (
            <FileRow
              key={n.path}
              node={n}
              depth={0}
              expanded={expandedPaths.has(n.path)}
              onToggle={toggleDir}
              onFileClick={onFileClick}
              onDiffClick={onDiffClick}
              onRevertClick={onRevertClick}
            />
          ))}
        </div>
      ) : (
        <div style={{ paddingTop: 2, paddingBottom: 2 }}>
          {flatFiles.map((f) => (
            <div
              key={f.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0.25rem 0.75rem',
                borderBottom: '1px solid var(--color-border, #334155)22',
              }}
            >
              {f.status && <span style={{ fontSize: 11 }}>{STATUS_ICON[f.status]}</span>}
              <button
                type="button"
                onClick={() => onFileClick?.(f.path)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  cursor: onFileClick ? 'pointer' : 'default',
                  textAlign: 'left',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: f.status ? STATUS_COLOR[f.status] : 'var(--color-text, #f1f5f9)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  padding: 0,
                  minWidth: 0,
                }}
              >
                {f.path}
              </button>
              <LineDiff added={f.linesAdded} deleted={f.linesDeleted} />
              {onDiffClick && (
                <ActionBtn label="diff" title="查看差异" onClick={() => onDiffClick(f.path)} />
              )}
              {onRevertClick && (
                <ActionBtn label="↺" title="还原" onClick={() => onRevertClick(f.path)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
