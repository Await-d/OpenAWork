import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * 设置页「选项卡片行」：标题/描述 + 自适应卡片网格。
 * 主题风格、文件图标主题等选择行共用这一份结构，避免卡片实现各写一份后漂移。
 */

export interface SettingsOptionCard<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description: string;
  /** 卡片内的预览区（色板、图标样例等）；纯装饰内容需自带 aria-hidden。 */
  readonly preview?: ReactNode;
}

export interface SettingsOptionCardRowProps<T extends string> {
  title: string;
  description: string;
  options: readonly SettingsOptionCard<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 卡片最小宽度，默认 140 */
  minCardWidth?: number;
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
}: SettingsOptionCardRowProps<T>) {
  const [hovered, setHovered] = useState<T | null>(null);
  const [focused, setFocused] = useState<T | null>(null);

  return (
    <div style={ROW}>
      <div style={ROW_HEADER}>
        <span style={ROW_TITLE}>{title}</span>
        <span style={ROW_DESCRIPTION}>{description}</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))`,
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
              onClick={() => onChange(option.value)}
              onMouseEnter={() => setHovered(option.value)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setFocused(option.value)}
              onBlur={() => setFocused(null)}
              aria-pressed={active}
              aria-label={option.label}
              style={{
                ...OPTION_CARD,
                border: `1px solid ${optionCardBorder(active, hovered === option.value)}`,
                background: active ? 'var(--accent-subtle)' : 'var(--bg-overlay)',
                outline: isFocused ? '2px solid var(--accent)' : 'none',
                outlineOffset: 2,
                boxShadow: isFocused ? '0 0 0 4px var(--accent-subtle)' : 'none',
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
              <span style={OPTION_CARD_DESCRIPTION}>{option.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
