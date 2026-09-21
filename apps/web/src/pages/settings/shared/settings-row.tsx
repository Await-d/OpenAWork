import type { CSSProperties, ReactNode } from 'react';

/** 卡片式设置行容器；需要局部覆盖（如选中态描边）时可直接展开本常量。 */
export const SETTINGS_CARD_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
  padding: '10px 12px',
  background: 'var(--bg-overlay)',
};

const CARD_TEXT_BLOCK: CSSProperties = {
  minWidth: 0,
  flex: 1,
};

const CARD_TITLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-strong)',
};

const CARD_DESCRIPTION: CSSProperties = {
  marginTop: 3,
  fontSize: 11,
  lineHeight: 1.5,
  color: 'var(--fg-muted)',
};

const LIST_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '10px 0',
};

const LIST_TEXT_BLOCK: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
  flex: 1,
};

const LIST_TITLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--fg-strong)',
};

const LIST_DESCRIPTION: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

export interface SettingsRowProps {
  title: string;
  description?: string;
  /** 右侧控件（开关、下拉、按钮等）。 */
  children: ReactNode;
  /** 仅扁平列表行生效：是否显示底部分隔线，默认 true。 */
  divider?: boolean;
}

export function SettingsCardRow({ title, description, children }: SettingsRowProps) {
  return (
    <div style={SETTINGS_CARD_ROW_STYLE}>
      <div style={CARD_TEXT_BLOCK}>
        <div style={CARD_TITLE}>{title}</div>
        {description !== undefined && <div style={CARD_DESCRIPTION}>{description}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsListRow({
  title,
  description,
  children,
  divider = true,
}: SettingsRowProps) {
  return (
    <div
      style={{
        ...LIST_ROW,
        borderBottom: divider ? '1px solid var(--border-subtle)' : 'none',
      }}
    >
      <div style={LIST_TEXT_BLOCK}>
        <span style={LIST_TITLE}>{title}</span>
        {description !== undefined && <span style={LIST_DESCRIPTION}>{description}</span>}
      </div>
      {children}
    </div>
  );
}
