/**
 * 260530-team-page · content-kit · SectionPanel
 *
 * 统一的"章节面板"：标题 + 可选 hint + 可选 actions + body，带卡片化背景。
 *
 * 与 TabContainer 里的 TabSection 区别：
 *   - TabSection：tab 内的"分组块"，默认透明、轻量。
 *   - SectionPanel：内容区里需要明确视觉边界的"面板卡片"（如活动分布、
 *     时间线、分层明细等），默认带边框 + 表面底色 + padding。
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  CK_BORDER,
  CK_SURFACE,
  CK_RADIUS,
  CK_GAP,
  CK_SECTION_LABEL_STYLE,
} from './content-kit-tokens.js';

export interface SectionPanelProps {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** body 间距，默认 CK_GAP。 */
  gap?: number;
  /** 自定义 body 容器样式（如改成 grid）。 */
  bodyStyle?: CSSProperties;
  style?: CSSProperties;
}

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px',
  borderRadius: CK_RADIUS,
  border: `1px solid ${CK_BORDER}`,
  background: CK_SURFACE,
  minWidth: 0,
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const TITLE_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: 'var(--fg-strong)',
};

export function SectionPanel({
  title,
  hint,
  actions,
  children,
  gap = CK_GAP,
  bodyStyle,
  style,
}: SectionPanelProps) {
  const hasHeader = Boolean(title || hint || actions);
  return (
    <section style={{ ...PANEL_STYLE, ...style }}>
      {hasHeader ? (
        <header style={HEADER_STYLE}>
          {title ? <span style={TITLE_STYLE}>{title}</span> : null}
          {hint ? <span style={CK_SECTION_LABEL_STYLE}>{hint}</span> : null}
          {actions ? (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              {actions}
            </div>
          ) : null}
        </header>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap, minWidth: 0, ...bodyStyle }}>
        {children}
      </div>
    </section>
  );
}
