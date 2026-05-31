import { type CSSProperties } from 'react';
import { EditorBrowserWorkspace, type EditorPaneTab } from './EditorBrowserWorkspace.js';
import type { OpenFile, RevealTarget } from '../../hooks/editor/useFileEditor.js';

/**
 * 全屏文件编辑/浏览工作区浮层。
 *
 * 复用 {@link EditorBrowserWorkspace}(与 chat 页同一套文件查阅 + 浏览器能力),
 * 以「占据整个内容区域」的方式渲染。供 team 页等没有内置分屏编辑器的场景挂载:
 * 点击文件树节点时铺满内容区打开真正的编辑器,而不是窄边栏只读预览。
 *
 * 纯展示组件 —— 文件状态由调用方的 `useFileEditor` 拥有并通过 props 传入。
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
}: WorkspaceEditorOverlayProps) {
  if (!open) return null;

  const activePath = fileEditor.activeFile?.path ?? null;
  const activeName = activePath ? (activePath.split('/').pop() ?? activePath) : null;

  return (
    <div style={OVERLAY_STYLE} role="dialog" aria-label={title}>
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
      />
    </div>
  );
}
