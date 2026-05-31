/**
 * 260530-team-page · content-kit · MetricGrid
 *
 * 统一的"指标卡自适应网格"容器，替换各 tab 复制的
 * `repeat(auto-fill, minmax(160px, 1fr))` 内联写法。
 */

import type { CSSProperties, ReactNode } from 'react';
import { CK_GAP } from './content-kit-tokens.js';

export interface MetricGridProps {
  children: ReactNode;
  /** 每列最小宽度，默认 160。 */
  minColumnWidth?: number;
  /** 列填充策略，默认 auto-fill（不拉伸最后一行）。 */
  fill?: 'auto-fill' | 'auto-fit';
  gap?: number;
  style?: CSSProperties;
}

export function MetricGrid({
  children,
  minColumnWidth = 160,
  fill = 'auto-fill',
  gap = CK_GAP,
  style,
}: MetricGridProps) {
  return (
    <div
      style={{
        display: 'grid',
        gap,
        gridTemplateColumns: `repeat(${fill}, minmax(${minColumnWidth}px, 1fr))`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
