import type { CSSProperties } from 'react';
import { DIALOGUE_MODE_OPTIONS, type DialogueMode } from './dialogue-mode.js';

const MODE_ACCENTS: Record<DialogueMode, { bg: string; color: string }> = {
  clarify: { bg: 'rgba(245, 158, 11, 0.10)', color: 'rgb(245, 158, 11)' },
  coding: { bg: 'rgba(139, 92, 246, 0.12)', color: 'rgb(167, 139, 250)' },
  programmer: { bg: 'rgba(16, 185, 129, 0.12)', color: 'rgb(52, 211, 153)' },
};

function ModeIcon({ mode }: { mode: DialogueMode }) {
  if (mode === 'clarify') {
    return (
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M9.09 9a3 3 0 1 1 5.82 1c0 2-3 2-3 4" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  if (mode === 'coding') {
    return (
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    );
  }
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 18v2" />
    </svg>
  );
}

interface DialogueModeToggleProps {
  mode: DialogueMode;
  onChange: (mode: DialogueMode) => void;
  disabled?: boolean;
  style?: CSSProperties;
}

export default function DialogueModeToggle({
  mode,
  onChange,
  disabled,
  style,
}: DialogueModeToggleProps) {
  return (
    <div
      data-testid="dialogue-mode-toggle"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        borderRadius: 8,
        padding: 2,
        background: 'color-mix(in oklch, var(--surface) 90%, transparent)',
        border: '1px solid var(--border-subtle)',
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
    >
      {DIALOGUE_MODE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={mode === option.value}
          disabled={disabled}
          title={option.description}
          onClick={() => onChange(option.value)}
          style={{
            height: 26,
            padding: '0 9px',
            fontSize: 11,
            fontWeight: mode === option.value ? 600 : 500,
            border: 'none',
            borderRadius: 6,
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: mode === option.value ? MODE_ACCENTS[option.value].bg : 'transparent',
            color: mode === option.value ? MODE_ACCENTS[option.value].color : 'var(--text-3)',
            transition: 'background 0.15s ease, color 0.15s ease',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <ModeIcon mode={option.value} />
          {option.label}
        </button>
      ))}
    </div>
  );
}
