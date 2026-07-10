import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { useSessionSidebarFileTreeState } from './use-session-sidebar-file-tree-state.js';
import FileTreeContextMenu from '../file-tree/FileTreeContextMenu.js';
import {
  copyTextToClipboard,
  getFileTreeRelativePath,
  isValidFileTreeEntryName,
  joinFileTreePath,
} from '../file-tree/file-tree-actions.js';
import { FileTreeView, type FileTreeContextTarget } from './SidebarHelpers.js';
import type { FileTreeNode } from '../../common/modal/WorkspacePickerModal.js';
import { toast } from '../../common/feedback/ToastNotification.js';
import { dispatchComposerReference } from '../../../utils/chat/composer-reference-events.js';

function getParentDir(path: string): string {
  if (path === '/') return '/';
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return path.slice(0, lastSlash);
}

type FileTreeContextMenuState = FileTreeContextTarget & {
  targetType: 'root' | FileTreeContextTarget['type'];
};

const ICON_BTN_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 5,
  background: 'transparent',
  border: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

export interface WorkspaceFileTreePanelProps {
  /** Called when the user clicks a file in the tree. */
  onOpenFile?: (path: string) => void;
  /** Fetch tree data for a given path. */
  fetchTree: (path: string, depth?: number) => Promise<FileTreeNode[]>;
  /** Whether the panel is actively visible (controls data loading). */
  active?: boolean;
  /** Optional callback to create a new session from a directory right-click. */
  onCreateSession?: (directoryPath: string) => void;
  /**
   * Optional workspace path override. When provided, this takes precedence
   * over the store's `fileTreeRootPath` — useful for contexts like the
   * chat editor pane where the tree should reflect the current session's
   * working directory rather than the globally selected workspace.
   */
  workspacePath?: string | null;
  /**
   * Visual variant:
   * - `'sidebar'` (default): card-style header with border + radius, for
   *   standalone sidebar columns.
   * - `'embedded'`: flat IDE-style — no card border, compact header,
   *   borderless search, tighter spacing. For embedding inside an editor
   *   panel where the parent already provides structural chrome.
   */
  variant?: 'sidebar' | 'embedded';
  /** Optional className / style overrides for the root container. */
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 完整的工作区文件树面板——从 SessionSidebar 的 files tab 提取。
 *
 * 包含：工作区目录头部（路径展示、新建文件/文件夹、刷新）、搜索过滤、
 * FileTreeView 以及右键上下文菜单（打开、复制路径、引用到对话、
 * 新建、删除、重命名等）。
 *
 * 可在侧边栏、编辑器面板等任何需要文件浏览的位置复用。
 */
export function WorkspaceFileTreePanel({
  onOpenFile,
  fetchTree,
  active = true,
  onCreateSession,
  workspacePath: workspacePathOverride,
  variant = 'sidebar',
  className,
  style,
}: WorkspaceFileTreePanelProps) {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const accessToken = useAuthStore((s) => s.accessToken);
  const workspaceClient = useMemo(() => createWorkspaceClient(gatewayUrl), [gatewayUrl]);

  const {
    fileTreeRootPath: storeFileTreeRootPath,
    expandedDirs: expandedDirsArr,
    setExpandedDirs: setExpandedDirsArr,
    activeFilePathByWorkspace,
    bumpWorkspaceTreeVersion,
    removeSavedWorkspacePath,
  } = useUIStateStore();

  // 当外部传入 workspacePath 时，覆盖 store 中的 fileTreeRootPath，
  // 让文件树反映当前会话的工作目录而非全局选中的工作区。
  const fileTreeRootPath = workspacePathOverride ?? storeFileTreeRootPath;

  const uiActiveFilePath =
    activeFilePathByWorkspace[
      fileTreeRootPath && fileTreeRootPath.trim().length > 0 ? fileTreeRootPath : '__default__'
    ] ?? null;

  const expandedDirs = useMemo(() => new Set(expandedDirsArr), [expandedDirsArr]);
  const setExpandedDirs = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof updater === 'function' ? updater(new Set(expandedDirsArr)) : updater;
      setExpandedDirsArr(Array.from(next));
    },
    [expandedDirsArr, setExpandedDirsArr],
  );

  const [fileTreeFilter, setFileTreeFilter] = useState('');
  const [fileTreeContextMenu, setFileTreeContextMenu] = useState<FileTreeContextMenuState | null>(
    null,
  );
  const hasSelectedWorkspace = fileTreeRootPath !== null;

  const {
    applyCreatedEntry,
    applyDeletedEntry,
    applyRenamedEntry,
    ensureRootPath,
    fileTree,
    fileTreeError,
    fileTreeLoading,
    handleRefreshFileTree,
    handleToggleDirWithLoad,
    refreshDirectory,
    setFileTreeError,
  } = useSessionSidebarFileTreeState({
    active,
    expandedDirsArr,
    fetchTree,
    fileTreeRootPath,
    setExpandedDirs,
  });

  useEffect(() => {
    setFileTreeContextMenu(null);
  }, [fileTreeRootPath]);

  const refreshDirectoryWithVersion = useCallback(
    async (directoryPath: string): Promise<boolean> => {
      const refreshed = await refreshDirectory(directoryPath);
      if (refreshed) {
        bumpWorkspaceTreeVersion();
      }
      return refreshed;
    },
    [bumpWorkspaceTreeVersion, refreshDirectory],
  );

  const createWorkspaceFile = useCallback(
    async (path: string): Promise<void> => {
      try {
        await workspaceClient.createFile(accessToken ?? '', path);
      } catch (err) {
        const message = err instanceof Error ? err.message : '新建文件失败';
        throw new Error(message);
      }
    },
    [accessToken, workspaceClient],
  );

  const createWorkspaceDirectory = useCallback(
    async (path: string): Promise<void> => {
      try {
        await workspaceClient.createDirectory(accessToken ?? '', path);
      } catch (err) {
        const message = err instanceof Error ? err.message : '新建文件夹失败';
        throw new Error(message);
      }
    },
    [accessToken, workspaceClient],
  );

  const handleCreateEntry = useCallback(
    async (entryType: 'file' | 'directory', directoryPath: string, locationLabel: string) => {
      const defaultName = entryType === 'file' ? 'untitled.ts' : 'new-folder';
      const input = window.prompt(
        entryType === 'file'
          ? `在“${locationLabel}”中新建文件`
          : `在“${locationLabel}”中新建文件夹`,
        defaultName,
      );

      if (input === null) {
        return;
      }

      const entryName = input.trim();
      if (!isValidFileTreeEntryName(entryName)) {
        window.alert('名称不能为空、不能包含 / 或 \\，且不能使用受系统隐藏规则影响的目录名');
        return;
      }

      const nextPath = joinFileTreePath(directoryPath, entryName);

      try {
        setFileTreeError(null);
        if (entryType === 'file') {
          await createWorkspaceFile(nextPath);
        } else {
          await createWorkspaceDirectory(nextPath);
        }
        applyCreatedEntry({
          directoryPath,
          entry: {
            path: nextPath,
            name: entryName,
            type: entryType === 'file' ? 'file' : 'directory',
            ...(entryType === 'directory' ? { children: [] } : {}),
          },
        });

        const refreshed = await refreshDirectoryWithVersion(directoryPath);
        if (!refreshed) {
          bumpWorkspaceTreeVersion();
          setFileTreeError(
            `已创建${entryType === 'file' ? '文件' : '文件夹'}，但目录刷新失败，请手动刷新后确认`,
          );
        }

        if (entryType === 'file') {
          onOpenFile?.(nextPath);
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : '创建失败');
      }
    },
    [
      bumpWorkspaceTreeVersion,
      applyCreatedEntry,
      createWorkspaceDirectory,
      createWorkspaceFile,
      onOpenFile,
      refreshDirectoryWithVersion,
    ],
  );

  const handleCreateRootEntry = useCallback(
    (entryType: 'file' | 'directory') => {
      void (async () => {
        const rootPath = await ensureRootPath();
        if (!rootPath) {
          return;
        }
        await handleCreateEntry(entryType, rootPath, '工作区根目录');
      })();
    },
    [ensureRootPath, handleCreateEntry],
  );

  const handleCopyFileTreePath = useCallback((path: string, label: string) => {
    void copyTextToClipboard(path)
      .then(() => toast(`已复制${label}`, 'success'))
      .catch((error: unknown) => {
        toast(error instanceof Error ? error.message : '复制失败', 'error');
      });
  }, []);

  const handleReferenceFileTreeTarget = useCallback(
    (target: FileTreeContextMenuState) => {
      const relativePath = getFileTreeRelativePath(fileTreeRootPath, target.path);
      const referencePath = relativePath ?? target.path;
      const targetKind = target.targetType === 'file' ? '文件' : '目录';
      dispatchComposerReference(`@${referencePath} `);
      toast(`已引用${targetKind}到输入框`, 'success');
    },
    [fileTreeRootPath],
  );

  const handleOpenRootContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      const x = event.clientX;
      const y = event.clientY;

      void (async () => {
        const rootPath = await ensureRootPath();
        if (!rootPath) {
          return;
        }
        setFileTreeContextMenu({
          path: rootPath,
          name: '工作区根目录',
          type: 'directory',
          targetType: 'root',
          directoryPath: rootPath,
          x,
          y,
        });
      })();
    },
    [ensureRootPath],
  );

  const handleNodeContextMenu = useCallback((target: FileTreeContextTarget) => {
    setFileTreeContextMenu({ ...target, targetType: target.type });
  }, []);

  void removeSavedWorkspacePath;

  // ── Variant-driven styles ──────────────────────────────────────────
  const isEmbedded = variant === 'embedded';

  const rootGap = isEmbedded ? 0 : 8;
  const rootPadding = isEmbedded ? '0' : undefined;

  const headerStyle: React.CSSProperties = isEmbedded
    ? {
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 8px 5px',
        flexShrink: 0,
        borderBottom: '1px solid var(--border-subtle)',
        background: 'transparent',
      }
    : {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 8px 7px',
        borderRadius: 8,
        border: '1px solid var(--border-subtle)',
        background: 'color-mix(in oklab, var(--bg-overlay) 82%, var(--bg-base) 18%)',
      };

  const toolBtnSize = isEmbedded
    ? { width: 22, height: 22, borderRadius: 5 }
    : { width: 26, height: 26, borderRadius: 7 };

  const searchWrapStyle: React.CSSProperties = isEmbedded
    ? {
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 8px',
        background: 'transparent',
        borderBottom: '1px solid var(--border-subtle)',
      }
    : {
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-overlay)',
      };

  const treePadding = isEmbedded ? '4px 0' : undefined;

  return (
    <>
      <div
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: rootGap,
          padding: rootPadding,
          ...style,
        }}
      >
        {/* 工作区目录头部 */}
        <div style={headerStyle}>
          <button
            type="button"
            onContextMenu={handleOpenRootContextMenu}
            title={hasSelectedWorkspace ? '右键可在根目录新建文件或文件夹' : '请先选择工作区'}
            style={{
              display: 'flex',
              flexDirection: isEmbedded ? 'row' : 'column',
              alignItems: isEmbedded ? 'center' : 'flex-start',
              gap: isEmbedded ? 6 : 2,
              minWidth: 0,
              flex: 1,
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'default',
              textAlign: 'left',
            }}
          >
            {isEmbedded ? (
              <>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--fg-strong)',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={fileTreeRootPath ?? '尚未选择工作区'}
                >
                  {fileTreeRootPath
                    ? fileTreeRootPath.split('/').pop() || fileTreeRootPath
                    : '尚未选择工作区'}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)' }}>
                  工作区目录
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-default)',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={fileTreeRootPath ?? '尚未选择工作区'}
                >
                  {fileTreeRootPath ?? '尚未选择工作区'}
                </span>
              </>
            )}
          </button>
          <button
            type="button"
            title={hasSelectedWorkspace ? '在根目录新建文件' : '请先选择工作区'}
            onClick={() => handleCreateRootEntry('file')}
            disabled={fileTreeLoading || !hasSelectedWorkspace}
            className="icon-btn"
            style={{
              ...ICON_BTN_STYLE,
              ...toolBtnSize,
              opacity: fileTreeLoading || !hasSelectedWorkspace ? 0.5 : 1,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="12" x2="12" y2="18" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </button>
          <button
            type="button"
            title={hasSelectedWorkspace ? '在根目录新建文件夹' : '请先选择工作区'}
            onClick={() => handleCreateRootEntry('directory')}
            disabled={fileTreeLoading || !hasSelectedWorkspace}
            className="icon-btn"
            style={{
              ...ICON_BTN_STYLE,
              ...toolBtnSize,
              opacity: fileTreeLoading || !hasSelectedWorkspace ? 0.5 : 1,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>
          <button
            type="button"
            title={hasSelectedWorkspace ? '刷新目录' : '请先选择工作区'}
            onClick={handleRefreshFileTree}
            disabled={fileTreeLoading || !hasSelectedWorkspace}
            className="icon-btn"
            style={{
              ...ICON_BTN_STYLE,
              ...toolBtnSize,
              opacity: fileTreeLoading || !hasSelectedWorkspace ? 0.5 : 1,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10" />
              <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14" />
            </svg>
          </button>
        </div>

        {/* 错误提示 */}
        {fileTreeError && (
          <div
            style={{
              padding: '8px 10px',
              margin: isEmbedded ? '0 8px' : undefined,
              borderRadius: isEmbedded ? 6 : 8,
              border: '1px solid color-mix(in oklab, var(--danger) 32%, var(--border-default) 68%)',
              background: 'color-mix(in oklab, var(--danger) 10%, var(--bg-overlay) 90%)',
              color: 'var(--fg-default)',
              fontSize: 11,
              lineHeight: 1.5,
              flexShrink: 0,
            }}
          >
            {fileTreeError}
          </div>
        )}

        {/* 加载/空/文件树 */}
        {fileTreeLoading ? (
          <p
            style={{
              padding: '24px 8px',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--fg-muted)',
            }}
          >
            加载中…
          </p>
        ) : !hasSelectedWorkspace ? (
          <p
            style={{
              padding: '24px 8px',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--fg-muted)',
              lineHeight: 1.6,
            }}
          >
            请先选择工作区，文件树才会显示对应目录内容
          </p>
        ) : fileTree.length === 0 ? (
          <p
            style={{
              padding: '24px 8px',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--fg-muted)',
            }}
          >
            当前目录为空，可使用上方按钮或右键新建文件 / 文件夹
          </p>
        ) : (
          <>
            {/* 文件搜索 */}
            <div style={{ padding: isEmbedded ? 0 : '0 0 6px', flexShrink: 0 }}>
              <div style={searchWrapStyle}>
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--fg-muted)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  placeholder="过滤文件…"
                  value={fileTreeFilter}
                  onChange={(e) => setFileTreeFilter(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: 'var(--text-1)',
                    fontSize: 11,
                    padding: 0,
                  }}
                />
                {fileTreeFilter && (
                  <button
                    type="button"
                    onClick={() => setFileTreeFilter('')}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 7,
                      border: 'none',
                      background: 'var(--text-4)',
                      color: 'var(--bg-overlay)',
                      fontSize: 9,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* 文件树 */}
            <div style={{ flex: 1, overflow: 'auto', padding: treePadding }}>
              <FileTreeView
                nodes={fileTree}
                expandedDirs={expandedDirs}
                onOpenFile={onOpenFile}
                onToggleDir={(path) => void handleToggleDirWithLoad(path)}
                onNodeContextMenu={handleNodeContextMenu}
                filter={fileTreeFilter}
                activeFilePath={uiActiveFilePath}
              />
            </div>
          </>
        )}
      </div>

      {/* 右键上下文菜单 */}
      {fileTreeContextMenu &&
        createPortal(
          <FileTreeContextMenu
            x={fileTreeContextMenu.x}
            y={fileTreeContextMenu.y}
            targetLabel={
              fileTreeContextMenu.targetType === 'root' ? '工作区根目录' : fileTreeContextMenu.name
            }
            targetType={fileTreeContextMenu.targetType}
            relativePath={getFileTreeRelativePath(fileTreeRootPath, fileTreeContextMenu.path)}
            canOpen={fileTreeContextMenu.targetType === 'file' && Boolean(onOpenFile)}
            canCreateSession={Boolean(fileTreeContextMenu.path)}
            onClose={() => setFileTreeContextMenu(null)}
            onOpen={() => {
              if (fileTreeContextMenu.targetType === 'file') {
                onOpenFile?.(fileTreeContextMenu.path);
              }
            }}
            onCopyPath={() => handleCopyFileTreePath(fileTreeContextMenu.path, '完整路径')}
            onCopyRelativePath={() => {
              const relativePath = getFileTreeRelativePath(
                fileTreeRootPath,
                fileTreeContextMenu.path,
              );
              if (relativePath) {
                handleCopyFileTreePath(relativePath, '相对路径');
              }
            }}
            onReferenceInChat={() => handleReferenceFileTreeTarget(fileTreeContextMenu)}
            onCreateSession={
              onCreateSession &&
              (fileTreeContextMenu.targetType === 'root' ||
                fileTreeContextMenu.targetType === 'directory')
                ? () => onCreateSession(fileTreeContextMenu.path)
                : undefined
            }
            onCreateFile={() => {
              const label =
                fileTreeContextMenu.targetType === 'root'
                  ? '工作区根目录'
                  : fileTreeContextMenu.targetType === 'file'
                    ? `${fileTreeContextMenu.name} 所在目录`
                    : fileTreeContextMenu.name;
              void handleCreateEntry('file', fileTreeContextMenu.directoryPath, label);
            }}
            onCreateFolder={() => {
              const label =
                fileTreeContextMenu.targetType === 'root'
                  ? '工作区根目录'
                  : fileTreeContextMenu.targetType === 'file'
                    ? `${fileTreeContextMenu.name} 所在目录`
                    : fileTreeContextMenu.name;
              void handleCreateEntry('directory', fileTreeContextMenu.directoryPath, label);
            }}
            onRefresh={() => {
              void refreshDirectoryWithVersion(fileTreeContextMenu.directoryPath);
            }}
            onDelete={
              fileTreeContextMenu.targetType !== 'root'
                ? () => {
                    const targetPath = fileTreeContextMenu.path;
                    const targetName = fileTreeContextMenu.name;
                    const targetType = fileTreeContextMenu.targetType;
                    const confirmMsg =
                      targetType === 'directory'
                        ? `确定要删除文件夹「${targetName}」及其所有内容吗？此操作不可撤销。`
                        : `确定要删除文件「${targetName}」吗？此操作不可撤销。`;
                    if (!window.confirm(confirmMsg)) return;
                    void (async () => {
                      try {
                        if (!accessToken) return;
                        await workspaceClient.deleteEntry(accessToken, targetPath);
                        applyDeletedEntry(targetPath);
                        toast(`已删除: ${targetName}`, 'success');
                        void refreshDirectoryWithVersion(fileTreeContextMenu.directoryPath);
                        bumpWorkspaceTreeVersion();
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : '删除失败';
                        toast(msg, 'error');
                      }
                    })();
                  }
                : undefined
            }
            onRename={
              fileTreeContextMenu.targetType !== 'root'
                ? () => {
                    const targetPath = fileTreeContextMenu.path;
                    const targetName = fileTreeContextMenu.name;
                    const newName = window.prompt(`重命名「${targetName}」为：`, targetName);
                    if (!newName || newName === targetName || !newName.trim()) return;
                    if (!isValidFileTreeEntryName(newName.trim())) {
                      toast('名称无效，请检查是否包含特殊字符', 'warning');
                      return;
                    }
                    void (async () => {
                      try {
                        if (!accessToken) return;
                        const parentDir = fileTreeContextMenu.directoryPath;
                        const newPath = joinFileTreePath(
                          parentDir === targetPath ? getParentDir(targetPath) : parentDir,
                          newName.trim(),
                        );
                        await workspaceClient.renameEntry(accessToken, targetPath, newPath);
                        applyRenamedEntry({
                          oldPath: targetPath,
                          newPath,
                          newName: newName.trim(),
                        });
                        toast(`已重命名为: ${newName.trim()}`, 'success');
                        void refreshDirectoryWithVersion(fileTreeContextMenu.directoryPath);
                        bumpWorkspaceTreeVersion();
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : '重命名失败';
                        toast(msg, 'error');
                      }
                    })();
                  }
                : undefined
            }
          />,
          document.body,
        )}
    </>
  );
}
