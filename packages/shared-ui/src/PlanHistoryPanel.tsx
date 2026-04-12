import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { StepRowProps } from './StepRow.js';
import { StepRow } from './StepRow.js';

export interface HistoricalPlan {
  id: string;
  title: string;
  goal: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'skipped';
  createdAt: number;
  steps: StepRowProps[];
}

export interface PlanHistoryPanelProps {
  plans: HistoricalPlan[];
  onReplay?: (planId: string) => void;
  style?: CSSProperties;
}

const STATUS_COLOR: Record<HistoricalPlan['status'], string> = {
  pending: 'var(--color-muted, #94a3b8)',
  running: '#fbbf24',
  paused: '#fb923c',
  completed: '#34d399',
  failed: '#f87171',
  skipped: 'var(--color-muted, #94a3b8)',
};

export function PlanHistoryPanel({ plans, onReplay, style }: PlanHistoryPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
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
        计划历史
      </div>
      {plans.length === 0 && (
        <div style={{ padding: '1rem', fontSize: 12, color: 'var(--color-muted, #94a3b8)' }}>
          暂无历史计划。
        </div>
      )}
      {plans.map((plan, i) => (
        <div
          key={plan.id}
          style={{
            borderBottom: i < plans.length - 1 ? '1px solid var(--color-border, #334155)' : 'none',
          }}
        >
          <button
            type="button"
            onClick={() => toggle(plan.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '0.6rem 1rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--color-muted, #94a3b8)', marginRight: 2 }}>
              {expanded[plan.id] ? '▾' : '▸'}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--color-text, #f1f5f9)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {plan.title}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: STATUS_COLOR[plan.status],
                textTransform: 'uppercase',
              }}
            >
              {plan.status}
            </span>
            <span style={{ fontSize: 10, color: 'var(--color-muted, #94a3b8)' }}>
              {new Date(plan.createdAt).toLocaleDateString()}
            </span>
            {onReplay && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReplay(plan.id);
                }}
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #334155)',
                  background: 'var(--color-bg, #0f172a)',
                  color: 'var(--color-text, #f1f5f9)',
                  cursor: 'pointer',
                }}
              >
                重放
              </button>
            )}
          </button>
          {expanded[plan.id] && (
            <div style={{ padding: '0 1rem 0.75rem 2.5rem' }}>
              {plan.goal && (
                <div
                  style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)', marginBottom: 6 }}
                >
                  {plan.goal}
                </div>
              )}
              {plan.steps.map((step) => (
                <StepRow key={step.id} {...step} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
