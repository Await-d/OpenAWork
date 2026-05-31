import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createSessionsClient, createWorkspaceClient, type Session } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';

export interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

interface SessionWorkingDirectoryState {
  path: string | null;
  sessionId: string | null;
}

function parseSessionWorkingDirectory(
  session: Session & {
    metadata?: { workingDirectory?: string | null };
  },
): string | null {
  if (typeof session.metadata_json === 'string') {
    try {
      const parsed = JSON.parse(session.metadata_json) as {
        workingDirectory?: string | null;
      };
      return typeof parsed.workingDirectory === 'string'
        ? parsed.workingDirectory.trim() || null
        : null;
    } catch {
      return null;
    }
  }

  return typeof session.metadata?.workingDirectory === 'string'
    ? session.metadata.workingDirectory.trim() || null
    : null;
}

export function useWorkspace(sessionId: string | null) {
  const [workingDirectoryState, setWorkingDirectoryState] =
    useState<SessionWorkingDirectoryState>({
      path: null,
      sessionId: null,
    });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const activeSessionWorkspace = useUIStateStore((s) => s.activeSessionWorkspace);
  const setActiveSessionWorkspace = useUIStateStore((s) => s.setActiveSessionWorkspace);
  const sessionsClient = useMemo(() => createSessionsClient(gatewayUrl), [gatewayUrl]);
  // Workspace client is recreated on `gatewayUrl` change so that the local ↔
  // remote gateway toggle in Settings flips the call site without a reload.
  const workspaceClient = useMemo(() => createWorkspaceClient(gatewayUrl), [gatewayUrl]);

  const hasActiveSessionWorkspace =
    sessionId !== null && activeSessionWorkspace?.sessionId === sessionId;
  const retainedWorkingDirectory =
    sessionId !== null && workingDirectoryState.sessionId === sessionId
      ? workingDirectoryState.path
      : null;

  const resolvedWorkingDirectory = hasActiveSessionWorkspace
    ? activeSessionWorkspace.path
    : retainedWorkingDirectory;

  useEffect(() => {
    if (!sessionId) {
      requestIdRef.current += 1;
      setWorkingDirectoryState({
        path: null,
        sessionId: null,
      });
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const startingVersion =
      useUIStateStore.getState().activeSessionWorkspace?.sessionId === sessionId
        ? (useUIStateStore.getState().activeSessionWorkspace?.version ?? 0)
        : 0;

    setLoading(true);
    void sessionsClient
      .getResult(accessToken ?? '', sessionId)
      .then((result) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        if (!result.ok || !result.session) {
          setError(result.errorMessage ?? '加载会话失败');
          return;
        }

        const normalizedWorkingDirectory = parseSessionWorkingDirectory(result.session);
        const currentSessionWorkspace = useUIStateStore.getState().activeSessionWorkspace;
        if (
          currentSessionWorkspace?.sessionId === sessionId &&
          currentSessionWorkspace.version > startingVersion
        ) {
          return;
        }

        setWorkingDirectoryState({
          path: normalizedWorkingDirectory,
          sessionId,
        });
        setActiveSessionWorkspace(sessionId, normalizedWorkingDirectory);
        setError(null);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      });
  }, [sessionId, accessToken, sessionsClient, setActiveSessionWorkspace]);

  const setWorkspace = useCallback(
    async (path: string): Promise<void> => {
      if (!sessionId) throw new Error('当前没有激活的会话，无法绑定工作区。');
      const normalizedPath = path.trim();
      setLoading(true);
      try {
        await workspaceClient.setSessionWorkspace(accessToken ?? '', sessionId, normalizedPath);
        setWorkingDirectoryState({
          path: normalizedPath || null,
          sessionId,
        });
        setActiveSessionWorkspace(sessionId, normalizedPath || null);
        setError(null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [sessionId, accessToken, workspaceClient, setActiveSessionWorkspace],
  );

  const clearWorkspace = useCallback(async (): Promise<void> => {
    if (!sessionId) throw new Error('当前没有激活的会话，无法清空工作区。');
    setLoading(true);
    try {
      await workspaceClient.setSessionWorkspace(accessToken ?? '', sessionId, null);
      setWorkingDirectoryState({
        path: null,
        sessionId,
      });
      setActiveSessionWorkspace(sessionId, null);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [sessionId, accessToken, workspaceClient, setActiveSessionWorkspace]);

  const validatePath = useCallback(
    async (path: string): Promise<{ valid: boolean; error?: string; path?: string }> =>
      workspaceClient.validatePath(accessToken ?? '', path),
    [accessToken, workspaceClient],
  );

  const fetchWorkspaceRoots = useCallback(async (): Promise<string[]> => {
    const result = await workspaceClient.listRootsResult(accessToken ?? '');
    if (!result.ok) {
      throw new Error(result.errorMessage ?? '读取工作区根目录失败。');
    }
    if (result.roots.length === 0) {
      throw new Error('当前账号下没有可用工作区根目录。');
    }
    return result.roots;
  }, [accessToken, workspaceClient]);

  const fetchRootPath = useCallback(async (): Promise<string> => {
    const roots = await fetchWorkspaceRoots();
    const root = roots[0];
    if (!root) {
      throw new Error('当前账号下没有可用工作区根目录。');
    }

    return root;
  }, [fetchWorkspaceRoots]);

  const fetchTree = useCallback(
    async (path: string, depth = 2): Promise<FileTreeNode[]> => {
      const result = await workspaceClient.fetchTreeResult(accessToken ?? '', path, { depth });
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '读取文件树失败。');
      }
      return result.nodes;
    },
    [accessToken, workspaceClient],
  );

  const fetchFile = useCallback(
    async (path: string): Promise<{ content: string; truncated: boolean }> => {
      const result = await workspaceClient.readFileResult(accessToken ?? '', path, {
        workspaceRoot: resolvedWorkingDirectory ?? undefined,
      });
      if (!result.ok || !result.file) {
        throw new Error(result.errorMessage ?? '读取文件失败。');
      }
      return {
        content: result.file.content,
        truncated: result.file.truncated ?? false,
      };
    },
    [accessToken, resolvedWorkingDirectory, workspaceClient],
  );

  const searchFiles = useCallback(
    async (
      q: string,
      rootPath: string,
      maxResults = 20,
    ): Promise<{ path: string; line: number; text: string }[]> =>
      workspaceClient.search(accessToken ?? '', q, rootPath, { maxResults }),
    [accessToken, workspaceClient],
  );

  return {
    workingDirectory: resolvedWorkingDirectory,
    loading,
    error,
    setWorkspace,
    clearWorkspace,
    validatePath,
    fetchRootPath,
    fetchWorkspaceRoots,
    fetchTree,
    fetchFile,
    searchFiles,
  };
}
