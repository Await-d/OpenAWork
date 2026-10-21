import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  createSessionsClient,
  createSshClient,
  createWorkspaceClient,
  type Session,
  type WorkspaceFileReadOptions,
} from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { hasTeamWorkspace } from '../../utils/session/session-metadata.js';

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
      /**
       * 会话是否必须绑定工作区（team 语义）。与网关 `requiresBoundSessionWorkspace`
       * 同判定口径：`role_layer` / `team_parent_session_id` / metadata.teamWorkspaceId
       * 任一存在即为 true。未绑定的这类会话不回退默认工作区。
       */
      requiresBoundWorkspace: boolean;
    }
  | {
      errorMessage: string;
      kind: 'unavailable';
    };

/**
 * 会话是否必须绑定工作区（只看会话自身字段，不沿父链继承——与网关
 * `requiresBoundSessionWorkspace(sessionId)` 的查询口径一致）。
 */
function parseSessionRequiresBoundWorkspace(session: Session): boolean {
  return (
    hasTeamWorkspace(session.metadata_json) ||
    session.team_parent_session_id != null ||
    session.role_layer != null
  );
}

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
  let requiresBoundWorkspace = false;

  while (currentSessionId && !seenSessionIds.has(currentSessionId)) {
    seenSessionIds.add(currentSessionId);

    // 这里只需要 metadata(workingDirectory / sshConnectionId / parentSessionId),
    // 不读转录:否则沿父链每级都要把全量消息历史 + run event 拉回来。
    const result = await input.sessionsClient.getResult(input.token, currentSessionId, {
      includeMessages: false,
      signal: input.signal,
    });
    if (!result.ok || !result.session) {
      if (isRootSession) {
        return {
          kind: 'unavailable',
          errorMessage: result.errorMessage ?? '加载会话失败',
        };
      }
      return {
        kind: 'resolved',
        path: resolvedPath,
        sshConnectionId: resolvedSshConnectionId,
        requiresBoundWorkspace,
      };
    }

    if (isRootSession) {
      // 绑定策略只看顶层会话自身（与网关同口径，不沿父链继承）。
      requiresBoundWorkspace = parseSessionRequiresBoundWorkspace(result.session);
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

  return {
    kind: 'resolved',
    path: resolvedPath,
    sshConnectionId: resolvedSshConnectionId,
    requiresBoundWorkspace,
  };
}

/**
 * 工作区绑定的统一包装：置 loading → try → catch 写 error 后**原样抛出** → finally 清 loading。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，本 hook 2 处
 * 这类 try 会让整个 hook 脱靶（实测）。语义逐字照搬（含 catch 里的 `throw err`）。
 */
async function runWorkspaceBindingOnce(ctx: {
  setLoading: (loading: boolean) => void;
  setError: (message: string) => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setLoading(true);
  try {
    await ctx.run();
  } catch (err: unknown) {
    ctx.setError(err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    ctx.setLoading(false);
  }
}

export function useWorkspace(sessionId: string | null) {
  const [workspaceState, setWorkspaceState] = useState<SessionWorkspaceState>({
    path: null,
    sessionId: null,
    sshConnectionId: null,
  });
  /**
   * 未绑定工作区的**普通**会话（非 team）解析出的「默认工作区」根
   * （`~/Documents/OpenAWork`，由网关 `/workspace/files/index-version`
   * 省略 path 时回退给出）。
   *
   * 只服务于「文件浏览 / 读取」：文件树与 @ 引用用它让无工作区会话也能浏览
   * Agent 创建的文件；`workingDirectory` 保持 null，绑定语义不变。
   * 带 `sessionId` 是为了切会话时旧值立刻失效，绝不把上一个会话的目录
   * 泄漏给新会话。
   */
  const [fallbackWorkspaceState, setFallbackWorkspaceState] = useState<{
    sessionId: string;
    path: string;
  } | null>(null);
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
  // SSH 连接 id 与 resolvedWorkingDirectory 同源，优先取 store 缓存：本地 warp
  // 会解绑 SSH（网关删除 metadata.sshConnectionId），缓存里的 null 才是当前真相；
  // hook 本地值只在同会话内 setWorkspace 时不会刷新，可能残留旧连接。
  // 切到别的会话时立刻回落 null，避免身份串味。
  const retainedSshConnectionId = retainedWorkspaceState ? workspaceState.sshConnectionId : null;

  const resolvedWorkingDirectory = hasActiveSessionWorkspace
    ? activeSessionWorkspace.path
    : retainedWorkingDirectory;
  const resolvedSshConnectionId = hasActiveSessionWorkspace
    ? (activeSessionWorkspace.sshConnectionId ?? null)
    : retainedSshConnectionId;

  // 严格匹配当前会话：切会话瞬间旧会话的默认工作区立即失效（不闪旧目录）。
  const fallbackWorkspacePath =
    sessionId !== null && fallbackWorkspaceState?.sessionId === sessionId
      ? fallbackWorkspaceState.path
      : null;

  /**
   * 读取未绑定会话的默认工作区根；失败静默降级为 null（文件树退回
   * 「未绑定」空态即可，不影响绑定工作区的主流程）。
   */
  const loadFallbackWorkspacePath = useCallback(
    async (targetSessionId: string, signal?: AbortSignal): Promise<string | null> => {
      // 整个 try/catch 改成 `.catch(() => null)`：try 内的 `??` / `...(cond ? … : {})` /
      // `a || b` 都是值块，会让编译器报 "Support value blocks … within a try/catch statement"
      // 并放弃优化整个 hook。语义等价——请求失败时同样静默返回 null。
      const token = accessToken ?? '';
      const requestOptions = { sessionId: targetSessionId, ...(signal ? { signal } : {}) };
      const fallback = await workspaceClient
        .getFileIndexVersion(token, undefined, requestOptions)
        .catch(() => null);
      if (!fallback) {
        return null;
      }
      return fallback.root || null;
    },
    [accessToken, workspaceClient],
  );

  useEffect(() => {
    if (!sessionId) {
      requestIdRef.current += 1;
      setWorkspaceState({
        path: null,
        sessionId: null,
        sshConnectionId: null,
      });
      setFallbackWorkspaceState(null);
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
        setActiveSessionWorkspace(sessionId, result.path, result.sshConnectionId);
        setError(null);

        // 未绑定的本地普通会话：解析「默认工作区」根（仅用于文件浏览）。
        // 独立于 loading 的附加解析（不拖长会话切换的 loading）；失败静默，
        // 由 sessionId 匹配保证不把旧会话的目录外露。
        if (!result.path && !result.sshConnectionId && !result.requiresBoundWorkspace) {
          void loadFallbackWorkspacePath(sessionId, controller.signal).then((fallbackPath) => {
            if (requestIdRef.current === requestId && fallbackPath) {
              setFallbackWorkspaceState({ sessionId, path: fallbackPath });
            }
          });
        } else {
          setFallbackWorkspaceState(null);
        }
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
  }, [
    sessionId,
    accessToken,
    sessionsClient,
    setActiveSessionWorkspace,
    loadFallbackWorkspacePath,
  ]);

  const setWorkspace = useCallback(
    async (path: string): Promise<void> => {
      if (!sessionId) throw new Error('当前没有激活的会话，无法绑定工作区。');
      const normalizedPath = path.trim();
      // 置 loading 与 try/catch/finally 一起下沉到模块级 `runWorkspaceBindingOnce`
      // （见其注释：catch 会写 error 并原样抛出）。
      await runWorkspaceBindingOnce({
        setLoading,
        setError,
        run: async () => {
          await workspaceClient.setSessionWorkspace(accessToken ?? '', sessionId, normalizedPath);
          setWorkspaceState((previous) => ({
            path: normalizedPath || null,
            sessionId,
            // 改工作区路径不改会话的 SSH 绑定：同一会话保留已解析的远端连接 id。
            sshConnectionId: previous.sessionId === sessionId ? previous.sshConnectionId : null,
          }));
          setActiveSessionWorkspace(sessionId, normalizedPath || null, null);
          // 绑定生效后默认工作区不再参与文件浏览。
          setFallbackWorkspaceState(null);
          setError(null);
        },
      });
    },
    [sessionId, accessToken, workspaceClient, setActiveSessionWorkspace],
  );

  const clearWorkspace = useCallback(async (): Promise<void> => {
    if (!sessionId) throw new Error('当前没有激活的会话，无法清空工作区。');
    // 同 setWorkspace：置 loading 与 try/catch/finally 一起下沉到模块级
    // `runWorkspaceBindingOnce`（见其注释：catch 会写 error 并原样抛出）。
    await runWorkspaceBindingOnce({
      setLoading,
      setError,
      run: async () => {
        await workspaceClient.setSessionWorkspace(accessToken ?? '', sessionId, null);
        setWorkspaceState((previous) => ({
          path: null,
          sessionId,
          sshConnectionId: previous.sessionId === sessionId ? previous.sshConnectionId : null,
        }));
        setActiveSessionWorkspace(sessionId, null, null);
        setError(null);
        // 解除绑定后回到未绑定默认工作区（仅文件浏览用途），失败静默为 null。
        void loadFallbackWorkspacePath(sessionId).then((fallbackPath) => {
          if (fallbackPath) {
            setFallbackWorkspaceState({ sessionId, path: fallbackPath });
          }
        });
      },
    });
  }, [
    sessionId,
    accessToken,
    workspaceClient,
    setActiveSessionWorkspace,
    loadFallbackWorkspacePath,
  ]);

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
    async (
      path: string,
      depth = 2,
      readOptions?: WorkspaceFileReadOptions,
    ): Promise<FileTreeNode[]> => {
      const result = await workspaceClient.fetchTreeResult(accessToken ?? '', path, {
        depth,
        // 身份映射与 fetchFile 同构：已有会话传 sessionId，草稿态退而传
        // sshConnectionId，两者都无则为纯本地读取。
        //
        // 这三个参数缺一不可：缺了它们网关会判为 `local` 并用**网关本机** fs
        // 读取同名路径 —— SSH 远端工作区下就会渲染出网关本机的目录（网关在
        // Linux 且路径恰好存在时不报错，只是数据是错的）。
        ...(readOptions ?? {}),
        ...(readOptions?.workspaceRoot === undefined && resolvedWorkingDirectory
          ? { workspaceRoot: resolvedWorkingDirectory }
          : {}),
        ...(readOptions?.sessionId === undefined && sessionId ? { sessionId } : {}),
        ...(readOptions?.sshConnectionId === undefined &&
        !sessionId &&
        retainedSshConnectionId &&
        readOptions?.sshConnectionId === undefined
          ? { sshConnectionId: retainedSshConnectionId }
          : {}),
      });
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '读取文件树失败。');
      }
      return result.nodes;
    },
    [accessToken, resolvedWorkingDirectory, retainedSshConnectionId, sessionId, workspaceClient],
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
     * 未绑定工作区的普通会话的默认工作区根（仅文件浏览/读取用途）。
     *
     * 消费方（文件树 / @ 引用）用 `workingDirectory ?? fallbackWorkspacePath`
     * 作为浏览根；`workingDirectory` 仍是 null（未绑定语义），不要替换使用。
     */
    fallbackWorkspacePath,
    /**
     * 当前会话的 SSH 连接 id（本地会话为 null）。读取身份消费方据此判断
     * 会话是否绑定远端工作区；无活动的会话工作区时为 null。
     */
    sshConnectionId: resolvedSshConnectionId,
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
