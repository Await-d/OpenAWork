/**
 * 会话扩展页面的「单条说明卡片」。
 *
 * 面板与确认页此前各自内联了同一形状（登录 / 找不到 / 加载中 / 出错），只是外层
 * 布局不同：面板是文档式长页里的一张卡，确认页是居中的对话框。这里保留两种
 * `variant` 而不是强行合并视觉——合并会改变观感，属行为变更。
 */

import {
  confirmCardStyle,
  confirmMutedStyle,
  confirmPageStyle,
  panelCardStyle,
  panelPageStyle,
} from './session-extension-display.js';

export type SessionExtensionNoticeVariant = 'panel' | 'confirm';

export function SessionExtensionNotice({
  title,
  variant,
  children,
}: {
  /** 面板变体不带标题（它只在页面顶部已经有「会话扩展」标题）。 */
  title?: string;
  variant: SessionExtensionNoticeVariant;
  children: React.ReactNode;
}): React.ReactElement {
  if (variant === 'confirm') {
    return (
      <div style={confirmPageStyle}>
        <div style={confirmCardStyle}>
          {title ? (
            <h1 style={{ fontSize: 16, color: 'var(--text-1)', margin: '0 0 12px' }}>{title}</h1>
          ) : null}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div style={panelPageStyle}>
      <div style={panelCardStyle}>{children}</div>
    </div>
  );
}

/** 确认页里最常见的「一段说明文字」，避免每处重复 muted 样式。 */
export function NoticeText({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p style={confirmMutedStyle}>{children}</p>;
}
