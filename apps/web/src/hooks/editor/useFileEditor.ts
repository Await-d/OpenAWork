import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { resolveBareFilename } from '../../components/chat/file-preview/resolve-bare-filename.js';
import { getFilePreviewKind, isBinaryPreviewKind } from '../../utils/file/file-preview.js';
import { loadPreviewContent } from '../../utils/file/load-preview-content.js';
import { isPathWithinRoot } from '../../utils/workspace-path.js';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  language: string;
  disposeContent?: () => void;
}

export interface OpenFileOptions {
  /** 1-based line to scroll to / position the cursor on after the file opens. */
  line?: number;
  /**
   * Optional 1-based end line. When set together with `line`, the editor
   * selects (and reveals) the `[line, endLine]` range — used by the `read`
   * tool so clicking a windowed read lands on the lines that were read
   * instead of always snapping to line 1.
   */
  endLine?: number;
}

/**
 * A request to scroll the editor to a particular line once the target file
 * is active and Monaco has mounted. `nonce` lets repeated clicks on the same
 * file/line re-trigger the reveal (a plain `{path,line}` object would be
 * referentially equal and the reveal effect would skip).
 */
export interface RevealTarget {
  path: string;
  line: number;
  endLine?: number;
  nonce: number;
}

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    mdx: 'markdown',
    css: 'css',
    html: 'html',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sh: 'shell',
    bash: 'shell',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    sql: 'sql',
    xml: 'xml',
    graphql: 'graphql',
    txt: 'plaintext',
  };
  return map[ext] ?? 'plaintext';
}

function workspaceKey(workspacePath: string | null | undefined): string {
  return workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
}

function releaseOpenFileContent(file: OpenFile | null | undefined): void {
  file?.disposeContent?.();
}

/**
 * useFileEditor:按 workspace 隔离的文件编辑器状态。
 *
 * - 打开文件:仅写入当前 workspace 的桶
 * - 切换 workspace:清空内存 openFiles,从新 workspace 桶加载持久化路径
 * - 关闭文件 / 保存:同样仅在当前 workspace 内生效
 *
 * 这样跨 workspace 切回 A 时,A 上次留下的文件会被重新加载;不会再共享一个全局
 * openFilePaths 列表导致跨 workspace 文件路径串。
 */
