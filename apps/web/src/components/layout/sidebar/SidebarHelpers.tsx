import React, { useState as useLocalState, useEffect as useLocalEffect } from 'react';
import { createWorkspaceClient } from '@openAwork/web-client';
import type { FileTreeNode } from '../../common/modal/WorkspacePickerModal.js';
import { FileIcon, FolderIcon } from '../../file-editor/preview/FileIcon.js';

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
    void createWorkspaceClient(gatewayUrl)
      .reviewStatus(accessToken, workspacePath)
      .then((items) => {
        if (!cancelled) setChanges(items.length);
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
        border: '1px solid var(--border-default)',
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
  filter = '',
  highlightedPath,
  activeFilePath,
}: {
  nodes: FileTreeNode[];
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onNodeContextMenu?: (target: FileTreeContextTarget) => void;
  depth?: number;
  filter?: string;
  highlightedPath?: string | null;
  /** Path of the currently active/open file in the editor — shows selected state. */
  activeFilePath?: string | null;
}) {
  // Sort: directories first, then files, both alphabetically
  const sortedNodes = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
  });

  // Filter nodes if filter string is provided
  const filteredNodes = filter.trim()
    ? sortedNodes.filter((node) => {
        const lowerFilter = filter.toLowerCase();
        if (node.name.toLowerCase().includes(lowerFilter)) return true;
        // For directories, check if any child matches (show parent if child matches)
        if (node.type === 'directory' && node.children) {
          return hasMatchingDescendant(node.children, lowerFilter);
        }
        return false;
      })
    : sortedNodes;

  const INDENT_PX = 16;
  const GUIDE_OFFSET = 12; // offset from left edge where guide line starts

  return (
    <div
      className="file-tree-level"
      role={depth === 0 ? 'tree' : 'group'}
      style={{ position: 'relative' }}
    >
      {/* Tree guide line for nested levels */}
      {depth > 0 && (
        <div
          aria-hidden="true"
          className="file-tree-guide-line"
          style={{
            position: 'absolute',
            left: GUIDE_OFFSET + (depth - 1) * INDENT_PX,
            top: 0,
            bottom: 0,
            width: 1,
            background: 'var(--border-subtle)',
            opacity: 0.6,
            pointerEvents: 'none',
          }}
        />
      )}

      {filteredNodes.map((node, index) => {
        const isExpanded = expandedDirs.has(node.path);
        const isHighlighted = highlightedPath === node.path;
        const isActive = activeFilePath === node.path;
        const isLastChild = index === filteredNodes.length - 1;
        const childCount = node.type === 'directory' && node.children ? node.children.length : 0;

        return (
          <div
            key={node.path}
            role="treeitem"
            aria-expanded={node.type === 'directory' ? isExpanded : undefined}
            data-tree-path={node.path}
            data-tree-type={node.type}
          >
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
                className="file-tree-node file-tree-dir"
                data-highlighted={isHighlighted ? 'true' : undefined}
                data-expanded={isExpanded ? 'true' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  width: '100%',
                  padding: `3px 8px 3px ${8 + depth * INDENT_PX}px`,
                  borderRadius: 5,
                  border: 'none',
                  background: isHighlighted
                    ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                    : isExpanded
                      ? 'color-mix(in oklch, var(--accent) 4%, transparent)'
                      : 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: isExpanded ? 500 : 400,
                  color: isExpanded ? 'var(--fg-strong)' : 'var(--fg-default)',
                  textAlign: 'left',
                  transition: 'background 80ms ease',
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
                    transform: isExpanded ? 'rotate(90deg)' : 'none',
                    transition: 'transform 120ms cubic-bezier(.4,0,.2,1)',
                    opacity: 0.7,
                  }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <FolderIcon open={isExpanded} size={13} name={node.name} />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                >
                  {filter ? highlightMatch(node.name, filter) : node.name}
                </span>
                {/* Child count badge for collapsed dirs with loaded children */}
                {!isExpanded && childCount > 0 && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: 'var(--text-4)',
                      background: 'color-mix(in oklch, var(--text-4) 10%, transparent)',
                      borderRadius: 6,
                      padding: '0 4px',
                      lineHeight: '14px',
                      flexShrink: 0,
                    }}
                  >
                    {childCount}
                  </span>
                )}
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
                className="file-tree-node file-tree-file"
                data-highlighted={isHighlighted ? 'true' : undefined}
                data-active={isActive ? 'true' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  width: '100%',
                  padding: `2px 8px 2px ${8 + depth * INDENT_PX}px`,
                  borderRadius: 5,
                  border: isActive
                    ? '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-default))'
                    : '1px solid transparent',
                  background: isActive
                    ? 'color-mix(in oklch, var(--accent) 12%, var(--bg-overlay))'
                    : isHighlighted
                      ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                      : 'transparent',
                  cursor: onOpenFile ? 'pointer' : 'default',
                  fontSize: 12,
                  color: isActive ? 'var(--fg-strong)' : 'var(--fg-default)',
                  fontWeight: isActive ? 500 : 400,
                  textAlign: 'left',
                  transition: 'background 80ms ease, border-color 80ms ease',
                }}
              >
                {/* Spacer to align with chevron */}
                <span style={{ width: 9, flexShrink: 0 }} />
                <FileIcon path={node.path} size={13} />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                >
                  {filter ? highlightMatch(node.name, filter) : node.name}
                </span>
                {/* File size hint from extension */}
                <FileExtBadge name={node.name} />
              </button>
            )}
            {node.type === 'directory' && isExpanded && node.children && (
              <FileTreeView
                nodes={node.children}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
                onNodeContextMenu={onNodeContextMenu}
                depth={depth + 1}
                filter={filter}
                highlightedPath={highlightedPath}
                activeFilePath={activeFilePath}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: check if any descendant matches the filter
// ---------------------------------------------------------------------------
function hasMatchingDescendant(nodes: FileTreeNode[], lowerFilter: string): boolean {
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(lowerFilter)) return true;
    if (node.type === 'directory' && node.children) {
      if (hasMatchingDescendant(node.children, lowerFilter)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helper: highlight matching text in node name
// ---------------------------------------------------------------------------
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <span
        style={{
          background: 'color-mix(in oklch, var(--accent) 25%, transparent)',
          borderRadius: 2,
        }}
      >
        {text.slice(index, index + query.length)}
      </span>
      {text.slice(index + query.length)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helper: subtle extension badge for files
// ---------------------------------------------------------------------------
function FileExtBadge({ name }: { name: string }) {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : null;
  if (!ext || ext.length > 4) return null;

  // Only show for less obvious extensions
  const SKIP_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'css', 'html']);
  if (SKIP_EXTS.has(ext)) return null;

  return (
    <span
      style={{
        fontSize: 8,
        fontWeight: 500,
        color: 'var(--text-4)',
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
        flexShrink: 0,
        opacity: 0.7,
      }}
    >
      .{ext}
    </span>
  );
}
