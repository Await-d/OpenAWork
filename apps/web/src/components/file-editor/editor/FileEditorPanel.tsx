import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import type { OpenFile, RevealTarget } from '../../../hooks/editor/useFileEditor.js';
import { isBinaryPreviewKind } from '../../../utils/file/file-preview.js';
import { getFilePreviewKind } from '../../../utils/file/file-preview.js';
import { ContextMenu, type ContextMenuItem } from '../../common/display/ContextMenu.js';
import { EditorTabBar } from '../tabs/EditorTabBar.js';
import { FileBreadcrumb } from '../tabs/FileBreadcrumb.js';
import { FilePreviewPane } from '../preview/FilePreviewPane.js';
import { MonacoErrorBoundary } from './MonacoErrorBoundary.js';

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.default })),
);

// Per-file panel mode preference, persisted to localStorage so the
// user's "code vs preview" choice survives page reloads.
const PANEL_MODE_STORAGE_KEY = 'openAwork:fileEditor:panelMode';
const PANEL_MODE_STORAGE_LIMIT = 200;

type PanelMode = 'code' | 'preview';

function readPanelModeMap(): Record<string, PanelMode> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PANEL_MODE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, PanelMode>;
    }
    return {};
  } catch {
    return {};
  }
}

function readPanelModeFor(path: string): PanelMode | null {
  const value = readPanelModeMap()[path];
  return value === 'code' || value === 'preview' ? value : null;
}

