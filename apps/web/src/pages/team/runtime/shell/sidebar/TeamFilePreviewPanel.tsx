/**
 * 260530-team-page · Wave 2 · TeamFilePreviewPanel（F5 文件内联预览面板）
 *
 * 浮层式文件预览：单击文件树节点时从右侧滑出，复用 FilePreviewPane（文本/md/
 * 代码/图片/SVG/JSON/二进制 notice 全分支）。
 *
 * 与"打开到编辑器"并存：单击预览（轻量、不进 tab），用户可在面板内点
 * "在编辑器中打开" 走 onOpenInEditor 进完整编辑器。
 */

import { type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { FilePreviewPane } from '../../../../../components/file-editor/preview/FilePreviewPane.js';
import { EmptyState } from '../../shared/content-kit/index.js';

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(560px, 60vw)',
  zIndex: 120,
  display: 'flex',
  flexDirection: 'column',
  background: 'color-mix(in srgb, var(--bg-overlay) 97%, var(--bg-base))',
  borderLeft: '1px solid color-mix(in srgb, var(--border-default) 70%, transparent)',
  boxShadow: 'var(--shadow-lg)',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  flexShrink: 0,
};

const BTN_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};

export interface TeamFilePreviewPanelProps {
  path: string | null;
  content: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  /** "在编辑器中打开" 回调；不传则不显示该按钮。 */
  onOpenInEditor?: (path: string) => void;
}

export function TeamFilePreviewPanel({
  path,
  content,
  loading,
  error,
  onClose,
  onOpenInEditor,
}: TeamFilePreviewPanelProps) {
  if (!path) return null;

  const filename = path.split('/').pop() ?? path;

  const body = (
    <div style={OVERLAY_STYLE} role="dialog" aria-label={`预览 ${filename}`}>
      <header style={HEADER_STYLE}>
        <span aria-hidden style={{ fontSize: 14 }}>
          📄
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--fg-strong)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={path}
        >
          {filename}
        </span>
        {onOpenInEditor ? (
          <button type="button" style={BTN_STYLE} onClick={() => onOpenInEditor(path)}>
            在编辑器中打开
          </button>
        ) : null}
        <button
          type="button"
          style={BTN_STYLE}
          onClick={onClose}
          aria-label="关闭预览"
          title="关闭预览"
        >
          ✕
        </button>
      </header>

      {error ? (
        <div
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: 'var(--warning)',
            background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)',
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div
          style={{
            flex: 1,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--fg-muted)',
            fontSize: 12,
          }}
        >
          加载文件内容…
        </div>
      ) : error && !content ? (
        <EmptyState
          emoji="⚠️"
          title="无法预览"
          description={error}
          style={{ flex: 1, margin: 12 }}
        />
      ) : (
        <FilePreviewPane path={path} content={content} />
      )}
    </div>
  );

  return createPortal(body, document.body);
}
