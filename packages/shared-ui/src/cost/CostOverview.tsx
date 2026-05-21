import type { CSSProperties } from 'react';

export interface CostBreakdownItem {
  modelName: string;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface CostOverviewProps {
  monthlyCostUsd: number;
  breakdown: CostBreakdownItem[];
  style?: CSSProperties;
}

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  });
}

const thStyle: CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--fg-muted)',
  textAlign: 'left',
  borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
};

const tdStyle: CSSProperties = {
  padding: '0.6rem 0.75rem',
  fontSize: 12,
  color: 'var(--fg-default)',
  verticalAlign: 'middle',
};

const tdMutedStyle: CSSProperties = {
  ...tdStyle,
  color: 'var(--fg-muted)',
};

export function CostOverview({ monthlyCostUsd, breakdown, style }: CostOverviewProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--fg-default)',
        ...style,
      }}
    >
      <div
        style={{
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          borderRadius: 12,
          padding: '1.5rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Current Month Total</span>
        <span
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--fg-default)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatUsd(monthlyCostUsd)}
        </span>
      </div>

      <div
        style={{
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '1rem 1.5rem',
            borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>按模型费用</h2>
        </div>

        {breakdown.length === 0 ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--fg-muted)',
              fontSize: 12,
            }}
          >
            No usage recorded this month.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>模型</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>输入</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>输出</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>合计</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row, idx) => (
                <tr
                  key={row.modelName}
                  style={{
                    borderBottom:
                      idx < breakdown.length - 1
                        ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))'
                        : 'none',
                  }}
                >
                  <td style={tdStyle}>{row.modelName}</td>
                  <td
                    style={{
                      ...tdMutedStyle,
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatUsd(row.inputCost)}
                  </td>
                  <td
                    style={{
                      ...tdMutedStyle,
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatUsd(row.outputCost)}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: 'right',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatUsd(row.totalCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
