/**
 * SessionPanelFrame — 对话面板卡片容器。
 *
 * 参照 OpenCode SessionPanelFrame：
 *   rounded-[10px] + shadow-raised + bg-surface
 *
 * 包装 ChatPage 的对话区域（SessionHeader + MessageTimeline + Composer）
 * 为一个卡片，与背景形成层次感。
 */

import type { CSSProperties, ReactNode } from 'react';

export interface SessionPanelFrameProps {
  readonly children: ReactNode;
  readonly raised?: boolean;
  readonly style?: CSSProperties;
}

const FRAME_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 10,
  overflow: 'hidden',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  boxShadow: 'var(--shadow-md)',
  minWidth: 0,
};

export function SessionPanelFrame({ children, raised, style }: SessionPanelFrameProps) {
  return (
    <div
      className="session-panel-frame"
      style={{
        ...FRAME_STYLE,
        ...(raised
          ? {
              boxShadow: 'var(--shadow-lg)',
            }
          : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
