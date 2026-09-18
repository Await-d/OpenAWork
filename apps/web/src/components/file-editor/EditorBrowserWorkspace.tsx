import React, { useEffect, useState } from 'react';
import { FileEditorPanel } from './editor/FileEditorPanel.js';
import { BuiltInBrowser } from '../chat/misc/BuiltInBrowser.js';
import { normalizeBrowserPreviewInput } from '../chat/misc/browser/browser-url.js';
import { ResizeHandle } from '../layout/shared/resize-handle.js';
import {
  FILE_TREE_WIDTH_DEFAULT,
  FILE_TREE_WIDTH_MAX,
  FILE_TREE_WIDTH_MIN,
} from './workspace-resize.js';
import type { OpenFile, RevealTarget } from '../../hooks/editor/useFileEditor.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import './editor-browser-workspace.css';

export type EditorPaneTab = 'code' | 'browser';

export interface FileTreeWidthBounds {
  readonly min: number;
  readonly max: number;
}

const FILE_TREE_WIDTH_BOUNDS: FileTreeWidthBounds = {
  min: FILE_TREE_WIDTH_MIN,
  max: FILE_TREE_WIDTH_MAX,
};

function clampWidthToBounds(width: number, bounds: FileTreeWidthBounds): number {
  if (!Number.isFinite(width)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, width));
}

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
   * 本实例声明的浏览器宿主面。全应用同一时刻只有 `browserPreviewSurface` 与之一致
   * 的那一个实例挂载 `BuiltInBrowser`：停靠面板的工作区 pane 传 `'dock'`，主内容区
   * / 团队页 / 移动端文件 tab 缺省 `'editor'`。
   */
  browserSurface?: 'editor' | 'dock';
  /**
   * 缺省 `false`：没有预览地址且从未挂载过浏览器时不出现「预览」子 tab
   * （主内容区 / 移动端保持既有行为）。停靠面板传 `true`，让工作区在没有地址时
   * 也永远有一个可见的预览入口。
   */
  alwaysShowBrowserTab?: boolean;
  /**
   * 缺省 `false`：渲染内建「代码 / 预览」两个子 tab 按钮。停靠面板传 `true` ——
   * 一级 tab 条（审查 / 代码 / 预览 / Context）是唯一切换 UI，子 tab 按钮必须隐藏，
   * 避免出现两层切换；隐藏的只是按钮，全屏按钮仍照常渲染。
   */
  hidePaneTabs?: boolean;
  /**
   * 空态里用户提交预览地址时的回调（已补全 scheme）。缺省时不渲染地址输入 ——
   * 主内容区 / 移动端的空态行为因此保持原样；停靠面板把它写回当前 workspace 的
   * 预览 URL。
   */
  onBrowserPreviewUrlChange?: (url: string | null) => void;
  /**
   * Whether the workspace is currently rendered full-width (occupying the
   * whole content area). Drives the fullscreen toggle's pressed state /
   * icon. Optional — when `onToggleFullScreen` is omitted no toggle shows.
   */
  fullScreen?: boolean;
  /** Toggle between full-content and split layouts. */
  onToggleFullScreen?: () => void;
  /**
   * Optional file tree rendered to the left of the code editor
   * (e.g. a workspace file explorer in the chat editor pane).
   */
  fileTree?: React.ReactNode;
  /**
   * Initial width of the file tree column. Callers embedding the workspace in a
   * narrow pane (e.g. the dock side panel) pass a smaller value.
   */
  fileTreeInitialWidth?: number;
  /**
   * Width bounds of the file tree column. Narrow panes pass tighter bounds so
   * the editor column always keeps usable width.
   */
  fileTreeWidthBounds?: FileTreeWidthBounds;
}

