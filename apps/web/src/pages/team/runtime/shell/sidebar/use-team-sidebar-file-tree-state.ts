import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWorkspaceClient, type FileTreeNode } from '@openAwork/web-client';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from '../../../hooks/recoverable-read-model.js';
import { useRecoverableRetryController } from '../../../hooks/use-recoverable-retry.js';

const TEAM_SIDEBAR_FILE_TREE_RETRY_BASE_MS = 2_000;
const TEAM_SIDEBAR_FILE_TREE_RETRY_MAX_MS = 30_000;

export function computeTeamSidebarFileTreeRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_SIDEBAR_FILE_TREE_RETRY_BASE_MS,
    maxMs: TEAM_SIDEBAR_FILE_TREE_RETRY_MAX_MS,
  });
}

export function formatTeamSidebarFileTreeLoadError(input: {
  hasCachedTree: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载文件树失败。',
    hasRetainedData: input.hasCachedTree,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '文件树',
    retryable: input.result.retryable,
  });
}

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

function sortTeamSidebarFileTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
  });
}

function insertTeamSidebarFileTreeNode(
  nodes: FileTreeNode[],
  targetPath: string,
  entry: FileTreeNode,
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath && node.type === 'directory') {
      return {
        ...node,
        children: sortTeamSidebarFileTreeNodes([...(node.children ?? []), entry]),
      };
    }
    if (node.children) {
      return {
        ...node,
        children: insertTeamSidebarFileTreeNode(node.children, targetPath, entry),
      };
    }
    return node;
  });
}

function removeTeamSidebarFileTreeNode(nodes: FileTreeNode[], targetPath: string): FileTreeNode[] {
  return nodes
    .filter((node) => node.path !== targetPath)
    .map((node) =>
      node.children
        ? { ...node, children: removeTeamSidebarFileTreeNode(node.children, targetPath) }
        : node,
    );
}

function remapNodePath(node: FileTreeNode, oldPath: string, newPath: string): FileTreeNode {
  const nextPath =
    node.path === oldPath ? newPath : node.path.replace(`${oldPath}/`, `${newPath}/`);
  return {
    ...node,
    path: nextPath,
    children: node.children?.map((child) => remapNodePath(child, oldPath, newPath)),
  };
}

function renameTeamSidebarFileTreeNode(
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
        children: renameTeamSidebarFileTreeNode(node.children, oldPath, newPath, newName),
      };
    }
    return node;
  });
}

interface UseTeamSidebarFileTreeStateOptions {
  active: boolean;
  gatewayUrl: string;
  token: string | null;
  workspacePath?: string | null;
}

interface UseTeamSidebarFileTreeStateResult {
  applyCreatedEntry: (input: { directoryPath: string; entry: FileTreeNode }) => void;
  applyDeletedEntry: (path: string) => void;
  applyRenamedEntry: (input: { newName: string; newPath: string; oldPath: string }) => void;
  expandedDirs: Set<string>;
  handleRefresh: () => void;
  handleToggleDir: (path: string) => void;
  refreshDirectory: (directoryPath: string) => Promise<boolean>;
  treeError: string | null;
  treeLoading: boolean;
  treeNodes: FileTreeNode[];
}

