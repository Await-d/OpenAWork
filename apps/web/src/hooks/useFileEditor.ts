import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../stores/auth.js';
import { useUIStateStore } from '../stores/uiState.js';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  language: string;
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

export function useFileEditor() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const workspaceClient = useMemo(() => createWorkspaceClient(gatewayUrl), [gatewayUrl]);
  const openFilePaths = useUIStateStore((s) => s.openFilePaths);
  const activeFilePath = useUIStateStore((s) => s.activeFilePath);
  const setOpenFilePaths = useUIStateStore((s) => s.setOpenFilePaths);
  const setActiveFilePath = useUIStateStore((s) => s.setActiveFilePath);

  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const persistedPaths = openFilePaths;
  const persistedActive = activeFilePath;
  const openFilePathsRef = useRef(openFiles.map((f) => f.path));
  openFilePathsRef.current = openFiles.map((f) => f.path);
  // closeAll 设置该 ref 让接下来的 reload effect 跳过一次,避免 setOpenFiles([]) 之后
  // store 还没同步完成时,reload effect 看到 persistedPaths 旧值再次 readFile 加载。
  const skipNextReloadRef = useRef(false);
  useEffect(() => {
    const next = openFilePathsRef.current;
    setOpenFilePaths(next);
  }, [openFiles, setOpenFilePaths]);

  const openFile = useCallback(
    async (path: string) => {
      const existing = openFiles.find((f) => f.path === path);
      if (existing) {
        setActiveFilePath(path);
        return;
      }
      setLoading(true);
      setSaveError(null);
      try {
        const data = await workspaceClient.readFile(token ?? '', path);
        const name = path.split('/').pop() ?? path;
        const file: OpenFile = {
          path,
          name,
          content: data.content,
          originalContent: data.content,
          language: getLanguage(path),
        };
        setOpenFiles((prev) => [...prev, file]);
        setActiveFilePath(path);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : '打开文件失败');
      } finally {
        setLoading(false);
      }
    },
    [openFiles, token, workspaceClient, setActiveFilePath],
  );

  useEffect(() => {
    if (skipNextReloadRef.current) {
      skipNextReloadRef.current = false;
      return;
    }
    if (persistedPaths.length === 0 || openFiles.length > 0) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const loaded: OpenFile[] = [];
      for (const path of persistedPaths) {
        try {
          const data = await workspaceClient.readFile(token ?? '', path);
          loaded.push({
            path,
            name: path.split('/').pop() ?? path,
            content: data.content,
            originalContent: data.content,
            language: getLanguage(path),
          });
        } catch (_e) {
          setLoading(false);
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
  }, [persistedPaths, persistedPaths.length, openFiles.length, token, workspaceClient]);

  const closeFile = useCallback(
    (path: string) => {
      setOpenFiles((prev) => {
        const idx = prev.findIndex((f) => f.path === path);
        const next = prev.filter((f) => f.path !== path);
        if (activeFilePath === path) {
          const nextActive = next[Math.max(0, idx - 1)]?.path ?? next[0]?.path ?? null;
          setActiveFilePath(nextActive);
        }
        return next;
      });
    },
    [activeFilePath, setActiveFilePath],
  );

  const updateContent = useCallback((path: string, content: string) => {
    setOpenFiles((prev) => prev.map((f) => (f.path === path ? { ...f, content } : f)));
  }, []);

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

  const closeAll = useCallback(() => {
    console.log('[useFileEditor closeAll] called, prev openFiles:', openFiles.length);
    // 标记跳过下一次 reload effect,避免在 store 同步前 reload 把旧路径再加载回来。
    skipNextReloadRef.current = true;
    setOpenFilePaths([]);
    setOpenFiles([]);
    setActiveFilePath(null);
  }, [setActiveFilePath, setOpenFilePaths, openFiles.length]);

  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null;

  const isDirty = (path: string) => {
    const f = openFiles.find((o) => o.path === path);
    return f ? f.content !== f.originalContent : false;
  };

  return {
    openFiles,
    activeFile,
    activeFilePath,
    loading,
    saveError,
    openFile,
    closeFile,
    closeAll,
    updateContent,
    saveFile,
    setActiveFilePath,
    isDirty,
  };
}
