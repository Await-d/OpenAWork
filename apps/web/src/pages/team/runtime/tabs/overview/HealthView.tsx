/**
 * 260516-team-page-v2 · T-13 · HealthView
 *
 * 「健康度 / 异常驾驶舱」tab 内容：
 *   - 失败 handoff 列表（按时间倒序）
 *   - 卡住的 pending（>2min 视为卡住）
 *   - 一键取消／重试入口
 *
 * 数据来源：useHandoffStore.handoffs
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  useHandoffStore,
  type HandoffEntry,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { TabContainer } from '../TabContainer.js';

const STUCK_THRESHOLD_MS = 2 * 60 * 1000;

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  reviewer: '评审',
};

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const SECTION_TITLE_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const STAT_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
};

const STAT_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  fontSize: 12,
};

const FAILED_ROW_STYLE: CSSProperties = {
  ...ROW_STYLE,
  borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
  background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-overlay))',
};

const STUCK_ROW_STYLE: CSSProperties = {
  ...ROW_STYLE,
  borderColor: 'color-mix(in srgb, var(--warning) 50%, transparent)',
  background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-overlay))',
};

const EMPTY_STYLE: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  padding: 32,
  borderRadius: 12,
  border: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 13,
  gap: 6,
};

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export interface HealthViewProps {
  onCancelHandoff?: (handoffId: string) => void;
}

export function HealthView({ onCancelHandoff }: HealthViewProps) {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);

  const allEntries = useMemo(() => Array.from(handoffs.values()), [handoffs]);

  const failed = useMemo(
    () =>
      allEntries
        .filter((e) => e.state === 'failed')
        .sort((a, b) => (b.endedAt ?? b.updatedAt) - (a.endedAt ?? a.updatedAt))
        .slice(0, 30),
    [allEntries],
  );

  const stuck = useMemo(
    () =>
      allEntries
        .filter((e) => {
          if (e.state !== 'pending' && e.state !== 'claimed') return false;
          const ref = e.startedAt ?? e.updatedAt;
          return now - ref > STUCK_THRESHOLD_MS;
        })
        .sort((a, b) => (a.startedAt ?? a.updatedAt) - (b.startedAt ?? b.updatedAt)),
    [allEntries, now],
  );

  const running = useMemo(() => allEntries.filter((e) => e.state === 'running'), [allEntries]);

  // 失败率（最近 50 条）
  const recentTerminal = useMemo(
    () =>
      allEntries
        .filter((e) => e.state === 'completed' || e.state === 'failed' || e.state === 'cancelled')
        .sort((a, b) => (b.endedAt ?? b.updatedAt) - (a.endedAt ?? a.updatedAt))
        .slice(0, 50),
    [allEntries],
  );
  const failureRate = useMemo(() => {
    if (recentTerminal.length === 0) return null;
    const failures = recentTerminal.filter((e) => e.state === 'failed').length;
    return Math.round((failures / recentTerminal.length) * 100);
  }, [recentTerminal]);

  // 各 layer 的失败数
  const failedByLayer = useMemo(() => {
    const map = new Map<TeamRoleLayer, number>();
    for (const e of failed) {
      map.set(e.toRoleLayer, (map.get(e.toRoleLayer) ?? 0) + 1);
    }
    return map;
  }, [failed]);

  const overallHealthy = failed.length === 0 && stuck.length === 0;

  return (
    <TabContainer
      title="健康度"
      subtitle="按 handoff 维度展示失败与卡住的任务，提供取消 / 重试入口。"
    >
      <div style={CONTAINER_STYLE}>
        {/* 概览 */}
        <div style={{ display: 'grid', gap: 8 }}>
          <span style={SECTION_TITLE_STYLE}>健康概览</span>
          <div style={STAT_GRID_STYLE}>
            <HealthStat
              label="整体状态"
              value={overallHealthy ? '健康' : '需关注'}
              tone={overallHealthy ? 'success' : 'warning'}
            />
            <HealthStat
              label="失败 handoff"
              value={String(failed.length)}
              tone={failed.length > 0 ? 'danger' : 'default'}
            />
            <HealthStat
              label="卡住 (>2min)"
              value={String(stuck.length)}
              tone={stuck.length > 0 ? 'warning' : 'default'}
            />
            <HealthStat label="运行中" value={String(running.length)} tone="default" />
            <HealthStat
              label="近期失败率"
              value={failureRate !== null ? `${failureRate}%` : '—'}
              tone={
                failureRate !== null && failureRate > 30
                  ? 'danger'
                  : failureRate !== null && failureRate > 10
                    ? 'warning'
                    : 'success'
              }
            />
          </div>
        </div>

        {overallHealthy ? (
          <div style={EMPTY_STYLE}>
            <span style={{ fontSize: 26 }} aria-hidden>
              ✅
            </span>
            <strong style={{ color: 'var(--fg-default)' }}>团队运行正常</strong>
            <span>无失败 handoff，无超时卡住的任务。</span>
          </div>
        ) : null}

        {/* 失败列表 */}
        {failed.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={SECTION_TITLE_STYLE}>失败 handoff（{failed.length}）</span>
            {Array.from(failedByLayer.entries()).length > 0 ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Array.from(failedByLayer.entries()).map(([layer, count]) => (
                  <span
                    key={layer}
                    style={{
                      padding: '2px 10px',
                      borderRadius: 999,
                      background: 'color-mix(in srgb, var(--danger) 14%, transparent)',
                      color: 'var(--danger))',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {LAYER_LABELS[layer]} × {count}
                  </span>
                ))}
              </div>
            ) : null}
            <div style={{ display: 'grid', gap: 6 }}>
              {failed.map((entry) => (
                <FailedRow key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        ) : null}

        {/* 卡住列表 */}
        {stuck.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={SECTION_TITLE_STYLE}>卡住 (&gt; 2min)</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {stuck.map((entry) => {
                const ref = entry.startedAt ?? entry.updatedAt;
                return (
                  <StuckRow
                    key={entry.id}
                    entry={entry}
                    waitedMs={now - ref}
                    onCancel={onCancelHandoff}
                  />
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </TabContainer>
  );
}

function HealthStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'default' | 'success' | 'warning' | 'danger';
}) {
  const color =
    tone === 'success'
      ? 'var(--success))'
      : tone === 'warning'
        ? 'var(--warning))'
        : tone === 'danger'
          ? 'var(--danger))'
          : 'var(--fg-strong)';
  return (
    <div style={STAT_CARD_STYLE}>
      <span style={{ fontSize: 18, fontWeight: 800, color }}>{value}</span>
      <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function FailedRow({ entry }: { entry: HandoffEntry }) {
  const dateStr = new Date(entry.endedAt ?? entry.updatedAt).toLocaleString();
  return (
    <div style={FAILED_ROW_STYLE}>
      <span aria-hidden style={{ fontSize: 14 }}>
        ⚠️
      </span>
      <span style={{ minWidth: 130, color: 'var(--fg-strong)', fontWeight: 700 }}>
        {LAYER_LABELS[entry.fromRoleLayer]} → {LAYER_LABELS[entry.toRoleLayer]}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--fg-muted)',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 10,
        }}
        title={entry.id}
      >
        {entry.id}
      </span>
      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{dateStr}</span>
    </div>
  );
}

function StuckRow({
  entry,
  waitedMs,
  onCancel,
}: {
  entry: HandoffEntry;
  waitedMs: number;
  onCancel?: (id: string) => void;
}) {
  return (
    <div style={STUCK_ROW_STYLE}>
      <span aria-hidden style={{ fontSize: 14 }}>
        ⏳
      </span>
      <span style={{ minWidth: 130, color: 'var(--fg-strong)', fontWeight: 700 }}>
        {LAYER_LABELS[entry.fromRoleLayer]} → {LAYER_LABELS[entry.toRoleLayer]}
      </span>
      <span
        style={{
          padding: '1px 8px',
          borderRadius: 999,
          background: 'color-mix(in srgb, var(--warning) 14%, transparent)',
          color: 'var(--warning))',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
        }}
      >
        {entry.state}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ color: 'var(--fg-strong)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        已等待 {formatMs(waitedMs)}
      </span>
      {onCancel ? (
        <button
          type="button"
          onClick={() => onCancel(entry.id)}
          style={{
            padding: '2px 10px',
            borderRadius: 6,
            border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
            background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
            color: 'var(--danger))',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          取消
        </button>
      ) : null}
    </div>
  );
}
