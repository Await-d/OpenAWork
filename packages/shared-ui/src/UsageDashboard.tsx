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
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
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
          color: 'var(--color-muted, #94a3b8)',
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          borderBottom: '1px solid var(--color-border, #334155)',
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
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text, #f1f5f9)' }}
                >
                  {r.month}
                </span>
                <span style={{ fontSize: 12, color: '#34d399', fontWeight: 700 }}>
                  ${r.totalCostUsd.toFixed(4)}
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: 'var(--color-bg, #0f172a)',
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
                        ? '#f87171'
                        : budgetPct && budgetPct >= 80
                          ? '#fbbf24'
                          : '#6366f1',
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--color-muted, #94a3b8)',
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
          <div style={{ fontSize: 12, color: 'var(--color-muted, #94a3b8)' }}>暂无用量数据。</div>
        )}
      </div>
      {budgetUsd && (
        <div
          style={{
            padding: '0.5rem 1rem',
            borderTop: '1px solid var(--color-border, #334155)',
            fontSize: 11,
            color: 'var(--color-muted, #94a3b8)',
          }}
        >
          预算：${budgetUsd.toFixed(2)}
        </div>
      )}
    </div>
  );
}
