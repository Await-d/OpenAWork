/**
 * ComposerStatsBar — 输入框下方统计信息栏
 *
 * 数值按语义分色：输入=靛蓝(aux)、输出=accent、推理=珊瑚(complement)、
 * 缓存读=success、缓存写=琥珀(contrast)、上下文=动态阈值色。
 */

import React, { useMemo } from 'react';

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m${rem}s`;
}

function formatDurationLong(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m${rem}s`;
}

// ─── 语义色彩常量 ────────────────────────────────────────────────────────────

const COLOR_INPUT = 'var(--aux)';
const COLOR_OUTPUT = 'var(--accent)';
const COLOR_REASONING = 'var(--complement)';
const COLOR_CACHE = 'var(--success)';
const COLOR_SPEED = 'var(--accent)';
const COLOR_LATENCY = 'var(--contrast)';
const COLOR_DURATION = 'var(--fg-default)';
const COLOR_COUNT = 'var(--aux)';
const COLOR_COMPACTION = 'var(--warning)';

// ─── 类型定义 ──────────────────────────────────────────────────────────────

export interface ComposerStatsData {
  /** 累计估算费用（美元）。 */
  totalCostUsd: number;
  /** 当前/最近一轮估算费用（美元）。 */
  currentRoundCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  contextUsedTokens: number;
  contextMaxTokens: number;
  contextIsEstimated: boolean;
  messageTurns: number;
  hiddenMessageCount: number;
  serverTotalTurnCount: number | null;
  compactionCount: number;
  latestCompactionTrigger?: 'manual' | 'automatic';
  latestCompactionRepresentedMessages?: number;
  latestCompactionCompactedMessages?: number;
  childSessionCount: number;
  sessionTaskCount: number;
  tokensPerSecond?: number;
  firstTokenLatencyMs?: number;
  currentRoundDurationMs?: number;
  totalDurationMs: number;
  streaming: boolean;
}

// ─── 单项统计标签 ────────────────────────────────────────────────────────────

interface StatItemProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  pct?: number;
  pctColor?: string;
  highlight?: boolean;
  title?: string;
}

const StatItem: React.FC<StatItemProps> = React.memo(function StatItem({
  icon,
  label,
  value,
  valueColor,
  pct,
  pctColor,
  highlight,
  title,
}) {
  const vc = valueColor ?? 'var(--fg-default)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        lineHeight: 1.4,
        color: highlight ? 'var(--fg-strong)' : 'var(--fg-muted)',
        whiteSpace: 'nowrap',
        transition: 'color 200ms ease',
      }}
      title={title}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 12,
          height: 12,
          flexShrink: 0,
          opacity: highlight ? 0.95 : 0.75,
          color: vc,
        }}
      >
        {icon}
      </span>
      <span style={{ fontWeight: 400 }}>{label}</span>
      <span style={{ fontWeight: 600, color: vc, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
      {pct != null && pctColor && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span
            style={{
              display: 'inline-block',
              width: 36,
              height: 3,
              borderRadius: 9999,
              background: 'var(--border-subtle)',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                display: 'block',
                height: '100%',
                width: `${Math.min(100, Math.max(0, pct))}%`,
                background: pctColor,
                borderRadius: 9999,
                transition: 'width 300ms ease',
              }}
            />
          </span>
          <span
            style={{
              fontSize: 9,
              color: pctColor,
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
            }}
          >
            {pct}%
          </span>
        </span>
      )}
    </div>
  );
});

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

