import { color } from '../tokens.js';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { StepRowProps } from '../chat/StepRow.js';
import { StepRow } from '../chat/StepRow.js';

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
  pending: 'var(--fg-muted))',
  running: color.contrast,
  paused: color.warning,
  completed: color.success,
  failed: color.danger,
  skipped: 'var(--fg-muted))',
};

export function PlanHistoryPanel({ plans, onReplay, style }: PlanHistoryPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div
      style={{
        background: 'var(--bg-overlay))',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
          color: 'var(--fg-muted))',
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        }}
      >
        计划历史
      </div>
      {plans.length === 0 && (
        <div style={{ padding: '1rem', fontSize: 12, color: 'var(--fg-muted))' }}>
          暂无历史计划。
        </div>
      )}
      {plans.map((plan, i) => (
        <div
          key={plan.id}
          style={{
            borderBottom:
              i < plans.length - 1
                ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))'
                : 'none',
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
            <span style={{ fontSize: 10, color: 'var(--fg-muted))', marginRight: 2 }}>
              {expanded[plan.id] ? '▾' : '▸'}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--fg-strong))',
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
            <span style={{ fontSize: 10, color: 'var(--fg-muted))' }}>
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
                  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                  background: 'var(--bg-base))',
                  color: 'var(--fg-strong))',
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
                <div style={{ fontSize: 11, color: 'var(--fg-muted))', marginBottom: 6 }}>
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
