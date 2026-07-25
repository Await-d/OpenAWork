import type { CSSProperties } from 'react';

const BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  minHeight: 26,
  padding: '0 10px',
  background: 'color-mix(in srgb, var(--bg-raised, var(--bg-overlay)) 80%, transparent)',
  borderRadius: 0,
  borderBottom: '1px solid var(--border-default)',
};

const LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--fg-faint)',
  marginRight: 2,
  whiteSpace: 'nowrap',
};

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 20,
  padding: '0 7px',
  borderRadius: 0,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-base)',
  color: 'var(--fg-muted)',
  fontSize: 10.5,
  fontWeight: 650,
  whiteSpace: 'nowrap',
};

const REMOVE_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 14,
  height: 14,
  borderRadius: 0,
  fontSize: 11,
  lineHeight: 1,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-faint)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

export interface Decision {
  id: string;
  label: string;
}

export interface TeamDecisionBarProps {
  decisions: Decision[];
  onRemove?: (id: string) => void;
}

export function TeamDecisionBar({ decisions, onRemove }: TeamDecisionBarProps) {
  if (decisions.length === 0) return null;

  return (
    <div style={BAR_STYLE}>
      <span style={LABEL_STYLE}>已确认</span>
      {decisions.map((d) => (
        <span key={d.id} style={CHIP_STYLE}>
          <b style={{ color: 'var(--fg-strong)', fontWeight: 650 }}>{d.label}</b>
          {onRemove != null ? (
            <button
              type="button"
              style={REMOVE_BTN_STYLE}
              title="移除"
              aria-label={`移除 ${d.label}`}
              onClick={() => onRemove(d.id)}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}
