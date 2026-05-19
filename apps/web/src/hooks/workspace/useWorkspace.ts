import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createSessionsClient, createWorkspaceClient, type Session } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth.js';
import { useUIStateStore } from '../../stores/uiState.js';

export interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

export function useWorkspace(sessionId: string | null) {
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const activeSessionWorkspace = useUIStateStore((s) => s.activeSessionWorkspace);
  const setActiveSessionWorkspace = useUIStateStore((s) => s.setActiveSessionWorkspace);
  // Workspace client is recreated on `gatewayUrl` change so that the local ↔
  // remote gateway toggle in Settings flips the call site without a reload.
  const workspaceClient = useMemo(() => createWorkspaceClient(gatewayUrl), [gatewayUrl]);

  const hasActiveSessionWorkspace =
    sessionId !== null && activeSessionWorkspace?.sessionId === sessionId;

  const resolvedWorkingDirectory = hasActiveSessionWorkspace
    ? activeSessionWorkspace.path
    : workingDirectory;

  useEffect(() => {
    if (!sessionId) {
      requestIdRef.current += 1;
      setWorkingDirectory(null);
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

    setWorkingDirectory(null);
    setError(null);
    setLoading(true);
    createSessionsClient(gatewayUrl)
      .get(accessToken ?? '', sessionId)
      .then(
        (
          session: Session & {
            metadata_json?: string;
            metadata?: { workingDirectory?: string | null };
          },
        ) => {
          let wd: string | null = null;
          if (typeof session?.metadata_json === 'string') {
            try {
              const parsed = JSON.parse(session.metadata_json) as {
                workingDirectory?: string | null;
              };
              wd = parsed?.workingDirectory ?? null;
            } catch {
              wd = null;
            }
          } else {
            wd = session?.metadata?.workingDirectory ?? null;
          }

          const normalizedWorkingDirectory = typeof wd === 'string' ? wd.trim() || null : null;
          if (requestIdRef.current !== requestId) {
            return;
          }

          const currentSessionWorkspace = useUIStateStore.getState().activeSessionWorkspace;
          if (
            currentSessionWorkspace?.sessionId === sessionId &&
            currentSessionWorkspace.version > startingVersion
          ) {
            return;
          }

          setWorkingDirectory(normalizedWorkingDirectory);
          setActiveSessionWorkspace(sessionId, normalizedWorkingDirectory);
          setError(null);
        },
      )
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      });
  }, [sessionId, accessToken, gatewayUrl, setActiveSessionWorkspace]);

  const setWorkspace = useCallback(
    async (path: string): Promise<void> => {
      if (!sessionId) throw new Error('No active session');
      const normalizedPath = path.trim();
      setLoading(true);
      try {
        await workspaceClient.setSessionWorkspace(accessToken ?? '', sessionId, normalizedPath);
        setWorkingDirectory(normalizedPath || null);
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
    if (!sessionId) throw new Error('No active session');
    setLoading(true);
    try {
      await workspaceClient.setSessionWorkspace(accessToken ?? '', sessionId, null);
      setWorkingDirectory(null);
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
    const roots = await workspaceClient.listRoots(accessToken ?? '');
    if (roots.length === 0) {
      throw new Error('fetchWorkspaceRoots failed: no workspace roots');
    }
    return roots;
  }, [accessToken, workspaceClient]);

  const fetchRootPath = useCallback(async (): Promise<string> => {
    const roots = await fetchWorkspaceRoots();
    const root = roots[0];
    if (!root) {
      throw new Error('fetchRootPath failed: no workspace roots');
    }

    return root;
  }, [fetchWorkspaceRoots]);

  const fetchTree = useCallback(
    async (path: string, depth = 2): Promise<FileTreeNode[]> =>
      workspaceClient.fetchTree(accessToken ?? '', path, { depth }),
    [accessToken, workspaceClient],
  );

  const fetchFile = useCallback(
    async (path: string): Promise<{ content: string; truncated: boolean }> => {
      const data = await workspaceClient.readFile(accessToken ?? '', path);
      return { content: data.content, truncated: data.truncated ?? false };
    },
    [accessToken, workspaceClient],
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
