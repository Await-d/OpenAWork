/**
 * 260516-team-page-v2 · T-13 · TabPlaceholder
 *
 * 通用「占位 tab」组件：在 TeamPageV2 中间区为尚未接入的 tab 提供
 * 一致的占位 UI（标题 + 简介 + 计划要点 + 数据源提示），便于后续
 * 按 Roadmap 迭代时直接替换为正式实现。
 *
 * 用法：
 *   <TabPlaceholder
 *     title="耗时分析"
 *     subtitle="按 layer / handoff 聚合 P50/P95，绘制甘特图"
 *     bullets={[
 *       '复用 useHandoffStore.handoffs 中 startedAt / updatedAt',
 *       '需要后端补全 startedAt 字段',
 *     ]}
 *     dataSource="useHandoffStore"
 *     status="planned"
 *   />
 */

import type { CSSProperties, ReactNode } from 'react';

export type TabPlaceholderStatus = 'planned' | 'in-progress' | 'data-pending';

export interface TabPlaceholderProps {
  title: string;
  subtitle?: string;
  bullets?: string[];
  dataSource?: string;
  status?: TabPlaceholderStatus;
  emoji?: string;
  /** 额外的自定义内容，渲染在 bullets 之后。 */
  extra?: ReactNode;
}

const CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  overflow: 'auto',
};

const CARD_STYLE: CSSProperties = {
  width: '100%',
  maxWidth: 560,
  display: 'grid',
  gap: 14,
  padding: '24px 28px',
  borderRadius: 16,
  border: '1px dashed color-mix(in srgb, var(--accent) 36%, transparent)',
  background:
    'linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, var(--bg-overlay) 0%, color-mix(in srgb, var(--bg-overlay) 90%, var(--bg-base) 100%)',
};

const STATUS_META: Record<TabPlaceholderStatus, { label: string; color: string; bg: string }> = {
  planned: {
    label: '规划中',
    color: 'var(--fg-default)',
    bg: 'color-mix(in srgb, var(--fg-muted) 18%, transparent)',
  },
  'in-progress': {
    label: '迭代中',
    color: 'var(--accent)',
    bg: 'color-mix(in srgb, var(--accent) 20%, transparent)',
  },
  'data-pending': {
    label: '待数据接入',
    color: 'var(--warning))',
    bg: 'color-mix(in srgb, var(--warning) 22%, transparent)',
  },
};

export function TabPlaceholder({
  title,
  subtitle,
  bullets,
  dataSource,
  status = 'planned',
  emoji = '🚧',
  extra,
}: TabPlaceholderProps) {
  const statusMeta = STATUS_META[status];

  return (
    <div style={CONTAINER_STYLE} role="status" aria-live="polite">
      <div style={CARD_STYLE}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 26 }} aria-hidden>
            {emoji}
          </span>
          <strong style={{ fontSize: 18, color: 'var(--fg-strong)' }}>{title}</strong>
          <span
            style={{
              marginLeft: 'auto',
              padding: '3px 10px',
              borderRadius: 999,
              background: statusMeta.bg,
              color: statusMeta.color,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            {statusMeta.label}
          </span>
        </div>

        {subtitle ? (
          <span style={{ fontSize: 13, color: 'var(--fg-default)', lineHeight: 1.6 }}>{subtitle}</span>
        ) : null}

        {bullets && bullets.length > 0 ? (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'grid',
              gap: 8,
            }}
          >
            {bullets.map((bullet, idx) => (
              <li
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 12,
                  color: 'var(--fg-default)',
                  lineHeight: 1.55,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 6,
                    height: 6,
                    marginTop: 7,
                    borderRadius: 999,
                    background: 'var(--accent)',
                    opacity: 0.7,
                  }}
                />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {dataSource ? (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base))',
              border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
              fontSize: 11,
              color: 'var(--fg-muted)',
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
            }}
          >
            <span style={{ color: 'var(--fg-muted)', marginRight: 6 }}>数据源:</span>
            <code style={{ color: 'var(--fg-default)' }}>{dataSource}</code>
          </div>
        ) : null}

        {extra}
      </div>
    </div>
  );
}
