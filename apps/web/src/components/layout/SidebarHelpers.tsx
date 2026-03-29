import { useState as useLocalState, useEffect as useLocalEffect } from 'react';
import type { FileTreeNode } from '../WorkspacePickerModal.js';
import { FileIcon, FolderIcon } from '../FileIcon.js';

export interface FileTreeContextTarget {
  path: string;
  name: string;
  type: 'file' | 'directory';
  directoryPath: string;
  x: number;
  y: number;
}

function getParentDirectory(path: string): string {
  if (path === '/') return '/';

  const lastSlashIndex = path.lastIndexOf('/');
  if (lastSlashIndex <= 0) return '/';

  return path.slice(0, lastSlashIndex);
}

export function WorkspaceGitBadge({
  workspacePath,
  gatewayUrl,
  accessToken,
}: {
  workspacePath: string;
  gatewayUrl: string;
  accessToken: string;
}) {
  const [changes, setChanges] = useLocalState<number | null>(null);
  useLocalEffect(() => {
    let cancelled = false;
    void fetch(`${gatewayUrl}/workspace/review/status?path=${encodeURIComponent(workspacePath)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fail'))))
      .then((data: { changes: unknown[] }) => {
        if (!cancelled) setChanges(Array.isArray(data.changes) ? data.changes.length : 0);
      })
      .catch(() => {
        if (!cancelled) setChanges(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, gatewayUrl, accessToken]);

  if (changes === null || changes === 0) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 9,
        fontWeight: 700,
        background: 'var(--accent-muted)',
        color: 'var(--accent)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: '1px 5px 1px 4px',
        flexShrink: 0,
      }}
      title={`${changes} 处未提交改动`}
    >
      <svg
        width="8"
        height="8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3m0 12v3M3 12h3m12 0h3" />
      </svg>
      {changes}
    </span>
  );
}

export function FileTreeView({
  nodes,
  expandedDirs,
  onToggleDir,
  onOpenFile,
  onNodeContextMenu,
  depth = 0,
}: {
  nodes: FileTreeNode[];
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onNodeContextMenu?: (target: FileTreeContextTarget) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.path}>
          {node.type === 'directory' ? (
            <button
              type="button"
              onClick={() => onToggleDir(node.path)}
              onContextMenu={(event) => {
                event.preventDefault();
                onNodeContextMenu?.({
                  path: node.path,
                  name: node.name,
                  type: node.type,
                  directoryPath: node.path,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                width: '100%',
                padding: `3px 8px 3px ${8 + depth * 12}px`,
                borderRadius: 5,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--text-2)',
                textAlign: 'left',
              }}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  transform: expandedDirs.has(node.path) ? 'rotate(90deg)' : 'none',
                  transition: 'transform 150ms',
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <FolderIcon open={expandedDirs.has(node.path)} size={13} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.name}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenFile?.(node.path)}
              onContextMenu={(event) => {
                event.preventDefault();
                onNodeContextMenu?.({
                  path: node.path,
                  name: node.name,
                  type: node.type,
                  directoryPath: getParentDirectory(node.path),
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                width: '100%',
                padding: `3px 8px 3px ${8 + depth * 12}px`,
                borderRadius: 5,
                border: 'none',
                background: 'transparent',
                cursor: onOpenFile ? 'pointer' : 'default',
                fontSize: 12,
                color: 'var(--text-2)',
                textAlign: 'left',
              }}
            >
              <span style={{ width: 9, flexShrink: 0 }} />
              <FileIcon path={node.path} size={13} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.name}
              </span>
            </button>
          )}
          {node.type === 'directory' && expandedDirs.has(node.path) && node.children && (
            <FileTreeView
              nodes={node.children}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
              onNodeContextMenu={onNodeContextMenu}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </>
  );
}
