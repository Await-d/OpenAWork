import React, { useEffect, useState } from 'react';
import { FileEditorPanel } from './editor/FileEditorPanel.js';
import { BuiltInBrowser } from '../chat/misc/BuiltInBrowser.js';
import type { OpenFile, RevealTarget } from '../../hooks/editor/useFileEditor.js';

export type EditorPaneTab = 'code' | 'browser';

/**
 * 编辑器 + 内置浏览器的可复用工作区。
 *
 * 把原先内嵌在 `ChatEditorPane` 里的「代码/预览 tab + FileEditorPanel +
 * BuiltInBrowser」整体抽离出来,让两种布局共享同一份实现:
 *
 *   1. **分屏模式**(chat 页占内容区一半):由 `ChatEditorPane` 包裹拖拽手柄
 *      与宽度计算后渲染本组件。
 *   2. **全屏模式**(占据整个内容区):由 `ChatPage` 直接渲染本组件,铺满。
 *
 * 复用 `useFileEditor` 的文件状态与 `BuiltInBrowser` 的浏览器能力 —— 与
 * chat 中的文件查阅 / 浏览器预览是同一套数据来源,不重复造轮子。
 */
export interface EditorBrowserWorkspaceProps {
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
    revealTarget?: RevealTarget | null;
    clearRevealTarget?: () => void;
  };
  saving: boolean;
  handleSaveFile: (path: string) => Promise<void>;
  /** Browser preview URL — when set, shows a browser tab in the workspace. */
  browserPreviewUrl?: string | null;
  /** Current workspace path — used to namespace BuiltInBrowser tabs storage. */
  workspacePath?: string | null;
  /** Active tab in the workspace. */
  activeTab?: EditorPaneTab;
  /** Callback when the active tab changes. */
  onTabChange?: (tab: EditorPaneTab) => void;
  /**
   * Whether the workspace is currently rendered full-width (occupying the
   * whole content area). Drives the fullscreen toggle's pressed state /
   * icon. Optional — when `onToggleFullScreen` is omitted no toggle shows.
   */
  fullScreen?: boolean;
  /** Toggle between full-content and split layouts. */
  onToggleFullScreen?: () => void;
}

export function EditorBrowserWorkspace({
  fileEditor,
  saving,
  handleSaveFile,
  browserPreviewUrl,
  workspacePath,
  activeTab = 'code',
  onTabChange,
  fullScreen = false,
  onToggleFullScreen,
}: EditorBrowserWorkspaceProps) {
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

  // 当浏览器 tab 不可用(无 URL 且从未挂载)时,工作区只剩代码视图;
  // 此时即便外部 activeTab 仍记着 'browser' 也回落到 'code',避免空白。
  const effectiveTab: EditorPaneTab =
    currentTab === 'browser' && !showBrowserTab ? 'code' : currentTab;

  // 只有「需要 tab 栏」或「需要全屏切换按钮」时才渲染顶部工具条。
  const showToolbar = showBrowserTab || !!onToggleFullScreen;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {showToolbar && (
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
          {showBrowserTab && (
            <>
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
                active={effectiveTab === 'code'}
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
                active={effectiveTab === 'browser'}
                onClick={() => setCurrentTab('browser')}
                badge
              />
            </>
          )}

          {onToggleFullScreen && (
            <button
              type="button"
              onClick={onToggleFullScreen}
              aria-pressed={fullScreen}
              title={fullScreen ? '退出全屏 · 恢复分屏对话' : '全屏 · 占据整个内容区'}
              aria-label={fullScreen ? '退出全屏' : '全屏'}
              style={{
                marginLeft: 'auto',
                width: 26,
                height: 26,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                border: fullScreen
                  ? '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-default))'
                  : '1px solid transparent',
                background: fullScreen
                  ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                  : 'transparent',
                color: fullScreen ? 'var(--accent)' : 'var(--fg-muted)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {fullScreen ? (
                <svg
                  aria-hidden="true"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
          )}
        </div>
      )}

      {/* Code editor */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: effectiveTab === 'code' ? 'flex' : 'none',
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
          revealTarget={fileEditor.revealTarget ?? null}
          onRevealConsumed={fileEditor.clearRevealTarget}
        />
      </div>

      {/* Browser preview — stays mounted once activated */}
      {browserMounted && (
        <BuiltInBrowser
          style={{
            flex: 1,
            minHeight: 0,
            display: effectiveTab === 'browser' ? 'flex' : 'none',
          }}
          previewUrl={browserPreviewUrl}
          workspacePath={workspacePath}
          hidden={effectiveTab !== 'browser'}
        />
      )}
    </div>
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
