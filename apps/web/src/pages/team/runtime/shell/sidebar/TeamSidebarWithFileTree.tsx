/**
 * TeamSidebarWithFileTree · 会话列表 + 文件目录 双 tab 侧边栏
 *
 * 与 chat 端 SessionSidebar 的整体布局对齐：
 *   ┌──────────────────────────────┐
 *   │ [+ 新建会话] [📁 工作区]      │  ← 顶部主按钮行
 *   ├──────────────────────────────┤
 *   │ [💬 会话] [📁 文件树]         │  ← tab 切换
 *   ├──────────────────────────────┤
 *   │ 🔍 搜索会话…                  │  ← 搜索框（仅会话 tab）
 *   ├──────────────────────────────┤
 *   │ 会话卡片列表 / 文件树          │  ← 内容区
 *   └──────────────────────────────┘
 *
 * 通过 TeamSessionListSidebar 的 chromeless 模式，把 header / 搜索框 / 工作区
 * 切换器从内部组件抽到这里集中渲染，避免和 chat 体验产生差异。
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import {
  FileTreeView,
  type FileTreeContextTarget,
} from '../../../../../components/layout/sidebar/SidebarHelpers.js';
import FileTreeContextMenu from '../../../../../components/layout/file-tree/FileTreeContextMenu.js';
import type { FileTreeNode } from '../../../../../components/common/modal/WorkspacePickerModal.js';
import { getFileTreeRelativePath } from '../../../../../components/layout/file-tree/file-tree-actions.js';
import {
  TeamSessionListSidebar,
  type TeamSessionListSidebarProps,
} from './TeamSessionListSidebar.js';

type SidebarTab = 'sessions' | 'files';

// ─── Styles (与 chat SessionSidebar 完全对齐) ───────────────────────────────

const TOP_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '8px 8px 6px',
  flexShrink: 0,
  alignItems: 'center',
};

const PRIMARY_BTN_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  height: 30,
  padding: '0 10px',
  alignItems: 'center',
  gap: 6,
  borderRadius: '8px 0 0 8px',
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  minWidth: 0,
  justifyContent: 'center',
  border: 'none',
};

const PRIMARY_BTN_DISABLED_STYLE: CSSProperties = {
  ...PRIMARY_BTN_STYLE,
  opacity: 0.55,
  cursor: 'not-allowed',
};

const PRIMARY_SPLIT_BTN_STYLE: CSSProperties = {
  display: 'flex',
  width: 30,
  height: 30,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '0 8px 8px 0',
  background: 'var(--accent)',
  borderLeft: '1px solid oklch(from var(--accent) calc(l - 0.08) c h / 0.5)',
  color: 'var(--fg-on-accent)',
  cursor: 'pointer',
  flexShrink: 0,
  border: 'none',
};

const TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  padding: '0 8px 6px',
  flexShrink: 0,
  borderBottom: '1px solid var(--border-default)',
  gap: 4,
};

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    height: 28,
    padding: '0 8px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 7,
    border: active ? '1px solid var(--border-default)' : '1px solid transparent',
    background: active ? 'var(--bg-overlay)' : 'transparent',
    color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    transition: 'background 150ms ease, color 150ms ease',
    whiteSpace: 'nowrap',
  };
}

const SEARCH_BAR_STYLE: CSSProperties = {
  padding: '4px 6px',
  flexShrink: 0,
  borderBottom: '1px solid var(--border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const SEARCH_INPUT_STYLE: CSSProperties = {
  width: '100%',
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 11,
  color: 'var(--fg-strong)',
  outline: 'none',
  boxSizing: 'border-box',
};

const FILE_TREE_CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '8px 0',
};

// ─── Props ───────────────────────────────────────────────────────────────────

export interface TeamSidebarWithFileTreeProps extends TeamSessionListSidebarProps {
  /** Workspace path for file tree operations. */
  workspacePath?: string | null;
  /** Callback when user clicks a file in the tree. */
  onOpenFile?: (path: string) => void;
  /** 点击副 split 按钮（工作区选择器入口）的回调；不传则不渲染该按钮。 */
  onOpenWorkspacePicker?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TeamSidebarWithFileTree({
  workspacePath,
  onOpenFile,
  onOpenWorkspacePicker,
  collapsed,
  onSubmitDraft,
  teamWorkspaceId,
  ...sidebarProps
}: TeamSidebarWithFileTreeProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('sessions');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const token = useAuthStore((s) => s.accessToken);

  // File tree state
  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeLoading, setTreeLoading] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: FileTreeContextTarget;
  } | null>(null);

  const workspaceClient = useMemo(() => createWorkspaceClient(gatewayUrl), [gatewayUrl]);

  // Load root tree when switching to files tab
  useEffect(() => {
    if (activeTab !== 'files' || !workspacePath || !token) {
      return;
    }
    let cancelled = false;
    setTreeLoading(true);
    workspaceClient
      .fetchTree(token, workspacePath, { depth: 1 })
      .then((nodes) => {
        if (!cancelled) setTreeNodes(nodes as FileTreeNode[]);
      })
      .catch(() => {
        if (!cancelled) setTreeNodes([]);
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, workspacePath, token, workspaceClient]);

  const handleToggleDir = useCallback(
    (path: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          if (token) {
            void workspaceClient
              .fetchTree(token, path, { depth: 1 })
              .then((children) => {
                setTreeNodes((prevNodes) =>
                  injectChildren(prevNodes, path, children as FileTreeNode[]),
                );
              })
              .catch(() => {});
          }
        }
        return next;
      });
    },
    [token, workspaceClient],
  );

  const handleNodeContextMenu = useCallback((target: FileTreeContextTarget) => {
    setContextMenu({
      x: target.x,
      y: target.y,
      target,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextMenuOpen = useCallback(() => {
    if (contextMenu?.target.path && onOpenFile) {
      onOpenFile(contextMenu.target.path);
    }
    setContextMenu(null);
  }, [contextMenu, onOpenFile]);

  const handleCopyPath = useCallback(() => {
    if (contextMenu?.target.path) {
      void navigator.clipboard.writeText(contextMenu.target.path);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleCopyRelativePath = useCallback(() => {
    if (contextMenu?.target.path && workspacePath) {
      const rel = getFileTreeRelativePath(contextMenu.target.path, workspacePath);
      void navigator.clipboard.writeText(rel ?? contextMenu.target.path);
    }
    setContextMenu(null);
  }, [contextMenu, workspacePath]);

  const handleRefresh = useCallback(() => {
    setContextMenu(null);
    if (!token || !workspacePath) return;
    setTreeLoading(true);
    void workspaceClient
      .fetchTree(token, workspacePath, { depth: 1 })
      .then((nodes) => setTreeNodes(nodes as FileTreeNode[]))
      .catch(() => setTreeNodes([]))
      .finally(() => setTreeLoading(false));
  }, [token, workspacePath, workspaceClient]);

  const handleNewSessionClick = useCallback(() => {
    if (!teamWorkspaceId) {
      console.warn('[TeamSidebarWithFileTree] 请先选择工作空间');
      return;
    }
    setShowNewSessionModal(true);
  }, [teamWorkspaceId]);

  const canCreateSession = Boolean(onSubmitDraft && teamWorkspaceId);

  // 折叠态：完全委托给 TeamSessionListSidebar 处理（它有自己的 columnar 视图）
  if (collapsed) {
    return (
      <TeamSessionListSidebar
        collapsed={collapsed}
        onSubmitDraft={onSubmitDraft}
        teamWorkspaceId={teamWorkspaceId}
        {...sidebarProps}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 顶部主按钮行：新建会话 + 工作区入口（split button） */}
      <div style={TOP_BAR_STYLE}>
        <div style={{ display: 'flex', gap: 0, flex: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={handleNewSessionClick}
            disabled={!canCreateSession}
            title={canCreateSession ? '新建会话' : '请先选择工作空间'}
            className="icon-btn-accent"
            style={canCreateSession ? PRIMARY_BTN_STYLE : PRIMARY_BTN_DISABLED_STYLE}
          >
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建会话
          </button>
          {onOpenWorkspacePicker ? (
            <button
              type="button"
              onClick={onOpenWorkspacePicker}
              title="选择工作区"
              style={PRIMARY_SPLIT_BTN_STYLE}
            >
              <svg
                aria-hidden="true"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* Tab 切换器 */}
      <div style={TAB_BAR_STYLE}>
        <button
          type="button"
          onClick={() => setActiveTab('sessions')}
          style={tabButtonStyle(activeTab === 'sessions')}
        >
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>会话</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('files')}
          style={tabButtonStyle(activeTab === 'files')}
          disabled={!workspacePath}
          title={workspacePath ? '浏览工作区文件' : '无工作区路径'}
        >
          <svg
            aria-hidden="true"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>文件树</span>
        </button>
      </div>

      {/* 搜索框（仅会话 tab） */}
      {activeTab === 'sessions' && (
        <div style={SEARCH_BAR_STYLE}>
          <input
            type="text"
            placeholder="搜索会话…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            style={SEARCH_INPUT_STYLE}
            aria-label="搜索会话"
          />
        </div>
      )}

      {/* 内容区 */}
      {activeTab === 'sessions' ? (
        <TeamSessionListSidebar
          collapsed={false}
          onSubmitDraft={onSubmitDraft}
          teamWorkspaceId={teamWorkspaceId}
          chromeless
          controlledSearchQuery={searchQuery}
          showNewSessionModal={showNewSessionModal}
          onCloseNewSessionModal={() => setShowNewSessionModal(false)}
          {...sidebarProps}
        />
      ) : (
        <div style={FILE_TREE_CONTAINER_STYLE}>
          {treeLoading ? (
            <div style={{ padding: '16px', color: 'var(--fg-muted)', fontSize: 11 }}>
              加载文件目录…
            </div>
          ) : treeNodes.length === 0 ? (
            <div style={{ padding: '16px', color: 'var(--fg-muted)', fontSize: 11 }}>
              {workspacePath ? '目录为空' : '无工作区路径'}
            </div>
          ) : (
            <>
              <FileTreeView
                nodes={treeNodes}
                expandedDirs={expandedDirs}
                onToggleDir={handleToggleDir}
                onOpenFile={onOpenFile}
                onNodeContextMenu={handleNodeContextMenu}
              />
              {contextMenu &&
                createPortal(
                  <FileTreeContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    targetLabel={contextMenu.target.name}
                    targetType={contextMenu.target.type}
                    relativePath={
                      workspacePath
                        ? getFileTreeRelativePath(contextMenu.target.path, workspacePath)
                        : contextMenu.target.path
                    }
                    canOpen={contextMenu.target.type === 'file'}
                    canCreateSession={false}
                    onClose={handleCloseContextMenu}
                    onOpen={handleContextMenuOpen}
                    onCopyPath={handleCopyPath}
                    onCopyRelativePath={handleCopyRelativePath}
                    onReferenceInChat={() => setContextMenu(null)}
                    onCreateSession={() => setContextMenu(null)}
                    onCreateFile={() => setContextMenu(null)}
                    onCreateFolder={() => setContextMenu(null)}
                    onRefresh={handleRefresh}
                  />,
                  document.body,
                )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function injectChildren(
  nodes: FileTreeNode[],
  parentPath: string,
  children: FileTreeNode[],
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === parentPath && node.type === 'directory') {
      return { ...node, children };
    }
    if (node.children) {
      return { ...node, children: injectChildren(node.children, parentPath, children) };
    }
    return node;
  });
}
