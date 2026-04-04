import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useUIStateStore } from '../../stores/uiState.js';
import { useAuthStore } from '../../stores/auth.js';
import { useSessions } from '../../hooks/useSessions.js';
import SessionContextMenu from './SessionContextMenu.js';
import FileTreeContextMenu from './FileTreeContextMenu.js';
import { SessionSidebarSessionRow } from './SessionSidebarSessionRow.js';
import WorkspaceGroupMenu from './WorkspaceGroupMenu.js';
import { WorkspaceDeleteConfirmDialog } from './WorkspaceDeleteConfirmDialog.js';
import { WorkspaceGitBadge, FileTreeView, type FileTreeContextTarget } from './SidebarHelpers.js';
import type { FileTreeNode } from '../WorkspacePickerModal.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import { toast } from '../ToastNotification.js';
import { UNBOUND_WORKSPACE_GROUP_KEY, getWorkspaceGroupKey } from '../../utils/session-grouping.js';

const sessionIconBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 5,
  background: 'transparent',
  border: 'none',
  color: 'var(--text-3)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

const HIDDEN_FILE_TREE_ENTRY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.DS_Store',
]);

type FileTreeContextMenuState = FileTreeContextTarget & {
  targetType: 'root' | FileTreeContextTarget['type'];
};

function joinFileTreePath(directoryPath: string, entryName: string): string {
  if (directoryPath === '/') {
    return `/${entryName}`;
  }

  return `${directoryPath}/${entryName}`;
}

function isValidFileTreeEntryName(entryName: string): boolean {
  return (
    entryName.length > 0 &&
    !/[\\/]/.test(entryName) &&
    entryName !== '.' &&
    entryName !== '..' &&
    !HIDDEN_FILE_TREE_ENTRY_NAMES.has(entryName)
  );
}

