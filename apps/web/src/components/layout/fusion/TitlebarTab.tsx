/**
 * TitlebarTab — 单个会话标签组件。
 *
 * 功能：
 *  - 标题截断（max-width + ellipsis）
 *  - 关闭按钮（hover 时显示）
 *  - 拖拽手柄（HTML5 drag/drop，用于标签排序）
 *  - 活跃高亮
 *  - draft 状态指示（未关联 session 的草稿标签）
 */

import type { SessionTab } from '../../../stores/ui/uiState.js';

export interface TitlebarTabProps {
  tab: SessionTab;
  active: boolean;
  index: number;
  onClick: () => void;
  onClose: () => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
}

export function TitlebarTab({
  tab,
  active,
  index,
  onClick,
  onClose,
  onDragStart,
  onDragOver,
  onDrop,
}: TitlebarTabProps) {
  const isDraft = tab.type === 'draft';

  return (
    <div
      role="tab"
      aria-selected={active}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onClick={onClick}
      title={tab.title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 4px 0 10px',
        height: 28,
        minHeight: 28,
        borderRadius: 6,
        background: active
          ? 'color-mix(in oklch, var(--accent) 12%, var(--bg-overlay))'
          : 'transparent',
        border: active
          ? '1px solid color-mix(in oklch, var(--accent) 30%, transparent)'
          : '1px solid transparent',
        color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        flexShrink: 0,
        maxWidth: 200,
        transition: 'background 120ms ease, border-color 120ms ease',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background =
            'color-mix(in oklch, var(--fg-default) 6%, var(--bg-overlay))';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
        }
      }}
    >
      {/* Draft indicator dot */}
      {isDraft && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--fg-muted)',
            flexShrink: 0,
            opacity: 0.6,
          }}
        />
      )}
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 140,
        }}
      >
        {tab.title}
      </span>
      {/* Close button — always visible on active tab, hover on others */}
      <button
        type="button"
        aria-label="关闭标签"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          borderRadius: 4,
          border: 'none',
          background: 'transparent',
          color: 'var(--fg-muted)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
          opacity: active ? 0.7 : 0,
          transition: 'opacity 120ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1';
          e.currentTarget.style.background = 'color-mix(in oklch, var(--danger) 12%, transparent)';
          e.currentTarget.style.color = 'var(--danger)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = active ? '0.7' : '0';
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--fg-muted)';
        }}
      >
        ×
      </button>
    </div>
  );
}