const TokenIcon = (
  <svg {...ip}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
const ArrowDownIcon = (
  <svg {...ip}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);
const ArrowUpIcon = (
  <svg {...ip}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const BrainIcon = (
  <svg {...ip}>
    <path d="M9.5 9a2.5 2.5 0 1 1 5 0c0 1.6-1.5 2.2-2.2 2.8-.4.3-.6.7-.6 1.2" />
    <circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />
    <path d="M12 2a8.5 8.5 0 0 0-5.7 14.8c.4.4.7.9.8 1.5l.2 1.1a1.4 1.4 0 0 0 1.4 1.1h6.6a1.4 1.4 0 0 0 1.4-1.1l.2-1.1c.1-.6.4-1.1.8-1.5A8.5 8.5 0 0 0 12 2Z" />
  </svg>
);
const CacheIcon = (
  <svg {...ip}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5" />
    <path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" />
  </svg>
);
const ContextIcon = (
  <svg {...ip}>
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M7 8h10M7 12h6" />
  </svg>
);
const WindowIcon = (
  <svg {...ip}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 3v18" />
  </svg>
);
const TurnsIcon = (
  <svg {...ip}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 10h.01M12 10h.01M16 10h.01" />
  </svg>
);
const LayersIcon = (
  <svg {...ip}>
    <path d="M12 3 3 8l9 5 9-5-9-5Z" />
    <path d="m3 12 9 5 9-5" />
    <path d="m3 16 9 5 9-5" />
  </svg>
);
const EyeOffIcon = (
  <svg {...ip}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <path d="M1 1l22 22" />
  </svg>
);
const ServerIcon = (
  <svg {...ip}>
    <rect x="2" y="2" width="20" height="8" rx="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" />
    <path d="M6 6h.01M6 18h.01" />
  </svg>
);
const GitBranchIcon = (
  <svg {...ip}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);
const CheckSquareIcon = (
  <svg {...ip}>
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);
const SpeedIcon = (
  <svg {...ip}>
    <path d="M13 2L3 14h9l-1 8 10-12h-9z" />
  </svg>
);
const ClockIcon = (
  <svg {...ip}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const TimerIcon = (
  <svg {...ip}>
    <path d="M10 2h4" />
    <path d="M12 14v-4" />
    <circle cx="12" cy="14" r="8" />
  </svg>
);

const Separator = () => (
  <span
    aria-hidden="true"
    style={{ width: 1, height: 10, background: 'var(--border-subtle)', flexShrink: 0 }}
  />
);

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
        valueColor: COLOR_COMPACTION,
      });
    } else if (data.compactionCount > 0) {
      summaryItems.push({
        label: '压缩',
        value: data.latestCompactionTrigger === 'manual' ? '手动' : '已生效',
        valueColor: COLOR_COMPACTION,
      });
    }

    if (data.currentRoundDurationMs != null && data.currentRoundDurationMs > 0) {
      summaryItems.push({
        label: data.streaming ? '本轮' : '耗时',
        value: formatDuration(data.currentRoundDurationMs),
        valueColor: data.streaming ? COLOR_OUTPUT : COLOR_DURATION,
      });
    } else if (data.totalDurationMs > 0) {
      summaryItems.push({
        label: '总耗时',
        value: formatDurationLong(data.totalDurationMs),
        valueColor: COLOR_DURATION,
      });
    }

    if (summaryItems.length === 0) {
      summaryItems.push({
        label: '轮数',
        value: String(data.messageTurns),
        valueColor: COLOR_COUNT,
      });
    }

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '2px 4px 0',
        }}
      >
        {summaryItems.map((item) => (
          <span
            key={`${item.label}-${item.value}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 8px',
              borderRadius: 999,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-overlay)',
              color: 'var(--fg-muted)',
              fontSize: 10,
              lineHeight: 1.4,
            }}
          >
            <span>{item.label}</span>
            <span style={{ color: item.valueColor, fontWeight: 600 }}>{item.value}</span>
          </span>
        ))}
        {data.contextIsEstimated && (
          <span style={{ fontSize: 9, color: 'var(--fg-subtle)', fontStyle: 'italic' }}>
            * 估算
          </span>
        )}
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

    if (!data || (data.messageTurns === 0 && !data.streaming)) return null;

    const showSpeed = data.streaming && data.tokensPerSecond != null && data.tokensPerSecond > 0;
    const showLatency = data.firstTokenLatencyMs != null && data.firstTokenLatencyMs > 0;
    const showRoundDuration =
      data.currentRoundDurationMs != null && data.currentRoundDurationMs > 0;
    const showReasoning = data.reasoningTokens != null && data.reasoningTokens > 0;
    const showCacheRead = data.cacheReadTokens != null && data.cacheReadTokens > 0;
    const showCacheWrite = data.cacheWriteTokens != null && data.cacheWriteTokens > 0;
    const showHiddenMessages = data.hiddenMessageCount > 0;
    const showServerTurns =
      data.serverTotalTurnCount != null && data.serverTotalTurnCount > data.messageTurns;
    const showCompaction = data.compactionCount > 0;
    const showChildSessions = data.childSessionCount > 0;
    const showSessionTasks = data.sessionTaskCount > 0;

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 4px 0',
          flexWrap: 'wrap',
          rowGap: 2,
        }}
      >
        <StatItem
          icon={TokenIcon}
          label="Token"
          value={formatTokenCount(data.totalInputTokens + data.totalOutputTokens)}
          valueColor={COLOR_OUTPUT}
          title={`输入 ${formatTokenCount(data.totalInputTokens)} · 输出 ${formatTokenCount(data.totalOutputTokens)}`}
        />
        <StatItem
          icon={ArrowDownIcon}
          label="输入"
          value={formatTokenCount(data.totalInputTokens)}
          valueColor={COLOR_INPUT}
          title={`累计输入 Token：${data.totalInputTokens.toLocaleString()}`}
        />
        <StatItem
          icon={ArrowUpIcon}
          label="输出"
          value={formatTokenCount(data.totalOutputTokens)}
          valueColor={COLOR_OUTPUT}
          title={`累计输出 Token：${data.totalOutputTokens.toLocaleString()}`}
        />
        {showReasoning && (
          <StatItem
            icon={BrainIcon}
            label="推理"
            value={formatTokenCount(data.reasoningTokens!)}
            valueColor={COLOR_REASONING}
            highlight={data.streaming}
            title={`推理 Token：${data.reasoningTokens!.toLocaleString()}`}
          />
        )}
        {showCacheRead && (
          <StatItem
            icon={CacheIcon}
            label="缓存读"
            value={formatTokenCount(data.cacheReadTokens!)}
            valueColor={COLOR_CACHE}
            highlight={data.streaming}
            title={`缓存读取 Token：${data.cacheReadTokens!.toLocaleString()}`}
          />
        )}
        {showCacheWrite && (
          <StatItem
            icon={CacheIcon}
            label="缓存写"
            value={formatTokenCount(data.cacheWriteTokens!)}
            valueColor="var(--contrast)"
            highlight={data.streaming}
            title={`缓存写入 Token：${data.cacheWriteTokens!.toLocaleString()}`}
          />
        )}
        <Separator />
        {contextPct != null && (
          <StatItem
            icon={ContextIcon}
            label="上下文"
            value={`${formatTokenCount(data.contextUsedTokens)}/${formatTokenCount(data.contextMaxTokens)}`}
            valueColor={contextColor}
            pct={contextPct}
            pctColor={contextColor}
            highlight={contextPct >= 70}
            title={
              data.contextIsEstimated
                ? `估算上下文：${data.contextUsedTokens.toLocaleString()} / ${data.contextMaxTokens.toLocaleString()} (${contextPct}%)`
                : `上下文：${data.contextUsedTokens.toLocaleString()} / ${data.contextMaxTokens.toLocaleString()} (${contextPct}%)`
            }
          />
        )}
        {data.contextMaxTokens > 0 && (
          <StatItem
            icon={WindowIcon}
            label="窗口"
            value={formatTokenCount(data.contextMaxTokens)}
            valueColor={COLOR_INPUT}
            title={`模型上下文窗口：${data.contextMaxTokens.toLocaleString()} tokens`}
          />
        )}
        <Separator />
        <StatItem
          icon={TurnsIcon}
          label="轮数"
          value={String(data.messageTurns)}
          valueColor={COLOR_COUNT}
          title={`助手回复轮数：${data.messageTurns}`}
        />
        {showServerTurns && (
          <StatItem
            icon={ServerIcon}
            label="总轮数"
            value={String(data.serverTotalTurnCount)}
            valueColor={COLOR_COUNT}
            title={`服务端记录的完整轮数：${data.serverTotalTurnCount}`}
          />
        )}
        {showHiddenMessages && (
          <StatItem
            icon={EyeOffIcon}
            label="隐藏"
            value={String(data.hiddenMessageCount)}
            valueColor={COLOR_REASONING}
            title={`被折叠/隐藏的历史消息：${data.hiddenMessageCount}`}
          />
        )}
        {showCompaction && (
          <StatItem
            icon={LayersIcon}
            label="压缩"
            value={
              data.latestCompactionRepresentedMessages &&
              data.latestCompactionRepresentedMessages > 0
                ? `${data.latestCompactionRepresentedMessages} 条`
                : `${data.compactionCount} 次`
            }
            valueColor={COLOR_COMPACTION}
            title={
              data.latestCompactionRepresentedMessages &&
              data.latestCompactionRepresentedMessages > 0
                ? `最近一次压缩后，摘要覆盖 ${data.latestCompactionRepresentedMessages} 条历史消息`
                : `当前会话已发生 ${data.compactionCount} 次上下文压缩`
            }
          />
        )}
        {showChildSessions && (
          <StatItem
            icon={GitBranchIcon}
            label="子会话"
            value={String(data.childSessionCount)}
            valueColor={COLOR_OUTPUT}
            title={`子 Agent 运行数：${data.childSessionCount}`}
          />
        )}
        {showSessionTasks && (
          <StatItem
            icon={CheckSquareIcon}
            label="任务"
            value={String(data.sessionTaskCount)}
            valueColor={COLOR_COUNT}
            title={`会话任务总数：${data.sessionTaskCount}`}
          />
        )}
        <Separator />
        {showSpeed && (
          <StatItem
            icon={SpeedIcon}
            label="速度"
            value={`${data.tokensPerSecond!.toFixed(1)} tok/s`}
            valueColor={COLOR_SPEED}
            highlight
            title={`当前输出速率：${data.tokensPerSecond!.toFixed(1)} tokens/s`}
          />
        )}
        {showLatency && (
          <StatItem
            icon={ClockIcon}
            label="首token"
            value={formatDuration(data.firstTokenLatencyMs!)}
            valueColor={COLOR_LATENCY}
            title={`首 Token 延迟：${formatDuration(data.firstTokenLatencyMs!)}`}
          />
        )}
        {showRoundDuration && (
          <StatItem
            icon={TimerIcon}
            label="本轮"
            value={formatDuration(data.currentRoundDurationMs!)}
            valueColor={data.streaming ? COLOR_OUTPUT : COLOR_DURATION}
            highlight={data.streaming}
            title={`本轮耗时：${formatDuration(data.currentRoundDurationMs!)}`}
          />
        )}
        {data.totalDurationMs > 0 && (
          <StatItem
            icon={ClockIcon}
            label="总耗时"
            value={formatDurationLong(data.totalDurationMs)}
            valueColor={COLOR_DURATION}
            title={`会话累计耗时：${formatDurationLong(data.totalDurationMs)}`}
          />
        )}
        {data.contextIsEstimated && (
          <span style={{ fontSize: 9, color: 'var(--fg-subtle)', fontStyle: 'italic' }}>
            * 估算
          </span>
        )}
      </div>
    );
  },
);
