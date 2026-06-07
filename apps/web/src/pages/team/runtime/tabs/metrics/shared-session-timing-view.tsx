import { useMemo, type CSSProperties } from 'react';
import type { Message } from '@openAwork/shared';
import type {
  SharedSessionCommentRecord,
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
} from '@openAwork/web-client';
import { EmptyState, MetricGrid, StatCard } from '../../shared/content-kit/index.js';

interface TimelineItem {
  detail?: string;
  timestampMs: number;
  title: string;
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function summarizeText(message: Message): string | null {
  const text = message.content
    .flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
    .find((part) => part.length > 0);
  return text ? (text.length > 40 ? `${text.slice(0, 37)}…` : text) : null;
}

function buildAssistantTimeline(messages: Message[]): TimelineItem[] {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message, index) => ({
      detail: summarizeText(message) ?? undefined,
      timestampMs: message.createdAt,
      title: `Assistant 输出 #${index + 1}`,
    }));
}

function buildCommentTimeline(comments: SharedSessionCommentRecord[]): TimelineItem[] {
  return comments.map((comment) => ({
    detail: comment.authorEmail,
    timestampMs: parseIsoMs(comment.createdAt) ?? 0,
    title: comment.content.length > 40 ? `${comment.content.slice(0, 37)}…` : comment.content,
  }));
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  const left = sorted[middle - 1] ?? 0;
  const right = sorted[middle] ?? left;
  return Math.round((left + right) / 2);
}

function sharedSessionTitle(
  selectedSessionTitle: string | null | undefined,
  summary: SharedSessionSummaryRecord | null,
): string {
  return selectedSessionTitle?.trim() || summary?.title?.trim() || summary?.sessionId || '共享会话';
}

