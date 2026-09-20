/**
 * 会话面板（概览 / 历史）共用的纯数据模型与格式化函数。
 *
 * 这里只放无副作用、无 React 依赖的纯函数：概览组件（`chat-overview-tab-content.tsx`）
 * 与历史组件（`right-panel-sections.tsx` 的 `ChatHistoryTabContent`）共享同一份压缩 /
 * 流式诊断 / 待办分栏规则，避免两处措辞与判定漂移。
 */

import type { UpstreamStreamSummary } from '@openAwork/shared';

/** 待办条目：会话待办本身 + 分栏标记（主待办 / 临时待办）。 */
export interface SessionTodoItem {
  content: string;
  lane?: 'main' | 'temp';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

export interface CompactionItem {
  id: string;
  summary: string;
  trigger: 'manual' | 'automatic';
  phase?: 'started' | 'completed' | 'failed';
  occurredAt: number;
  compactedMessages?: number;
  representedMessages?: number;
  cause?: 'manual' | 'usage_overflow' | 'provider_overflow' | 'proactive_near_overflow';
  strategy?: 'runtime_replace' | 'summary_only' | 'replay' | 'synthetic_continue';
}

export interface UpstreamSummaryItem {
  id: string;
  occurredAt: number;
  requestId?: string;
  runId?: string;
  summary: UpstreamStreamSummary;
}

export interface UpstreamSummaryRequestGroup {
  key: string;
  label: string;
  items: UpstreamSummaryItem[];
}

export interface UpstreamSummaryGroupCounts {
  errorCount: number;
  stalledCount: number;
  toolCount: number;
}

export function splitSessionTodosByLane(sessionTodos: SessionTodoItem[]): {
  mainTodos: SessionTodoItem[];
  tempTodos: SessionTodoItem[];
} {
  return {
    mainTodos: sessionTodos.filter((todo) => todo.lane !== 'temp'),
    tempTodos: sessionTodos.filter((todo) => todo.lane === 'temp'),
  };
}

export function formatCompactionShortLabel(item: CompactionItem): string {
  const triggerLabel = item.trigger === 'manual' ? '手动' : '自动';
  if (item.phase === 'failed') {
    return `${triggerLabel} · 压缩失败`;
  }
  if (item.phase === 'started') {
    return `${triggerLabel} · 压缩中`;
  }
  if (typeof item.representedMessages === 'number' && item.representedMessages > 0) {
    return `${triggerLabel} · 摘要覆盖 ${item.representedMessages} 条`;
  }
  if (typeof item.compactedMessages === 'number' && item.compactedMessages > 0) {
    return `${triggerLabel} · 压缩 ${item.compactedMessages} 条`;
  }
  return `${triggerLabel} · 已压缩历史`;
}

export function formatCompactionCauseLabel(
  cause: CompactionItem['cause'],
  strategy: CompactionItem['strategy'],
): string | null {
  const causeLabel =
    cause === 'usage_overflow'
      ? '达到上下文上限'
      : cause === 'provider_overflow'
        ? '上游窗口溢出'
        : cause === 'proactive_near_overflow'
          ? '接近上限提前压缩'
          : cause === 'manual'
            ? '手动触发'
            : null;
  const strategyLabel =
    strategy === 'summary_only'
      ? '仅保留摘要'
      : strategy === 'replay'
        ? '按回放尾部保留'
        : strategy === 'synthetic_continue'
          ? '续写模式'
          : strategy === 'runtime_replace'
            ? '运行态替换'
            : null;
  if (causeLabel && strategyLabel) {
    return `${causeLabel} · ${strategyLabel}`;
  }
  return causeLabel ?? strategyLabel;
}

export function formatContextCompactionHint(
  latestCompaction: CompactionItem | null,
  estimated: boolean,
): string {
  if (!latestCompaction) {
    return estimated
      ? '当前值基于前端窗口估算；本轮尚未发生上下文压缩。'
      : '当前会话尚未发生上下文压缩，历史会按原始顺序参与发送。';
  }

  if (latestCompaction.phase === 'failed') {
    return '最近一次压缩未完成；当前上下文仍可能接近上限。';
  }

  if (latestCompaction.phase === 'started') {
    return '最近一次压缩仍在进行中，发送窗口会在完成后更新。';
  }

  return (
    formatCompactionCauseLabel(latestCompaction.cause, latestCompaction.strategy) ??
    formatCompactionShortLabel(latestCompaction)
  );
}

export function formatUpstreamSummaryStatusLabel(summary: UpstreamStreamSummary): string {
  if (summary.stopReason === 'end_turn') return '正常结束';
  if (summary.stopReason === 'tool_use') return '等待工具';
  if (summary.stopReason === 'max_tokens') return '达到上限';
  if (summary.stopReason === 'cancelled') return '已停止';
  if (summary.stopReason === 'tool_permission') return '等待权限';
  return '上游错误';
}

export function formatUpstreamSummaryMetricLine(summary: UpstreamStreamSummary): string {
  const suffix = summary.stalled
    ? ' · stalled'
    : summary.sawError
      ? ' · error'
      : summary.sawDone
        ? ' · done'
        : '';
  return `文本 ${summary.textDeltaCount} / 思考 ${summary.reasoningDeltaCount} / 工具 ${summary.toolCallDeltaCount}${suffix}`;
}

export function groupUpstreamSummariesByRequest(
  items: UpstreamSummaryItem[],
): UpstreamSummaryRequestGroup[] {
  const groups = new Map<string, UpstreamSummaryRequestGroup>();
  for (const item of items) {
    const requestId = item.requestId?.trim();
    const runId = item.runId?.trim();
    const key = requestId ? `request:${requestId}` : runId ? `run:${runId}` : `orphan:${item.id}`;
    const label = requestId ? `请求 ${requestId}` : runId ? `运行 ${runId}` : '未绑定请求';
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(key, { key, label, items: [item] });
  }
  return Array.from(groups.values());
}

export function findUpstreamSummaryGroupByKey(
  items: UpstreamSummaryItem[],
  key: string,
): UpstreamSummaryRequestGroup | null {
  return groupUpstreamSummariesByRequest(items).find((group) => group.key === key) ?? null;
}

export function summarizeUpstreamSummaryGroupCounts(
  group: UpstreamSummaryRequestGroup,
): UpstreamSummaryGroupCounts {
  return group.items.reduce<UpstreamSummaryGroupCounts>(
    (acc, item) => ({
      errorCount:
        acc.errorCount + (item.summary.sawError || item.summary.stopReason === 'error' ? 1 : 0),
      stalledCount: acc.stalledCount + (item.summary.stalled ? 1 : 0),
      toolCount:
        acc.toolCount +
        (item.summary.stopReason === 'tool_use' || item.summary.toolCallDeltaCount > 0 ? 1 : 0),
    }),
    { errorCount: 0, stalledCount: 0, toolCount: 0 },
  );
}

export function formatUpstreamSummaryGroupHeadline(group: UpstreamSummaryRequestGroup): string {
  const counts = summarizeUpstreamSummaryGroupCounts(group);
  return `${group.items.length} 条 · 错误 ${counts.errorCount} / 卡住 ${counts.stalledCount} / 工具 ${counts.toolCount}`;
}

export function buildUpstreamSummaryGroupContextText(
  group: UpstreamSummaryRequestGroup,
  limit = 3,
): string {
  const recentItems = group.items.slice(0, Math.max(0, limit));
  const lines = [group.label, formatUpstreamSummaryGroupHeadline(group)];

  if (recentItems.length > 0) {
    lines.push('最近诊断');
    lines.push(
      ...recentItems.map((item, index) => {
        const timeLabel = new Date(item.occurredAt).toLocaleTimeString('zh-CN', {
          hour12: false,
        });
        return `${index + 1}. ${formatUpstreamSummaryStatusLabel(item.summary)} · ${formatUpstreamSummaryMetricLine(item.summary)} · ${timeLabel}${item.runId ? ` · ${item.runId}` : ''}`;
      }),
    );
  }

  return lines.join('\n');
}
