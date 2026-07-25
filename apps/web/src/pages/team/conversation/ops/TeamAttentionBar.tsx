import type { CSSProperties } from 'react';

const BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 26,
  padding: '0 10px',
  borderRadius: 0,
  borderBottom: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border-default))',
  background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-raised, var(--bg-overlay)))',
  color: 'var(--fg-muted)',
  fontSize: 11,
};

const BADGE_STYLE: CSSProperties = {
  color: 'var(--warning)',
  fontWeight: 750,
  fontSize: 10,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const TITLE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontWeight: 650,
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
};

const HINT_STYLE: CSSProperties = {
  fontSize: 10.5,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 240,
  flex: 1,
  minWidth: 0,
};

const JUMP_BTN_STYLE: CSSProperties = {
  appearance: 'none',
  border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border-default))',
  background: 'transparent',
  color: 'var(--warning)',
  minHeight: 20,
  padding: '0 8px',
  fontSize: 10.5,
  fontWeight: 700,
  cursor: 'pointer',
  flexShrink: 0,
};

export interface TeamAttentionBarProps {
  show: boolean;
  title: string;
  hint?: string;
  onJump?: () => void;
}

export function TeamAttentionBar({ show, title, hint, onJump }: TeamAttentionBarProps) {
  if (!show) return null;

  return (
    <div style={BAR_STYLE}>
      <span style={BADGE_STYLE}>待你处理</span>
      <strong style={TITLE_STYLE} title={title}>
        {title}
      </strong>
      {hint != null && hint !== '' ? (
        <span style={HINT_STYLE} title={hint}>
          {hint}
        </span>
      ) : (
        <span style={{ flex: 1 }} />
      )}
      {onJump != null ? (
        <button type="button" style={JUMP_BTN_STYLE} onClick={onJump}>
          查看
        </button>
      ) : null}
    </div>
  );
}
