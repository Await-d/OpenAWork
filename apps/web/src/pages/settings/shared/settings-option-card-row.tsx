import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * 设置页「选项卡片行」：标题/描述 + 自适应卡片网格。
 * 主题风格、文件图标主题等选择行共用这一份结构，避免卡片实现各写一份后漂移。
 */

export interface SettingsOptionCard<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
  /** 卡片内的预览区（色板、图标样例等）；纯装饰内容需自带 aria-hidden。 */
  readonly preview?: ReactNode;
  /** 禁用态：不响应点击，且不会触发 onChange。 */
  readonly disabled?: boolean;
  /** 原生 button 的 title 提示，用于解释为何禁用等。 */
  readonly title?: string;
}

export interface SettingsOptionCardRowProps<T extends string> {
  /** 可选头部标题；与 description 均未传时不渲染表头，仅渲染卡片网格。 */
  title?: string;
  /** 可选头部描述；单独传入时只渲染描述行。 */
  description?: string;
  options: readonly SettingsOptionCard<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 卡片最小宽度，默认 140 */
  minCardWidth?: number;
  /** 传入时给卡片网格加 `role="group"` + `aria-label`，供读屏播报选项组名称。 */
  ariaLabel?: string;
  /** 是否在行底部渲染分隔线，默认 true；嵌在已有分隔线的容器内时传 false。 */
  divider?: boolean;
}

const ROW: CSSProperties = {
  padding: '10px 0',
  borderBottom: '1px solid var(--border-subtle)',
};

const ROW_HEADER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  marginBottom: 10,
};

const ROW_TITLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--fg-strong)',
};

const ROW_DESCRIPTION: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

const OPTION_CARD: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 12px',
  borderRadius: 8,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'border-color 100ms ease, background 100ms ease',
};

const OPTION_CARD_LABEL: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
};

const OPTION_CARD_DESCRIPTION: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.4,
};

function optionCardBorder(active: boolean, hovered: boolean): string {
  if (active) return 'var(--accent)';
  if (hovered) return 'var(--border-emphasis)';
  return 'var(--border-default)';
}

export function SettingsOptionCardRow<T extends string>({
  title,
  description,
  options,
  value,
  onChange,
  minCardWidth = 140,
  ariaLabel,
  divider = true,
}: SettingsOptionCardRowProps<T>) {
  const [hovered, setHovered] = useState<T | null>(null);
  const [focused, setFocused] = useState<T | null>(null);
  const [pressed, setPressed] = useState<T | null>(null);

  const hasHeader = title !== undefined || description !== undefined;

  return (
    <div style={divider ? ROW : { ...ROW, borderBottom: 'none' }}>
      {hasHeader && (
        <div style={ROW_HEADER}>
          {title !== undefined && <span style={ROW_TITLE}>{title}</span>}
          {description !== undefined && <span style={ROW_DESCRIPTION}>{description}</span>}
        </div>
      )}
      <div
        role={ariaLabel === undefined ? undefined : 'group'}
        aria-label={ariaLabel}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(${minCardWidth}px, 1fr))`,
          gap: 10,
        }}
      >
        {options.map((option) => {
          const active = value === option.value;
          const isFocused = focused === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                if (option.disabled !== true) {
                  onChange(option.value);
                }
              }}
              onMouseEnter={() => setHovered(option.value)}
              onMouseLeave={() => {
                setHovered(null);
                setPressed(null);
              }}
              onMouseDown={() => setPressed(option.value)}
              onMouseUp={() => setPressed(null)}
              onFocus={() => setFocused(option.value)}
              onBlur={() => setFocused(null)}
              aria-pressed={active}
              aria-label={option.label}
              disabled={option.disabled}
              title={option.title}
              style={{
                ...OPTION_CARD,
                border: `1px solid ${optionCardBorder(active, hovered === option.value)}`,
                background: active ? 'var(--accent-subtle)' : 'var(--bg-overlay)',
                cursor: option.disabled ? 'not-allowed' : 'pointer',
                opacity: option.disabled ? 0.6 : 1,
                outline: isFocused ? '2px solid var(--accent)' : 'none',
                outlineOffset: 2,
                boxShadow: isFocused ? '0 0 0 4px var(--accent-subtle)' : 'none',
                transform:
                  pressed === option.value && option.disabled !== true ? 'translateY(1px)' : 'none',
              }}
            >
              {option.preview}
              <span
                style={{
                  ...OPTION_CARD_LABEL,
                  color: active ? 'var(--accent)' : 'var(--fg-strong)',
                }}
              >
                {option.label}
              </span>
              {option.description !== undefined && (
                <span style={OPTION_CARD_DESCRIPTION}>{option.description}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
