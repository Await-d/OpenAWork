import type { CSSProperties } from 'react';

export interface ModelCostDisplayProps {
  modelName: string;
  inputPer1m: number;
  outputPer1m: number;
  cachedPer1m?: number;
  style?: CSSProperties;
}

function formatCost(value: number): string {
  if (value === 0) return 'free';
  if (value < 0.01) return `$${value.toFixed(4)}/1M`;
  return `$${value.toFixed(2)}/1M`;
}

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.4rem 0',
  borderBottom: '1px solid var(--color-border, #334155)',
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-muted, #94a3b8)',
};

const valueStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text, #e2e8f0)',
  fontFamily: 'monospace',
};

export function ModelCostDisplay({
  modelName,
  inputPer1m,
  outputPer1m,
  cachedPer1m,
  style,
}: ModelCostDisplayProps) {
  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        padding: '0.75rem 1rem',
        fontFamily: 'system-ui, sans-serif',
        ...style,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-text, #e2e8f0)',
          marginBottom: '0.6rem',
        }}
      >
        {modelName}
      </div>

      <div style={{ ...rowStyle }}>
        <span style={labelStyle}>输入</span>
        <span style={valueStyle}>{formatCost(inputPer1m)} /M</span>
      </div>

      <div style={{ ...rowStyle }}>
        <span style={labelStyle}>输出</span>
        <span style={valueStyle}>{formatCost(outputPer1m)} /M</span>
      </div>

      {cachedPer1m !== undefined && (
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={labelStyle}>缓存</span>
          <span
            style={{
              ...valueStyle,
              color: '#34d399',
            }}
          >
            {formatCost(cachedPer1m)} cached
          </span>
        </div>
      )}
    </div>
  );
}
