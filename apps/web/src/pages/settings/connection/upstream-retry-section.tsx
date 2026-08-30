import React from 'react';
import { BP, SS, ST } from '../shared/settings-section-styles.js';

interface UpstreamRetrySectionProps {
  isSaving: boolean;
  maxRetries: number;
  onChange: (value: number) => void;
  onSave: () => void;
  savedMaxRetries: number;
}

const OPTION_BUTTON: React.CSSProperties = {
  minWidth: 36,
  borderRadius: 999,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
  padding: '5px 10px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'all 150ms ease',
};

export function UpstreamRetrySection({
  isSaving,
  maxRetries,
  onChange,
  onSave,
  savedMaxRetries,
}: UpstreamRetrySectionProps) {
  const hasUnsavedChanges = maxRetries !== savedMaxRetries;

  return (
    <section style={{ ...SS, marginBottom: 0, padding: '10px 12px', gap: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 200, flex: '1 1 240px' }}>
          <h3 style={ST}>
            <span style={{ whiteSpace: 'nowrap' }}>上游失败自动重试</span>
          </h3>
          <p
            style={{
              margin: '2px 0 0',
              color: 'var(--fg-default)',
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            当模型上游出现<span style={{ whiteSpace: 'nowrap' }}>短暂性错误</span>时，网关会在停止前
            <span style={{ whiteSpace: 'nowrap' }}>自动重试</span>。该策略也会同步应用到
            <span style={{ whiteSpace: 'nowrap' }}>后台子代理</span>。
          </p>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
            color: 'var(--accent)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          当前值
          <span style={{ color: 'var(--fg-strong)', fontWeight: 700 }}>{savedMaxRetries}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[0, 1, 2, 3].map((value) => {
          const selected = value === maxRetries;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onChange(value)}
              aria-pressed={selected}
              style={{
                ...OPTION_BUTTON,
                background: selected
                  ? 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))'
                  : OPTION_BUTTON.background,
                borderColor: selected ? 'var(--accent)' : 'var(--border-default)',
                color: selected ? 'var(--accent)' : OPTION_BUTTON.color,
                boxShadow: selected
                  ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent)'
                  : 'none',
              }}
            >
              <span style={{ whiteSpace: 'nowrap' }}>{value} 次</span>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.4 }}>
          <span style={{ whiteSpace: 'nowrap' }}>0 次</span>表示遇到上游错误后立即停止；
          <span style={{ whiteSpace: 'nowrap' }}>3 次</span>表示首次失败后最多再尝试
          <span style={{ whiteSpace: 'nowrap' }}>3 次</span>。
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={!hasUnsavedChanges || isSaving}
          style={{
            ...BP,
            padding: '5px 12px',
            opacity: !hasUnsavedChanges || isSaving ? 0.6 : 1,
            cursor: !hasUnsavedChanges || isSaving ? 'not-allowed' : 'pointer',
          }}
        >
          {isSaving ? '保存中…' : hasUnsavedChanges ? '应用策略' : '已应用'}
        </button>
      </div>
    </section>
  );
}
