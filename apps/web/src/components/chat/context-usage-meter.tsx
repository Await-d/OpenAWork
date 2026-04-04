import { useMemo } from 'react';

export interface ContextUsageMeterProps {
  usedTokens: number;
  maxTokens: number;
  estimated?: boolean;
}

const WARN_THRESHOLD = 70;
const DANGER_THRESHOLD = 90;

function stateColor(pct: number): string {
  if (pct >= DANGER_THRESHOLD) return 'var(--danger)';
  if (pct >= WARN_THRESHOLD) return 'var(--warning)';
  return 'var(--success)';
}

function stateBgColor(pct: number): string {
  if (pct >= DANGER_THRESHOLD) return 'color-mix(in oklch, var(--danger) 14%, transparent)';
  if (pct >= WARN_THRESHOLD) return 'color-mix(in oklch, var(--warning) 12%, transparent)';
  return 'color-mix(in oklch, var(--success) 10%, transparent)';
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function ContextUsageMeter({
  usedTokens,
  maxTokens,
  estimated = false,
}: ContextUsageMeterProps) {
  const safeUsedTokens = Math.max(0, usedTokens);
  const rawPct = useMemo(
    () => (maxTokens > 0 ? Math.max(0, Math.round((safeUsedTokens / maxTokens) * 100)) : 0),
    [safeUsedTokens, maxTokens],
  );
  const pct = useMemo(() => Math.min(100, rawPct), [rawPct]);
  const clampedAriaValue = useMemo(
    () => (maxTokens > 0 ? Math.min(safeUsedTokens, maxTokens) : 0),
    [maxTokens, safeUsedTokens],
  );
  const overLimit = safeUsedTokens > maxTokens;

  const color = stateColor(pct);
  const bgTint = stateBgColor(pct);
  const visiblePctLabel = `${estimated ? '≈' : ''}${rawPct}%`;
  const label = `${estimated ? '上下文估算已用' : '上下文已用'} ${fmtTokens(safeUsedTokens)} / ${fmtTokens(maxTokens)}（${rawPct}%）${overLimit ? '，已接近或超过上下文窗口' : ''}`;
  const title = `${label}${estimated ? ' · 基于当前会话消息与流式输出估算' : ''}`;

  return (
    <div
      data-testid="chat-context-usage-meter"
      role="meter"
      aria-label="上下文用量"
      aria-valuenow={clampedAriaValue}
      aria-valuemin={0}
      aria-valuemax={maxTokens}
      aria-valuetext={label}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 22,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 52,
          height: 16,
          borderRadius: 4,
          border: `1px solid ${color}`,
          background: bgTint,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 1,
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              minWidth: pct > 0 ? 2 : 0,
              borderRadius: 2,
              background: color,
              opacity: 0.82,
              transition: 'width 400ms cubic-bezier(.4,0,.2,1), background 300ms ease',
            }}
          />
        </div>
      </div>

      <div
        aria-hidden="true"
        style={{
          width: 3,
          height: 8,
          borderRadius: '0 2px 2px 0',
          background: color,
          opacity: 0.5,
          marginLeft: -3,
          flexShrink: 0,
        }}
      />

      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          lineHeight: 1,
          color,
          transition: 'color 300ms ease',
          flexShrink: 0,
        }}
      >
        {visiblePctLabel}
      </span>
    </div>
  );
}
