import React, { useEffect, useMemo, useState } from 'react';

export interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

export interface WorkspacePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => Promise<void>;
  fetchRootPath?: () => Promise<string>;
  fetchWorkspaceRoots?: () => Promise<string[]>;
  fetchTree?: (path: string, depth?: number) => Promise<FileTreeNode[]>;
  validatePath?: (path: string) => Promise<{ valid: boolean; error?: string; path?: string }>;
  loading?: boolean;
  initialPath?: string;
}

function isPathWithinRoot(path: string, rootPath: string): boolean {
  if (rootPath === '/') {
    return path.startsWith('/');
  }

  return path === rootPath || path.startsWith(`${rootPath}/`);
}

function findContainingRoot(path: string, roots: string[]): string | null {
  return roots.find((root) => isPathWithinRoot(path, root)) ?? null;
}

function getParentPath(path: string): string | null {
  const normalizedPath = path.trim();
  if (!normalizedPath || normalizedPath === '/') {
    return null;
  }

  const trimmedPath = normalizedPath.endsWith('/')
    ? normalizedPath.replace(/\/+$/, '') || '/'
    : normalizedPath;

  if (trimmedPath === '/') {
    return null;
  }

  const lastSlashIndex = trimmedPath.lastIndexOf('/');
  if (lastSlashIndex <= 0) {
    return '/';
  }

  return trimmedPath.slice(0, lastSlashIndex);
}

