import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderIcon } from '../../file-editor/preview/FileIcon.js';
import { isTauriRuntime, pickDesktopFolder } from '../../../utils/gateway/desktop-gateway.js';
import {
  findContainingRoot,
  getParentPath,
  joinDirectoryPath,
} from '../../../utils/workspace-path.js';

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
  createDirectory?: (path: string) => Promise<void>;
  validatePath?: (path: string) => Promise<{ valid: boolean; error?: string; path?: string }>;
  loading?: boolean;
  initialPath?: string;
}

function validateDirectoryName(name: string): string | null {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return '请输入文件夹名称';
  }

  if (trimmedName === '.' || trimmedName === '..') {
    return '文件夹名称不能为 . 或 ..';
  }

  if (/[\\/]/.test(trimmedName)) {
    return '文件夹名称不能包含路径分隔符';
  }

  return null;
}

export default function WorkspacePickerModal({
  isOpen,
  onClose,
  onSelect,
  fetchRootPath,
  fetchWorkspaceRoots,
  fetchTree,
  createDirectory,
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
  const [nativePicking, setNativePicking] = useState(false);
  const [creatingDirectory, setCreatingDirectory] = useState(false);
  const [showCreateDirectoryForm, setShowCreateDirectoryForm] = useState(false);
  const [newDirectoryName, setNewDirectoryName] = useState('');
  const lastActionRef = useRef<{ kind: 'initialize' } | { kind: 'open'; path: string } | null>(
    null,
  );
  const supportsNativePicker = isTauriRuntime();

  const openDirectory = useCallback(
    async (path: string) => {
      setBrowsing(true);
      setError(null);
      try {
        const nodes = fetchTree ? await fetchTree(path, 1) : [];
        setCurrentPath(path);
        setPathInput(path);
        setDirectories(nodes.filter((node) => node.type === 'directory'));
        lastActionRef.current = { kind: 'open', path };
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法读取文件夹');
      } finally {
        setBrowsing(false);
      }
    },
    [fetchTree],
  );

  const initialize = useCallback(async () => {
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
        initialPath && findContainingRoot(initialPath, resolvedRoots) ? initialPath : fallbackRoot;
      setAvailableRoots(resolvedRoots);
      setCurrentPath(startPath);
      setPathInput(startPath);

      if (supportsNativePicker && !initialPath) {
        setDirectories([]);
        lastActionRef.current = { kind: 'initialize' };
        return;
      }

      const nodes = fetchTree ? await fetchTree(startPath, 1) : [];
      setDirectories(nodes.filter((node) => node.type === 'directory'));
      lastActionRef.current = { kind: 'initialize' };
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取工作区目录');
    } finally {
      setBrowsing(false);
    }
  }, [fetchRootPath, fetchTree, fetchWorkspaceRoots, initialPath, supportsNativePicker]);

  const retryLastAction = useCallback(async () => {
    if (lastActionRef.current?.kind === 'open') {
      await openDirectory(lastActionRef.current.path);
      return;
    }
    await initialize();
  }, [initialize, openDirectory]);

  useEffect(() => {
    if (!isOpen) {
      setCurrentPath(null);
      setAvailableRoots([]);
      setDirectories([]);
      setError(null);
      setPathInput('');
      setConfirming(false);
      setBrowsing(false);
      setNativePicking(false);
      setCreatingDirectory(false);
      setShowCreateDirectoryForm(false);
      setNewDirectoryName('');
      return;
    }

    void initialize();
  }, [initialize, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const handleOnline = () => {
      if (error) {
        void retryLastAction();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [error, isOpen, retryLastAction]);

  const busy = loading || confirming || browsing || nativePicking || creatingDirectory;

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

  async function handleGoUp() {
    if (!currentPath) return;
    const parentPath = getParentPath(currentPath);
    if (!parentPath) return;
    await openDirectory(parentPath);
  }

  async function handlePickNativeFolder() {
    setNativePicking(true);
    setError(null);

    try {
      const pickedPath = await pickDesktopFolder();
      if (!pickedPath) {
        return;
      }

      await onSelect(pickedPath);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开系统文件夹选择器失败');
    } finally {
      setNativePicking(false);
    }
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

  async function handleCreateDirectory() {
    if (!createDirectory) {
      return;
    }

    if (!currentPath) {
      setError('请先打开一个目录，再新建文件夹');
      return;
    }

    const validationError = validateDirectoryName(newDirectoryName);
    if (validationError) {
      setError(validationError);
      return;
    }

    const nextPath = joinDirectoryPath(currentPath, newDirectoryName);
    setError(null);
    setCreatingDirectory(true);

    try {
      await createDirectory(nextPath);
      const nodes = fetchTree ? await fetchTree(currentPath, 1) : [];
      setDirectories(nodes.filter((node) => node.type === 'directory'));
      setPathInput(currentPath);
      setShowCreateDirectoryForm(false);
      setNewDirectoryName('');
      lastActionRef.current = { kind: 'open', path: currentPath };
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建文件夹失败');
    } finally {
      setCreatingDirectory(false);
    }
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
          background: 'color-mix(in srgb, var(--bg-base) 50%, transparent)',
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
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: '24px 24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
            选择工作区文件夹
          </span>
          <button
            type="button"
            onClick={onClose}
            className="workspace-picker-action"
            disabled={busy}
            style={{
              background: 'none',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              color: 'var(--fg-muted)',
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
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 500 }}>
              工作区根目录
            </span>
            <select
              aria-label="工作区根目录"
              className="workspace-picker-select"
              disabled={busy}
              value={currentRoot ?? ''}
              onChange={(event) => {
                void openDirectory(event.currentTarget.value);
              }}
              style={{
                height: 36,
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'var(--surface-elevated, var(--bg-overlay))',
                color: 'var(--fg-strong)',
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

        {supportsNativePicker ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '14px 16px',
              borderRadius: 12,
              border: '1px solid var(--accent-border)',
              background:
                'linear-gradient(135deg, var(--accent-subtle), color-mix(in srgb, var(--bg-overlay) 82%, var(--bg-surface)))',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--fg-strong)', fontWeight: 700 }}>
                系统文件夹选择器
              </span>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                桌面端会调用 Windows、macOS 或 Linux 的原生文件夹窗口，支持多磁盘、
                收藏位置和最近目录。
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handlePickNativeFolder()}
              className="workspace-picker-action"
              disabled={busy}
              style={{
                height: 40,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid var(--accent-border)',
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                fontSize: 12,
                fontWeight: 700,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
                alignSelf: 'flex-start',
              }}
            >
              {nativePicking ? '打开中…' : '使用系统选择器'}
            </button>
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-default)',
            background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-overlay))',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-strong)', fontWeight: 600 }}>
              工作区路径
            </span>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              输入框同步显示当前目录，也可以直接编辑绝对路径后打开。
              {supportsNativePicker ? ' 桌面端更推荐使用上方系统选择器。' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              aria-label="工作区路径输入"
              className="workspace-picker-input"
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
              placeholder="例如：/home/await/project/OpenAWork 或 C:\\Users\\Alice\\OpenAWork"
              disabled={busy}
              title={currentPath ?? pathInput}
              style={{
                flex: '1 1 260px',
                minWidth: 0,
                height: 38,
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-strong)',
                padding: '0 12px',
                outline: 'none',
                fontSize: 12,
              }}
            />
            <button
              type="button"
              onClick={() => void handleGoUp()}
              className="workspace-picker-action"
              disabled={!canGoUp || busy}
              style={{
                height: 38,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'transparent',
                color: 'var(--fg-default)',
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
              className="workspace-picker-action"
              disabled={busy || pathInput.trim().length === 0}
              style={{
                height: 38,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-strong)',
                fontSize: 12,
                fontWeight: 600,
                cursor: busy || pathInput.trim().length === 0 ? 'not-allowed' : 'pointer',
                opacity: busy || pathInput.trim().length === 0 ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              打开路径
            </button>
            <button
              type="button"
              onClick={() => void retryLastAction()}
              className="workspace-picker-action"
              disabled={busy}
              style={{
                height: 38,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'transparent',
                color: 'var(--fg-default)',
                fontSize: 12,
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              重试
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
            border: '1px solid var(--border-default)',
            borderRadius: 10,
            padding: 10,
            background: 'var(--bg-2, var(--bg-base))',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--spacing-2)',
              paddingBottom: 'var(--spacing-2)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
                当前目录
              </span>
              <span
                title={currentPath ?? undefined}
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 11,
                  color: 'var(--fg-muted)',
                }}
              >
                {currentPath ?? '尚未打开目录'}
              </span>
            </div>
            {createDirectory && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setShowCreateDirectoryForm((value) => !value);
                }}
                className="workspace-picker-action"
                disabled={!currentPath || busy}
                style={{
                  height: 32,
                  padding: '0 var(--spacing-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  background: showCreateDirectoryForm
                    ? 'var(--accent-subtle)'
                    : 'var(--bg-overlay)',
                  color: showCreateDirectoryForm ? 'var(--accent)' : 'var(--fg-strong)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: !currentPath || busy ? 'not-allowed' : 'pointer',
                  opacity: !currentPath || busy ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                {showCreateDirectoryForm ? '收起' : '新建文件夹'}
              </button>
            )}
          </div>

          {createDirectory && showCreateDirectoryForm && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-2)',
                flexWrap: 'wrap',
                paddingBottom: 'var(--spacing-2)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <input
                type="text"
                aria-label="文件夹名称"
                className="workspace-picker-input"
                value={newDirectoryName}
                onChange={(event) => {
                  setNewDirectoryName(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleCreateDirectory();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setShowCreateDirectoryForm(false);
                    setNewDirectoryName('');
                  }
                }}
                placeholder="文件夹名称，例如：src"
                disabled={busy}
                style={{
                  flex: '1 1 220px',
                  minWidth: 0,
                  height: 34,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-overlay)',
                  color: 'var(--fg-strong)',
                  padding: '0 var(--spacing-3)',
                  outline: 'none',
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                onClick={() => void handleCreateDirectory()}
                className="workspace-picker-action"
                disabled={busy || newDirectoryName.trim().length === 0}
                style={{
                  height: 34,
                  padding: '0 var(--spacing-4)',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--fg-on-accent)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy || newDirectoryName.trim().length === 0 ? 'not-allowed' : 'pointer',
                  opacity: busy || newDirectoryName.trim().length === 0 ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                {creatingDirectory ? '创建中…' : '创建'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateDirectoryForm(false);
                  setNewDirectoryName('');
                }}
                className="workspace-picker-action"
                disabled={busy}
                style={{
                  height: 34,
                  padding: '0 var(--spacing-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                取消
              </button>
            </div>
          )}

          {busy ? (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>正在读取文件夹…</div>
          ) : directories.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              当前目录下没有可进入的子文件夹
            </div>
          ) : (
            directories
              .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
              .map((directory) => (
                <button
                  key={directory.path}
                  type="button"
                  onClick={() => void openDirectory(directory.path)}
                  className="workspace-picker-dir-btn ui-hover-accent-soft"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    minHeight: 34,
                    padding: '4px 10px',
                    borderRadius: 7,
                    border: '1px solid transparent',
                    background: 'transparent',
                    color: 'var(--fg-strong)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <FolderIcon size={14} name={directory.name} />
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {directory.name}
                  </span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--fg-muted)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ flexShrink: 0, opacity: 0.5 }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))
          )}
        </div>

        {error && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            className="workspace-picker-action"
            disabled={busy}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'transparent',
              color: 'var(--fg-muted)',
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
            className="workspace-picker-action"
            disabled={busy || !currentPath}
            style={{
              height: 34,
              padding: '0 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--fg-on-accent)',
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
                  border: '2px solid color-mix(in srgb, var(--fg-on-accent) 30%, transparent)',
                  borderTopColor: 'var(--fg-on-accent)',
                  display: 'inline-block',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            )}
            选择当前文件夹
          </button>
        </div>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .workspace-picker-action:focus-visible,
        .workspace-picker-input:focus-visible,
        .workspace-picker-select:focus-visible,
        .workspace-picker-dir-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px var(--accent-subtle);
        }
        .workspace-picker-action:not(:disabled):hover {
          border-color: var(--border-emphasis);
        }
        .workspace-picker-dir-btn:not(:disabled):hover {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
        }
      `}</style>
    </div>
  );
}