async function getResponseErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === 'string' && data.error.length > 0) {
      return data.error;
    }
  } catch {
    return fallbackMessage;
  }

  return fallbackMessage;
}

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
  const {
    sidebarTab,
    setSidebarTab,
    setLeftSidebarOpen,
    togglePinSession,
    isPinned,
    expandedDirs: expandedDirsArr,
    setExpandedDirs: setExpandedDirsArr,
    fileTreeRootPath,
    bumpWorkspaceTreeVersion,
    removeSavedWorkspacePath,
  } = useUIStateStore();
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

  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [fileTreeLoading, setFileTreeLoading] = useState(false);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [fileTreeContextMenu, setFileTreeContextMenu] = useState<FileTreeContextMenuState | null>(
    null,
  );
  const hasSelectedWorkspace = fileTreeRootPath !== null;
  const fileTreeRequestIdRef = useRef(0);
  const latestFileTreeRootPathRef = useRef(fileTreeRootPath);
  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const deletingWorkspaceGroupKeysRef = useRef<Set<string>>(new Set());
  const workspaceDeletionSubmitLockRef = useRef(false);

  const nextFileTreeRequest = useCallback(() => {
    const requestId = fileTreeRequestIdRef.current + 1;
    fileTreeRequestIdRef.current = requestId;
    return requestId;
  }, []);

  const isActiveFileTreeRequest = useCallback(
    (requestId: number, rootPath: string | null) =>
      fileTreeRequestIdRef.current === requestId && latestFileTreeRootPathRef.current === rootPath,
    [],
  );

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

  const patchTreeChildren = useCallback(
    (nodes: FileTreeNode[], targetPath: string, children: FileTreeNode[]): FileTreeNode[] =>
      nodes.map((n) =>
        n.path === targetPath
          ? { ...n, children }
          : {
              ...n,
              children: n.children
                ? patchTreeChildren(n.children, targetPath, children)
                : n.children,
            },
      ),
    [],
  );

  const findNode = useCallback((nodes: FileTreeNode[], targetPath: string): FileTreeNode | null => {
    for (const node of nodes) {
      if (node.path === targetPath) return node;
      if (node.children) {
        const found = findNode(node.children, targetPath);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const ensureRootPath = useCallback(async (): Promise<string> => {
    if (!fileTreeRootPath) {
      throw new Error('请先选择工作区');
    }

    return fileTreeRootPath;
  }, [fileTreeRootPath]);

  const collectLoadedExpandedDirectories = useCallback(
    (nodes: FileTreeNode[]): string[] => {
      const expandedDirectorySet = new Set(expandedDirsArr);
      const directoryPaths: string[] = [];

      const visit = (entries: FileTreeNode[]) => {
        for (const entry of entries) {
          if (entry.type !== 'directory') {
            continue;
          }

          if (expandedDirectorySet.has(entry.path) && entry.children) {
            directoryPaths.push(entry.path);
            visit(entry.children);
          }
        }
      };

      visit(nodes);
      return directoryPaths;
    },
    [expandedDirsArr],
  );

  const collectNestedLoadedExpandedDirectories = useCallback(
    (directoryPath: string): string[] => {
      const targetNode = findNode(fileTree, directoryPath);
      if (!targetNode) {
        return [];
      }

      return collectLoadedExpandedDirectories([targetNode]).filter(
        (path) => path !== directoryPath,
      );
    },
    [collectLoadedExpandedDirectories, fileTree, findNode],
  );

  const loadFileTree = useCallback(
    async (preserveExpandedDirectories: boolean): Promise<boolean> => {
      if (!fileTreeRootPath) {
        setFileTree([]);
        setFileTreeError(null);
        return false;
      }

      const requestId = nextFileTreeRequest();
      const requestedRootPath = fileTreeRootPath;

      setFileTreeLoading(true);
      setFileTreeError(null);

      try {
        const rootNodes = await fetchTree(requestedRootPath, 1);

        if (!isActiveFileTreeRequest(requestId, requestedRootPath)) {
          return false;
        }

        if (!preserveExpandedDirectories || fileTree.length === 0) {
          setFileTree(rootNodes);
          return true;
        }

        let nextTree = rootNodes;
        let failedRefreshCount = 0;

        for (const directoryPath of collectLoadedExpandedDirectories(fileTree)) {
          try {
            const children = await fetchTree(directoryPath, 1);

            if (!isActiveFileTreeRequest(requestId, requestedRootPath)) {
              return false;
            }

            nextTree = patchTreeChildren(nextTree, directoryPath, children);
          } catch (error) {
            failedRefreshCount += 1;
            console.warn('刷新已展开目录失败', directoryPath, error);
          }
        }

        if (!isActiveFileTreeRequest(requestId, requestedRootPath)) {
          return false;
        }

        setFileTree(nextTree);
        if (failedRefreshCount > 0) {
          setFileTreeError(`已有 ${failedRefreshCount} 个已展开目录未能刷新完成`);
        }

        return true;
      } catch (error) {
        setFileTreeError(error instanceof Error ? error.message : '读取文件树失败');
        if (!preserveExpandedDirectories) {
          setFileTree([]);
        }
        return false;
      } finally {
        if (isActiveFileTreeRequest(requestId, requestedRootPath)) {
          setFileTreeLoading(false);
        }
      }
    },
    [
      collectLoadedExpandedDirectories,
      fetchTree,
      fileTree,
      fileTreeRootPath,
      isActiveFileTreeRequest,
      nextFileTreeRequest,
      patchTreeChildren,
    ],
  );

  useEffect(() => {
    latestFileTreeRootPathRef.current = fileTreeRootPath;
    fileTreeRequestIdRef.current += 1;
    setFileTree([]);
    setFileTreeError(null);
    setFileTreeContextMenu(null);
    setExpandedDirsArr([]);

    if (!fileTreeRootPath) {
      setFileTreeLoading(false);
    }
  }, [fileTreeRootPath, setExpandedDirsArr]);

  useEffect(() => {
    if (sidebarTab === 'files' && fileTreeRootPath && fileTree.length === 0) {
      void loadFileTree(false);
    }
  }, [fileTree.length, fileTreeRootPath, loadFileTree, sidebarTab]);

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

  const refreshDirectory = useCallback(
    async (directoryPath: string): Promise<boolean> => {
      if (!fileTreeRootPath) {
        setFileTree([]);
        setFileTreeError('请先选择工作区');
        return false;
      }

      const rootPath = await ensureRootPath();
      const requestId = nextFileTreeRequest();
      const requestedRootPath = fileTreeRootPath;

      if (directoryPath === rootPath || fileTree.length === 0) {
        const refreshed = await loadFileTree(true);
        if (refreshed) {
          bumpWorkspaceTreeVersion();
        }
        return refreshed;
      }

      setFileTreeLoading(true);
      setFileTreeError(null);
      try {
        let nextChildren = await fetchTree(directoryPath, 1);

        if (!isActiveFileTreeRequest(requestId, requestedRootPath)) {
          return false;
        }

        let failedRefreshCount = 0;

        for (const nestedDirectoryPath of collectNestedLoadedExpandedDirectories(directoryPath)) {
          try {
            const nestedChildren = await fetchTree(nestedDirectoryPath, 1);

            if (!isActiveFileTreeRequest(requestId, requestedRootPath)) {
              return false;
            }

            nextChildren = patchTreeChildren(nextChildren, nestedDirectoryPath, nestedChildren);
          } catch {
            failedRefreshCount += 1;
          }
        }

        if (!isActiveFileTreeRequest(requestId, requestedRootPath)) {
          return false;
        }

        setFileTree((prev) => patchTreeChildren(prev, directoryPath, nextChildren));
        if (failedRefreshCount > 0) {
          setFileTreeError(`已有 ${failedRefreshCount} 个已展开子目录未能刷新完成`);
        }
        bumpWorkspaceTreeVersion();
        return true;
      } catch (error) {
        setFileTreeError(error instanceof Error ? error.message : '刷新目录失败');
        return false;
      } finally {
        if (isActiveFileTreeRequest(requestId, requestedRootPath)) {
          setFileTreeLoading(false);
        }
      }
    },
    [
      bumpWorkspaceTreeVersion,
      collectNestedLoadedExpandedDirectories,
      ensureRootPath,
      fetchTree,
      fileTree.length,
      fileTreeRootPath,
      isActiveFileTreeRequest,
      loadFileTree,
      nextFileTreeRequest,
      patchTreeChildren,
    ],
  );

  const createWorkspaceFile = useCallback(
    async (path: string): Promise<void> => {
      const response = await fetch(`${gatewayUrl}/workspace/file`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path, content: '' }),
      });

      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, '新建文件失败'));
      }
    },
    [accessToken, gatewayUrl],
  );

  const createWorkspaceDirectory = useCallback(
    async (path: string): Promise<void> => {
      const response = await fetch(`${gatewayUrl}/workspace/directory`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, '新建文件夹失败'));
      }
    },
    [accessToken, gatewayUrl],
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

        const refreshed = await refreshDirectory(directoryPath);
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
      createWorkspaceDirectory,
      createWorkspaceFile,
      onOpenFile,
      refreshDirectory,
    ],
  );

  const handleCreateRootEntry = useCallback(
    (entryType: 'file' | 'directory') => {
      void (async () => {
        try {
          const rootPath = await ensureRootPath();
          await handleCreateEntry(entryType, rootPath, '工作区根目录');
        } catch (error) {
          setFileTreeError(error instanceof Error ? error.message : '读取根目录失败');
        }
      })();
    },
    [ensureRootPath, handleCreateEntry],
  );

  const handleRefreshFileTree = useCallback(() => {
    void (async () => {
      try {
        const rootPath = await ensureRootPath();
        await refreshDirectory(rootPath);
      } catch (error) {
        setFileTreeError(error instanceof Error ? error.message : '刷新文件树失败');
      }
    })();
  }, [ensureRootPath, refreshDirectory]);

  const handleOpenRootContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      const x = event.clientX;
      const y = event.clientY;

      void (async () => {
        try {
          const rootPath = await ensureRootPath();
          setFileTreeContextMenu({
            path: rootPath,
            name: '工作区根目录',
            type: 'directory',
            targetType: 'root',
            directoryPath: rootPath,
            x,
            y,
          });
        } catch (error) {
          setFileTreeError(error instanceof Error ? error.message : '无法打开根目录菜单');
        }
      })();
    },
    [ensureRootPath],
  );

  const handleNodeContextMenu = useCallback((target: FileTreeContextTarget) => {
    setFileTreeContextMenu({ ...target, targetType: target.type });
  }, []);

  const handleToggleDirWithLoad = useCallback(
    async (path: string) => {
      const currentRootPath = fileTreeRootPath;
      const requestId = nextFileTreeRequest();

      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      const node = findNode(fileTree, path);
      if (node && (!node.children || node.children.length === 0)) {
        try {
          setFileTreeError(null);
          const children = await fetchTree(path, 1);

          if (!isActiveFileTreeRequest(requestId, currentRootPath)) {
            return;
          }

          setFileTree((prev) => patchTreeChildren(prev, path, children));
        } catch (error) {
          if (!isActiveFileTreeRequest(requestId, currentRootPath)) {
            return;
          }

          setFileTreeError(error instanceof Error ? error.message : '读取目录失败');
          setExpandedDirs((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        }
      }
    },
    [
      fileTree,
      fileTreeRootPath,
      fetchTree,
      findNode,
      isActiveFileTreeRequest,
      nextFileTreeRequest,
      patchTreeChildren,
      setExpandedDirs,
    ],
  );

  const handleSidebarTabChange = useCallback(
    async (tab: 'sessions' | 'files') => {
      setSidebarTab(tab);
      if (tab === 'files' && !fileTreeRootPath) {
        setFileTree([]);
        setFileTreeError(null);
      }
    },
    [fileTreeRootPath, setSidebarTab],
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
              color: 'var(--accent-text)',
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
              borderLeft: '1px solid oklch(from var(--accent) calc(l - 0.08) c h / 0.5)',
              color: 'var(--accent-text)',
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
        <button
          type="button"
          title="收起面板"
          onClick={() => setLeftSidebarOpen(false)}
          className="icon-btn"
          style={{
            display: 'flex',
            width: 28,
            height: 28,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 7,
            color: 'var(--text-3)',
            flexShrink: 0,
          }}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          padding: '0 8px 6px',
          flexShrink: 0,
          borderBottom: '1px solid var(--border)',
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
              borderRadius: 7,
              border: sidebarTab === tab ? '1px solid var(--border)' : '1px solid transparent',
              background: sidebarTab === tab ? 'var(--surface)' : 'transparent',
              color: sidebarTab === tab ? 'var(--text)' : 'var(--text-3)',
              fontSize: 12,
              fontWeight: sidebarTab === tab ? 600 : 400,
              cursor: 'pointer',
              transition: 'background 150ms ease, color 150ms ease',
            }}
          >
            {tab === 'sessions' ? '会话' : '文件树'}
          </button>
        ))}
      </div>

      {sidebarTab === 'sessions' && (
        <div
          style={{
            padding: '4px 6px',
            flexShrink: 0,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <input
            type="text"
            placeholder="搜索会话…"
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 11,
              color: 'var(--text)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {sidebarTab === 'sessions' && sessions.length === 0 && groupedSessionTrees.length === 0 && (
          <p
            style={{
              padding: '24px 8px',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--text-3)',
            }}
          >
            暂无会话
          </p>
        )}
        {sidebarTab === 'files' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 8px 7px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'color-mix(in oklab, var(--surface) 82%, var(--bg) 18%)',
              }}
            >
              <button
                type="button"
                onContextMenu={handleOpenRootContextMenu}
                title={hasSelectedWorkspace ? '右键可在根目录新建文件或文件夹' : '请先选择工作区'}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  minWidth: 0,
                  flex: 1,
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'default',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)' }}>
                  工作区目录
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-2)',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={fileTreeRootPath ?? '尚未选择工作区'}
                >
                  {fileTreeRootPath ?? '尚未选择工作区'}
                </span>
              </button>
              <button
                type="button"
                title={hasSelectedWorkspace ? '在根目录新建文件' : '请先选择工作区'}
                onClick={() => handleCreateRootEntry('file')}
                disabled={fileTreeLoading || !hasSelectedWorkspace}
                className="icon-btn"
                style={{
                  ...sessionIconBtnStyle,
                  width: 26,
                  height: 26,
                  borderRadius: 7,
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
                  ...sessionIconBtnStyle,
                  width: 26,
                  height: 26,
                  borderRadius: 7,
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
                  ...sessionIconBtnStyle,
                  width: 26,
                  height: 26,
                  borderRadius: 7,
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
            {fileTreeError && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in oklab, var(--danger) 32%, var(--border) 68%)',
                  background: 'color-mix(in oklab, var(--danger) 10%, var(--surface) 90%)',
                  color: 'var(--text-2)',
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                {fileTreeError}
              </div>
            )}
            {fileTreeLoading ? (
              <p
                style={{
                  padding: '24px 8px',
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--text-3)',
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
                  color: 'var(--text-3)',
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
                  color: 'var(--text-3)',
                }}
              >
                当前目录为空，可使用上方按钮或右键新建文件 / 文件夹
              </p>
            ) : (
              <FileTreeView
                nodes={fileTree}
                expandedDirs={expandedDirs}
                onOpenFile={onOpenFile}
                onToggleDir={(path) => void handleToggleDirWithLoad(path)}
                onNodeContextMenu={handleNodeContextMenu}
              />
            )}
          </div>
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
                style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 }}
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
                        color: 'var(--text-3)',
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
                        color: 'var(--text-3)',
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
                          color: 'var(--text-3)',
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
        })()}
      {fileTreeContextMenu && (
        <FileTreeContextMenu
          x={fileTreeContextMenu.x}
          y={fileTreeContextMenu.y}
          targetLabel={
            fileTreeContextMenu.targetType === 'root' ? '工作区根目录' : fileTreeContextMenu.name
          }
          targetType={fileTreeContextMenu.targetType}
          onClose={() => setFileTreeContextMenu(null)}
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
            void refreshDirectory(fileTreeContextMenu.directoryPath);
          }}
        />
      )}
      {workspaceContextMenu && (
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
        />
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
