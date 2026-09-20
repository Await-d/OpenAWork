import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  createSessionsClient,
  createSshClient,
  createWorkspaceClient,
  type Session,
} from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';

export interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

interface SessionWorkspaceState {
  path: string | null;
  sessionId: string | null;
  sshConnectionId: string | null;
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

/**
 * 解析会话元数据里的 SSH 连接 id（网关绑定 SSH 工作区时写入的键名是
 * `sshConnectionId`）。与 workingDirectory 同源同口径：metadata_json 优先，
 * 缺失 / 类型不符 / 空串一律返回 null（本地会话）。
 */
function parseSessionSshConnectionId(
  session: Session & {
    metadata?: { sshConnectionId?: string | null };
  },
): string | null {
  if (typeof session.metadata_json === 'string') {
    try {
      const parsed = JSON.parse(session.metadata_json) as {
        sshConnectionId?: string | null;
      };
      return typeof parsed.sshConnectionId === 'string'
        ? parsed.sshConnectionId.trim() || null
        : null;
    } catch {
      return null;
    }
  }

  return typeof session.metadata?.sshConnectionId === 'string'
    ? session.metadata.sshConnectionId.trim() || null
    : null;
}

function normalizeOptionalPath(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function parseSessionParentSessionId(
  session: Session & {
    metadata?: { parentSessionId?: string | null };
  },
): string | null {
  const directTeamParentSessionId = normalizeOptionalPath(session.team_parent_session_id);
  if (directTeamParentSessionId) {
    return directTeamParentSessionId;
  }

  const directParentSessionId = normalizeOptionalPath(session.parentSessionId);
  if (directParentSessionId) {
    return directParentSessionId;
  }

  if (typeof session.metadata_json === 'string') {
    try {
      const parsed = JSON.parse(session.metadata_json) as {
        parentSessionId?: string | null;
      };
      return normalizeOptionalPath(parsed.parentSessionId);
    } catch {
      return null;
    }
  }

  return normalizeOptionalPath(session.metadata?.parentSessionId);
}

type SessionWorkspaceLookupResult =
  | {
      kind: 'resolved';
      path: string | null;
      sshConnectionId: string | null;
    }
  | {
      errorMessage: string;
      kind: 'unavailable';
    };

async function resolveSessionWorkspaceWithParentFallback(input: {
  sessionId: string;
  sessionsClient: ReturnType<typeof createSessionsClient>;
  signal: AbortSignal;
  token: string;
}): Promise<SessionWorkspaceLookupResult> {
  const seenSessionIds = new Set<string>();
  let currentSessionId: string | null = input.sessionId;
  let isRootSession = true;
  let resolvedPath: string | null = null;
  let resolvedSshConnectionId: string | null = null;

  while (currentSessionId && !seenSessionIds.has(currentSessionId)) {
    seenSessionIds.add(currentSessionId);

    const result = await input.sessionsClient.getResult(input.token, currentSessionId, {
      signal: input.signal,
    });
    if (!result.ok || !result.session) {
      if (isRootSession) {
        return {
          kind: 'unavailable',
          errorMessage: result.errorMessage ?? '加载会话失败',
        };
      }
      return { kind: 'resolved', path: resolvedPath, sshConnectionId: resolvedSshConnectionId };
    }

    // 两个字段各自沿父链继承：workingDirectory 与 sshConnectionId 可能落在
    // 不同层级（例如子会话只带 parentSessionId），任一未解析出就继续向上找。
    resolvedPath = resolvedPath ?? parseSessionWorkingDirectory(result.session);
    resolvedSshConnectionId =
      resolvedSshConnectionId ?? parseSessionSshConnectionId(result.session);
    if (resolvedPath && resolvedSshConnectionId) {
      break;
    }

    currentSessionId = parseSessionParentSessionId(result.session);
    isRootSession = false;
  }

  return { kind: 'resolved', path: resolvedPath, sshConnectionId: resolvedSshConnectionId };
}

export function useWorkspace(sessionId: string | null) {
  const [workspaceState, setWorkspaceState] = useState<SessionWorkspaceState>({
    path: null,
    sessionId: null,
    sshConnectionId: null,
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
  const retainedWorkspaceState = sessionId !== null && workspaceState.sessionId === sessionId;
  const retainedWorkingDirectory = retainedWorkspaceState ? workspaceState.path : null;
  // SSH 连接 id 没有 activeSessionWorkspace 那层 store 缓存，只能取本 hook
  // 为同一会话解析出的值；切到别的会话时立刻回落 null，避免身份串味。
  const retainedSshConnectionId = retainedWorkspaceState ? workspaceState.sshConnectionId : null;

  const resolvedWorkingDirectory = hasActiveSessionWorkspace
    ? activeSessionWorkspace.path
    : retainedWorkingDirectory;

  useEffect(() => {
    if (!sessionId) {
      requestIdRef.current += 1;
      setWorkspaceState({
        path: null,
        sessionId: null,
        sshConnectionId: null,
      });
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    const startingVersion =
      useUIStateStore.getState().activeSessionWorkspace?.sessionId === sessionId
        ? (useUIStateStore.getState().activeSessionWorkspace?.version ?? 0)
        : 0;

    setLoading(true);
    void resolveSessionWorkspaceWithParentFallback({
      sessionId,
      sessionsClient,
      signal: controller.signal,
      token: accessToken ?? '',
    })
      .then((result) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        if (result.kind === 'unavailable') {
          setError(result.errorMessage);
          return;
        }

        const currentSessionWorkspace = useUIStateStore.getState().activeSessionWorkspace;
        if (
          currentSessionWorkspace?.sessionId === sessionId &&
          currentSessionWorkspace.version > startingVersion
        ) {
          return;
        }

        setWorkspaceState({
          path: result.path,
          sessionId,
          sshConnectionId: result.sshConnectionId,
        });
        setActiveSessionWorkspace(sessionId, result.path);
        setError(null);
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) {
          return;
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setError(error instanceof Error ? error.message : '加载会话失败');
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [sessionId, accessToken, sessionsClient, setActiveSessionWorkspace]);

  const setWorkspace = useCallback(
    async (path: string): Promise<void> => {
      if (!sessionId) throw new Error('当前没有激活的会话，无法绑定工作区。');
      const normalizedPath = path.trim();
      setLoading(true);
      try {
        await workspaceClient.setSessionWorkspace(accessToken ?? '', sessionId, normalizedPath);
        setWorkspaceState((previous) => ({
          path: normalizedPath || null,
          sessionId,
          // 改工作区路径不改会话的 SSH 绑定：同一会话保留已解析的远端连接 id。
          sshConnectionId: previous.sessionId === sessionId ? previous.sshConnectionId : null,
        }));
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
      setWorkspaceState((previous) => ({
        path: null,
        sessionId,
        sshConnectionId: previous.sessionId === sessionId ? previous.sshConnectionId : null,
      }));
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

  const searchFileIndex = useCallback(
    async (
      path: string,
      options: {
        query: string;
        limit?: number;
        signal?: AbortSignal;
        /** SSH 会话定位：已有会话传当前会话 id，草稿态传所选 SSH 连接 id。 */
        sessionId?: string | null;
        sshConnectionId?: string | null;
      },
    ): Promise<{ files: string[]; directories: string[] }> => {
      const result = await workspaceClient.searchFileIndexResult(accessToken ?? '', path, options);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '检索工作区文件索引失败。');
      }
      return { files: result.files, directories: result.directories };
    },
    [accessToken, workspaceClient],
  );

  const createDirectory = useCallback(
    async (path: string): Promise<void> => {
      await workspaceClient.createDirectory(accessToken ?? '', path);
    },
    [accessToken, workspaceClient],
  );

  const fetchFile = useCallback(
    async (path: string): Promise<{ content: string; truncated: boolean }> => {
      const result = await workspaceClient.readFileResult(accessToken ?? '', path, {
        workspaceRoot: resolvedWorkingDirectory ?? undefined,
        // 身份映射：已有会话传 sessionId，草稿态退而传 sshConnectionId；两者
        // 都无则为纯本地读取。未绑定 SSH 的会话仍由网关回退本地逻辑。
        ...(sessionId ? { sessionId } : {}),
        ...(!sessionId && retainedSshConnectionId
          ? { sshConnectionId: retainedSshConnectionId }
          : {}),
      });
      if (!result.ok || !result.file) {
        throw new Error(result.errorMessage ?? '读取文件失败。');
      }
      return {
        content: result.file.content,
        truncated: result.file.truncated ?? false,
      };
    },
    [accessToken, resolvedWorkingDirectory, retainedSshConnectionId, sessionId, workspaceClient],
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

  /**
   * SSH 远端目录浏览：复用 `/ssh/files`（单层 readdir）并映射为文件树节点结构，
   * 供 SSH 工作区选择弹窗使用（不经过本地 /workspace/* 端点）。
   */
  const fetchSshTree = useCallback(
    async (connectionId: string, path: string): Promise<FileTreeNode[]> => {
      if (!accessToken) {
        throw new Error('未登录，无法读取远端目录。');
      }
      const entries = await createSshClient(gatewayUrl).listFiles(accessToken, connectionId, path);
      return entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.kind,
      }));
    },
    [accessToken, gatewayUrl],
  );

  const createSshDirectory = useCallback(
    async (connectionId: string, path: string): Promise<void> => {
      if (!accessToken) {
        throw new Error('未登录，无法创建远端目录。');
      }
      await createSshClient(gatewayUrl).mkdir(accessToken, { connectionId, path });
    },
    [accessToken, gatewayUrl],
  );

  return {
    workingDirectory: resolvedWorkingDirectory,
    /**
     * 当前会话的 SSH 连接 id（本地会话为 null）。读取身份消费方据此判断
     * 会话是否绑定远端工作区；无活动的会话工作区时为 null。
     */
    sshConnectionId: retainedSshConnectionId,
    loading,
    error,
    setWorkspace,
    clearWorkspace,
    validatePath,
    fetchRootPath,
    fetchWorkspaceRoots,
    fetchTree,
    fetchSshTree,
    createSshDirectory,
    searchFileIndex,
    createDirectory,
    fetchFile,
    searchFiles,
  };
}
