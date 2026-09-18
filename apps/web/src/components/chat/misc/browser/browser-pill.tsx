/**
 * 浏览器面板通用筛选 pill（瀑布视图的状态 / 类型筛选、控制台视图切换共用）。
 *
 * 交互状态覆盖 default / hover / pressed / 选中（`aria-pressed`）/ focus：
 * 伪类无法用内联样式表达，因此与 `BrowserToolbar` / `DeviceBarButton` 同一做法，
 * 由 React 状态驱动样式——组件不依赖任何 CSS 类或外部样式表。
 *
 * 颜色一律「应用 token + `currentColor` 兜底」：本组件可能被渲染在尚未加载应用级
 * token 表（`index.css`）的宿主里（验收 harness、独立预览），裸 `var()` 会在
 * computed-value 阶段整体失效，边框、选中底色、焦点环会一起消失、pill 退化成纯
 * 文本。兜底不含任何硬编码色值，只按比例混出 `currentColor`；token 表存在时兜底
 * 永远不会生效。
 */

import { useState } from 'react';

const ACCENT = 'var(--accent, currentColor)';
const ACCENT_BG = 'var(--accent, color-mix(in oklch, currentColor 26%, transparent))';
const ACCENT_BG_HOVER = 'var(--accent-hover, color-mix(in oklch, currentColor 34%, transparent))';
const ACCENT_TEXT = 'var(--fg-on-accent, currentColor)';
const ACCENT_BORDER = 'var(--accent-border, color-mix(in oklch, currentColor 60%, transparent))';
const ACCENT_SUBTLE = 'var(--accent-subtle, color-mix(in oklch, currentColor 10%, transparent))';
const HOVER_BG = 'var(--bg-hover, color-mix(in oklch, currentColor 10%, transparent))';
const PRESSED_BG = 'var(--bg-active, color-mix(in oklch, currentColor 14%, transparent))';
const BORDER_SUBTLE = 'var(--border-subtle, color-mix(in oklch, currentColor 14%, transparent))';
const BORDER_EMPHASIS =
  'var(--border-emphasis, color-mix(in oklch, currentColor 32%, transparent))';
const FG_DEFAULT = 'var(--fg-default, currentColor)';
const FG_MUTED = 'var(--fg-muted, color-mix(in oklch, currentColor 70%, transparent))';

const PILL_SIZE = {
  sm: { height: 18, fontSize: 9 },
  md: { height: 20, fontSize: 9.5 },
} as const;

interface BrowserPillProps {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
  testId?: string;
  /** `sm` = 控制台视图切换（18px）；`md` = 瀑布筛选（20px，默认）。 */
  size?: keyof typeof PILL_SIZE;
}

export function BrowserPill({
  label,
  active,
  onClick,
  title,
  testId,
  size = 'md',
}: BrowserPillProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const metrics = PILL_SIZE[size];

  const background = active
    ? hovered
      ? ACCENT_BG_HOVER
      : ACCENT_BG
    : pressed
      ? PRESSED_BG
      : hovered
        ? HOVER_BG
        : 'transparent';
  const color = active ? ACCENT_TEXT : hovered || pressed ? FG_DEFAULT : FG_MUTED;
  const borderColor = active ? ACCENT_BORDER : hovered || pressed ? BORDER_EMPHASIS : BORDER_SUBTLE;

  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testId}
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: metrics.height,
        padding: '0 8px',
        borderRadius: 9999,
        border: `1px solid ${borderColor}`,
        background,
        color,
        fontSize: metrics.fontSize,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        flexShrink: 0,
        outline: focused ? `2px solid ${ACCENT}` : 'none',
        outlineOffset: 2,
        boxShadow: focused ? `0 0 0 4px ${ACCENT_SUBTLE}` : 'none',
        transition:
          'background 100ms cubic-bezier(0.4, 0, 0.2, 1), border-color 100ms cubic-bezier(0.4, 0, 0.2, 1), color 100ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {label}
    </button>
  );
}
