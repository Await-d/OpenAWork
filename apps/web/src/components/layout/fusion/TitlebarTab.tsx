/**
 * TitlebarTab — 单个会话标签组件。
 *
 * 功能：
 *  - 标题截断（max-width + ellipsis）
 *  - 关闭按钮（hover 时显示）
 *  - 拖拽手柄（HTML5 drag/drop，用于标签排序）
 *  - 活跃高亮
 *  - draft 状态指示（未关联 session 的草稿标签）
 *  - 会话图标（固定/自定义 emoji/对话模式）
 */

import type { SessionTab } from '../../../stores/ui/uiState.js';
import type { SessionDialogueMode } from '../../../utils/session/session-metadata.js';

export interface TitlebarTabProps {
  tab: SessionTab;
  active: boolean;
  index: number;
  sessionIcon?: string;
  sessionDialogueMode?: SessionDialogueMode;
  sessionStateStatus?: 'idle' | 'running' | 'paused';
  isPinned?: boolean;
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
  sessionIcon,
  sessionDialogueMode,
  sessionStateStatus,
  isPinned = false,
  onClick,
  onClose,
  onDragStart,
  onDragOver,
  onDrop,
}: TitlebarTabProps) {
  const isDraft = tab.type === 'draft';
  const isStreaming = tab.streaming === true;
  const isRunning = sessionStateStatus === 'running';
  const isPaused = sessionStateStatus === 'paused';

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
        maxWidth: 280,
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
      {/* Session icon (pinned/custom emoji/dialogue mode) */}
      {!isDraft && tab.type === 'session' && (
        <span
          aria-label={isPinned ? '已固定' : isRunning ? '运行中' : isPaused ? '已暂停' : '空闲'}
          title={isPinned ? '已固定' : isRunning ? '运行中' : isPaused ? '已暂停' : '空闲'}
          style={{
            position: 'relative',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            borderRadius: 4,
            background: active
              ? 'color-mix(in oklch, var(--accent) 8%, transparent)'
              : 'transparent',
            color: active ? 'var(--accent)' : isPinned ? 'var(--accent)' : 'var(--fg-muted)',
            transition: 'background 120ms ease, color 120ms ease',
          }}
        >
          {isPinned ? (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="17" x2="12" y2="22" />
              <path d="M5 17H19V15L17 9V4H18V2H6V4H7V9L5 15V17Z" />
            </svg>
          ) : sessionIcon ? (
            <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>
              {sessionIcon}
            </span>
          ) : sessionDialogueMode === 'coding' ? (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          ) : sessionDialogueMode === 'programmer' ? (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M8 9l-3 3 3 3" />
              <path d="M16 9l3 3-3 3" />
              <path d="M12 7l-2 10" />
            </svg>
          ) : (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          )}
          {/* Running indicator */}
          {isRunning && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                bottom: -1,
                right: -1,
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: 'var(--success)',
                boxShadow: '0 0 4px var(--success)',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          )}
          {/* Paused indicator */}
          {isPaused && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                bottom: -1,
                right: -1,
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: 'var(--warning)',
              }}
            />
          )}
        </span>
      )}
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
          maxWidth: 220,
        }}
      >
        {tab.title}
      </span>
      {/* Streaming indicator */}
      {isStreaming && (
        <span
          aria-label="正在生成"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: 'var(--accent)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: 'var(--accent)',
              animation: 'pulse 1.5s ease-in-out 0.2s infinite',
            }}
          />
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: 'var(--accent)',
              animation: 'pulse 1.5s ease-in-out 0.4s infinite',
            }}
          />
        </span>
      )}
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
