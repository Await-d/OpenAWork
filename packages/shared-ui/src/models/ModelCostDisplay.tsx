import { color } from '../tokens.js';
import type { CSSProperties } from 'react';

export interface ModelCostDisplayProps {
  modelName: string;
  inputPer1m: number;
  outputPer1m: number;
  contextWindow?: number;
  cacheReadPer1m?: number;
  cacheWritePer1m?: number;
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
  borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
};

const valueStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-default)',
  fontFamily: 'monospace',
};

export function ModelCostDisplay({
  modelName,
  inputPer1m,
  outputPer1m,
  contextWindow,
  cacheReadPer1m,
  cacheWritePer1m,
  cachedPer1m,
  style,
}: ModelCostDisplayProps) {
  return (
    <div
      style={{
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
          color: 'var(--fg-default)',
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

      {contextWindow !== undefined && (
        <div style={{ ...rowStyle }}>
          <span style={labelStyle}>上下文窗口</span>
          <span style={valueStyle}>
            {new Intl.NumberFormat('zh-CN', {
              notation: 'compact',
              maximumFractionDigits: 1,
            }).format(contextWindow)}{' '}
            tokens
          </span>
        </div>
      )}

      {cacheReadPer1m !== undefined && (
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={labelStyle}>缓存读取</span>
          <span
            style={{
              ...valueStyle,
              color: color.success,
            }}
          >
            {formatCost(cacheReadPer1m)} cached
          </span>
        </div>
      )}

      {cacheWritePer1m !== undefined && (
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={labelStyle}>缓存写入</span>
          <span
            style={{
              ...valueStyle,
              color: color.success,
            }}
          >
            {formatCost(cacheWritePer1m)} cached
          </span>
        </div>
      )}

      {cacheReadPer1m === undefined &&
        cacheWritePer1m === undefined &&
        cachedPer1m !== undefined && (
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <span style={labelStyle}>缓存</span>
            <span style={{ ...valueStyle, color: color.success }}>
              {formatCost(cachedPer1m)} cached
            </span>
          </div>
        )}
    </div>
  );
}
