/**
 * ComposerStatsBar 的数据组装层：把统计快照摊平成有序的渲染项。
 *
 * 组装与渲染分离的理由：优先级表、格式化、颜色语义都属于数据决策，
 * 留在组件里会让渲染逻辑被大量条件分支淹没。
 *
 * 优先级约定：数值越大越先被裁掉，0 表示永不隐藏（详见 composer-stats-bar-fit.ts）。
 */

import type { StatsBarItemKind } from './composer-stats-bar-fit.js';

export const STATS_BAR_ICON = {
  token: 'token',
  input: 'input',
  output: 'output',
  reasoning: 'reasoning',
  cache: 'cache',
  context: 'context',
  window: 'window',
  turns: 'turns',
  server: 'server',
  hidden: 'hidden',
  compaction: 'compaction',
  child: 'child',
  task: 'task',
  speed: 'speed',
  latency: 'latency',
  round: 'round',
  duration: 'duration',
} as const;

export type StatsBarIconName = (typeof STATS_BAR_ICON)[keyof typeof STATS_BAR_ICON];

// ─── 裁剪优先级 ──────────────────────────────────────────────────────────────

const PRIORITY = {
  /** 核心四项：输入 / 输出 / 上下文 / 轮数。 */
  core: 0,
  /** 流式期间的实时指标。 */
  live: 5,
  /** 时延类指标（次要，但保留价值高）。 */
  latency: 10,
  childSession: 15,
  window: 20,
  serverTurns: 25,
  cacheRead: 30,
  cacheWrite: 35,
  reasoning: 40,
  hidden: 45,
  compaction: 50,
  task: 55,
  /** 总 Token 与输入/输出重复，优先让位。 */
  totalToken: 60,
  /** 「* 估算」脚注——对应信息已写进各项 tooltip。 */
  note: 80,
} as const;

// ─── 语义色彩 ────────────────────────────────────────────────────────────────

const COLOR_INPUT = 'var(--aux)';
const COLOR_OUTPUT = 'var(--accent)';
const COLOR_REASONING = 'var(--complement)';
const COLOR_CACHE = 'var(--success)';
const COLOR_SPEED = 'var(--accent)';
const COLOR_LATENCY = 'var(--contrast)';
const COLOR_DURATION = 'var(--fg-default)';
const COLOR_COUNT = 'var(--aux)';
const COLOR_COMPACTION = 'var(--warning)';

// ─── 格式化 ──────────────────────────────────────────────────────────────────

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m${rem}s`;
}

export function formatDurationLong(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m${rem}s`;
}

// ─── 类型 ────────────────────────────────────────────────────────────────────

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

export interface ComposerStatEntry {
  readonly key: string;
  readonly kind: StatsBarItemKind;
  readonly icon?: StatsBarIconName;
  readonly label: string;
  readonly value: string;
  readonly valueColor?: string;
  readonly title: string;
  readonly highlight?: boolean;
  readonly meterPct?: number;
  readonly meterColor?: string;
  readonly priority: number;
}

export interface ComposerStatsContext {
  /** 上下文占用百分比（未取模时为 null）。 */
  readonly contextPct: number | null;
  /** 上下文占用的语义色。 */
  readonly contextColor: string | undefined;
}

const SEPARATOR: ComposerStatEntry = {
  key: 'separator',
  kind: 'separator',
  label: '',
  value: '',
  title: '',
  priority: PRIORITY.core,
};