export default function WorkspacePickerModal({
  isOpen,
  onClose,
  onSelect,
  fetchRootPath,
  fetchWorkspaceRoots,
  fetchTree,
  validatePath,
  loading = false,
  initialPath,
}: WorkspacePickerModalProps) {
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [availableRoots, setAvailableRoots] = useState<string[]>([]);
  const [directories, setDirectories] = useState<FileTreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCurrentPath(null);
      setAvailableRoots([]);
      setDirectories([]);
      setError(null);
      setPathInput('');
      setConfirming(false);
      setBrowsing(false);
      return;
    }

    let cancelled = false;
    const initialize = async () => {
      setBrowsing(true);
      setError(null);
      try {
        const roots = fetchWorkspaceRoots
          ? await fetchWorkspaceRoots()
          : fetchRootPath
            ? [await fetchRootPath()]
            : ['/'];
        const normalizedRoots = roots.filter((root) => root.trim().length > 0);
        const fallbackRoot = normalizedRoots[0] ?? '/';
        const resolvedRoots = normalizedRoots.length > 0 ? normalizedRoots : [fallbackRoot];
        const startPath =
          initialPath && findContainingRoot(initialPath, resolvedRoots)
            ? initialPath
            : fallbackRoot;
        const nodes = fetchTree ? await fetchTree(startPath, 1) : [];
        if (cancelled) return;
        setAvailableRoots(resolvedRoots);
        setCurrentPath(startPath);
        setPathInput(startPath);
        setDirectories(nodes.filter((node) => node.type === 'directory'));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '无法读取工作区目录');
        }
      } finally {
        if (!cancelled) setBrowsing(false);
      }
    };

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [fetchRootPath, fetchTree, fetchWorkspaceRoots, initialPath, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const busy = loading || confirming || browsing;

  const currentRoot = useMemo(() => {
    if (availableRoots.length === 0) {
      return null;
    }

    if (!currentPath) {
      return availableRoots[0] ?? null;
    }

    return findContainingRoot(currentPath, availableRoots) ?? availableRoots[0] ?? null;
  }, [availableRoots, currentPath]);

  const canGoUp = useMemo(() => {
    if (!currentPath) return false;
    return getParentPath(currentPath) !== null;
  }, [currentPath]);

  if (!isOpen) return null;

  async function openDirectory(path: string) {
    setBrowsing(true);
    setError(null);
    try {
      const nodes = fetchTree ? await fetchTree(path, 1) : [];
      setCurrentPath(path);
      setPathInput(path);
      setDirectories(nodes.filter((node) => node.type === 'directory'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取文件夹');
    } finally {
      setBrowsing(false);
    }
  }

  async function handleGoUp() {
    if (!currentPath) return;
    const parentPath = getParentPath(currentPath);
    if (!parentPath) return;
    await openDirectory(parentPath);
  }

  async function handleOpenPathInput() {
    const candidatePath = pathInput.trim();
    if (!candidatePath) {
      setError('请输入要打开的绝对路径');
      return;
    }

    setError(null);
    let nextPath = candidatePath;

    if (validatePath) {
      const result = await validatePath(candidatePath);
      if (!result.valid) {
        setError(result.error ?? '路径无效');
        return;
      }

      if (typeof result.path === 'string' && result.path.length > 0) {
        nextPath = result.path;
      }
    }

    await openDirectory(nextPath);
  }

  async function handleSelectCurrent() {
    if (!currentPath) {
      setError('当前没有可选择的文件夹');
      return;
    }
    setError(null);
    setConfirming(true);
    try {
      if (validatePath) {
        const result = await validatePath(currentPath);
        if (!result.valid) {
          setError(result.error ?? '路径无效');
          return;
        }
      }
      await onSelect(currentPath);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <button
        type="button"
        aria-label="关闭对话框"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: 'oklch(0 0 0 / 0.5)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          border: 'none',
          cursor: 'default',
          padding: 0,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选择工作区文件夹"
        style={{
          position: 'relative',
          zIndex: 1,
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '24px 24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            选择工作区文件夹
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              background: 'none',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              color: 'var(--text-3)',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {availableRoots.length > 1 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
              工作区根目录
            </span>
            <select
              aria-label="工作区根目录"
              disabled={busy}
              value={currentRoot ?? ''}
              onChange={(event) => {
                void openDirectory(event.currentTarget.value);
              }}
              style={{
                height: 36,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface-elevated, var(--surface))',
                color: 'var(--text)',
                padding: '0 12px',
                outline: 'none',
                fontSize: 12,
              }}
            >
              {availableRoots.map((root) => (
                <option key={root} value={root}>
                  {root}
                </option>
              ))}
            </select>
          </label>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background:
              'linear-gradient(135deg, oklch(0.26 0.03 250 / 0.35), oklch(0.2 0.02 250 / 0.08))',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>工作区路径</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              输入框同步显示当前目录，也可以直接编辑绝对路径后打开。
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              aria-label="工作区路径输入"
              value={pathInput}
              onChange={(event) => {
                setPathInput(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleOpenPathInput();
                }
              }}
              placeholder="例如：/home/await/project/OpenAWork"
              disabled={busy}
              title={currentPath ?? pathInput}
              style={{
                flex: 1,
                height: 38,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                padding: '0 12px',
                outline: 'none',
                fontSize: 12,
              }}
            />
            <button
              type="button"
              onClick={() => void handleGoUp()}
              disabled={!canGoUp || busy}
              style={{
                height: 38,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-2)',
                fontSize: 12,
                fontWeight: 600,
                cursor: !canGoUp || busy ? 'not-allowed' : 'pointer',
                opacity: !canGoUp || busy ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              上一级
            </button>
            <button
              type="button"
              onClick={() => void handleOpenPathInput()}
              disabled={busy || pathInput.trim().length === 0}
              style={{
                height: 38,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 12,
                fontWeight: 600,
                cursor: busy || pathInput.trim().length === 0 ? 'not-allowed' : 'pointer',
                opacity: busy || pathInput.trim().length === 0 ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              打开路径
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 220,
            maxHeight: 320,
            overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 10,
            background: 'var(--bg-2, var(--bg))',
          }}
        >
          {busy ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>正在读取文件夹…</div>
          ) : directories.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              当前目录下没有可进入的子文件夹
            </div>
          ) : (
            directories.map((directory) => (
              <button
                key={directory.path}
                type="button"
                onClick={() => void openDirectory(directory.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  minHeight: 38,
                  padding: '0 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 12, flexShrink: 0 }}>📁</span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {directory.name}
                </span>
                <span style={{ color: 'var(--text-3)', fontSize: 12, flexShrink: 0 }}>进入</span>
              </button>
            ))
          )}
        </div>

        {error && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-3)',
              fontSize: 12,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSelectCurrent()}
            disabled={busy || !currentPath}
            style={{
              height: 34,
              padding: '0 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              fontSize: 12,
              fontWeight: 600,
              cursor: busy || !currentPath ? 'not-allowed' : 'pointer',
              opacity: busy || !currentPath ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {busy && (
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: '2px solid oklch(from var(--accent-text) l c h / 0.3)',
                  borderTopColor: 'var(--accent-text)',
                  display: 'inline-block',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            )}
            选择当前文件夹
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
