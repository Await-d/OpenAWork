import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../stores/auth.js';
import { useUIStateStore } from '../stores/uiState.js';

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
    fetch(`${gatewayUrl}/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch session: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const session = data?.session ?? data;
        let wd: string | null = null;
        if (typeof session?.metadata_json === 'string') {
          try {
            const parsed = JSON.parse(session.metadata_json);
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
      })
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
        const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/workspace`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ workingDirectory: normalizedPath }),
        });
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) {
          throw new Error(data?.error ?? `setWorkspace failed: ${res.status}`);
        }
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
    [sessionId, accessToken, gatewayUrl, setActiveSessionWorkspace],
  );

  const clearWorkspace = useCallback(async (): Promise<void> => {
    if (!sessionId) throw new Error('No active session');
    setLoading(true);
    try {
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/workspace`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ workingDirectory: null }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `clearWorkspace failed: ${res.status}`);
      }
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
  }, [sessionId, accessToken, gatewayUrl, setActiveSessionWorkspace]);

  const validatePath = useCallback(
    async (path: string): Promise<{ valid: boolean; error?: string; path?: string }> => {
      const res = await fetch(`${gatewayUrl}/workspace/validate?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return { valid: false, error: `Validation request failed: ${res.status}` };
      return res.json();
    },
    [accessToken, gatewayUrl],
  );

  const fetchWorkspaceRoots = useCallback(async (): Promise<string[]> => {
    const res = await fetch(`${gatewayUrl}/workspace/root`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`fetchWorkspaceRoots failed: ${res.status}`);
    const data = (await res.json()) as { root?: string; roots?: string[] };
    const roots = Array.isArray(data.roots)
      ? data.roots.filter((root) => typeof root === 'string' && root.length > 0)
      : typeof data.root === 'string' && data.root.length > 0
        ? [data.root]
        : [];

    if (roots.length === 0) {
      throw new Error('fetchWorkspaceRoots failed: no workspace roots');
    }

    return roots;
  }, [accessToken, gatewayUrl]);

  const fetchRootPath = useCallback(async (): Promise<string> => {
    const roots = await fetchWorkspaceRoots();
    const root = roots[0];
    if (!root) {
      throw new Error('fetchRootPath failed: no workspace roots');
    }

    return root;
  }, [fetchWorkspaceRoots]);

  const fetchTree = useCallback(
    async (path: string, depth = 2): Promise<FileTreeNode[]> => {
      const res = await fetch(
        `${gatewayUrl}/workspace/tree?path=${encodeURIComponent(path)}&depth=${depth}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) throw new Error(`fetchTree failed: ${res.status}`);
      const data = await res.json();
      return (data?.nodes ?? data) as FileTreeNode[];
    },
    [accessToken, gatewayUrl],
  );

  const fetchFile = useCallback(
    async (path: string): Promise<{ content: string; truncated: boolean }> => {
      const res = await fetch(`${gatewayUrl}/workspace/file?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`fetchFile failed: ${res.status}`);
      return res.json();
    },
    [accessToken, gatewayUrl],
  );

  const searchFiles = useCallback(
    async (
      q: string,
      rootPath: string,
      maxResults = 20,
    ): Promise<{ path: string; line: number; text: string }[]> => {
      const res = await fetch(
        `${gatewayUrl}/workspace/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(rootPath)}&maxResults=${maxResults}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) throw new Error(`searchFiles failed: ${res.status}`);
      const data = await res.json();
      return (data?.results ?? []) as { path: string; line: number; text: string }[];
    },
    [accessToken, gatewayUrl],
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
