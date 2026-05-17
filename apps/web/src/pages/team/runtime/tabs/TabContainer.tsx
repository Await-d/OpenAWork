/**
 * 260517-team-page-v2 · Tab 通用容器
 *
 * 让每个子 tab 内容拥有一致的：
 *   - 紧凑外边距（默认 12px 横向 / 14px 上方 / 0 下方），不再使用大留白
 *   - 滚动容器（垂直可滚，水平禁止）
 *   - 全宽内容（不再限制 max-width，避免在大屏中央留出空白带）
 *   - 可选的轻量顶部 header（标题 + 副标题 + 操作 slot），无 sticky / blur
 *   - 不带卡片化背景（让 tab 自己决定是否做章节背景）
 *
 * 用法：
 *   <TabContainer title="任务流" subtitle="…" actions={<button …/>}>
 *     <TabSection title="待派发" actions={…}>…</TabSection>
 *   </TabContainer>
 */

import { type CSSProperties, type ReactNode } from 'react';

const CONTAINER_BASE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const SCROLL_AREA_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
};

const INNER_BASE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  width: '100%',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 10,
  flexWrap: 'wrap',
  paddingBottom: 8,
  borderBottom: '1px solid color-mix(in srgb, var(--border) 28%, transparent)',
};

const HEADER_TEXT_GROUP_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
  minWidth: 0,
};

const TITLE_STYLE: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text)',
  lineHeight: 1.25,
};

const SUBTITLE_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-3)',
  lineHeight: 1.5,
};

const ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
};

export interface TabContainerProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  /**
   * 内容最大宽度。默认 'none'（铺满容器），避免大屏左右出现死白。
   * 仅当内容是长行文本（spec/plan markdown）时才设为 1280 之类的限制。
   */
  maxWidth?: number | 'none';
  /**
   * 是否在容器内插入 padding，默认 true。
   * 极少数需要全宽贴边的 tab（OfficeThreeCanvas / 编辑器）可设 false。
   */
  padded?: boolean;
  /**
   * 是否启用滚动；默认启用。
   */
  scroll?: boolean;
  children: ReactNode;
}

export function TabContainer({
  title,
  subtitle,
  actions,
  maxWidth = 'none',
  padded = true,
  scroll = true,
  children,
}: TabContainerProps) {
  const innerStyle: CSSProperties = {
    ...INNER_BASE,
    maxWidth: maxWidth === 'none' ? undefined : maxWidth,
    padding: padded ? '12px 14px 16px' : 0,
  };

  const hasHeader = Boolean(title || subtitle || actions);

  const headerNode = hasHeader ? (
    <header style={HEADER_STYLE}>
      <div style={HEADER_TEXT_GROUP_STYLE}>
        {title ? <span style={TITLE_STYLE}>{title}</span> : null}
        {subtitle ? <span style={SUBTITLE_STYLE}>{subtitle}</span> : null}
      </div>
      {actions ? <div style={ACTIONS_STYLE}>{actions}</div> : null}
    </header>
  ) : null;

  const content = (
    <div style={innerStyle}>
      {headerNode}
      {children}
    </div>
  );

  if (!scroll) {
    return <div style={CONTAINER_BASE}>{content}</div>;
  }

  return (
    <div style={CONTAINER_BASE}>
      <div style={SCROLL_AREA_STYLE}>{content}</div>
    </div>
  );
}

// ─── TabSection：tab 内的章节块 ──────────────────────────────────

const SECTION_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const SECTION_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const SECTION_TITLE_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--text)',
};

const SECTION_HINT_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--text-3)',
};

const SECTION_ACTIONS_STYLE: CSSProperties = {
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const CARD_PADDING_STYLE: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border) 30%, transparent)',
  background: 'transparent',
};

export interface TabSectionProps {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  /** 卡片化背景；默认 false（透明）。开启后只加 1px 边框 + 紧凑 padding，不带 box-shadow。 */
  card?: boolean;
  children: ReactNode;
}

export function TabSection({ title, hint, actions, card = false, children }: TabSectionProps) {
  return (
    <section style={card ? { ...SECTION_STYLE, ...CARD_PADDING_STYLE } : SECTION_STYLE}>
      {title || hint || actions ? (
        <header style={SECTION_HEADER_STYLE}>
          {title ? <span style={SECTION_TITLE_STYLE}>{title}</span> : null}
          {hint ? <span style={SECTION_HINT_STYLE}>{hint}</span> : null}
          {actions ? <div style={SECTION_ACTIONS_STYLE}>{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
