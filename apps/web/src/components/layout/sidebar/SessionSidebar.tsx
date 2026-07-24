import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useSessions } from '../../../hooks/workspace/useSessions.js';
import SessionContextMenu from './SessionContextMenu.js';
import FileTreeContextMenu from '../file-tree/FileTreeContextMenu.js';
import { useSessionSidebarFileTreeState } from './use-session-sidebar-file-tree-state.js';
import {
  copyTextToClipboard,
  getFileTreeRelativePath,
  isValidFileTreeEntryName,
  joinFileTreePath,
} from '../file-tree/file-tree-actions.js';
import { SessionSidebarSessionRow } from './SessionSidebarSessionRow.js';
import { WorkspaceFileTreePanel } from './WorkspaceFileTreePanel.js';
import WorkspaceGroupMenu from '../workspace/WorkspaceGroupMenu.js';
import { WorkspaceDeleteConfirmDialog } from '../workspace/WorkspaceDeleteConfirmDialog.js';
import { WorkspaceGitBadge, FileTreeView, type FileTreeContextTarget } from './SidebarHelpers.js';
import type { FileTreeNode } from '../../common/modal/WorkspacePickerModal.js';
import { preloadRouteModuleByPath } from '../../../routes/preloadable-route-modules.js';
import { toast } from '../../common/feedback/ToastNotification.js';
import { dispatchComposerReference } from '../../../utils/chat/composer-reference-events.js';
import {
  UNBOUND_WORKSPACE_GROUP_KEY,
  getWorkspaceGroupKey,
} from '../../../utils/session/session-grouping.js';

