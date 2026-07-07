/**
 * 260530-team-page · content-kit · EmptyState
 *
 * 统一空态，替换各 tab 复制的 EMPTY_STYLE（emoji + 标题 + 说明 + 可选 CTA）。
 *
 * 用法：
 *   <EmptyState icon={<Icon />} title="暂无用量数据" description="…" />
 *   <EmptyState emoji="📭" title="当前层级暂无 handoff" compact />
 */

import type { CSSProperties, ReactNode } from 'react';
import { CK_DASHED_BORDER, CK_RADIUS_LG } from './content-kit-tokens.js';

export interface EmptyStateProps {
  emoji?: string;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** 可选行动按钮 / 自定义节点。 */
  action?: ReactNode;
  /** 紧凑模式：更小的 padding / 字号，用于面板内嵌空态。 */
  compact?: boolean;
  style?: CSSProperties;
}

export function EmptyState({
  emoji = '🗂️',
  icon,
  title,
  description,
  action,
  compact = false,
  style,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'grid',
        placeItems: 'center',
        gap: compact ? 4 : 6,
        padding: compact ? 18 : 32,
        borderRadius: CK_RADIUS_LG,
        border: CK_DASHED_BORDER,
        color: 'var(--fg-muted)',
        fontSize: compact ? 12 : 13,
        textAlign: 'center',
        ...style,
      }}
    >
      {icon ? (
        <span style={{ color: 'var(--fg-muted)' }} aria-hidden>
          {icon}
        </span>
      ) : (
        <span style={{ fontSize: compact ? 22 : 26 }} aria-hidden>
          {emoji}
        </span>
      )}
      <strong style={{ color: 'var(--fg-default)' }}>{title}</strong>
      {description ? <span style={{ maxWidth: 420, lineHeight: 1.5 }}>{description}</span> : null}
      {action ? <div style={{ marginTop: compact ? 2 : 6 }}>{action}</div> : null}
    </div>
  );
}
