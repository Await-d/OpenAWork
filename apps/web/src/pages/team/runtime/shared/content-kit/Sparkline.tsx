/**
 * 260530-team-page · content-kit · Sparkline
 *
 * 轻量迷你折线图（纯 SVG，无依赖）。用于趋势缩略展示
 * （如用量随时间、活动脉冲等）。
 */

import { useId } from 'react';
import type { CSSProperties } from 'react';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** 是否填充折线下方区域。 */
  fill?: boolean;
  strokeWidth?: number;
  style?: CSSProperties;
  ariaLabel?: string;
}

export function Sparkline({
  values,
  width = 120,
  height = 28,
  color = 'var(--accent)',
  fill = true,
  strokeWidth = 1.5,
  style,
  ariaLabel,
}: SparklineProps) {
  const gradientId = useId();

  if (values.length === 0) {
    return (
      <svg width={width} height={height} style={style} aria-label={ariaLabel} role="img">
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="var(--border-subtle)"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const pad = strokeWidth;

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');

  const lastPoint = points.length > 0 ? points[points.length - 1]! : ([0, 0] as const);
  const firstPoint = points.length > 0 ? points[0]! : ([0, 0] as const);
  const areaPath = `${linePath} L${lastPoint[0].toFixed(2)},${height} L${firstPoint[0].toFixed(2)},${height} Z`;

  return (
    <svg width={width} height={height} style={style} aria-label={ariaLabel} role="img">
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