export function EditorBrowserWorkspace({
  fileEditor,
  saving,
  handleSaveFile,
  browserPreviewUrl,
  workspacePath,
  activeTab = 'code',
  onTabChange,
  browserSurface = 'editor',
  alwaysShowBrowserTab = false,
  hidePaneTabs = false,
  onBrowserPreviewUrlChange,
  fullScreen = false,
  onToggleFullScreen,
  fileTree,
  fileTreeInitialWidth,
  fileTreeWidthBounds,
}: EditorBrowserWorkspaceProps) {
  const [localTab, setLocalTab] = useState<EditorPaneTab>('code');
  const currentTab = onTabChange ? activeTab : localTab;
  const setCurrentTab = onTabChange ?? setLocalTab;

  // ── File tree resizable width ──────────────────────────────────────
  // 约束在 workspace-resize.ts，拖拽/键盘由共享 ResizeHandle 提供。
  const treeBounds = fileTreeWidthBounds ?? FILE_TREE_WIDTH_BOUNDS;
  const [fileTreeWidth, setFileTreeWidth] = useState(
    fileTreeInitialWidth ?? FILE_TREE_WIDTH_DEFAULT,
  );

  // 容器变窄（分栏拖动 / 停靠面板宽度变化）时把已有宽度重新钳回新区间，
  // 否则文件树会越过 45% 上限把编辑器压到不可用。
  useEffect(() => {
    setFileTreeWidth((width) => clampWidthToBounds(width, treeBounds));
  }, [treeBounds.min, treeBounds.max]);

  // Keep browser mounted once activated (preserves page state across tab switches)
  const [browserMounted, setBrowserMounted] = useState(false);
  // 单一浏览器互斥：BuiltInBrowser 持有唯一的网关实时会话，全应用同一时刻最多
  // 挂载一份。每个实例声明自己的宿主面（editor / dock），只有与 store 中当前激活
  // 宿主一致的实例才挂载浏览器；停靠面板卸载归还 'editor' 后由主内容区接管。
  const activeBrowserSurface = useUIStateStore((s) => s.browserPreviewSurface);
  const ownsBrowserSurface = browserSurface === activeBrowserSurface;
  const showBrowserTab =
    (!!browserPreviewUrl || browserMounted || alwaysShowBrowserTab) && ownsBrowserSurface;

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

  // 无地址时的预览入口：只有宿主提供了写回回调才渲染（主内容区 / 移动端缺省不渲染）。
  const showBrowserEmptyState =
    effectiveTab === 'browser' && !browserPreviewUrl && !!onBrowserPreviewUrlChange;

  // 停靠面板（`hidePaneTabs`）把子 tab 与全屏入口都移到面板一级 tab 条上，本组件
  // 完全不渲染内部工具条，避免在 tab 条与内容之间残留一条只有图标的空行；主内容区 /
  // 移动端保持原工具条（子 tab + 内建全屏按钮）。
  const showToolbar = !hidePaneTabs && (showBrowserTab || !!onToggleFullScreen);

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
          data-testid="editor-browser-workspace-toolbar"
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
          flexDirection: 'row',
          overflow: 'hidden',
        }}
      >
        {fileTree && (
          <div
            style={{
              width: fileTreeWidth,
              flexShrink: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {fileTree}
          </div>
        )}
        {fileTree && (
          <div
            style={{
              width: 4,
              flexShrink: 0,
              cursor: 'col-resize',
              background: 'var(--border-subtle)',
              position: 'relative',
              zIndex: 5,
            }}
          >
            <ResizeHandle
              width={fileTreeWidth}
              bounds={{ ...treeBounds, default: fileTreeInitialWidth ?? FILE_TREE_WIDTH_DEFAULT }}
              clamp={(width) => clampWidthToBounds(width, treeBounds)}
              ariaLabel="调整文件树宽度"
              onWidthChange={setFileTreeWidth}
              onWidthCommit={setFileTreeWidth}
            />
          </div>
        )}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
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
            workspacePath={workspacePath ?? null}
          />
        </div>
      </div>

      {/* Browser preview — stays mounted once activated */}
      {browserMounted &&
        ownsBrowserSurface &&
        // 提供空态回调的宿主（停靠面板）在无地址时用空态替代浏览器，避免出现
        // 一个没有地址栏来源的空白浏览器；主内容区 / 移动端保持原行为。
        (!!browserPreviewUrl || !onBrowserPreviewUrlChange) && (
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

      {showBrowserEmptyState && onBrowserPreviewUrlChange ? (
        <BrowserPreviewEmptyState onSubmit={onBrowserPreviewUrlChange} />
      ) : null}
    </div>
  );
}

function BrowserPreviewEmptyState({ onSubmit }: { onSubmit: (url: string) => void }) {
  const [draftUrl, setDraftUrl] = useState('');
  const normalizedDraftUrl = normalizeBrowserPreviewInput(draftUrl);

  return (
    <div className="editor-browser-workspace__empty" data-testid="editor-browser-empty-state">
      <span className="editor-browser-workspace__empty-icon" aria-hidden="true">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </span>
      <div className="editor-browser-workspace__empty-copy">
        <strong>还没有预览地址</strong>
        <span>
          在对话里执行 /open &lt;url&gt;、让 Agent 启动 dev server 自动检测端口，或直接填入地址。
        </span>
      </div>
      <form
        className="editor-browser-workspace__empty-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (normalizedDraftUrl === null) {
            return;
          }
          onSubmit(normalizedDraftUrl);
          setDraftUrl('');
        }}
      >
        <input
          className="editor-browser-workspace__empty-input"
          type="text"
          value={draftUrl}
          aria-label="预览地址"
          placeholder="http://localhost:5173"
          onChange={(event) => setDraftUrl(event.target.value)}
        />
        <button
          className="editor-browser-workspace__empty-submit"
          type="submit"
          disabled={normalizedDraftUrl === null}
        >
          打开预览
        </button>
      </form>
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
        borderRadius: 6,
        border: active ? '1px solid var(--border-default)' : '1px solid transparent',
        background: active ? 'var(--bg-raised)' : 'transparent',
        boxShadow: active ? 'var(--shadow-sm)' : 'none',
        color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
        fontSize: 11,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        transition:
          'color 100ms ease, border-color 100ms ease, background 100ms ease, box-shadow 100ms ease',
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