function writePanelModeFor(path: string, mode: PanelMode): void {
  if (typeof window === 'undefined') return;
  try {
    const map = readPanelModeMap();
    if (map[path] === mode) return;
    map[path] = mode;
    // Cap entries to avoid unbounded growth: drop oldest keys.
    const keys = Object.keys(map);
    if (keys.length > PANEL_MODE_STORAGE_LIMIT) {
      for (const key of keys.slice(0, keys.length - PANEL_MODE_STORAGE_LIMIT)) {
        delete map[key];
      }
    }
    window.localStorage.setItem(PANEL_MODE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota / disabled storage — silently ignore, in-memory state still works.
  }
}

export function FileEditorPanel({
  files,
  activeFile,
  activeFilePath,
  isDirty,
  saving,
  saveError,
  theme,
  onActivate,
  onClose,
  onChange,
  onSave,
  onReorder,
  revealTarget,
  onRevealConsumed,
}: {
  files: OpenFile[];
  activeFile: OpenFile | null;
  activeFilePath: string | null;
  isDirty: (path: string) => boolean;
  saving?: boolean;
  saveError?: string | null;
  theme?: 'dark' | 'light';
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  /**
   * Pending request to scroll/select a line range in the active file.
   * Threaded down from `useFileEditor` when a caller opens a file with a
   * line (e.g. clicking a windowed `read` tool result). Consumed once the
   * editor mounts and the matching file is active.
   */
  revealTarget?: RevealTarget | null;
  /** Called after a `revealTarget` has been applied so it can be cleared. */
  onRevealConsumed?: () => void;
}) {
  const [panelMode, setPanelMode] = useState<'code' | 'preview'>('code');

  // Monaco instance for the active file, captured on mount. Used to scroll
  // to a `revealTarget` line once the file is open. Reset whenever the file
  // path / mount key changes so a stale editor isn't driven.
  const editorRef = useRef<MonacoEditorNs.IStandaloneCodeEditor | null>(null);

  // Apply a reveal target (1-based line, optional end line) to the live
  // Monaco editor: select the range, scroll it to center, and focus so the
  // cursor is where the user expects. No-op when the editor isn't mounted
  // yet — the mount effect re-checks the pending target on attach.
  const applyReveal = useCallback((target: RevealTarget) => {
    const ed = editorRef.current;
    if (!ed) return false;
    const model = ed.getModel();
    const maxLine = model ? model.getLineCount() : target.line;
    const startLine = Math.min(Math.max(1, target.line), Math.max(1, maxLine));
    const endLine = Math.min(
      Math.max(startLine, target.endLine ?? startLine),
      Math.max(1, maxLine),
    );
    const endColumn = model ? model.getLineMaxColumn(endLine) : 1;
    ed.revealLinesInCenterIfOutsideViewport(startLine, endLine);
    ed.setSelection({
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: endLine,
      endColumn,
    });
    ed.setPosition({ lineNumber: startLine, column: 1 });
    ed.focus();
    return true;
  }, []);

  // Re-apply whenever a new reveal target arrives for the file that's
  // currently active. Runs after Monaco's value has been set for the file.
  // We retry on a microtask + a short timeout because @monaco-editor/react
  // sets the model value asynchronously after mount, so the very first
  // reveal can land before the content (and line count) exist.
  useEffect(() => {
    if (!revealTarget) return;
    if (!activeFile || activeFile.path !== revealTarget.path) return;
    if (panelMode !== 'code') {
      // The line view only exists in the code editor; flip to it so the
      // reveal has somewhere to land.
      setPanelMode('code');
    }
    let cancelled = false;
    const tryApply = (attemptsLeft: number) => {
      if (cancelled) return;
      if (applyReveal(revealTarget)) {
        onRevealConsumed?.();
        return;
      }
      if (attemptsLeft <= 0) {
        // Give up but still clear so we don't loop forever.
        onRevealConsumed?.();
        return;
      }
      setTimeout(() => tryApply(attemptsLeft - 1), 60);
    };
    // First attempt next frame (editor likely mounted), then retry a few times.
    const raf = requestAnimationFrame(() => tryApply(8));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [revealTarget, activeFile, panelMode, applyReveal, onRevealConsumed]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeFilePath) onSave(activeFilePath);
      }
    },
    [activeFilePath, onSave],
  );

  const activePreviewKind = useMemo(
    () => (activeFile ? getFilePreviewKind(activeFile.path) : null),
    [activeFile],
  );

  // Track the last file path we auto-applied a default panel mode for.
  // We only want to auto-switch to preview when the user opens a NEW
  // file — not on every re-render — otherwise the user can never
  // manually switch to code view for markdown/svg/image files.
  const lastAutoAppliedPathRef = useRef<string | null>(null);

  useEffect(() => {
    const currentPath = activeFile?.path ?? null;

    // No file open: nothing to do.
    if (!currentPath) {
      lastAutoAppliedPathRef.current = null;
      return;
    }

    // Same file as before: respect the user's manual mode choice.
    if (lastAutoAppliedPathRef.current === currentPath) {
      // Edge case: file used to support preview but no longer does.
      if (!activePreviewKind && panelMode === 'preview') {
        setPanelMode('code');
      }
      return;
    }

    // New file opened: prefer a remembered choice from localStorage,
    // otherwise pick a sensible default. Binary files MUST stay on
    // preview because their utf-8 decoded content is mojibake that
    // would otherwise be dumped into Monaco.
    lastAutoAppliedPathRef.current = currentPath;

    if (isBinaryPreviewKind(activePreviewKind)) {
      setPanelMode('preview');
      return;
    }

    // A pending line reveal for this file needs the code editor to land in
    // (the preview pane has no line gutter / scroll target). Force code mode
    // so e.g. clicking a windowed `read` result on a markdown file still
    // jumps to the right line instead of opening the rendered preview.
    if (revealTarget && revealTarget.path === currentPath) {
      setPanelMode('code');
      return;
    }

    const remembered = activePreviewKind ? readPanelModeFor(currentPath) : null;
    if (remembered) {
      setPanelMode(remembered);
      return;
    }

    if (
      activePreviewKind === 'markdown' ||
      activePreviewKind === 'svg' ||
      activePreviewKind === 'image'
    ) {
      setPanelMode('preview');
    } else {
      setPanelMode('code');
    }
  }, [activeFile?.path, activePreviewKind, panelMode, revealTarget]);

  // Persist the user's manual mode choice for the current file.
  // We only persist when the file has a preview kind (otherwise the
  // toggle isn't shown and the choice is meaningless).
  useEffect(() => {
    const currentPath = activeFile?.path;
    if (!currentPath || !activePreviewKind) return;
    if (isBinaryPreviewKind(activePreviewKind)) return;
    writePanelModeFor(currentPath, panelMode);
  }, [activeFile?.path, activePreviewKind, panelMode]);

  // Lock panelMode to 'preview' for binary files — there's nothing
  // useful to show in the code editor for these.
  const effectivePanelMode = isBinaryPreviewKind(activePreviewKind) ? 'preview' : panelMode;

  const handlePreview = useCallback(
    (path: string) => {
      onActivate(path);
      setPanelMode('preview');
    },
    [onActivate],
  );

  // ───────────────────────── Context menu ─────────────────────────
  // Right-click on a tab opens tab-management actions; right-click on
  // the preview body opens content actions. Both share the same
  // <ContextMenu> mount point.
  type MenuState =
    | { kind: 'tab'; targetPath: string; x: number; y: number }
    | { kind: 'preview'; targetPath: string; x: number; y: number }
    | null;
  const [contextMenu, setContextMenu] = useState<MenuState>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleTabContextMenu = useCallback((path: string, x: number, y: number) => {
    setContextMenu({ kind: 'tab', targetPath: path, x, y });
  }, []);

  const handlePreviewContextMenu = useCallback(
    (x: number, y: number) => {
      if (!activeFile) return;
      setContextMenu({ kind: 'preview', targetPath: activeFile.path, x, y });
    },
    [activeFile],
  );

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // Fall through to the legacy path below.
    }
    // Fallback for non-secure contexts: a hidden textarea + execCommand.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      // Best effort — silently ignore.
    }
  }, []);

  const closeOthers = useCallback(
    (keepPath: string) => {
      // Snapshot first so we don't iterate while the array mutates.
      const toClose = files.filter((f) => f.path !== keepPath).map((f) => f.path);
      for (const path of toClose) onClose(path);
    },
    [files, onClose],
  );

  const closeAll = useCallback(() => {
    const toClose = files.map((f) => f.path);
    for (const path of toClose) onClose(path);
  }, [files, onClose]);

  const closeRight = useCallback(
    (anchorPath: string) => {
      const idx = files.findIndex((f) => f.path === anchorPath);
      if (idx < 0) return;
      const toClose = files.slice(idx + 1).map((f) => f.path);
      for (const path of toClose) onClose(path);
    },
    [files, onClose],
  );

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenu) return [];
    const targetPath = contextMenu.targetPath;
    const target = files.find((f) => f.path === targetPath) ?? null;
    if (!target) return [];

    const targetKind = getFilePreviewKind(targetPath);
    const previewSupported = targetKind !== null;
    const isBinary = isBinaryPreviewKind(targetKind);
    const targetIdx = files.findIndex((f) => f.path === targetPath);
    const hasOthers = files.length > 1;
    const hasRight = targetIdx >= 0 && targetIdx < files.length - 1;
    const fileName = target.path.split('/').pop() ?? target.path;
    const isActive = target.path === activeFilePath;

    if (contextMenu.kind === 'tab') {
      const items: ContextMenuItem[] = [
        {
          id: 'view-code',
          label: '以代码方式查看',
          disabled: isBinary,
          onSelect: () => {
            onActivate(targetPath);
            setPanelMode('code');
          },
        },
        {
          id: 'view-preview',
          label: '以预览方式查看',
          disabled: !previewSupported,
          onSelect: () => {
            onActivate(targetPath);
            setPanelMode('preview');
          },
        },
        { id: 'sep-1', type: 'separator' },
        {
          id: 'copy-path',
          label: '复制完整路径',
          onSelect: () => void copyToClipboard(targetPath),
        },
        {
          id: 'copy-name',
          label: '复制文件名',
          onSelect: () => void copyToClipboard(fileName),
        },
        { id: 'sep-2', type: 'separator' },
        {
          id: 'close',
          label: '关闭',
          shortcut: isActive ? '⌘W' : undefined,
          onSelect: () => onClose(targetPath),
        },
        {
          id: 'close-others',
          label: '关闭其他',
          disabled: !hasOthers,
          onSelect: () => closeOthers(targetPath),
        },
        {
          id: 'close-right',
          label: '关闭右侧',
          disabled: !hasRight,
          onSelect: () => closeRight(targetPath),
        },
        {
          id: 'close-all',
          label: '关闭全部',
          danger: true,
          onSelect: () => closeAll(),
        },
      ];
      return items;
    }

    // Preview body context menu.
    const items: ContextMenuItem[] = [
      {
        id: 'switch-code',
        label: '切换到代码视图',
        disabled: isBinary,
        onSelect: () => setPanelMode('code'),
      },
      { id: 'sep-1', type: 'separator' },
      {
        id: 'copy-content',
        label: '复制全部内容',
        disabled: isBinary,
        onSelect: () => void copyToClipboard(target.content),
      },
      {
        id: 'copy-path',
        label: '复制完整路径',
        onSelect: () => void copyToClipboard(targetPath),
      },
      {
        id: 'copy-name',
        label: '复制文件名',
        onSelect: () => void copyToClipboard(fileName),
      },
      { id: 'sep-2', type: 'separator' },
      {
        id: 'close',
        label: '关闭',
        shortcut: isActive ? '⌘W' : undefined,
        onSelect: () => onClose(targetPath),
      },
    ];
    return items;
  }, [
    contextMenu,
    files,
    activeFilePath,
    closeAll,
    closeOthers,
    closeRight,
    copyToClipboard,
    onActivate,
    onClose,
  ]);

  return (
    <section
      aria-label="文件编辑器"
      tabIndex={-1}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        outline: 'none',
      }}
      onKeyDown={handleKeyDown}
    >
      <EditorTabBar
        files={files}
        activeFilePath={activeFilePath}
        isDirty={isDirty}
        isPreviewAvailable={(path) => getFilePreviewKind(path) !== null}
        onActivate={onActivate}
        onClose={onClose}
        onPreview={handlePreview}
        onContextMenu={handleTabContextMenu}
        onReorder={onReorder}
        previewFilePath={effectivePanelMode === 'preview' ? activeFilePath : null}
      />
      {activeFile ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '4px 10px',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
              background: 'var(--bg-overlay)',
            }}
          >
            <FileBreadcrumb path={activeFile.path} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              {activePreviewKind ? (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: 2,
                    borderRadius: 8,
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={effectivePanelMode === 'code'}
                    onClick={() => setPanelMode('code')}
                    disabled={isBinaryPreviewKind(activePreviewKind)}
                    title={
                      isBinaryPreviewKind(activePreviewKind)
                        ? '二进制文件无法以代码形式查看'
                        : undefined
                    }
                    style={{
                      height: 24,
                      padding: '0 10px',
                      borderRadius: 6,
                      border: 'none',
                      background:
                        effectivePanelMode === 'code' ? 'var(--bg-overlay)' : 'transparent',
                      color: effectivePanelMode === 'code' ? 'var(--fg-strong)' : 'var(--fg-muted)',
                      fontSize: 11,
                      fontWeight: effectivePanelMode === 'code' ? 600 : 500,
                      cursor: isBinaryPreviewKind(activePreviewKind) ? 'not-allowed' : 'pointer',
                      opacity: isBinaryPreviewKind(activePreviewKind) ? 0.5 : 1,
                    }}
                  >
                    代码
                  </button>
                  <button
                    type="button"
                    aria-pressed={effectivePanelMode === 'preview'}
                    onClick={() => setPanelMode('preview')}
                    style={{
                      height: 24,
                      padding: '0 10px',
                      borderRadius: 6,
                      border: 'none',
                      background:
                        effectivePanelMode === 'preview' ? 'var(--bg-overlay)' : 'transparent',
                      color:
                        effectivePanelMode === 'preview' ? 'var(--fg-strong)' : 'var(--fg-muted)',
                      fontSize: 11,
                      fontWeight: effectivePanelMode === 'preview' ? 600 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    预览
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>当前文件暂不支持预览</span>
              )}
              {saveError && (
                <span style={{ fontSize: 11, color: 'var(--danger)' }}>{saveError}</span>
              )}
              {isDirty(activeFile.path) && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onSave(activeFile.path)}
                  style={{
                    height: 24,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--accent)',
                    color: 'var(--fg-on-accent)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? '保存中…' : '保存 ⌘S'}
                </button>
              )}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {effectivePanelMode === 'preview' && activePreviewKind ? (
              <FilePreviewPane
                path={activeFile.path}
                content={activeFile.content}
                onContextMenu={handlePreviewContextMenu}
              />
            ) : (
              <MonacoErrorBoundary>
                {(mountKey) => (
                  <Suspense
                    fallback={
                      <div style={{ padding: 24, fontSize: 12, color: 'var(--fg-muted)' }}>
                        加载编辑器…
                      </div>
                    }
                  >
                    <MonacoEditor
                      key={`${activeFile.path}::${mountKey}`}
                      height="100%"
                      language={activeFile.language}
                      value={activeFile.content}
                      theme={theme === 'light' ? 'vs' : 'vs-dark'}
                      onMount={(editor) => {
                        editorRef.current = editor;
                        // If a reveal was queued before the editor mounted
                        // (the common case for a fresh open), apply it now
                        // that the instance exists.
                        if (revealTarget && revealTarget.path === activeFile.path) {
                          requestAnimationFrame(() => {
                            if (applyReveal(revealTarget)) onRevealConsumed?.();
                          });
                        }
                      }}
                      onChange={(val) => {
                        if (val !== undefined) onChange(activeFile.path, val);
                      }}
                      options={{
                        fontSize: 12,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                        tabSize: 2,
                        renderWhitespace: 'none',
                        lineNumbers: 'on',
                        folding: true,
                        automaticLayout: true,
                        fixedOverflowWidgets: true,
                      }}
                    />
                  </Suspense>
                )}
              </MonacoErrorBoundary>
            )}
          </div>
        </>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
            color: 'var(--fg-muted)',
            fontSize: 12,
          }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ opacity: 0.4 }}
          >
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
          <span>从左侧文件树选择文件打开</span>
        </div>
      )}
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </section>
  );
}
