import type { CSSProperties } from 'react';

const SUGGESTIONS = ['查看当前任务状态', '帮我写 README', '查看 plan 草稿'] as const;

const BAR_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--team-space-2)',
  paddingTop: 'var(--team-space-2)',
};

const BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 'var(--team-control-height-sm)',
  padding: '0 var(--team-space-3)',
  borderRadius: 'var(--team-radius-pill)',
  border: '1px solid color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 82%, var(--bg-base)',
  color: 'var(--fg-default)',
  fontSize: 'var(--team-font-xs)',
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
};

export interface SuggestionBarProps {
  onSelectSuggestion: (suggestion: string) => void | Promise<void>;
}

export function SuggestionBar({ onSelectSuggestion }: SuggestionBarProps) {
  return (
    <div style={BAR_STYLE} aria-label="建议操作">
      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => void onSelectSuggestion(suggestion)}
          className="team-hover-accent-soft"
          style={BUTTON_STYLE}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
