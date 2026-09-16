/**
 * 元素检查器的通用外壳组件（按钮 / 芯片 / 提示条 / 空态 / 骨架屏 / 图标）。
 *
 * 与 `NetworkWaterfall` 内部那套 chrome 同构，但独立成文件：检查器与瀑布是两个
 * 视图，共用私有组件会把两者的样式演进绑死；这里只共享 token。
 *
 * 交互状态（hover / pressed / focus）由 React state 驱动——伪类无法用内联样式表达，
 * 因此组件不依赖任何 CSS 类（与 `BrowserToolbar` / `BrowserPill` 一致）。
 */

import { useState, type ReactNode } from 'react';
import { INSPECTOR_CHIP_TONE, INSPECTOR_TOKEN, mergeInspectorShadows } from './browser-inspector-tokens.js';
import type { InspectorChipTone } from './browser-inspector-model.js';

// ── 按钮 ───────────────────────────────────────────────────────────────

export function InspectorActionButton({
  label,
  title,
  ariaLabel,
  testId,
  disabled = false,
  busy = false,
  onClick,
}: {
  label: string;
  title?: string;
  ariaLabel?: string;
  testId?: string;
  disabled?: boolean;
  /** 请求在途：展示占位文案并保持视觉禁用（不重复下发）。 */
  busy?: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const interactive = !disabled && !busy;

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={!interactive}
      title={title}
      aria-label={ariaLabel}
      aria-busy={busy}
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
        gap: 4,
        height: 20,
        padding: '0 8px',
        borderRadius: INSPECTOR_TOKEN.radiusSm,
        border: `1px solid ${
          interactive && (hovered || focused)
            ? INSPECTOR_TOKEN.borderEmphasis
            : INSPECTOR_TOKEN.borderSubtle
        }`,
        background: !interactive
          ? INSPECTOR_TOKEN.surface
          : pressed
            ? INSPECTOR_TOKEN.pressedBg
            : hovered
              ? INSPECTOR_TOKEN.hoverBg
              : INSPECTOR_TOKEN.surface,
        color: interactive && hovered ? INSPECTOR_TOKEN.textStrong : INSPECTOR_TOKEN.textDefault,
        fontSize: 9.5,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        cursor: interactive ? 'pointer' : 'not-allowed',
        opacity: interactive ? 1 : 0.55,
        outline: focused ? `2px solid ${INSPECTOR_TOKEN.accent}` : 'none',
        outlineOffset: 2,
        boxShadow: focused ? `0 0 0 4px ${INSPECTOR_TOKEN.focusRing}` : 'none',
        transition: `background ${INSPECTOR_TOKEN.motionMicro}, border-color ${INSPECTOR_TOKEN.motionMicro}`,
      }}
    >
      {label}
    </button>
  );
}

// ── 芯片 ───────────────────────────────────────────────────────────────

/** 无障碍状态芯片（focused / disabled / expanded / selected / checked …）。 */
export function InspectorChip({
  label,
  tone = 'muted',
  testId,
}: {
  label: string;
  tone?: InspectorChipTone;
  testId?: string;
}) {
  const chrome = INSPECTOR_CHIP_TONE[tone];
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 16,
        padding: '0 8px',
        borderRadius: INSPECTOR_TOKEN.radiusPill,
        border: `1px solid ${chrome.border}`,
        background: chrome.background,
        color: chrome.color,
        fontSize: 9,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// ── 提示条 / 空态 / 骨架屏 ─────────────────────────────────────────────

/**
 * 横贯面板的提示条：错误 / 深度裁剪 / 拾取等待都用它。
 *
 * 与居中空态（`InspectorNotice`）区分：提示条不阻断内容，表示「有数据但要注意」。
 */
export function InspectorStrip({
  tone,
  title,
  description,
  testId,
  action,
}: {
  tone: InspectorChipTone;
  title: string;
  description?: string;
  testId?: string;
  action?: ReactNode;
}) {
  const chrome = INSPECTOR_CHIP_TONE[tone];
  return (
    <div
      data-testid={testId}
      role="status"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        padding: '4px 8px',
        borderBottom: `1px solid ${chrome.border}`,
        background: chrome.background,
        color: chrome.color,
        fontSize: 9.5,
        lineHeight: 1.5,
      }}
    >
      <span style={{ fontWeight: 700 }}>{title}</span>
      {description !== undefined ? (
        <span style={{ color: INSPECTOR_TOKEN.textDefault, minWidth: 0 }}>{description}</span>
      ) : null}
      <div style={{ flex: 1 }} />
      {action}
    </div>
  );
}

export function InspectorNotice({
  icon,
  title,
  description,
  testId,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  testId?: string;
  action?: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        margin: 16,
        padding: '24px 16px',
        textAlign: 'center',
        border: `1px dashed ${INSPECTOR_TOKEN.borderEmphasis}`,
        borderRadius: INSPECTOR_TOKEN.radiusLg,
        background: INSPECTOR_TOKEN.surface,
      }}
    >
      <span
        aria-hidden="true"
        style={{ display: 'inline-flex', color: INSPECTOR_TOKEN.textSubtle, opacity: 0.6 }}
      >
        {icon}
      </span>
      <div
        style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: INSPECTOR_TOKEN.textStrong }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          lineHeight: 1.6,
          color: INSPECTOR_TOKEN.textMuted,
          maxWidth: 340,
          marginInline: 'auto',
        }}
      >
        {description}
      </div>
      {action !== undefined ? (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {action}
        </div>
      ) : null}
    </div>
  );
}

export function InspectorSkeleton({ label, testId }: { label: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      aria-busy="true"
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        flex: 1,
        minHeight: 0,
      }}
    >
      <span style={{ fontSize: 10, color: INSPECTOR_TOKEN.textMuted }}>{label}</span>
      {[0, 1, 2, 3, 4].map((index) => (
        <span key={index} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span
            style={{
              display: 'block',
              width: `${48 + index * 8}%`,
              height: 8,
              borderRadius: 4,
              background: INSPECTOR_TOKEN.surfaceRaised,
            }}
          />
          <span
            style={{
              display: 'block',
              width: `${82 - index * 9}%`,
              height: 10,
              borderRadius: 4,
              background: INSPECTOR_TOKEN.surfaceRaised,
            }}
          />
        </span>
      ))}
    </div>
  );
}

// ── 图标（Lucide 风格 24×24 stroke）────────────────────────────────────

export function InspectorDomIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <path d="M6.5 10v4a2 2 0 0 0 2 2H14" />
    </svg>
  );
}

export function InspectorA11yIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="4.5" r="2.5" />
      <path d="M4 8h16" />
      <path d="M12 8v6" />
      <path d="M12 14l-3.5 6" />
      <path d="M12 14l3.5 6" />
    </svg>
  );
}

export function InspectorOffIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function InspectorPickIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

export function InspectorSearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function InspectorChevron() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
