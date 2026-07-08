import React from 'react';

export function RequestScopeEffectNote(props: {
  title: string;
  requestId: string;
  visibleCount: number;
  totalCount: number;
  summary?: string;
  description?: string;
}) {
  const { title, requestId, visibleCount, totalCount, summary, description } = props;

  return (
    <div
      data-testid="request-scope-effect-note"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid color-mix(in oklch, var(--accent) 24%, var(--border-default))',
        background: 'color-mix(in oklch, var(--accent) 8%, var(--bg-overlay))',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-strong)' }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 10,
              lineHeight: 1,
              padding: '2px 6px',
              borderRadius: 999,
              border: '1px solid color-mix(in oklch, var(--accent) 28%, var(--border-default))',
              color: 'var(--accent)',
              background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
            }}
          >
            {requestId}
          </span>
          <span
            style={{
              fontSize: 10,
              lineHeight: 1,
              padding: '2px 6px',
              borderRadius: 999,
              border: '1px solid var(--border-default)',
              color: 'var(--fg-muted)',
              background: 'var(--bg-overlay)',
            }}
          >
            {visibleCount}/{totalCount} 条
          </span>
        </div>
      </div>
      {summary ? <div style={{ fontSize: 11, color: 'var(--fg-default)' }}>{summary}</div> : null}
      {description ? (
        <div style={{ fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.45 }}>
          {description}
        </div>
      ) : null}
    </div>
  );
}
