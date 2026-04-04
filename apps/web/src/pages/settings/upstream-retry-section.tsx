import React from 'react';
import { BP, SS, ST } from './settings-section-styles.js';

interface UpstreamRetrySectionProps {
  isSaving: boolean;
  maxRetries: number;
  onChange: (value: number) => void;
  onSave: () => void;
  savedMaxRetries: number;
}

const OPTION_BUTTON: React.CSSProperties = {
  minWidth: 40,
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-2)',
  padding: '7px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
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
    <section style={SS}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220, flex: '1 1 260px' }}>
          <h3 style={ST}>上游失败自动重试</h3>
          <p
            style={{
              margin: '4px 0 0',
              color: 'var(--text-2)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            当模型上游出现短暂性错误时，网关会在停止前自动重试。该策略也会同步应用到后台子代理。
          </p>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
            color: 'var(--accent)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          当前值
          <span style={{ color: 'var(--text)', fontWeight: 700 }}>{savedMaxRetries}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                  ? 'color-mix(in srgb, var(--accent) 16%, var(--surface))'
                  : OPTION_BUTTON.background,
                borderColor: selected ? 'var(--accent)' : 'var(--border)',
                color: selected ? 'var(--accent)' : OPTION_BUTTON.color,
                boxShadow: selected
                  ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent)'
                  : 'none',
              }}
            >
              {value} 次
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: 'var(--text-3)', fontSize: 12, lineHeight: 1.5 }}>
          0 次表示遇到上游错误后立即停止；3 次表示首次失败后最多再尝试 3 次。
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={!hasUnsavedChanges || isSaving}
          style={{
            ...BP,
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
