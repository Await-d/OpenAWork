import type { CSSProperties } from 'react';
import { useState } from 'react';

export interface ChatWorkbenchSignalChipProps {
  readonly ariaLabel?: string;
  readonly label: string;
  readonly onClick?: () => void;
  readonly tone: 'accent' | 'aux' | 'contrast';
}

export function ChatWorkbenchSignalChip({
  ariaLabel,
  label,
  onClick,
  tone,
}: ChatWorkbenchSignalChipProps) {
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const color =
    tone === 'accent' ? 'var(--accent)' : tone === 'aux' ? 'var(--aux)' : 'var(--contrast)';
  const interactive = typeof onClick === 'function';
  const background =
    hovered || focused
      ? 'color-mix(in srgb, currentColor 15%, var(--bg-overlay))'
      : 'color-mix(in srgb, currentColor 9%, var(--bg-overlay))';
  const transform = active ? 'translateY(1px)' : undefined;
  const commonStyle: CSSProperties = {
    alignItems: 'center',
    background,
    border: '1px solid color-mix(in srgb, currentColor 28%, transparent)',
    borderRadius: 'var(--radius-pill)',
    color,
    display: 'inline-flex',
    fontSize: 10.5,
    fontWeight: 700,
    minHeight: 22,
    padding: '0 var(--spacing-2)',
    transform,
    transition: 'background var(--motion-micro), transform var(--motion-micro)',
    whiteSpace: 'nowrap',
  };

  if (!interactive) {
    return <span style={commonStyle}>{label}</span>;
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      onBlur={() => {
        setActive(false);
        setFocused(false);
      }}
      onClick={onClick}
      onFocus={() => setFocused(true)}
      onMouseDown={() => setActive(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setActive(false);
        setHovered(false);
      }}
      onMouseUp={() => setActive(false)}
      style={{
        ...commonStyle,
        boxShadow: focused ? '0 0 0 4px var(--accent-subtle)' : undefined,
        cursor: 'pointer',
        outline: focused ? '2px solid var(--accent)' : '2px solid transparent',
        outlineOffset: 2,
      }}
    >
      {label}
    </button>
  );
}
