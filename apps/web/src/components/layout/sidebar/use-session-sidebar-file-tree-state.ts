import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileTreeNode } from '../../common/modal/WorkspacePickerModal.js';
import { isPathWithinRoot, rebasePath } from '../../../utils/workspace-path.js';

const SESSION_SIDEBAR_FILE_TREE_RETRY_BASE_MS = 2_000;
const SESSION_SIDEBAR_FILE_TREE_RETRY_MAX_MS = 30_000;

function computeRetryDelay(attempt: number): number {
  const safeAttempt = Math.max(0, attempt);
  return Math.min(
    SESSION_SIDEBAR_FILE_TREE_RETRY_BASE_MS * 2 ** safeAttempt,
    SESSION_SIDEBAR_FILE_TREE_RETRY_MAX_MS,
  );
}

type RetryAction =
  | { kind: 'root'; preserveExpandedDirectories: boolean }
  | { kind: 'refresh-directory'; path: string }
  | { kind: 'toggle-directory'; path: string };

function patchTreeChildren(
  nodes: FileTreeNode[],
  targetPath: string,
  children: FileTreeNode[],
): FileTreeNode[] {
  return nodes.map((n) =>
    n.path === targetPath
      ? { ...n, children }
      : {
          ...n,
          children: n.children ? patchTreeChildren(n.children, targetPath, children) : n.children,
        },
  );
}

function findNode(nodes: FileTreeNode[], targetPath: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

interface UseSessionSidebarFileTreeStateOptions {
  active: boolean;
  expandedDirsArr: string[];
  fetchTree: (path: string, depth?: number) => Promise<FileTreeNode[]>;
  fileTreeRootPath: string | null;
  setExpandedDirs: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
}

interface UseSessionSidebarFileTreeStateResult {
  applyCreatedEntry: (input: { directoryPath: string; entry: FileTreeNode }) => void;
  applyDeletedEntry: (path: string) => void;
  applyRenamedEntry: (input: { newName: string; newPath: string; oldPath: string }) => void;
  ensureRootPath: () => Promise<string | null>;
  fileTree: FileTreeNode[];
  fileTreeError: string | null;
  fileTreeLoading: boolean;
  handleRefreshFileTree: () => void;
  handleToggleDirWithLoad: (path: string) => void;
  refreshDirectory: (directoryPath: string) => Promise<boolean>;
  setFileTreeError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function sortSessionSidebarFileTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
  });
}

export function insertSessionSidebarFileTreeNode(
  nodes: FileTreeNode[],
  targetPath: string,
  entry: FileTreeNode,
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath && node.type === 'directory') {
      const nextChildren = sortSessionSidebarFileTreeNodes([...(node.children ?? []), entry]);
      return { ...node, children: nextChildren };
    }
    if (node.children) {
      return {
        ...node,
        children: insertSessionSidebarFileTreeNode(node.children, targetPath, entry),
      };
    }
    return node;
  });
}

export function removeSessionSidebarFileTreeNode(
  nodes: FileTreeNode[],
  targetPath: string,
): FileTreeNode[] {
  return nodes
    .filter((node) => node.path !== targetPath)
    .map((node) =>
      node.children
        ? { ...node, children: removeSessionSidebarFileTreeNode(node.children, targetPath) }
        : node,
    );
}

function remapNodePath(node: FileTreeNode, oldPath: string, newPath: string): FileTreeNode {
  const nextPath =
    node.path === oldPath ? newPath : (rebasePath(node.path, oldPath, newPath) ?? node.path);
  return {
    ...node,
    path: nextPath,
    children: node.children?.map((child) => remapNodePath(child, oldPath, newPath)),
  };
}

export function renameSessionSidebarFileTreeNode(
  nodes: FileTreeNode[],
  oldPath: string,
  newPath: string,
  newName: string,
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === oldPath) {
      const remapped = remapNodePath(node, oldPath, newPath);
      return { ...remapped, name: newName };
    }
    if (node.children) {
      return {
        ...node,
        children: renameSessionSidebarFileTreeNode(node.children, oldPath, newPath, newName),
      };
    }
    return node;
  });
}

