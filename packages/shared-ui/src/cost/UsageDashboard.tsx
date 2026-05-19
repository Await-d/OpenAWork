import { color } from '../tokens.js';
import type { CSSProperties } from 'react';

export interface MonthlyRecord {
  month: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: Record<string, number>;
}

export interface UsageDashboardProps {
  records: MonthlyRecord[];
  budgetUsd?: number;
  style?: CSSProperties;
}

export function UsageDashboard({ records, budgetUsd, style }: UsageDashboardProps) {
  const maxCost = Math.max(...records.map((r) => r.totalCostUsd), 0.0001);
  return (
    <div
      style={{
        background: 'var(--bg-overlay, #121721)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 10,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          padding: '0.6rem 1rem',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--fg-muted, #7b8a9e)',
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        }}
      >
        月度用量
      </div>
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {records.map((r) => {
          const pct = Math.min((r.totalCostUsd / maxCost) * 100, 100);
          const budgetPct = budgetUsd ? Math.min((r.totalCostUsd / budgetUsd) * 100, 100) : null;
          return (
            <div key={r.month}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong, #f1f4f8)' }}
                >
                  {r.month}
                </span>
                <span style={{ fontSize: 12, color: color.success, fontWeight: 700 }}>
                  ${r.totalCostUsd.toFixed(4)}
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: 'var(--bg-base, #080b12)',
                  overflow: 'hidden',
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background:
                      budgetPct && budgetPct >= 100
                        ? color.danger
                        : budgetPct && budgetPct >= 80
                          ? color.contrast
                          : 'var(--accent, #5cd4c0)',
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--fg-muted, #7b8a9e)',
                  display: 'flex',
                  gap: 12,
                }}
              >
                <span>{r.totalInputTokens.toLocaleString()} 输入</span>
                <span>{r.totalOutputTokens.toLocaleString()} 输出</span>
                {budgetUsd && <span>{budgetPct?.toFixed(0)}% 预算</span>}
              </div>
            </div>
          );
        })}
        {records.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--fg-muted, #7b8a9e)' }}>暂无用量数据。</div>
        )}
      </div>
      {budgetUsd && (
        <div
          style={{
            padding: '0.5rem 1rem',
            borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            fontSize: 11,
            color: 'var(--fg-muted, #7b8a9e)',
          }}
        >
          预算：${budgetUsd.toFixed(2)}
        </div>
      )}
    </div>
  );
}
