import React, { useEffect, useState } from 'react';
import { FileEditorPanel } from '../../../components/file-editor/editor/FileEditorPanel.js';
import { BuiltInBrowser } from '../../../components/chat/misc/BuiltInBrowser.js';
import type { OpenFile } from '../../../hooks/editor/useFileEditor.js';

export type EditorPaneTab = 'code' | 'browser';

export interface ChatEditorPaneProps {
  editorMode: boolean;
  splitPos: number;
  splitDragging: React.MutableRefObject<boolean>;
  editorPaneRef: React.RefObject<HTMLDivElement | null>;
  handleSplitMouseDown: (e: React.MouseEvent) => void;
  fileEditor: {
    openFiles: OpenFile[];
    activeFile: OpenFile | null;
    activeFilePath: string | null;
    isDirty: (path: string) => boolean;
    saveError: string | null;
    setActiveFilePath: (path: string | null) => void;
    closeFile: (path: string) => void;
    updateContent: (path: string, content: string) => void;
    reorderFiles?: (fromIndex: number, toIndex: number) => void;
  };
  saving: boolean;
  handleSaveFile: (path: string) => Promise<void>;
  /** Browser preview URL — when set, shows a browser tab in the editor pane. */
  browserPreviewUrl?: string | null;
  /** Current workspace path — used to namespace BuiltInBrowser tabs storage. */
  workspacePath?: string | null;
  /** Active tab in the editor pane. */
  activeTab?: EditorPaneTab;
  /** Callback when the active tab changes. */
  onTabChange?: (tab: EditorPaneTab) => void;
}

export function ChatEditorPane({
  editorMode,
  splitPos,
  splitDragging,
  editorPaneRef,
  handleSplitMouseDown,
  fileEditor,
  saving,
  handleSaveFile,
  browserPreviewUrl,
  workspacePath,
  activeTab = 'code',
  onTabChange,
}: ChatEditorPaneProps) {
  const [localTab, setLocalTab] = useState<EditorPaneTab>('code');
  const currentTab = onTabChange ? activeTab : localTab;
  const setCurrentTab = onTabChange ?? setLocalTab;

  // Keep browser mounted once activated (preserves page state across tab switches)
  const [browserMounted, setBrowserMounted] = useState(false);
  const showBrowserTab = !!browserPreviewUrl || browserMounted;

  // Auto-switch to browser tab only when browserPreviewUrl is *newly* set
  // (e.g. dev-server detect 推入或用户主动打开)。挂载时 url 已存在(刷新后从持久化
  // 恢复)的情况不切 tab,以保留用户上次留下的 code/browser 选择。
  const previousBrowserUrlRef = React.useRef<string | null | undefined>(browserPreviewUrl);
  useEffect(() => {
    const prev = previousBrowserUrlRef.current;
    previousBrowserUrlRef.current = browserPreviewUrl;
    if (browserPreviewUrl) {
      setBrowserMounted(true);
      // 只有从无到有才切 tab(用户主动触发)。
      if (!prev) {
        setCurrentTab('browser');
      }
    }
  }, [browserPreviewUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button
        type="button"
        aria-label="拖动调整编辑器宽度"
        onMouseDown={handleSplitMouseDown}
        disabled={!editorMode}
        style={{
          width: editorMode ? 5 : 0,
          flexShrink: 0,
          cursor: editorMode ? 'col-resize' : 'default',
          background: 'var(--border-subtle)',
          transition: splitDragging.current
            ? 'none'
            : 'width 240ms ease, opacity 180ms ease, background 150ms ease',
          zIndex: 10,
          border: 'none',
          padding: 0,
          opacity: editorMode ? 1 : 0,
          pointerEvents: editorMode ? 'auto' : 'none',
        }}
      />
      <div
        ref={editorPaneRef}
        aria-hidden={!editorMode}
        style={{
          flex: '0 0 auto',
          width: editorMode ? 'calc(100% - var(--split-pos) - 2.5px)' : 0,
          minWidth: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: editorMode ? '1px solid var(--border-default)' : '1px solid transparent',
          opacity: editorMode ? 1 : 0,
          transform: editorMode ? 'translateX(0)' : 'translateX(10px)',
          pointerEvents: editorMode ? 'auto' : 'none',
          transition: splitDragging.current
            ? 'none'
            : 'width 240ms ease, opacity 180ms ease, transform 240ms ease, border-color 180ms ease',
        }}
      >
        {/* Tab bar when browser preview is available */}
        {showBrowserTab && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-overlay)',
              flexShrink: 0,
              padding: '0 4px',
              minHeight: 32,
            }}
          >
            <EditorPaneTabButton
              label="代码"
              icon={
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              }
              active={currentTab === 'code'}
              onClick={() => setCurrentTab('code')}
            />
            <EditorPaneTabButton
              label="预览"
              icon={
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              }
              active={currentTab === 'browser'}
              onClick={() => setCurrentTab('browser')}
              badge
            />
          </div>
        )}

        {/* Code editor */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: currentTab === 'code' ? 'flex' : 'none',
            flexDirection: 'column',
          }}
        >
          <FileEditorPanel
            files={fileEditor.openFiles}
            activeFile={fileEditor.activeFile}
            activeFilePath={fileEditor.activeFilePath}
            isDirty={fileEditor.isDirty}
            saving={saving}
            saveError={fileEditor.saveError}
            onActivate={fileEditor.setActiveFilePath}
            onClose={fileEditor.closeFile}
            onChange={fileEditor.updateContent}
            onSave={handleSaveFile}
            onReorder={fileEditor.reorderFiles}
          />
        </div>

        {/* Browser preview — stays mounted once activated */}
        {browserMounted && (
          <BuiltInBrowser
            style={{
              flex: 1,
              minHeight: 0,
              display: currentTab === 'browser' ? 'flex' : 'none',
            }}
            previewUrl={browserPreviewUrl}
            workspacePath={workspacePath}
            hidden={currentTab !== 'browser'}
          />
        )}
      </div>
    </>
  );
}

function EditorPaneTabButton({
  label,
  icon,
  active,
  onClick,
  badge = false,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 28,
        padding: '0 10px',
        borderRadius: '6px 6px 0 0',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        background: active ? 'color-mix(in oklch, var(--accent) 6%, transparent)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--fg-muted)',
        fontSize: 11,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        transition: 'color 100ms ease, border-color 100ms ease, background 100ms ease',
        position: 'relative',
      }}
    >
      {icon}
      {label}
      {badge && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--accent)',
            position: 'absolute',
            top: 5,
            right: 5,
          }}
        />
      )}
    </button>
  );
}