export function useSessionSidebarFileTreeState(
  options: UseSessionSidebarFileTreeStateOptions,
): UseSessionSidebarFileTreeStateResult {
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [fileTreeLoading, setFileTreeLoading] = useState(false);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const fileTreeRef = useRef<FileTreeNode[]>([]);
  const latestFileTreeRootPathRef = useRef<string | null>(options.fileTreeRootPath);
  const previousFileTreeRootPathRef = useRef<string | null>(options.fileTreeRootPath);
  const fileTreeRequestIdRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const lastRetryActionRef = useRef<RetryAction | null>(null);

  // Mirror caller-provided options into a ref so our memoized callbacks can
  // read the latest functions/values without having to list them as
  // dependencies. Several call sites (e.g. SessionSidebar) recreate
  // `setExpandedDirs` on every render, and depending on it directly would
  // re-run effects that themselves call `setExpandedDirs`, producing an
  // infinite update loop ("Maximum update depth exceeded").
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    fileTreeRef.current = fileTree;
  }, [fileTree]);

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

  const collectLoadedExpandedDirectories = useCallback((nodes: FileTreeNode[]): string[] => {
    const expandedDirectorySet = new Set(optionsRef.current.expandedDirsArr);
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
  }, []);

  const collectNestedLoadedExpandedDirectories = useCallback(
    (directoryPath: string): string[] => {
      const targetNode = findNode(fileTreeRef.current, directoryPath);
      if (!targetNode) {
        return [];
      }

      return collectLoadedExpandedDirectories([targetNode]).filter(
        (path) => path !== directoryPath,
      );
    },
    [collectLoadedExpandedDirectories],
  );

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryAttemptRef.current = 0;
  }, []);

  const ensureRootPath = useCallback(async (): Promise<string | null> => {
    const rootPath = optionsRef.current.fileTreeRootPath;
    if (!rootPath) {
      setFileTreeError('请先选择工作区');
      return null;
    }

    return rootPath;
  }, []);

  const refreshDirectoryRef = useRef<(directoryPath: string) => Promise<boolean>>(
    async () => false,
  );
  const loadFileTreeRef = useRef<(preserveExpandedDirectories: boolean) => Promise<boolean>>(
    async () => false,
  );
  const toggleDirRef = useRef<(path: string) => void>(() => {});

  const runRetryAction = useCallback(() => {
    const action = lastRetryActionRef.current;
    if (!action) {
      return;
    }
    if (action.kind === 'root') {
      void loadFileTreeRef.current(action.preserveExpandedDirectories);
      return;
    }
    if (action.kind === 'refresh-directory') {
      void refreshDirectoryRef.current(action.path);
      return;
    }
    void toggleDirRef.current(action.path);
  }, []);

  const scheduleRetry = useCallback(
    (action: RetryAction) => {
      lastRetryActionRef.current = action;
      if (retryTimerRef.current !== null) {
        return;
      }
      const delay = computeRetryDelay(retryAttemptRef.current);
      retryAttemptRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        runRetryAction();
      }, delay);
    },
    [runRetryAction],
  );

  const loadFileTree = useCallback(
    async (preserveExpandedDirectories: boolean): Promise<boolean> => {
      const requestedRootPath = optionsRef.current.fileTreeRootPath;
      if (!requestedRootPath) {
        setFileTree([]);
        setFileTreeError(null);
        return false;
      }

      const requestId = nextFileTreeRequest();
      const hasCachedTree = fileTreeRef.current.length > 0;

      setFileTreeLoading(!hasCachedTree || !preserveExpandedDirectories);
      setFileTreeError(null);

      try {
        const rootNodes = await optionsRef.current.fetchTree(requestedRootPath, 1);

        if (!isActiveFileTreeRequest(requestId, requestedRootPath)) {
          return false;
        }

        if (!preserveExpandedDirectories || fileTreeRef.current.length === 0) {
          setFileTree(rootNodes);
          clearRetry();
          return true;
        }

        let nextTree = rootNodes;
        let failedRefreshCount = 0;

        for (const directoryPath of collectLoadedExpandedDirectories(fileTreeRef.current)) {
          try {
            const children = await optionsRef.current.fetchTree(directoryPath, 1);

            if (!isActiveFileTreeRequest(requestId, requestedRootPath)) {
              return false;
            }

            nextTree = patchTreeChildren(nextTree, directoryPath, children);
          } catch {
            failedRefreshCount += 1;
          }
        }

        if (!isActiveFileTreeRequest(requestId, requestedRootPath)) {
          return false;
        }

        setFileTree(nextTree);
        clearRetry();
        if (failedRefreshCount > 0) {
          setFileTreeError(`已有 ${failedRefreshCount} 个已展开目录未能刷新完成`);
        }
        return true;
      } catch (error) {
        if (!preserveExpandedDirectories) {
          setFileTree((current) => current);
        }
        setFileTreeError(error instanceof Error ? error.message : '读取文件树失败');
        scheduleRetry({ kind: 'root', preserveExpandedDirectories });
        return false;
      } finally {
        if (isActiveFileTreeRequest(requestId, requestedRootPath)) {
          setFileTreeLoading(false);
        }
      }
    },
    [
      clearRetry,
      collectLoadedExpandedDirectories,
      isActiveFileTreeRequest,
      nextFileTreeRequest,
      scheduleRetry,
    ],
  );

  loadFileTreeRef.current = loadFileTree;

  const refreshDirectory = useCallback(
    async (directoryPath: string): Promise<boolean> => {
      const requestedRootPath = optionsRef.current.fileTreeRootPath;
      if (!requestedRootPath) {
        setFileTree([]);
        setFileTreeError('请先选择工作区');
        return false;
      }

      const rootPath = await ensureRootPath();
      if (!rootPath) {
        return false;
      }
      const requestId = nextFileTreeRequest();

      if (directoryPath === rootPath || fileTreeRef.current.length === 0) {
        return loadFileTree(true);
      }

      setFileTreeLoading(true);
      setFileTreeError(null);
      try {
        let nextChildren = await optionsRef.current.fetchTree(directoryPath, 1);

        if (!isActiveFileTreeRequest(requestId, requestedRootPath)) {
          return false;
        }

        let failedRefreshCount = 0;
        for (const nestedDirectoryPath of collectNestedLoadedExpandedDirectories(directoryPath)) {
          try {
            const nestedChildren = await optionsRef.current.fetchTree(nestedDirectoryPath, 1);

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
        clearRetry();
        if (failedRefreshCount > 0) {
          setFileTreeError(`已有 ${failedRefreshCount} 个已展开子目录未能刷新完成`);
        }
        return true;
      } catch (error) {
        setFileTreeError(error instanceof Error ? error.message : '刷新目录失败');
        scheduleRetry({ kind: 'refresh-directory', path: directoryPath });
        return false;
      } finally {
        if (isActiveFileTreeRequest(requestId, requestedRootPath)) {
          setFileTreeLoading(false);
        }
      }
    },
    [
      clearRetry,
      collectNestedLoadedExpandedDirectories,
      ensureRootPath,
      isActiveFileTreeRequest,
      loadFileTree,
      nextFileTreeRequest,
      scheduleRetry,
    ],
  );

  refreshDirectoryRef.current = refreshDirectory;

  const handleRefreshFileTree = useCallback(() => {
    void (async () => {
      const rootPath = await ensureRootPath();
      if (!rootPath) {
        return;
      }
      await refreshDirectory(rootPath);
    })();
  }, [ensureRootPath, refreshDirectory]);

  const handleToggleDirWithLoad = useCallback(
    async (path: string) => {
      const currentRootPath = optionsRef.current.fileTreeRootPath;
      const requestId = nextFileTreeRequest();

      optionsRef.current.setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      const node = findNode(fileTreeRef.current, path);
      if (node && (!node.children || node.children.length === 0)) {
        try {
          setFileTreeError(null);
          const children = await optionsRef.current.fetchTree(path, 1);

          if (!isActiveFileTreeRequest(requestId, currentRootPath)) {
            return;
          }

          setFileTree((prev) => patchTreeChildren(prev, path, children));
          clearRetry();
        } catch (error) {
          if (!isActiveFileTreeRequest(requestId, currentRootPath)) {
            return;
          }

          setFileTreeError(error instanceof Error ? error.message : '读取目录失败');
          scheduleRetry({ kind: 'toggle-directory', path });
          optionsRef.current.setExpandedDirs((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        }
      }
    },
    [clearRetry, isActiveFileTreeRequest, nextFileTreeRequest, scheduleRetry],
  );

  toggleDirRef.current = (path) => {
    void handleToggleDirWithLoad(path);
  };

  useEffect(() => {
    const previousRootPath = previousFileTreeRootPathRef.current;
    const nextRootPath = options.fileTreeRootPath;
    latestFileTreeRootPathRef.current = nextRootPath;

    // Only reset internal state when the workspace root actually changes.
    // Without this guard the effect re-runs whenever the parent passes a
    // newly-constructed `setExpandedDirs` callback, which would clear the
    // tree, write `[]` back to the store, change the callback identity
    // again, and trigger an infinite update loop.
    if (previousRootPath === nextRootPath) {
      return;
    }
    previousFileTreeRootPathRef.current = nextRootPath;

    fileTreeRequestIdRef.current += 1;
    clearRetry();
    setFileTree([]);
    setFileTreeError(null);
    optionsRef.current.setExpandedDirs(new Set());

    if (!nextRootPath) {
      setFileTreeLoading(false);
    }
  }, [clearRetry, options.fileTreeRootPath]);

  useEffect(() => {
    if (options.active && options.fileTreeRootPath && fileTree.length === 0) {
      void loadFileTree(false);
    }
  }, [fileTree.length, loadFileTree, options.active, options.fileTreeRootPath]);

  useEffect(() => {
    if (typeof window === 'undefined' || !options.active) {
      return;
    }
    const handleOnline = () => {
      if (options.fileTreeRootPath) {
        if (lastRetryActionRef.current) {
          clearRetry();
          runRetryAction();
          return;
        }
        handleRefreshFileTree();
      }
    };
    const handleOffline = () => {
      setFileTreeLoading(false);
      setFileTreeError('当前网络离线，文件树暂时不可用。');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [clearRetry, handleRefreshFileTree, options.active, options.fileTreeRootPath, runRetryAction]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  return {
    applyCreatedEntry: ({ directoryPath, entry }) => {
      if (options.fileTreeRootPath === directoryPath) {
        setFileTree((current) => sortSessionSidebarFileTreeNodes([...current, entry]));
        return;
      }
      setFileTree((current) => insertSessionSidebarFileTreeNode(current, directoryPath, entry));
    },
    applyDeletedEntry: (path) => {
      setFileTree((current) => removeSessionSidebarFileTreeNode(current, path));
    },
    applyRenamedEntry: ({ newName, newPath, oldPath }) => {
      setFileTree((current) =>
        renameSessionSidebarFileTreeNode(current, oldPath, newPath, newName),
      );
    },
    ensureRootPath,
    fileTree,
    fileTreeError,
    fileTreeLoading,
    handleRefreshFileTree,
    handleToggleDirWithLoad: (path) => {
      void handleToggleDirWithLoad(path);
    },
    refreshDirectory,
    setFileTreeError,
  };
}
