import React from 'react';
import {
  EditorBrowserWorkspace,
  type EditorPaneTab,
} from '../../../components/file-editor/EditorBrowserWorkspace.js';
import type { OpenFile, RevealTarget } from '../../../hooks/editor/useFileEditor.js';

export type { EditorPaneTab };

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
    revealTarget?: RevealTarget | null;
    clearRevealTarget?: () => void;
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
  /** Whether the editor workspace is currently in full-content mode. */
  fullScreen?: boolean;
  /** Toggle between full-content and split layouts. */
  onToggleFullScreen?: () => void;
  /** Optional file tree rendered inside the code tab. */
  fileTree?: React.ReactNode;
}

/**
 * Chat 页右侧分屏编辑器面板。
 *
 * 仅负责「分屏」专属的外壳:拖拽手柄 + 宽度过渡动画;内部真正的
 * 「代码/预览 tab + 编辑器 + 浏览器」交给可复用的 {@link EditorBrowserWorkspace}。
 * 全屏模式下 ChatPage 会直接渲染 EditorBrowserWorkspace、不经过本组件。
 */
export function ChatEditorPane({
  editorMode,
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
  fullScreen = false,
  onToggleFullScreen,
  fileTree,
}: ChatEditorPaneProps) {
  // 全屏时编辑器占满内容区,既不需要拖拽手柄也不需要为对话列留出宽度。
  const splitHandleVisible = editorMode && !fullScreen;
  return (
    <>
      <button
        type="button"
        aria-label="拖动调整编辑器宽度"
        onMouseDown={handleSplitMouseDown}
        disabled={!splitHandleVisible}
        style={{
          width: splitHandleVisible ? 5 : 0,
          flexShrink: 0,
          cursor: splitHandleVisible ? 'col-resize' : 'default',
          background: 'var(--border-subtle)',
          transition: splitDragging.current
            ? 'none'
            : 'width 240ms ease, opacity 180ms ease, background 150ms ease',
          zIndex: 10,
          border: 'none',
          padding: 0,
          opacity: splitHandleVisible ? 1 : 0,
          pointerEvents: splitHandleVisible ? 'auto' : 'none',
        }}
      />
      <div
        ref={editorPaneRef}
        aria-hidden={!editorMode}
        style={{
          flex: editorMode && fullScreen ? 1 : '0 0 auto',
          width: fullScreen
            ? editorMode
              ? '100%'
              : 0
            : editorMode
              ? 'calc(100% - var(--split-pos) - 2.5px)'
              : 0,
          minWidth: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          borderLeft:
            editorMode && !fullScreen ? '1px solid var(--border-default)' : '1px solid transparent',
          opacity: editorMode ? 1 : 0,
          transform: editorMode ? 'translateX(0)' : 'translateX(10px)',
          pointerEvents: editorMode ? 'auto' : 'none',
          transition: splitDragging.current
            ? 'none'
            : 'width 240ms ease, opacity 180ms ease, transform 240ms ease, border-color 180ms ease',
        }}
      >
        <EditorBrowserWorkspace
          fileEditor={fileEditor}
          saving={saving}
          handleSaveFile={handleSaveFile}
          browserPreviewUrl={browserPreviewUrl}
          workspacePath={workspacePath}
          activeTab={activeTab}
          onTabChange={onTabChange}
          fullScreen={fullScreen}
          onToggleFullScreen={onToggleFullScreen}
          fileTree={fileTree}
        />
      </div>
    </>
  );
}