export function buildComposerStatEntries(
  data: ComposerStatsData | null,
  { contextPct, contextColor }: ComposerStatsContext,
): ComposerStatEntry[] {
  if (!data) return [];

  const entries: ComposerStatEntry[] = [
    {
      key: 'total-token',
      kind: 'stat',
      icon: STATS_BAR_ICON.token,
      label: 'Token',
      value: formatTokenCount(data.totalInputTokens + data.totalOutputTokens),
      valueColor: COLOR_OUTPUT,
      title: `输入 ${formatTokenCount(data.totalInputTokens)} · 输出 ${formatTokenCount(data.totalOutputTokens)}`,
      priority: PRIORITY.totalToken,
    },
    {
      key: 'input',
      kind: 'stat',
      icon: STATS_BAR_ICON.input,
      label: '输入',
      value: formatTokenCount(data.totalInputTokens),
      valueColor: COLOR_INPUT,
      title: `累计输入 Token：${data.totalInputTokens.toLocaleString()}`,
      priority: PRIORITY.core,
    },
    {
      key: 'output',
      kind: 'stat',
      icon: STATS_BAR_ICON.output,
      label: '输出',
      value: formatTokenCount(data.totalOutputTokens),
      valueColor: COLOR_OUTPUT,
      title: `累计输出 Token：${data.totalOutputTokens.toLocaleString()}`,
      priority: PRIORITY.core,
    },
  ];

  if (data.reasoningTokens != null && data.reasoningTokens > 0) {
    entries.push({
      key: 'reasoning',
      kind: 'stat',
      icon: STATS_BAR_ICON.reasoning,
      label: '推理',
      value: formatTokenCount(data.reasoningTokens),
      valueColor: COLOR_REASONING,
      title: `推理 Token：${data.reasoningTokens.toLocaleString()}`,
      highlight: data.streaming,
      priority: PRIORITY.reasoning,
    });
  }

  if (data.cacheReadTokens != null && data.cacheReadTokens > 0) {
    entries.push({
      key: 'cache-read',
      kind: 'stat',
      icon: STATS_BAR_ICON.cache,
      label: '缓存读',
      value: formatTokenCount(data.cacheReadTokens),
      valueColor: COLOR_CACHE,
      title: `缓存读取 Token：${data.cacheReadTokens.toLocaleString()}`,
      highlight: data.streaming,
      priority: PRIORITY.cacheRead,
    });
  }

  if (data.cacheWriteTokens != null && data.cacheWriteTokens > 0) {
    entries.push({
      key: 'cache-write',
      kind: 'stat',
      icon: STATS_BAR_ICON.cache,
      label: '缓存写',
      value: formatTokenCount(data.cacheWriteTokens),
      valueColor: 'var(--contrast)',
      title: `缓存写入 Token：${data.cacheWriteTokens.toLocaleString()}`,
      highlight: data.streaming,
      priority: PRIORITY.cacheWrite,
    });
  }

  entries.push(SEPARATOR);

  if (contextPct != null) {
    entries.push({
      key: 'context',
      kind: 'stat',
      icon: STATS_BAR_ICON.context,
      label: '上下文',
      value: formatTokenCount(data.contextUsedTokens),
      valueColor: contextColor,
      meterPct: contextPct,
      meterColor: contextColor,
      title: data.contextIsEstimated
        ? `估算上下文：${data.contextUsedTokens.toLocaleString()} / ${data.contextMaxTokens.toLocaleString()} (${contextPct}%)`
        : `上下文：${data.contextUsedTokens.toLocaleString()} / ${data.contextMaxTokens.toLocaleString()} (${contextPct}%)`,
      highlight: contextPct >= 70,
      priority: PRIORITY.core,
    });
  }

  if (data.contextMaxTokens > 0) {
    entries.push({
      key: 'window',
      kind: 'stat',
      icon: STATS_BAR_ICON.window,
      label: '窗口',
      value: formatTokenCount(data.contextMaxTokens),
      valueColor: COLOR_INPUT,
      title: `模型上下文窗口：${data.contextMaxTokens.toLocaleString()} tokens`,
      priority: PRIORITY.window,
    });
  }

  entries.push(SEPARATOR);

  entries.push({
    key: 'turns',
    kind: 'stat',
    icon: STATS_BAR_ICON.turns,
    label: '轮数',
    value: String(data.messageTurns),
    valueColor: COLOR_COUNT,
    title: `助手回复轮数：${data.messageTurns}`,
    priority: PRIORITY.core,
  });

  if (data.serverTotalTurnCount != null && data.serverTotalTurnCount > data.messageTurns) {
    entries.push({
      key: 'server-turns',
      kind: 'stat',
      icon: STATS_BAR_ICON.server,
      label: '总轮数',
      value: String(data.serverTotalTurnCount),
      valueColor: COLOR_COUNT,
      title: `服务端记录的完整轮数：${data.serverTotalTurnCount}`,
      priority: PRIORITY.serverTurns,
    });
  }

  if (data.hiddenMessageCount > 0) {
    entries.push({
      key: 'hidden',
      kind: 'stat',
      icon: STATS_BAR_ICON.hidden,
      label: '隐藏',
      value: String(data.hiddenMessageCount),
      valueColor: COLOR_REASONING,
      title: `被折叠/隐藏的历史消息：${data.hiddenMessageCount}`,
      priority: PRIORITY.hidden,
    });
  }

  if (data.compactionCount > 0) {
    const represented = data.latestCompactionRepresentedMessages ?? 0;
    entries.push({
      key: 'compaction',
      kind: 'stat',
      icon: STATS_BAR_ICON.compaction,
      label: '压缩',
      value: represented > 0 ? `${represented} 条` : `${data.compactionCount} 次`,
      valueColor: COLOR_COMPACTION,
      title:
        represented > 0
          ? `最近一次压缩后，摘要覆盖 ${represented} 条历史消息`
          : `当前会话已发生 ${data.compactionCount} 次上下文压缩`,
      priority: PRIORITY.compaction,
    });
  }

  if (data.childSessionCount > 0) {
    entries.push({
      key: 'child-session',
      kind: 'stat',
      icon: STATS_BAR_ICON.child,
      label: '子会话',
      value: String(data.childSessionCount),
      valueColor: COLOR_OUTPUT,
      title: `子 Agent 运行数：${data.childSessionCount}`,
      priority: PRIORITY.childSession,
    });
  }

  if (data.sessionTaskCount > 0) {
    entries.push({
      key: 'task',
      kind: 'stat',
      icon: STATS_BAR_ICON.task,
      label: '任务',
      value: String(data.sessionTaskCount),
      valueColor: COLOR_COUNT,
      title: `会话任务总数：${data.sessionTaskCount}`,
      priority: PRIORITY.task,
    });
  }

  entries.push(SEPARATOR);

  if (data.streaming && data.tokensPerSecond != null && data.tokensPerSecond > 0) {
    entries.push({
      key: 'speed',
      kind: 'stat',
      icon: STATS_BAR_ICON.speed,
      label: '速度',
      value: `${data.tokensPerSecond.toFixed(1)} tok/s`,
      valueColor: COLOR_SPEED,
      title: `当前输出速率：${data.tokensPerSecond.toFixed(1)} tokens/s`,
      highlight: true,
      priority: PRIORITY.live,
    });
  }

  if (data.firstTokenLatencyMs != null && data.firstTokenLatencyMs > 0) {
    entries.push({
      key: 'latency',
      kind: 'stat',
      icon: STATS_BAR_ICON.latency,
      label: '首token',
      value: formatDuration(data.firstTokenLatencyMs),
      valueColor: COLOR_LATENCY,
      title: `首 Token 延迟：${formatDuration(data.firstTokenLatencyMs)}`,
      priority: PRIORITY.latency,
    });
  }

  if (data.currentRoundDurationMs != null && data.currentRoundDurationMs > 0) {
    entries.push({
      key: 'round-duration',
      kind: 'stat',
      icon: STATS_BAR_ICON.round,
      label: '本轮',
      value: formatDuration(data.currentRoundDurationMs),
      valueColor: data.streaming ? COLOR_OUTPUT : COLOR_DURATION,
      title: `本轮耗时：${formatDuration(data.currentRoundDurationMs)}`,
      highlight: data.streaming,
      priority: PRIORITY.live,
    });
  }

  if (data.totalDurationMs > 0) {
    entries.push({
      key: 'total-duration',
      kind: 'stat',
      icon: STATS_BAR_ICON.duration,
      label: '总耗时',
      value: formatDurationLong(data.totalDurationMs),
      valueColor: COLOR_DURATION,
      title: `会话累计耗时：${formatDurationLong(data.totalDurationMs)}`,
      priority: PRIORITY.latency,
    });
  }

  if (data.contextIsEstimated) {
    entries.push({
      key: 'estimated-note',
      kind: 'note',
      label: '',
      value: '* 估算',
      title: '上下文占用基于当前会话消息与流式输出估算',
      priority: PRIORITY.note,
    });
  }

  return entries;
}
