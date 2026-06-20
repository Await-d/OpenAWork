import React from 'react';

export function FocusedRequestBanner(props: {
  requestId: string;
  summary?: string;
  onCopy?: () => void;
  onClear: () => void;
}) {
  const { requestId, summary, onCopy, onClear } = props;
  return (
    <div
      data-testid="focused-request-banner"
      style={{
        margin: '8px 8px 0',
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid color-mix(in oklch, var(--accent) 24%, var(--border-default))',
        background: 'color-mix(in oklch, var(--accent) 8%, var(--bg-overlay))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexShrink: 0,
      }}
    >
      <div style={{ minWidth: 0, fontSize: 10.5, color: 'var(--fg-default)' }}>
        当前聚焦请求：<span style={{ color: 'var(--accent)', fontWeight: 700 }}>{requestId}</span>
        {summary ? <span style={{ color: 'var(--fg-muted)' }}> · {summary}</span> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            style={{
              borderRadius: 999,
              border: '1px solid color-mix(in oklch, var(--accent) 26%, var(--border-default))',
              background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
              color: 'var(--accent)',
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 7px',
              cursor: 'pointer',
            }}
          >
            复制诊断上下文
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          style={{
            borderRadius: 999,
            border: '1px solid color-mix(in oklch, var(--accent) 26%, var(--border-default))',
            background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
            color: 'var(--accent)',
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 7px',
            cursor: 'pointer',
          }}
        >
          取消聚焦
        </button>
      </div>
    </div>
  );
}