const sessionIconBtnStyle: React.CSSProperties = {
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

type FileTreeContextMenuState = FileTreeContextTarget & {
  targetType: 'root' | FileTreeContextTarget['type'];
};
export interface SessionSidebarProps {
  onOpenFile?: (path: string) => void;
  fetchRootPath: () => Promise<string>;
  fetchTree: (path: string, depth?: number) => Promise<FileTreeNode[]>;
  onOpenWorkspacePicker: () => void;
}

export function SessionSidebar({
  onOpenFile,
  fetchRootPath,
  fetchTree,
  onOpenWorkspacePicker,
}: SessionSidebarProps) {
  const navigate = useNavigate();
  const preloadChatRoute = useCallback((sessionIdToPreload: string) => {
    void preloadRouteModuleByPath(`/chat/${sessionIdToPreload}`);
  }, []);
  const openChatSession = useCallback(
    (sessionIdToOpen: string) => {
      preloadChatRoute(sessionIdToOpen);
      void navigate(`/chat/${sessionIdToOpen}`);
    },
    [navigate, preloadChatRoute],
  );
  void fetchRootPath;
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const accessToken = useAuthStore((s) => s.accessToken);
  const workspaceClient = useMemo(() => createWorkspaceClient(gatewayUrl), [gatewayUrl]);
  const {
    sidebarTab,
    setSidebarTab,
    togglePinSession,
    isPinned,
    expandedDirs: expandedDirsArr,
    setExpandedDirs: setExpandedDirsArr,
    fileTreeRootPath,
    activeFilePathByWorkspace,
    bumpWorkspaceTreeVersion,
    removeSavedWorkspacePath,
  } = useUIStateStore();
  const uiActiveFilePath =
    activeFilePathByWorkspace[
      fileTreeRootPath && fileTreeRootPath.trim().length > 0 ? fileTreeRootPath : '__default__'
    ] ?? null;
  const expandedDirs = new Set(expandedDirsArr);
  const setExpandedDirs = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const next = typeof updater === 'function' ? updater(new Set(expandedDirsArr)) : updater;
      setExpandedDirsArr(Array.from(next));
    },
    [expandedDirsArr, setExpandedDirsArr],
  );

  const {
    sessions,
    groupedSessionTrees,
    sessionCountByWorkspace,
    workspaceSessionIdsByGroupKey,
    renamingSessionId,
    renameValue,
    setRenameValue,
    hoveredSessionId,
    setHoveredSessionId,
    isDeletingSession,
    collapsedGroups,
    toggleGroupCollapsed,
    sessionSearch,
    setSessionSearch,
    newSession,
    startRename,
    commitRename,
    quickDeleteSession,
    quickExportSession,
    exportSessionAsMarkdown,
    exportSessionAsJson,
  } = useSessions();

  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<{
    allSessionIds: string[];
    workspacePath: string | null;
    workspaceLabel: string;
    groupKey: string;
    sessionCount: number;
    actualSessionCount: number;
    x: number;
    y: number;
  } | null>(null);
  const [deletingWorkspaceGroupKeys, setDeletingWorkspaceGroupKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingWorkspaceDeletion, setPendingWorkspaceDeletion] = useState<{
    groupKey: string;
    sessionIds: string[];
    workspaceLabel: string;
    workspacePath: string | null;
  } | null>(null);

  const [fileTreeFilter, setFileTreeFilter] = useState('');
  const [fileTreeContextMenu, setFileTreeContextMenu] = useState<FileTreeContextMenuState | null>(
    null,
  );
  const hasSelectedWorkspace = fileTreeRootPath !== null;
  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const deletingWorkspaceGroupKeysRef = useRef<Set<string>>(new Set());
  const workspaceDeletionSubmitLockRef = useRef(false);

  const restoreHoveredSessionFromPointer = useCallback(() => {
    const pointer = lastPointerPositionRef.current;
    if (!pointer) {
      setHoveredSessionId(null);
      return;
    }

    if (typeof document.elementFromPoint !== 'function') {
      setHoveredSessionId(null);
      return;
    }

    const hoveredElement = document.elementFromPoint(pointer.x, pointer.y);
    if (!(hoveredElement instanceof Element)) {
      setHoveredSessionId(null);
      return;
    }

    const hoveredSessionItem = hoveredElement.closest<HTMLElement>('[data-session-id]');
    setHoveredSessionId(hoveredSessionItem?.dataset.sessionId ?? null);
  }, [setHoveredSessionId]);

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
    active: sidebarTab === 'files',
    expandedDirsArr,
    fetchTree,
    fileTreeRootPath,
    setExpandedDirs,
  });

  useEffect(() => {
    setFileTreeContextMenu(null);
  }, [fileTreeRootPath]);

  useEffect(() => {
    if (!hoveredSessionId) {
      return;
    }

    if (sessions.some((session) => session.id === hoveredSessionId)) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        restoreHoveredSessionFromPointer();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [hoveredSessionId, restoreHoveredSessionFromPointer, sessions]);

  const handleDeleteWorkspaceGroup = useCallback(
    async (
      workspacePath: string | null,
      workspaceLabel: string,
      groupKey: string,
      sessionIds: string[],
    ) => {
      if (!workspacePath && sessionIds.length === 0) {
        return;
      }

      if (deletingWorkspaceGroupKeysRef.current.has(groupKey)) {
        return;
      }

      deletingWorkspaceGroupKeysRef.current.add(groupKey);

      setDeletingWorkspaceGroupKeys((previous) => {
        const next = new Set(previous);
        next.add(groupKey);
        return next;
      });

      const sessionCount = sessionIds.length;
      let successCount = 0;
      let failedCount = 0;

      try {
        for (const sessionId of sessionIds) {
          const deleted = await quickDeleteSession(sessionId, { suppressToast: true });
          if (deleted) {
            successCount += 1;
          } else {
            failedCount += 1;
          }
        }

        if (failedCount === 0) {
          if (workspacePath) {
            removeSavedWorkspacePath(workspacePath);
          }
          toast(
            sessionCount > 0
              ? workspacePath === null
                ? `已删除未绑定工作区中的 ${successCount} 个会话`
                : `已删除工作区「${workspaceLabel}」及 ${successCount} 个会话`
              : `已移除工作区「${workspaceLabel}」`,
            'success',
          );
          return;
        }

        toast(
          workspacePath === null
            ? `未绑定工作区删除未完成：已删除 ${successCount} 个会话，${failedCount} 个失败。`
            : `工作区「${workspaceLabel}」删除未完成：已删除 ${successCount} 个会话，${failedCount} 个失败，工作区未移除。`,
          'warning',
          4200,
        );
      } finally {
        setDeletingWorkspaceGroupKeys((previous) => {
          if (!previous.has(groupKey)) {
            return previous;
          }

          const next = new Set(previous);
          next.delete(groupKey);
          return next;
        });
        deletingWorkspaceGroupKeysRef.current.delete(groupKey);
      }
    },
    [quickDeleteSession, removeSavedWorkspacePath],
  );

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

  const handleCreateSessionFromFileTreeTarget = useCallback(
    (target: FileTreeContextMenuState) => {
      if (target.targetType !== 'root' && target.targetType !== 'directory') {
        return;
      }

      void newSession(target.path);
    },
    [newSession],
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

  const handleSidebarTabChange = useCallback(
    (tab: 'sessions' | 'files') => {
      setSidebarTab(tab);
      if (tab === 'files' && !fileTreeRootPath) {
        setFileTreeError(null);
      }
    },
    [fileTreeRootPath, setFileTreeError, setSidebarTab],
  );

  const { sessionId } = { sessionId: window.location.pathname.split('/chat/')[1]?.split('/')[0] };

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '8px 8px 6px',
          flexShrink: 0,
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', gap: 0, flex: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => void newSession()}
            title="新建会话"
            className="icon-btn-accent"
            style={{
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
            }}
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
          <button
            type="button"
            onClick={onOpenWorkspacePicker}
            title="选择工作区后新建会话"
            style={{
              display: 'flex',
              width: 30,
              height: 30,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '0 8px 8px 0',
              background: 'var(--accent)',
              borderLeft: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
              color: 'var(--fg-on-accent)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
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
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          padding: '0 8px 6px',
          flexShrink: 0,
          borderBottom: '1px solid var(--border-default)',
          gap: 4,
        }}
      >
        {(['sessions', 'files'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => void handleSidebarTabChange(tab)}
            style={{
              flex: 1,
              height: 28,
              padding: '0 8px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              borderRadius: 7,
              border:
                sidebarTab === tab ? '1px solid var(--border-default)' : '1px solid transparent',
              background: sidebarTab === tab ? 'var(--bg-overlay)' : 'transparent',
              color: sidebarTab === tab ? 'var(--fg-strong)' : 'var(--fg-muted)',
              fontSize: 12,
              fontWeight: sidebarTab === tab ? 600 : 400,
              cursor: 'pointer',
              transition: 'background 150ms ease, color 150ms ease',
            }}
          >
            {tab === 'sessions' ? (
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
            ) : (
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
            )}
            <span>{tab === 'sessions' ? '会话' : '文件树'}</span>
          </button>
        ))}
      </div>

      {sidebarTab === 'sessions' && (
        <div
          style={{
            padding: '4px 6px',
            flexShrink: 0,
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <input
            type="text"
            placeholder="搜索会话…"
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 11,
              color: 'var(--fg-strong)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <SessionPathFilterToggle />
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {sidebarTab === 'sessions' && sessions.length === 0 && groupedSessionTrees.length === 0 && (
          <p
            style={{
              padding: '24px 8px',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--fg-muted)',
            }}
          >
            暂无会话
          </p>
        )}
        {sidebarTab === 'files' && (
          <WorkspaceFileTreePanel
            onOpenFile={onOpenFile}
            fetchTree={fetchTree}
            active={sidebarTab === 'files'}
            sessionId={sessionId ?? null}
            onCreateSession={(directoryPath) => void newSession(directoryPath)}
            onSwitchWorkspace={onOpenWorkspacePicker}
          />
        )}
        {sidebarTab === 'sessions' &&
          groupedSessionTrees.map((group) => {
            const groupKey = getWorkspaceGroupKey(group.workspacePath);
            const isCollapsed = collapsedGroups.has(groupKey);
            const actualSessionCount =
              sessionCountByWorkspace.get(getWorkspaceGroupKey(group.workspacePath)) ?? 0;
            return (
              <div
                key={groupKey}
                style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 2 }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapsed(groupKey)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setWorkspaceContextMenu({
                        allSessionIds: workspaceSessionIdsByGroupKey.get(groupKey) ?? [],
                        workspacePath: group.workspacePath,
                        workspaceLabel: group.workspaceLabel,
                        groupKey,
                        sessionCount: group.sessions.length,
                        actualSessionCount,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      minWidth: 0,
                      padding: '5px 4px 4px 8px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: 'var(--fg-default)',
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
                        transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                        transition: 'transform 150ms ease',
                      }}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
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
                      style={{ flexShrink: 0 }}
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11,
                        fontWeight: 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {group.workspaceLabel}
                    </span>
                    {group.workspacePath && (
                      <WorkspaceGitBadge
                        workspacePath={group.workspacePath}
                        gatewayUrl={gatewayUrl}
                        accessToken={accessToken ?? ''}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--fg-muted)',
                        flexShrink: 0,
                        marginRight: 2,
                      }}
                    >
                      {group.sessions.length}
                    </span>
                  </button>
                  {group.workspacePath && (
                    <button
                      type="button"
                      onClick={() => void newSession(group.workspacePath)}
                      title={`在 ${group.workspaceLabel} 中新建会话`}
                      style={{
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--fg-muted)',
                        cursor: 'pointer',
                        padding: 0,
                        marginRight: 4,
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                  )}
                </div>

                {!isCollapsed && (
                  <div
                    style={{
                      marginLeft: 16,
                      borderLeft: '1px solid var(--border-subtle)',
                      paddingLeft: 4,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                    }}
                  >
                    {group.roots.map((node) => (
                      <SessionSidebarSessionRow
                        key={node.session.id}
                        activeSessionId={sessionId}
                        commitRename={commitRename}
                        hoveredSessionId={hoveredSessionId}
                        isDeletingSession={isDeletingSession}
                        isPinned={isPinned}
                        node={node}
                        onHoveredSessionChange={setHoveredSessionId}
                        onOpenContextMenu={(sessionIdToOpen, x, y) => {
                          setContextMenu({ sessionId: sessionIdToOpen, x, y });
                        }}
                        onPointerPositionChange={(position) => {
                          lastPointerPositionRef.current = position;
                        }}
                        openChatSession={openChatSession}
                        preloadChatRoute={preloadChatRoute}
                        quickDeleteSession={quickDeleteSession}
                        quickExportSession={quickExportSession}
                        renameValue={renameValue}
                        renamingSessionId={renamingSessionId}
                        setRenameValue={setRenameValue}
                        startRename={startRename}
                      />
                    ))}
                    {group.sessions.length === 0 && (
                      <div
                        style={{
                          padding: '8px 10px 8px 8px',
                          borderRadius: 6,
                          color: 'var(--fg-muted)',
                          fontSize: 11,
                          lineHeight: 1.5,
                        }}
                      >
                        {actualSessionCount === 0
                          ? '暂无会话，可在此工作区中新建一个会话。'
                          : '当前筛选条件下暂无匹配会话。'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {contextMenu &&
        createPortal(
          (() => {
            const ctxSession = sessions.find((s) => s.id === contextMenu.sessionId);
            const pinned = ctxSession ? isPinned(ctxSession.id) : false;
            return (
              <SessionContextMenu
                sessionId={contextMenu.sessionId}
                sessionTitle={ctxSession?.title ?? null}
                x={contextMenu.x}
                y={contextMenu.y}
                isPinned={pinned}
                hasMessages
                onClose={() => setContextMenu(null)}
                onRename={() => {
                  if (ctxSession) startRename(ctxSession);
                }}
                onExportMarkdown={() => exportSessionAsMarkdown(contextMenu.sessionId)}
                onExportJson={() => exportSessionAsJson(contextMenu.sessionId)}
                onClearMessages={() => alert('清空功能开发中')}
                onPin={() => togglePinSession(contextMenu.sessionId)}
                onDelete={() => void quickDeleteSession(contextMenu.sessionId)}
              />
            );
          })(),
          document.body,
        )}
      {workspaceContextMenu &&
        createPortal(
          <WorkspaceGroupMenu
            workspacePath={workspaceContextMenu.workspacePath}
            workspaceLabel={workspaceContextMenu.workspaceLabel}
            sessionCount={workspaceContextMenu.actualSessionCount}
            x={workspaceContextMenu.x}
            y={workspaceContextMenu.y}
            isCollapsed={collapsedGroups.has(workspaceContextMenu.groupKey)}
            canDelete={
              workspaceContextMenu.workspacePath !== null ||
              workspaceContextMenu.actualSessionCount > 0
            }
            onClose={() => setWorkspaceContextMenu(null)}
            onNewSession={() => void newSession(workspaceContextMenu.workspacePath)}
            onToggleCollapse={() => toggleGroupCollapsed(workspaceContextMenu.groupKey)}
            onDelete={() => {
              setPendingWorkspaceDeletion({
                groupKey: workspaceContextMenu.groupKey,
                sessionIds: workspaceContextMenu.allSessionIds,
                workspaceLabel: workspaceContextMenu.workspaceLabel,
                workspacePath: workspaceContextMenu.workspacePath,
              });
            }}
          />,
          document.body,
        )}
      <WorkspaceDeleteConfirmDialog
        open={pendingWorkspaceDeletion !== null}
        workspaceLabel={pendingWorkspaceDeletion?.workspaceLabel ?? ''}
        sessionCount={pendingWorkspaceDeletion?.sessionIds.length ?? 0}
        isUnboundGroup={pendingWorkspaceDeletion?.groupKey === UNBOUND_WORKSPACE_GROUP_KEY}
        deleting={
          pendingWorkspaceDeletion
            ? deletingWorkspaceGroupKeys.has(pendingWorkspaceDeletion.groupKey)
            : false
        }
        onCancel={() => {
          if (
            workspaceDeletionSubmitLockRef.current ||
            (pendingWorkspaceDeletion &&
              deletingWorkspaceGroupKeys.has(pendingWorkspaceDeletion.groupKey))
          ) {
            return;
          }

          setPendingWorkspaceDeletion(null);
        }}
        onConfirm={() => {
          if (!pendingWorkspaceDeletion) {
            return;
          }

          if (workspaceDeletionSubmitLockRef.current) {
            return;
          }

          workspaceDeletionSubmitLockRef.current = true;

          void handleDeleteWorkspaceGroup(
            pendingWorkspaceDeletion.workspacePath,
            pendingWorkspaceDeletion.workspaceLabel,
            pendingWorkspaceDeletion.groupKey,
            pendingWorkspaceDeletion.sessionIds,
          ).finally(() => {
            workspaceDeletionSubmitLockRef.current = false;
            setPendingWorkspaceDeletion(null);
          });
        }}
      />
    </>
  );
}

/**
 * Compact toggle row that scopes the sessions list to the user's
 * `selectedWorkspacePath` via the gateway `?path=` query param
 * (P3-PATH). Disabled when no workspace is selected — without a path
 * to scope to, the toggle would be a confusing no-op.
 */
function SessionPathFilterToggle(): React.ReactElement | null {
  const enabled = useUIStateStore((s) => s.sessionListPathFilterEnabled);
  const setEnabled = useUIStateStore((s) => s.setSessionListPathFilterEnabled);
  const featureEnabled = useUIStateStore((s) => s.sessionListPathFilterFeatureEnabled);
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);

  const hasWorkspace = Boolean(selectedWorkspacePath);
  // Auto-disable the toggle when the user clears the selected
  // workspace, otherwise the next list call would silently fall back
  // to "no path filter" with no UI cue.
  useEffect(() => {
    if (!hasWorkspace && enabled) {
      setEnabled(false);
    }
  }, [hasWorkspace, enabled, setEnabled]);

  // T-PATH-04: when the settings-level kill switch is off, hide the
  // toggle entirely. The hook in `useSessions` also drops the path
  // query in that state, so leaving the toggle visible would be
  // misleading ("ON but no effect").
  if (!featureEnabled) {
    return null;
  }
  if (!hasWorkspace) {
    return null;
  }

  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: 'var(--fg-muted)',
        cursor: 'pointer',
        padding: '2px 4px',
        userSelect: 'none',
      }}
      title="仅显示与当前工作区目录关联的会话"
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        style={{ margin: 0, cursor: 'pointer' }}
      />
      仅当前目录
    </label>
  );
}
