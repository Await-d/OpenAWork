import type { CSSProperties } from 'react';

export interface BudgetAlertProps {
  currentCostUsd: number;
  budgetUsd: number;
  onDismiss?: () => void;
  style?: CSSProperties;
}

export function BudgetAlert({ currentCostUsd, budgetUsd, onDismiss, style }: BudgetAlertProps) {
  const ratio = budgetUsd > 0 ? currentCostUsd / budgetUsd : 0;
  if (ratio < 0.8) return null;
  const isOver = ratio >= 1;
  const bg = isOver ? 'rgba(248,113,113,0.12)' : 'rgba(251,191,36,0.12)';
  const border = isOver ? '#f87171' : '#fbbf24';
  const color = isOver ? '#f87171' : '#fbbf24';
  const icon = isOver ? '✗' : '⚠';
  const msg = isOver
    ? `超出预算：$${currentCostUsd.toFixed(4)} / $${budgetUsd.toFixed(4)}`
    : `接近预算：$${currentCostUsd.toFixed(4)} / $${budgetUsd.toFixed(4)}（${Math.round(ratio * 100)}%）`;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0.6rem 1rem',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        fontSize: 12,
        color,
        ...style,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ flex: 1 }}>{msg}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color,
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
