import type { ReactNode } from 'react';
import { PREVIEW_MAX_ZOOM, PREVIEW_MIN_ZOOM } from './use-preview-zoom.js';

/**
 * 文件预览的通用工具栏骨架：左侧「类型 + 徽标」，右侧操作区。
 *
 * 图表（Mermaid）与矢量图（SVG）共用同一套工具栏与缩放手感，这里只负责
 * 排版与状态样式，具体按钮由调用方通过 children 传入。
 */
export function PreviewToolbar({
  label,
  badge,
  children,
}: {
  label: string;
  /** 右侧徽标：图表类型、图形尺寸等随内容变化的信息。 */
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="oaw-preview-toolbar">
      <div className="oaw-preview-toolbar-meta">
        <span className="oaw-preview-label">{label}</span>
        {badge !== undefined && badge !== null && (
          <span className="oaw-preview-badge">{badge}</span>
        )}
      </div>
      <div className="oaw-preview-actions">{children}</div>
    </div>
  );
}

/** 缩放控件组：缩小 / 百分比（点击复位）/ 放大 / 适应宽度。 */
export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  label,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
  /** 无障碍名称，如「图表缩放」「矢量图缩放」。 */
  label: string;
}) {
  return (
    <div className="oaw-preview-zoom" role="group" aria-label={label}>
      <button
        type="button"
        className="oaw-preview-btn"
        aria-label="缩小"
        disabled={zoom <= PREVIEW_MIN_ZOOM}
        onClick={onZoomOut}
      >
        −
      </button>
      <button
        type="button"
        className="oaw-preview-btn oaw-preview-zoom-value"
        title="恢复到 100%"
        onClick={onReset}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="oaw-preview-btn"
        aria-label="放大"
        disabled={zoom >= PREVIEW_MAX_ZOOM}
        onClick={onZoomIn}
      >
        ＋
      </button>
      <button
        type="button"
        className="oaw-preview-btn"
        title="缩放到刚好占满可用宽度"
        onClick={onFit}
      >
        适应宽度
      </button>
    </div>
  );
}