export function useTeamSidebarFileTreeState(
  options: UseTeamSidebarFileTreeStateOptions,
): UseTeamSidebarFileTreeStateResult {
  const workspaceClient = useMemo(
    () => createWorkspaceClient(options.gatewayUrl),
    [options.gatewayUrl],
  );
  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const treeNodesRef = useRef<FileTreeNode[]>([]);
  const currentRootRef = useRef<string | null>(null);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  useEffect(() => {
    treeNodesRef.current = treeNodes;
  }, [treeNodes]);

  const handleRefresh = useCallback(() => {
    resetRetry();
    setRefreshTick((current) => current + 1);
  }, [resetRetry]);

  useEffect(() => {
    let cancelled = false;
    clearRetry();

    if (!options.active || !options.workspacePath || !options.token) {
      currentRootRef.current = null;
      resetRetry();
      setTreeNodes([]);
      setExpandedDirs(new Set());
      setTreeLoading(false);
      setTreeError(null);
      return () => {
        cancelled = true;
      };
    }

    const rootChanged = currentRootRef.current !== options.workspacePath;
    currentRootRef.current = options.workspacePath;
    if (rootChanged) {
      setExpandedDirs(new Set());
      setTreeNodes([]);
    }

    const hasCachedTree = treeNodesRef.current.length > 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setTreeLoading(false);
      setTreeError(
        formatTeamSidebarFileTreeLoadError({
          hasCachedTree,
          result: {
            errorMessage: '当前网络离线，文件树暂时不可用。',
            retryable: true,
          },
        }),
      );
      return () => {
        cancelled = true;
      };
    }

    setTreeLoading(!hasCachedTree);
    setTreeError(null);

    void workspaceClient
      .fetchTreeResult(options.token, options.workspacePath, { depth: 1 })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          const nextRetryAtMs = scheduleRetry({
            computeDelay: computeTeamSidebarFileTreeRetryDelay,
            onRetry: () => {
              setRefreshTick((current) => current + 1);
            },
            retryable: result.retryable,
          });
          setTreeLoading(false);
          setTreeError(
            formatTeamSidebarFileTreeLoadError({
              hasCachedTree,
              nextRetryAtMs,
              result,
            }),
          );
          return;
        }

        resetRetry();
        setTreeNodes(result.nodes);
        setTreeLoading(false);
        setTreeError(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    clearRetry,
    options.active,
    options.token,
    options.workspacePath,
    refreshTick,
    resetRetry,
    scheduleRetry,
    workspaceClient,
  ]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (!options.active || !options.workspacePath || typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      handleRefresh();
    };
    const handleOffline = () => {
      resetRetry();
      setTreeLoading(false);
      setTreeError(
        formatTeamSidebarFileTreeLoadError({
          hasCachedTree: treeNodesRef.current.length > 0,
          result: {
            errorMessage: '当前网络离线，文件树暂时不可用。',
            retryable: true,
          },
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleRefresh, options.active, options.workspacePath, resetRetry]);

  const handleToggleDir = useCallback(
    (path: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
          return next;
        }
        next.add(path);
        return next;
      });
      if (!options.token) {
        return;
      }
      setTreeError(null);
      void workspaceClient.fetchTreeResult(options.token, path, { depth: 1 }).then((result) => {
        if (!result.ok) {
          const nextRetryAtMs = scheduleRetry({
            computeDelay: computeTeamSidebarFileTreeRetryDelay,
            onRetry: () => {
              setRefreshTick((current) => current + 1);
            },
            retryable: result.retryable,
          });
          setTreeError(
            formatTeamSidebarFileTreeLoadError({
              hasCachedTree: treeNodesRef.current.length > 0,
              nextRetryAtMs,
              result,
            }),
          );
          return;
        }
        resetRetry();
        setTreeNodes((current) => injectChildren(current, path, result.nodes));
        setTreeError(null);
      });
    },
    [options.token, resetRetry, scheduleRetry, workspaceClient],
  );

  const refreshDirectory = useCallback(
    async (directoryPath: string): Promise<boolean> => {
      if (!options.token || !options.workspacePath) {
        return false;
      }

      const result = await workspaceClient.fetchTreeResult(options.token, directoryPath, {
        depth: 1,
      });
      if (!result.ok) {
        setTreeError(result.errorMessage ?? '刷新目录失败。');
        return false;
      }

      if (directoryPath === options.workspacePath) {
        setTreeNodes(result.nodes);
      } else {
        setTreeNodes((current) => injectChildren(current, directoryPath, result.nodes));
      }
      setTreeError(null);
      return true;
    },
    [options.token, options.workspacePath, workspaceClient],
  );

  return {
    applyCreatedEntry: ({ directoryPath, entry }) => {
      setTreeNodes((current) =>
        directoryPath === options.workspacePath
          ? sortTeamSidebarFileTreeNodes([...current, entry])
          : insertTeamSidebarFileTreeNode(current, directoryPath, entry),
      );
    },
    applyDeletedEntry: (path) => {
      setTreeNodes((current) => removeTeamSidebarFileTreeNode(current, path));
      setExpandedDirs((current) => {
        const next = new Set<string>();
        for (const entry of current) {
          if (entry === path || entry.startsWith(`${path}/`)) {
            continue;
          }
          next.add(entry);
        }
        return next;
      });
    },
    applyRenamedEntry: ({ newName, newPath, oldPath }) => {
      setTreeNodes((current) => renameTeamSidebarFileTreeNode(current, oldPath, newPath, newName));
      setExpandedDirs((current) => {
        const next = new Set<string>();
        for (const entry of current) {
          if (entry === oldPath) {
            next.add(newPath);
            continue;
          }
          if (entry.startsWith(`${oldPath}/`)) {
            next.add(entry.replace(`${oldPath}/`, `${newPath}/`));
            continue;
          }
          next.add(entry);
        }
        return next;
      });
    },
    expandedDirs,
    handleRefresh,
    handleToggleDir,
    refreshDirectory,
    treeError,
    treeLoading,
    treeNodes,
  };
}
