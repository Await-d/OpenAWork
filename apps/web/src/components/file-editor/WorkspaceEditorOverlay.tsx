import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { EditorBrowserWorkspace, type EditorPaneTab } from './EditorBrowserWorkspace.js';
import { ResizeHandle } from '../layout/shared/resize-handle.js';
import {
  clampEditorWidthPx,
  editorWidthBoundsPx,
  splitPosFromEditorWidthPx,
  splitPosToEditorWidthPx,
} from './workspace-resize.js';
import type { OpenFile, RevealTarget } from '../../hooks/editor/useFileEditor.js';

/**
 * 全屏文件编辑/浏览工作区浮层。
 *
 * 复用 {@link EditorBrowserWorkspace}(与 chat 页同一套文件查阅 + 浏览器能力),
 * 以「占据整个内容区域」的方式渲染。供 team 页等没有内置分屏编辑器的场景挂载:
 * 点击文件树节点时铺满内容区打开真正的编辑器,而不是窄边栏只读预览。
 *
 * 纯展示组件 —— 文件状态由调用方的 `useFileEditor` 拥有并通过 props 传入。
 *
 * 除了传统的全屏覆盖模式(`mode='overlay'`),还支持分屏模式(`mode='split'`),
 * 此时编辑器作为 flex 兄弟节点与对话区并排,可通过拖拽 resizer 调整宽度。
 */
export interface WorkspaceEditorOverlayProps {
  /** 是否显示浮层。 */
  open: boolean;
  /** 关闭浮层回调。 */
  onClose: () => void;
  /** 当前工作区路径(用于浏览器 tab 持久化命名)。 */
  workspacePath?: string | null;
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
  onSave: (path: string) => Promise<void>;
  /** 浏览器预览 URL —— 有值时工作区会出现浏览器 tab。team 默认不传。 */
  browserPreviewUrl?: string | null;
  /** 工作区当前激活 tab。 */
  activeTab?: EditorPaneTab;
  onTabChange?: (tab: EditorPaneTab) => void;
  /** 浮层标题(默认「文件编辑器」)。 */
  title?: string;
  /**
   * 渲染模式:
   * - `'overlay'`(默认): absolute 覆盖整个父容器,编辑器与对话区互斥。
   * - `'split'`: flex 兄弟节点,与对话区并排,可拖拽调整宽度。
   */
  mode?: 'overlay' | 'split';
  /** split 模式下的初始宽度百分比(20-80,默认 50)。 */
  splitPos?: number;
  /** split 模式下拖拽结束时回调,用于持久化宽度。 */
  onSplitPosChange?: (pos: number) => void;
  /** 切换模式(overlay ↔ split)回调。不传则不显示切换按钮。 */
  onModeChange?: (mode: 'overlay' | 'split') => void;
  /** Optional file tree rendered inside the code tab (same as EditorBrowserWorkspace). */
  fileTree?: ReactNode;
}

const OVERLAY_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 90,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-base)',
  overflow: 'hidden',
};

/** split 模式:作为 flex 兄弟节点,不覆盖对话区 */
const SPLIT_STYLE: CSSProperties = {
  position: 'relative',
  zIndex: 90,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-base)',
  overflow: 'hidden',
  flexShrink: 0,
};

/** split 模式:拖拽手柄的定位容器 */
const RESIZER_STYLE: CSSProperties = {
  width: 4,
  flexShrink: 0,
  cursor: 'col-resize',
  background: 'transparent',
  position: 'relative',
  zIndex: 91,
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  flexShrink: 0,
  minHeight: 44,
};

const CLOSE_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 12px',
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};