export function SharedSessionTimingView({
  selectedSessionTitle,
  sharedSession,
  sharedSessionLoading,
  sharedSummary,
}: {
  selectedSessionTitle?: string | null;
  sharedSession: SharedSessionDetailRecord | null;
  sharedSessionLoading: boolean;
  sharedSummary: SharedSessionSummaryRecord | null;
}) {
  const summary = sharedSession?.share ?? sharedSummary;
  const title = sharedSessionTitle(selectedSessionTitle, summary);
  const assistantMessages =
    sharedSession?.session.messages?.filter((message) => message.role === 'assistant') ?? [];
  const assistantTimes = assistantMessages
    .map((message) => message.createdAt)
    .sort((left, right) => left - right);
  const assistantGaps = assistantTimes
    .slice(1)
    .map((timestampMs, index) => timestampMs - assistantTimes[index]!);
  const snapshotTimeMs = parseIsoMs(sharedSession?.session.fileChangesSummary?.latestSnapshotAt);
  const shareCreatedAtMs = parseIsoMs(summary?.shareCreatedAt);
  const shareUpdatedAtMs = parseIsoMs(summary?.shareUpdatedAt);
  const latestActivityMs = Math.max(
    shareUpdatedAtMs ?? 0,
    snapshotTimeMs ?? 0,
    ...assistantTimes,
    ...(sharedSession?.comments.map((comment) => parseIsoMs(comment.createdAt) ?? 0) ?? []),
  );
  const activeWindowMs =
    shareCreatedAtMs !== null && latestActivityMs > 0 && latestActivityMs >= shareCreatedAtMs
      ? latestActivityMs - shareCreatedAtMs
      : 0;

  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    if (shareCreatedAtMs !== null) {
      items.push({
        timestampMs: shareCreatedAtMs,
        title: '共享建立',
        detail: summary?.sharedByEmail,
      });
    }
    if (snapshotTimeMs !== null) {
      items.push({
        timestampMs: snapshotTimeMs,
        title: `工作区快照 · ${sharedSession?.session.fileChangesSummary?.snapshotCount ?? 0} 次`,
        detail: summary?.workspacePath ?? undefined,
      });
    }
    items.push(...buildAssistantTimeline(sharedSession?.session.messages ?? []));
    items.push(...buildCommentTimeline(sharedSession?.comments ?? []));
    return items
      .filter((item) => Number.isFinite(item.timestampMs) && item.timestampMs > 0)
      .sort((left, right) => right.timestampMs - left.timestampMs)
      .slice(0, 10);
  }, [
    shareCreatedAtMs,
    snapshotTimeMs,
    summary?.sharedByEmail,
    summary?.workspacePath,
    sharedSession,
  ]);

  if (sharedSessionLoading && !sharedSession) {
    return (
      <EmptyState
        emoji="⏱️"
        title="正在同步共享耗时信息"
        description="共享会话详情加载完成后，这里会展示共享协作节奏和关键时间节点。"
      />
    );
  }

  if (!summary) {
    return (
      <EmptyState
        emoji="⏱️"
        title="共享耗时暂不可用"
        description="当前只拿到了共享会话选择状态，详细共享快照还未同步。"
      />
    );
  }

  return (
    <div data-testid="shared-timing-view" style={{ display: 'grid', gap: 10 }}>
      <div
        style={{
          padding: '8px 12px',
          borderRadius: 10,
          border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
          background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
          color: 'var(--fg-default)',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        当前统计范围：{title}（共享会话快照）。这里展示的是共享协作本身的节奏，而不是本地 runtime
        handoff 时序。
      </div>

      <MetricGrid>
        <StatCard
          label="共享窗口"
          value={formatMs(activeWindowMs)}
          note={
            shareCreatedAtMs !== null
              ? `起点 ${formatTime(shareCreatedAtMs)}`
              : '共享建立时间未记录'
          }
        />
        <StatCard
          label="Assistant 输出"
          value={String(assistantMessages.length)}
          note={
            assistantMessages.length > 0
              ? `最近 ${formatTime(assistantTimes[assistantTimes.length - 1]!)}`
              : '暂无输出'
          }
        />
        <StatCard
          label="输出中位间隔"
          value={assistantGaps.length > 0 ? formatMs(computeMedian(assistantGaps)) : '—'}
          note={
            assistantGaps.length > 0
              ? `最大 ${formatMs(Math.max(...assistantGaps))}`
              : '至少两次输出后可计算'
          }
        />
        <StatCard
          label="共享评论"
          value={String(sharedSession?.comments.length ?? 0)}
          note={
            sharedSession?.comments.length
              ? `最近 ${formatTime(parseIsoMs(sharedSession.comments[0]?.createdAt) ?? latestActivityMs)}`
              : '暂无评论'
          }
        />
        <StatCard
          label="快照次数"
          value={String(sharedSession?.session.fileChangesSummary?.snapshotCount ?? 0)}
          note={snapshotTimeMs !== null ? `最近 ${formatTime(snapshotTimeMs)}` : '暂无快照'}
        />
        <StatCard
          label="同步状态"
          value={summary.stateStatus === 'running' ? '持续同步' : '暂停中'}
          note={
            shareUpdatedAtMs !== null
              ? `最新同步 ${formatTime(shareUpdatedAtMs)}`
              : '未记录同步时间'
          }
        />
      </MetricGrid>

      {timeline.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--fg-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700,
            }}
          >
            关键时间线
          </span>
          <div style={{ display: 'grid', gap: 6 }}>
            {timeline.map((item, index) => (
              <div
                key={`${item.title}-${item.timestampMs}-${index}`}
                style={{
                  display: 'grid',
                  gap: 3,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
                  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ color: 'var(--fg-strong)', fontSize: 12 }}>{item.title}</strong>
                  <span
                    style={{
                      color: 'var(--fg-muted)',
                      fontSize: 11,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatTime(item.timestampMs)}
                  </span>
                </div>
                {item.detail ? (
                  <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.6 }}>
                    {item.detail}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          emoji="⏱️"
          title="暂无共享时序节点"
          description="共享输出、评论或快照出现后，这里会形成真实的协作时间线。"
        />
      )}
    </div>
  );
}
