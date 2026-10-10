import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { BrandLogo } from '@openAwork/shared-ui';
import type { IslandTone } from './island-types.js';

export interface IslandPillProps {
  label: string;
  tone: IslandTone;
  expanded: boolean;
  /** 正在沿顶部拖动:驱动 grabbing 光标与轻微缩放。 */
  dragging: boolean;
  sessionTitle: string | null;
  preview: string;
  hasSession: boolean;
  /** 头部单击:打开会话(由上层做「双击优先」的延迟处理)。 */
  onOpenSession: () => void;
  /** 隐藏浮窗。 */
  onHide: () => void;
  /** 双击:复位到顶部居中。 */
  onRecenter: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * 灵动岛的纯展示组件。
 *
 * 折叠态是一条 28px 高的贴顶细胶囊(状态点 + 文案 + 波形 + 展开箭头),
 * 展开态由 Rust 侧补间把窗口拉成卡片,这里只负责内容层的错峰浮现。
 * 拖动手势挂在根节点上,指针事件由上层(IslandApp)解释。
 */
export function IslandPill({
  label,
  tone,
  expanded,
  dragging,
  sessionTitle,
  preview,
  hasSession,
  onOpenSession,
  onHide,
  onRecenter,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onMouseEnter,
  onMouseLeave,
}: IslandPillProps) {
  const handleHeaderKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!hasSession) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenSession();
    }
  };

  return (
    <div
      className={`island-root${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onRecenter}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={`island island-tone-${tone}${expanded ? ' is-expanded' : ''}`}>
        <div
          className="island-head"
          role={hasSession ? 'button' : undefined}
          tabIndex={hasSession ? 0 : undefined}
          title={hasSession ? '点击打开会话 · 双击复位居中' : '按住可沿顶部拖动'}
          onClick={hasSession ? onOpenSession : undefined}
          onKeyDown={hasSession ? handleHeaderKeyDown : undefined}
        >
          <BrandLogo className="island-brand" size={16} />
          <span className="island-label">{label}</span>
          <span className="island-spacer" />
          <span className="island-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <svg
            className="island-caret"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>

        <div className="island-body">
          <div className="island-body-main">
            <div className="island-title" title={sessionTitle ?? undefined}>
              {sessionTitle ?? '未选择会话'}
            </div>
            <div className="island-preview">{preview.length > 0 ? preview : '暂无消息'}</div>
          </div>
          <div className="island-actions">
            <button
              type="button"
              className="island-btn island-btn-accent"
              disabled={!hasSession}
              title="打开会话"
              aria-label="打开会话"
              onClick={onOpenSession}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 17 17 7" />
                <path d="M8 7h9v9" />
              </svg>
            </button>
            <button
              type="button"
              className="island-btn"
              title="隐藏灵动岛"
              aria-label="隐藏灵动岛"
              onClick={onHide}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>

        <div className="island-progress" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
