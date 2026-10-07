/**
 * ComposerStatsBar — 输入框下方统计信息栏
 *
 * 布局契约：恒定单行。宽度不足时按优先级裁掉低价值项（推理 / 缓存 / 隐藏 /
 * 压缩等），仍不足则进入紧凑模式——隐藏文字标签，只留图标 + 数值，
 * 完整数值仍可悬停查看 tooltip。
 *
 * 数值按语义分色：输入=靛蓝(aux)、输出=accent、推理=珊瑚(complement)、
 * 缓存读=success、缓存写=琥珀(contrast)、上下文=动态阈值色。
 */

import React, { useMemo } from 'react';
import {
  buildComposerStatEntries,
  formatDuration,
  formatDurationLong,
  STATS_BAR_ICON,
  type ComposerStatEntry,
  type ComposerStatsData,
  type StatsBarIconName,
} from './composer-stats-bar-entries.js';
import { useStatsBarFit } from './use-stats-bar-fit.js';

export type { ComposerStatsData } from './composer-stats-bar-entries.js';

// ─── 图标 ──────────────────────────────────────────────────────────────────

const ip = {
  width: 11,
  height: 11,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const ICON_PATHS: Record<StatsBarIconName, React.ReactNode> = {
  [STATS_BAR_ICON.token]: <path d="M4 7h16M4 12h16M4 17h10" />,
  [STATS_BAR_ICON.input]: <path d="M12 5v14M19 12l-7 7-7-7" />,
  [STATS_BAR_ICON.output]: <path d="M12 19V5M5 12l7-7 7 7" />,
  [STATS_BAR_ICON.reasoning]: (
    <>
      <path d="M9.5 9a2.5 2.5 0 1 1 5 0c0 1.6-1.5 2.2-2.2 2.8-.4.3-.6.7-.6 1.2" />
      <circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />
      <path d="M12 2a8.5 8.5 0 0 0-5.7 14.8c.4.4.7.9.8 1.5l.2 1.1a1.4 1.4 0 0 0 1.4 1.1h6.6a1.4 1.4 0 0 0 1.4-1.1l.2-1.1c.1-.6.4-1.1.8-1.5A8.5 8.5 0 0 0 12 2Z" />
    </>
  ),
  [STATS_BAR_ICON.cache]: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5" />
      <path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" />
    </>
  ),
  [STATS_BAR_ICON.context]: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 8h10M7 12h6" />
    </>
  ),
  [STATS_BAR_ICON.window]: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 3v18" />
    </>
  ),
  [STATS_BAR_ICON.turns]: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" />
    </>
  ),
  [STATS_BAR_ICON.server]: (
    <>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <path d="M6 6h.01M6 18h.01" />
    </>
  ),
  [STATS_BAR_ICON.hidden]: (
    <>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </>
  ),
  [STATS_BAR_ICON.compaction]: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </>
  ),
  [STATS_BAR_ICON.child]: (
    <>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  [STATS_BAR_ICON.task]: (
    <>
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  [STATS_BAR_ICON.speed]: <path d="M13 2L3 14h9l-1 8 10-12h-9z" />,
  [STATS_BAR_ICON.latency]: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  [STATS_BAR_ICON.round]: (
    <>
      <path d="M10 2h4" />
      <path d="M12 14v-4" />
      <circle cx="12" cy="14" r="8" />
    </>
  ),
  [STATS_BAR_ICON.duration]: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

function renderIcon(name: StatsBarIconName): React.ReactNode {
  return <svg {...ip}>{ICON_PATHS[name]}</svg>;
}

// ─── 单项渲染 ────────────────────────────────────────────────────────────────

const StatItem: React.FC<{ entry: ComposerStatEntry }> = React.memo(function StatItem({ entry }) {
  const vc = entry.valueColor ?? 'var(--fg-default)';
  return (
    <div
      className="composer-stats-bar__item"
      title={entry.title}
      style={{
        color: entry.highlight ? 'var(--fg-strong)' : 'var(--fg-muted)',
      }}
    >
      <span
        aria-hidden="true"
        className="composer-stats-bar__icon"
        style={{
          opacity: entry.highlight ? 0.95 : 0.75,
          color: vc,
        }}
      >
        {entry.icon ? renderIcon(entry.icon) : null}
      </span>
      <span className="composer-stats-bar__label">{entry.label}</span>
      <span
        className="composer-stats-bar__value"
        style={{ color: vc, fontVariantNumeric: 'tabular-nums' }}
      >
        {entry.value}
      </span>
      {entry.meterPct != null && entry.meterColor && (
        <span className="composer-stats-bar__meter">
          <span className="composer-stats-bar__meter-track">
            <span
              className="composer-stats-bar__meter-fill"
              style={{
                width: `${Math.min(100, Math.max(0, entry.meterPct))}%`,
                background: entry.meterColor,
              }}
            />
          </span>
          <span className="composer-stats-bar__meter-pct" style={{ color: entry.meterColor }}>
            {entry.meterPct}%
          </span>
        </span>
      )}
    </div>
  );
});

const Separator: React.FC = () => <span className="composer-stats-bar__separator" />;

const Note: React.FC<{ entry: ComposerStatEntry }> = React.memo(function Note({ entry }) {
  return (
    <span className="composer-stats-bar__note" title={entry.title}>
      {entry.value}
    </span>
  );
});

// ─── 主组件 ────────────────────────────────────────────────────────────────

export interface ComposerStatsBarProps {
  data: ComposerStatsData | null;
  variant?: 'home' | 'session';
}

export const CompactComposerStatsSummary: React.FC<ComposerStatsBarProps> = React.memo(
  function CompactComposerStatsSummary({ data }) {
    const contextPct = useMemo(() => {
      if (!data || data.contextMaxTokens <= 0) return null;
      return Math.min(100, Math.round((data.contextUsedTokens / data.contextMaxTokens) * 100));
    }, [data]);

    const contextColor = useMemo(() => {
      if (contextPct == null) return 'var(--fg-muted)';
      if (contextPct >= 90) return 'var(--danger)';
      if (contextPct >= 70) return 'var(--warning)';
      return 'var(--accent)';
    }, [contextPct]);

    if (!data || (data.messageTurns === 0 && !data.streaming)) return null;

    const summaryItems: Array<{
      readonly label: string;
      readonly value: string;
      readonly valueColor: string;
    }> = [];

    if (contextPct != null) {
      summaryItems.push({
        label: '上下文',
        value: `${contextPct}%`,
        valueColor: contextColor,
      });
    }

    if (data.latestCompactionRepresentedMessages && data.latestCompactionRepresentedMessages > 0) {
      summaryItems.push({
        label: '摘要',
        value: `${data.latestCompactionRepresentedMessages} 条`,
        valueColor: 'var(--warning)',
      });
    } else if (data.compactionCount > 0) {
      summaryItems.push({
        label: '压缩',
        value: data.latestCompactionTrigger === 'manual' ? '手动' : '已生效',
        valueColor: 'var(--warning)',
      });
    }

    if (data.currentRoundDurationMs != null && data.currentRoundDurationMs > 0) {
      summaryItems.push({
        label: data.streaming ? '本轮' : '耗时',
        value: formatDuration(data.currentRoundDurationMs),
        valueColor: data.streaming ? 'var(--accent)' : 'var(--fg-default)',
      });
    } else if (data.totalDurationMs > 0) {
      summaryItems.push({
        label: '总耗时',
        value: formatDurationLong(data.totalDurationMs),
        valueColor: 'var(--fg-default)',
      });
    }

    if (summaryItems.length === 0) {
      summaryItems.push({
        label: '轮数',
        value: String(data.messageTurns),
        valueColor: 'var(--aux)',
      });
    }

    return (
      <div className="composer-stats-summary">
        {summaryItems.map((item) => (
          <span key={`${item.label}-${item.value}`} className="composer-stats-summary__item">
            <span>{item.label}</span>
            <span style={{ color: item.valueColor, fontWeight: 600 }}>{item.value}</span>
          </span>
        ))}
        {data.contextIsEstimated && <span className="composer-stats-bar__note">* 估算</span>}
      </div>
    );
  },
);

export const ComposerStatsBar: React.FC<ComposerStatsBarProps> = React.memo(
  function ComposerStatsBar({ data }) {
    const contextPct = useMemo(() => {
      if (!data || data.contextMaxTokens <= 0) return null;
      return Math.min(100, Math.round((data.contextUsedTokens / data.contextMaxTokens) * 100));
    }, [data]);

    const contextColor = useMemo(() => {
      if (contextPct == null) return undefined;
      if (contextPct >= 90) return 'var(--danger)';
      if (contextPct >= 70) return 'var(--warning)';
      return 'var(--success)';
    }, [contextPct]);

    const entries = useMemo(
      () => buildComposerStatEntries(data, { contextPct, contextColor }),
      [data, contextPct, contextColor],
    );

    const { containerRef, fit } = useStatsBarFit(
      entries.map((entry) => ({
        kind: entry.kind,
        label: entry.label,
        value: entry.value,
        hasMeter: entry.meterPct != null,
        priority: entry.priority,
      })),
    );

    if (!data || (data.messageTurns === 0 && !data.streaming)) return null;

    // 首位可见项之前的分隔线没有意义，直接不渲染。
    const firstVisibleIndex = entries.findIndex((_, index) => fit.visible[index] !== false);

    return (
      <div
        ref={containerRef}
        role="group"
        aria-label="会话统计"
        className={`composer-stats-bar${fit.compact ? ' composer-stats-bar--compact' : ''}`}
      >
        {entries.map((entry, index) => {
          if (fit.visible[index] === false) return null;
          if (entry.kind === 'separator') {
            if (fit.compact || index === firstVisibleIndex) return null;
            return <Separator key={`separator-${index}`} />;
          }
          if (entry.kind === 'note') return <Note key={entry.key} entry={entry} />;
          return <StatItem key={entry.key} entry={entry} />;
        })}
      </div>
    );
  },
);
