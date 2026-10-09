import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { IslandTone } from './island-types.js';

export interface IslandPillProps {
  label: string;
  tone: IslandTone;
  expanded: boolean;
  sessionTitle: string | null;
  preview: string;
  hasSession: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenSession: () => void;
  onHide: () => void;
}

/**
 * 灵动岛的纯展示组件:折叠态是药丸(pill),展开态追加会话摘要与操作。
 *
 * 折叠 / 展开由窗口原生尺寸切换实现(见 Rust `island_set_expanded`),这里只
 * 负责内容层;`is-expanded` 仅用于切换背景不透明度。
 */
export function IslandPill({
  label,
  tone,
  expanded,
  sessionTitle,
  preview,
  hasSession,
  onMouseEnter,
  onMouseLeave,
  onOpenSession,
  onHide,
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
    <div className="island-root" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className={`island-pill island-tone-${tone}${expanded ? ' is-expanded' : ''}`}>
        <div
          className="island-header"
          role={hasSession ? 'button' : undefined}
          tabIndex={hasSession ? 0 : undefined}
          title={hasSession ? '点击打开会话' : undefined}
          onClick={hasSession ? onOpenSession : undefined}
          onKeyDown={hasSession ? handleHeaderKeyDown : undefined}
        >
          <span className={`island-dot island-dot-${tone}`} aria-hidden="true" />
          <span className="island-label">{label}</span>
          <span className="island-spacer" />
          {hasSession ? <span className="island-badge">打开</span> : null}
        </div>

        {expanded ? (
          <div className="island-body">
            <div className="island-title" title={sessionTitle ?? undefined}>
              {sessionTitle ?? '未选择会话'}
            </div>
            <div className="island-preview">{preview.length > 0 ? preview : '暂无消息'}</div>
            <div className="island-actions">
              <button
                type="button"
                className="island-btn island-btn-primary"
                disabled={!hasSession}
                onClick={onOpenSession}
              >
                打开会话
              </button>
              <button type="button" className="island-btn" onClick={onHide}>
                隐藏
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
