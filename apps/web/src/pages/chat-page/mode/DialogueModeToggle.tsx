import type { CSSProperties } from 'react';
import { DIALOGUE_MODE_OPTIONS, type DialogueMode } from './dialogue-mode.js';
import './DialogueModeToggle.css';

type ModeTone = 'accent' | 'aux' | 'contrast';

const MODE_TONES = {
  clarify: 'contrast',
  coding: 'accent',
  programmer: 'aux',
} as const satisfies Record<DialogueMode, ModeTone>;

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
      className="dialogue-mode-toggle"
      data-testid="dialogue-mode-toggle"
      data-disabled={disabled ? 'true' : 'false'}
      style={style}
    >
      {DIALOGUE_MODE_OPTIONS.map((option) => {
        const active = mode === option.value;

        return (
          <button
            key={option.value}
            className="dialogue-mode-toggle__button"
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            data-active={active ? 'true' : 'false'}
            data-tone={MODE_TONES[option.value]}
            disabled={disabled}
            title={option.description}
            onClick={() => onChange(option.value)}
          >
            <ModeIcon mode={option.value} />
            {active ? <span className="dialogue-mode-toggle__label">{option.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
