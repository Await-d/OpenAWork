import type { CSSProperties, ReactNode } from 'react';

const STATUS_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 24,
  padding: '0 9px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 76%, var(--bg))',
  fontSize: 11,
  color: 'var(--text-2)',
  whiteSpace: 'nowrap',
};

export const TEAM_RUNTIME_INSET_PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 14,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 78%, var(--bg))',
};

export function ChromeBadge({ children }: { children: ReactNode }) {
  return <span style={STATUS_BADGE_STYLE}>{children}</span>;
}

export function CompactMetricPill({
  hint,
  icon,
  label,
  value,
}: {
  hint?: string;
  icon?: ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: hint ? 6 : 4,
        minWidth: 116,
        padding: '8px 10px',
        borderRadius: 12,
        border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
        background: 'color-mix(in srgb, var(--surface) 76%, var(--bg))',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ display: 'grid', gap: 3, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1 }}>{label}</span>
          <span style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>{value}</span>
        </div>
        {icon ? (
          <span
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              flexShrink: 0,
              borderRadius: 9,
              display: 'grid',
              placeItems: 'center',
              background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
            }}
          >
            {icon}
          </span>
        ) : null}
      </div>
      {hint ? (
        <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.35 }}>{hint}</span>
      ) : null}
    </div>
  );
}

export function RailEmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div style={TEAM_RUNTIME_INSET_PANEL_STYLE}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.65 }}>{description}</span>
    </div>
  );
}
