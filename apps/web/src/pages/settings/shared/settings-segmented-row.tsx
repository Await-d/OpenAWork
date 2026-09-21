import { useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * 设置页「分段选择行」：标题/描述 + 横向分段控件。
 * 适用于选项只有文字标签、没有描述的紧凑场景（如锁屏时长、更新渠道、重试次数），
 * 这类选项不适合卡片网格（会被撑得过大），统一收敛到这一份横向分段实现。
 */

export interface SettingsSegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
  readonly title?: string;
}

export interface SettingsSegmentedRowProps<T extends string> {
  /** 与 section 内 `<h3>` 重复时可省略。 */
  title?: string;
  description?: string;
  options: readonly SettingsSegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 分段控件组的无障碍名称（必填）。 */
  ariaLabel: string;
}

const ROW: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 0',
  borderBottom: '1px solid var(--border-subtle)',
};

const HEAD_TEXT: CSSProperties = { minWidth: 0 };

const HEAD_TITLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-strong)',
};

const HEAD_DESCRIPTION: CSSProperties = {
  marginTop: 3,
  fontSize: 11,
  lineHeight: 1.5,
  color: 'var(--fg-muted)',
};

/** 分组容器：横向排列、窄屏自动换行。 */
const GROUP: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const ITEM_BASE: CSSProperties = {
  appearance: 'none',
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1.4,
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid var(--border-default)',
  background: 'transparent',
  color: 'var(--fg-default)',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
};

export function SettingsSegmentedRow<T extends string>({
  title,
  description,
  options,
  value,
  onChange,
  ariaLabel,
}: SettingsSegmentedRowProps<T>) {
  const [hovered, setHovered] = useState<T | null>(null);
  const [focused, setFocused] = useState<T | null>(null);
  const [pressed, setPressed] = useState<T | null>(null);

  const hasHeader = title !== undefined || description !== undefined;

  return (
    <div style={ROW}>
      {hasHeader && (
        <div style={HEAD_TEXT}>
          {title !== undefined && <div style={HEAD_TITLE}>{title}</div>}
          {description !== undefined && <div style={HEAD_DESCRIPTION}>{description}</div>}
        </div>
      )}
      <div role="group" aria-label={ariaLabel} style={GROUP}>
        {options.map((option) => {
          const selected = option.value === value;
          const isDisabled = option.disabled === true;
          const isHovered = hovered === option.value && !selected && !isDisabled;
          const isFocused = focused === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              aria-label={option.label}
              title={option.title}
              disabled={option.disabled}
              onClick={() => onChange(option.value)}
              onMouseEnter={() => setHovered(option.value)}
              onMouseLeave={() => {
                setHovered(null);
                setPressed(null);
              }}
              onMouseDown={() => setPressed(option.value)}
              onMouseUp={() => setPressed(null)}
              onFocus={() => setFocused(option.value)}
              onBlur={() => setFocused(null)}
              style={{
                ...ITEM_BASE,
                ...(selected
                  ? {
                      background: 'var(--accent)',
                      borderColor: 'var(--accent)',
                      color: 'var(--fg-on-accent)',
                      fontWeight: 600,
                    }
                  : {}),
                ...(isHovered
                  ? {
                      background: 'var(--bg-overlay)',
                      borderColor: 'var(--border-emphasis)',
                    }
                  : {}),
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                opacity: isDisabled ? 0.5 : 1,
                outline: isFocused ? '2px solid var(--accent)' : 'none',
                outlineOffset: 2,
                transform: pressed === option.value && !isDisabled ? 'translateY(1px)' : 'none',
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