export function useFileEditor(workspacePath?: string | null, uiWorkspaceScope?: string | null) {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const workspaceClient = useMemo(() => createWorkspaceClient(gatewayUrl), [gatewayUrl]);

  const persistenceWorkspaceScope = uiWorkspaceScope ?? workspacePath ?? null;
  const wsKey = workspaceKey(persistenceWorkspaceScope);
  const openFilePathsByWorkspace = useUIStateStore((s) => s.openFilePathsByWorkspace);
  const activeFilePathByWorkspace = useUIStateStore((s) => s.activeFilePathByWorkspace);
  const setOpenFilePathsForWorkspace = useUIStateStore((s) => s.setOpenFilePathsForWorkspace);
  const setActiveFilePathForWorkspace = useUIStateStore((s) => s.setActiveFilePathForWorkspace);

  const persistedPaths = useMemo(
    () => openFilePathsByWorkspace[wsKey] ?? [],
    [openFilePathsByWorkspace, wsKey],
  );
  const activeFilePath = activeFilePathByWorkspace[wsKey] ?? null;

  // `uiWorkspaceScope` 只用于隔离 UI 持久化，并不代表文件系统工作区。
  // 因此在恢复标签前必须仍以真实 workspacePath 过滤，避免历史状态中的其他
  // 项目文件被带到当前工作区并触发网关的跨工作区 403。
  const restorablePaths = useMemo(() => {
    if (!workspacePath?.trim()) return persistedPaths;
    return persistedPaths.filter((path) => isPathWithinRoot(path, workspacePath));
  }, [persistedPaths, workspacePath]);
  const hasInvalidPersistedPaths = restorablePaths.length !== persistedPaths.length;

  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Pending scroll target. Set when a caller passes a line to openFile;
  // consumed by the editor pane once the file is active + Monaco mounted.
  const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(null);
  const revealNonceRef = useRef(0);
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;

  // 当 workspace 切换时清掉内存中的 openFiles,后续 reload effect 会按新 workspace
  // 的 persistedPaths 加载文件。
  const lastSeenWorkspaceKeyRef = useRef(wsKey);
  useEffect(() => {
    if (lastSeenWorkspaceKeyRef.current === wsKey) return;
    lastSeenWorkspaceKeyRef.current = wsKey;
    for (const file of openFilesRef.current) {
      releaseOpenFileContent(file);
    }
    setOpenFiles([]);
  }, [wsKey]);

  useEffect(() => {
    return () => {
      for (const file of openFilesRef.current) {
        releaseOpenFileContent(file);
      }
    };
  }, []);

  // 清除过期或串入当前 UI 桶的路径，避免每次挂载都重复请求一个必然被服务端
  // 拒绝的文件；激活文件同时失效时也一并移除。
  useEffect(() => {
    if (restorablePaths.length === persistedPaths.length) return;
    setOpenFilePathsForWorkspace(persistenceWorkspaceScope, restorablePaths);
    if (activeFilePath && !restorablePaths.includes(activeFilePath)) {
      setActiveFilePathForWorkspace(persistenceWorkspaceScope, null);
    }
  }, [
    activeFilePath,
    persistedPaths.length,
    persistenceWorkspaceScope,
    restorablePaths,
    setActiveFilePathForWorkspace,
    setOpenFilePathsForWorkspace,
  ]);

  // 把内存 openFiles 同步到当前 workspace 桶。
  // 注意:绝不在 openFiles 为空时回写 store(否则会在 workspace 切换瞬间把刚恢复的
  // 持久化路径清掉)。openFiles=[] 只在两种场景出现:
  //   1) workspace 切换初期,reload effect 还没把文件加载回来
  //   2) 用户在该 workspace 里关掉了最后一个文件 → 由 closeFile 直接调 store setter
  // 两种场景都不能依赖这个 sync effect 来反映"清空"。
  const openFilePathsRef = useRef(openFiles.map((f) => f.path));
  openFilePathsRef.current = openFiles.map((f) => f.path);
  useEffect(() => {
    if (openFiles.length === 0) return;
    if (lastSeenWorkspaceKeyRef.current !== wsKey) return;
    const next = openFilePathsRef.current;
    const current = openFilePathsByWorkspace[wsKey] ?? [];
    if (current.length === next.length && current.every((p, i) => p === next[i])) return;
    setOpenFilePathsForWorkspace(persistenceWorkspaceScope, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles, wsKey]);

  const setActiveFilePath = useCallback(
    (path: string | null) => {
      setActiveFilePathForWorkspace(persistenceWorkspaceScope, path);
    },
    [persistenceWorkspaceScope, setActiveFilePathForWorkspace],
  );

  const openFile = useCallback(
    async (path: string, options?: OpenFileOptions) => {
      // Build a RevealTarget for the resolved path when the caller asked to
      // jump to a specific line. The nonce makes repeated clicks on the same
      // file+line re-fire the reveal effect downstream.
      const queueReveal = (resolved: string) => {
        if (options?.line == null) return;
        revealNonceRef.current += 1;
        setRevealTarget({
          path: resolved,
          line: options.line,
          ...(options.endLine != null ? { endLine: options.endLine } : {}),
          nonce: revealNonceRef.current,
        });
      };

      // Resolve a possibly-incomplete path (bare filename like
      // `create_quotation.py` from inline-code in chat) to a full
      // workspace path before opening. The same resolver is shared
      // with the hover preview popover; see
      // `./components/chat/file-preview/resolve-bare-filename.ts`.
      const existing = openFiles.find((f) => f.path === path);
      if (existing) {
        setActiveFilePath(path);
        queueReveal(path);
        return;
      }
      const resolvedPath = await resolveBareFilename({
        client: workspaceClient,
        token: token ?? '',
        workspaceRoot: workspacePath ?? null,
        rawPath: path,
      });
      // If resolution gave us a path we already have open, just activate it.
      const existingResolved = openFiles.find((f) => f.path === resolvedPath);
      if (existingResolved) {
        setActiveFilePath(resolvedPath);
        queueReveal(resolvedPath);
        return;
      }
      // Binary files: don't readFile, the gateway's utf-8 decode would
      // produce mojibake and Monaco would render garbage. Insert a
      // placeholder OpenFile whose content the FilePreviewPane uses
      // to display a "binary file" notice.
      const previewKind = getFilePreviewKind(resolvedPath);
      if (isBinaryPreviewKind(previewKind)) {
        const name = resolvedPath.split('/').pop() ?? resolvedPath;
        const placeholder: OpenFile = {
          path: resolvedPath,
          name,
          content: '',
          originalContent: '',
          language: 'plaintext',
        };
        setOpenFiles((prev) => [...prev, placeholder]);
        setActiveFilePath(resolvedPath);
        return;
      }
      setLoading(true);
      setSaveError(null);
      try {
        const loaded = await loadPreviewContent({
          client: workspaceClient,
          token: token ?? '',
          path: resolvedPath,
          workspaceRoot: workspacePath ?? null,
        });
        const name = resolvedPath.split('/').pop() ?? resolvedPath;
        const file: OpenFile = {
          path: resolvedPath,
          name,
          content: loaded.content,
          originalContent: loaded.content,
          language: getLanguage(resolvedPath),
          disposeContent: loaded.dispose,
        };
        setOpenFiles((prev) => [...prev, file]);
        setActiveFilePath(resolvedPath);
        queueReveal(resolvedPath);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : '打开文件失败');
      } finally {
        setLoading(false);
      }
    },
    [openFiles, token, workspaceClient, workspacePath, setActiveFilePath],
  );

  // workspace 切换或 persistedPaths 变化时,把 persisted 路径加载成 openFiles。
  useEffect(() => {
    // 先等待上一个 effect 将失效路径从持久化桶中移除。否则初次挂载时会同时
    // 启动一次加载、清理后又重新加载，导致有效文件被重复读取。
    if (hasInvalidPersistedPaths || restorablePaths.length === 0 || openFiles.length > 0) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const loaded: OpenFile[] = [];
      for (const path of restorablePaths) {
        try {
          const previewKind = getFilePreviewKind(path);
          if (isBinaryPreviewKind(previewKind)) {
            loaded.push({
              path,
              name: path.split('/').pop() ?? path,
              content: '',
              originalContent: '',
              language: 'plaintext',
            });
            continue;
          }
          const next = await loadPreviewContent({
            client: workspaceClient,
            token: token ?? '',
            path,
            workspaceRoot: workspacePath ?? null,
          });
          loaded.push({
            path,
            name: path.split('/').pop() ?? path,
            content: next.content,
            originalContent: next.content,
            language: getLanguage(path),
            disposeContent: next.dispose,
          });
        } catch (_e) {
          // 单个文件加载失败不阻塞其他文件
        }
      }
      if (!cancelled) {
        setOpenFiles(loaded);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    hasInvalidPersistedPaths,
    restorablePaths,
    openFiles.length,
    token,
    workspaceClient,
    workspacePath,
  ]);

  const closeFile = useCallback(
    (path: string) => {
      setOpenFiles((prev) => {
        const idx = prev.findIndex((f) => f.path === path);
        const closingFile = idx >= 0 ? prev[idx] : null;
        const next = prev.filter((f) => f.path !== path);
        releaseOpenFileContent(closingFile);
        if (activeFilePath === path) {
          const nextActive = next[Math.max(0, idx - 1)]?.path ?? next[0]?.path ?? null;
          setActiveFilePath(nextActive);
        }
        // 关到最后一个时,sync effect 不会回写(因为 openFiles=[] 时跳过),这里直接
        // 清掉 store 的当前 workspace 桶,让持久化与内存一致。
        if (next.length === 0) {
          setOpenFilePathsForWorkspace(persistenceWorkspaceScope, []);
        }
        return next;
      });
    },
    [activeFilePath, persistenceWorkspaceScope, setActiveFilePath, setOpenFilePathsForWorkspace],
  );

  const updateContent = useCallback((path: string, content: string) => {
    setOpenFiles((prev) => prev.map((f) => (f.path === path ? { ...f, content } : f)));
  }, []);

  /**
   * Reorder open file tabs by moving the file at `fromIndex` to `toIndex`.
   *
   * The new order is also written back to the workspace bucket so it
   * survives page reloads. No-ops when indices are out of range or
   * identical.
   */
  const reorderFiles = useCallback(
    (fromIndex: number, toIndex: number) => {
      setOpenFiles((prev) => {
        if (fromIndex === toIndex) return prev;
        if (fromIndex < 0 || fromIndex >= prev.length) return prev;
        if (toIndex < 0 || toIndex >= prev.length) return prev;
        const next = prev.slice();
        const [moved] = next.splice(fromIndex, 1);
        if (!moved) return prev;
        next.splice(toIndex, 0, moved);
        // Persist the new order immediately so a refresh restores it.
        setOpenFilePathsForWorkspace(
          persistenceWorkspaceScope,
          next.map((f) => f.path),
        );
        return next;
      });
    },
    [persistenceWorkspaceScope, setOpenFilePathsForWorkspace],
  );

  const saveFile = useCallback(
    async (path: string) => {
      const file = openFiles.find((f) => f.path === path);
      if (!file) return;
      setSaveError(null);
      try {
        await workspaceClient.writeFile(token ?? '', path, file.content);
        setOpenFiles((prev) =>
          prev.map((f) => (f.path === path ? { ...f, originalContent: f.content } : f)),
        );
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : '保存失败');
      }
    },
    [openFiles, token, workspaceClient],
  );

  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null;

  const isDirty = useCallback(
    (path: string) => {
      const f = openFiles.find((o) => o.path === path);
      return f ? f.content !== f.originalContent : false;
    },
    [openFiles],
  );

  // Clear the pending reveal once the editor has consumed it, so the same
  // target doesn't re-fire on unrelated re-renders.
  const clearRevealTarget = useCallback(() => {
    setRevealTarget(null);
  }, []);

  return {
    openFiles,
    activeFile,
    activeFilePath,
    loading,
    saveError,
    openFile,
    closeFile,
    updateContent,
    saveFile,
    reorderFiles,
    setActiveFilePath,
    isDirty,
    revealTarget,
    clearRevealTarget,
  };
}