export function WorkspaceEditorOverlay({
  open,
  onClose,
  workspacePath,
  fileEditor,
  saving,
  onSave,
  browserPreviewUrl,
  activeTab,
  onTabChange,
  title = '文件编辑器',
  mode = 'overlay',
  splitPos: splitPosProp = 50,
  onSplitPosChange,
  onModeChange,
  fileTree,
}: WorkspaceEditorOverlayProps) {
  // ─── split 模式宽度 ───
  const [splitPos, setSplitPos] = useState(splitPosProp);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 持久化值是百分比，而 ResizeHandle 以像素增量驱动拖拽，故需跟踪行宽做换算。
  const [rowWidthPx, setRowWidthPx] = useState(0);

  // 同步外部 splitPos 变化
  useEffect(() => {
    setSplitPos(splitPosProp);
  }, [splitPosProp]);

  useEffect(() => {
    if (mode !== 'split' || !open) return;
    const row = containerRef.current?.parentElement;
    if (!row) return;
    const measure = () => setRowWidthPx(row.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [mode, open]);

  if (!open) return null;

  const activePath = fileEditor.activeFile?.path ?? null;
  const activeName = activePath ? (activePath.split('/').pop() ?? activePath) : null;

  const isSplit = mode === 'split';
  const containerStyle = isSplit ? SPLIT_STYLE : OVERLAY_STYLE;
  const editorWidth = isSplit ? `${100 - splitPos}%` : undefined;

  const content = (
    <div
      ref={containerRef}
      style={{ ...containerStyle, ...(isSplit ? { width: editorWidth } : {}) }}
      role="dialog"
      aria-label={title}
    >
      <header style={HEADER_STYLE}>
        <span aria-hidden style={{ fontSize: 0, color: 'var(--fg-muted)' }}>
          <svg
            width="14"
            height="14"
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
        </span>
        <strong
          style={{ fontSize: 13, color: 'var(--fg-strong)', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {title}
        </strong>
        {activeName ? (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              color: 'var(--fg-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={activePath ?? undefined}
          >
            {activeName}
          </span>
        ) : (
          <span style={{ flex: 1, minWidth: 0 }} />
        )}
        {onModeChange ? (
          <button
            type="button"
            style={{ ...CLOSE_BTN_STYLE, marginRight: 4 }}
            onClick={() => onModeChange(isSplit ? 'overlay' : 'split')}
            aria-label={isSplit ? '切换为全屏覆盖' : '切换为分屏'}
            title={isSplit ? '切换为全屏覆盖' : '切换为分屏'}
          >
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
              {isSplit ? (
                <>
                  <rect x="2" y="3" width="20" height="18" rx="2" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                </>
              ) : (
                <>
                  <rect x="2" y="3" width="20" height="18" rx="2" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                </>
              )}
            </svg>
          </button>
        ) : null}
        <button type="button" style={CLOSE_BTN_STYLE} onClick={onClose} aria-label="关闭编辑器">
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          关闭
        </button>
      </header>

      <EditorBrowserWorkspace
        fileEditor={fileEditor}
        saving={saving}
        handleSaveFile={onSave}
        browserPreviewUrl={browserPreviewUrl}
        workspacePath={workspacePath}
        activeTab={activeTab}
        onTabChange={onTabChange}
        fileTree={fileTree}
      />
    </div>
  );

  // split 模式:返回 resizer + editor 的片段,由父容器 flex 排列
  if (isSplit) {
    return (
      <>
        <div style={RESIZER_STYLE}>
          <ResizeHandle
            width={splitPosToEditorWidthPx(splitPos, rowWidthPx)}
            bounds={editorWidthBoundsPx(rowWidthPx)}
            clamp={(widthPx) => clampEditorWidthPx(widthPx, rowWidthPx)}
            ariaLabel="调整编辑器宽度"
            onWidthChange={(widthPx) =>
              setSplitPos(splitPosFromEditorWidthPx(widthPx, rowWidthPx))
            }
            onWidthCommit={(widthPx) =>
              onSplitPosChange?.(splitPosFromEditorWidthPx(widthPx, rowWidthPx))
            }
          />
        </div>
        {content}
      </>
    );
  }

  // overlay 模式:直接返回覆盖层
  return content;
}
