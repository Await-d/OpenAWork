/**
 * 260516-team-page-v2 · T-13 · TimingView
 *
 * 「耗时」tab 内容：
 *   - 每层的 P50/P95/平均耗时
 *   - 当前活跃 handoff 的运行时长（实时刷新）
 *   - 简易甘特视图：按完成时间倒序，宽度 = 持续时间
 *
 * 数据来源：useHandoffStore（startedAt / endedAt / updatedAt）
 *   - startedAt：第一次进入 running/claimed
 *   - endedAt：进入 completed/failed/cancelled
 *   - 若 startedAt 缺失，回退到 createdAt（暂用 updatedAt 近似）
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  useHandoffStore,
  type HandoffEntry,
  type HandoffState,
  type TeamRoleLayer,
} from '../../../../../stores/team-events.js';
import { TabContainer } from '../TabContainer.js';

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  reviewer: '评审',
};

const LAYER_ORDER: TeamRoleLayer[] = ['reception', 'pm1', 'pm2', 'executor', 'reviewer'];

const STATE_COLORS: Record<HandoffState | 'idle', string> = {
  idle: 'var(--text-3)',
  pending: '#f59e0b',
  claimed: '#3b82f6',
  running: 'var(--success, #22c55e)',
  completed: 'var(--text-3)',
  failed: 'var(--danger, #d4574e)',
  cancelled: 'var(--text-3)',
};

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const SECTION_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const SECTION_TITLE_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const STAT_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
};

const STAT_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
};

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  const baseVal = sorted[base] ?? 0;
  return next !== undefined ? baseVal + rest * (next - baseVal) : baseVal;
}

export function TimingView() {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const [now, setNow] = useState(() => Date.now());

  // 1s tick 用于刷新「正在运行」的耗时
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const allEntries = useMemo(() => Array.from(handoffs.values()), [handoffs]);

  const layerStats = useMemo(() => {
    const map = new Map<TeamRoleLayer, number[]>();
    for (const entry of allEntries) {
      const start = entry.startedAt ?? entry.updatedAt;
      const end = entry.endedAt ?? (isTerminal(entry.state) ? entry.updatedAt : null);
      if (!start || !end || end < start) continue;
      const dur = end - start;
      const list = map.get(entry.toRoleLayer) ?? [];
      list.push(dur);
      map.set(entry.toRoleLayer, list);
    }
    return LAYER_ORDER.map((layer) => {
      const values = (map.get(layer) ?? []).slice().sort((a, b) => a - b);
      const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      return {
        layer,
        count: values.length,
        avg,
        p50: quantile(values, 0.5),
        p95: quantile(values, 0.95),
        max: values.length > 0 ? values[values.length - 1]! : 0,
      };
    });
  }, [allEntries]);

  const running = useMemo(
    () =>
      allEntries
        .filter((e) => e.state === 'running' || e.state === 'claimed' || e.state === 'pending')
        .sort((a, b) => (b.startedAt ?? b.updatedAt) - (a.startedAt ?? a.updatedAt)),
    [allEntries],
  );

  const completed = useMemo(
    () =>
      allEntries
        .filter((e) => isTerminal(e.state))
        .sort((a, b) => (b.endedAt ?? b.updatedAt) - (a.endedAt ?? a.updatedAt))
        .slice(0, 30),
    [allEntries],
  );

  const totalCount = allEntries.length;
  const successRate = useMemo(() => {
    let success = 0;
    let failed = 0;
    for (const e of allEntries) {
      if (e.state === 'completed') success++;
      else if (e.state === 'failed') failed++;
    }
    const total = success + failed;
    return total > 0 ? Math.round((success / total) * 100) : null;
  }, [allEntries]);

  if (totalCount === 0) {
    return (
      <TabContainer title="耗时分析" subtitle="按 handoff 维度统计执行耗时与 P50 / P95 分布。">
        <div style={CONTAINER_STYLE}>
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              padding: 32,
              borderRadius: 12,
              border: '1px dashed color-mix(in srgb, var(--border) 60%, transparent)',
              color: 'var(--text-3)',
              fontSize: 13,
              gap: 6,
            }}
          >
            <span style={{ fontSize: 26 }} aria-hidden>
              ⏱️
            </span>
            <span>暂无 handoff 记录。团队启动后耗时数据会出现在这里。</span>
          </div>
        </div>
      </TabContainer>
    );
  }

  return (
    <TabContainer title="耗时分析" subtitle="按 handoff 维度统计执行耗时与 P50 / P95 分布。">
      <div style={CONTAINER_STYLE}>
        {/* 概览 */}
        <div style={SECTION_STYLE}>
          <span style={SECTION_TITLE_STYLE}>概览</span>
          <div style={STAT_GRID_STYLE}>
            <StatCard label="Handoff 总数" value={String(totalCount)} />
            <StatCard label="运行中" value={String(running.length)} accent="success" />
            <StatCard
              label="成功率"
              value={successRate !== null ? `${successRate}%` : '—'}
              accent={successRate !== null && successRate < 80 ? 'warning' : 'default'}
            />
            <StatCard
              label="样本（已结束）"
              value={String(completed.length === 30 ? '≥ 30' : completed.length)}
            />
          </div>
        </div>

        {/* 各层级 P50/P95 */}
        <div style={SECTION_STYLE}>
          <span style={SECTION_TITLE_STYLE}>各层级耗时</span>
          <div style={STAT_GRID_STYLE}>
            {layerStats.map((stat) => (
              <div key={stat.layer} style={STAT_CARD_STYLE}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--text)',
                  }}
                >
                  {LAYER_LABELS[stat.layer]}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>样本 {stat.count}</span>
                <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-2)' }}>
                  <KV k="P50" v={formatMs(stat.p50)} />
                  <KV k="P95" v={formatMs(stat.p95)} />
                  <KV k="Max" v={formatMs(stat.max)} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 运行中（实时） */}
        {running.length > 0 ? (
          <div style={SECTION_STYLE}>
            <span style={SECTION_TITLE_STYLE}>运行中（实时）</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {running.map((entry) => {
                const start = entry.startedAt ?? entry.updatedAt;
                const dur = now - start;
                return <RunningRow key={entry.id} entry={entry} dur={dur} />;
              })}
            </div>
          </div>
        ) : null}

        {/* 已完成甘特 */}
        {completed.length > 0 ? (
          <div style={SECTION_STYLE}>
            <span style={SECTION_TITLE_STYLE}>最近已结束（前 30 条）</span>
            <CompletedGantt entries={completed} />
          </div>
        ) : null}
      </div>
    </TabContainer>
  );
}

function isTerminal(state: HandoffState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

function StatCard({
  label,
  value,
  accent = 'default',
}: {
  label: string;
  value: string;
  accent?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const valueColor =
    accent === 'success'
      ? 'var(--success, #22c55e)'
      : accent === 'warning'
        ? '#f59e0b'
        : accent === 'danger'
          ? 'var(--danger, #d4574e)'
          : 'var(--text)';
  return (
    <div style={STAT_CARD_STYLE}>
      <span style={{ fontSize: 18, fontWeight: 800, color: valueColor }}>{value}</span>
      <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <span>
      <span style={{ color: 'var(--text-3)' }}>{k}: </span>
      <strong style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{v}</strong>
    </span>
  );
}

function RunningRow({ entry, dur }: { entry: HandoffEntry; dur: number }) {
  const color = STATE_COLORS[entry.state];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, var(--border) 45%, transparent)',
        background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
        fontSize: 12,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: color,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 30%, transparent)`,
          flexShrink: 0,
        }}
      />
      <span style={{ minWidth: 130, color: 'var(--text-2)', fontWeight: 600 }}>
        {LAYER_LABELS[entry.fromRoleLayer]} → {LAYER_LABELS[entry.toRoleLayer]}
      </span>
      <span
        style={{
          padding: '1px 8px',
          borderRadius: 999,
          background: 'color-mix(in srgb, var(--surface) 60%, transparent)',
          border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
          color: 'var(--text-2)',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
        }}
      >
        {entry.state}
      </span>
      <span style={{ flex: 1 }} />
      <span
        style={{
          color: 'var(--text)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatMs(dur)}
      </span>
    </div>
  );
}

function CompletedGantt({ entries }: { entries: HandoffEntry[] }) {
  // 计算最大持续时间作为横向比例
  const maxDur = useMemo(() => {
    let max = 0;
    for (const e of entries) {
      const start = e.startedAt ?? e.updatedAt;
      const end = e.endedAt ?? e.updatedAt;
      const d = end - start;
      if (d > max) max = d;
    }
    return Math.max(max, 1);
  }, [entries]);

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {entries.map((entry) => {
        const start = entry.startedAt ?? entry.updatedAt;
        const end = entry.endedAt ?? entry.updatedAt;
        const dur = Math.max(0, end - start);
        const widthPct = Math.max(2, (dur / maxDur) * 100);
        const color =
          entry.state === 'completed'
            ? 'var(--success, #22c55e)'
            : entry.state === 'failed'
              ? 'var(--danger, #d4574e)'
              : 'var(--text-3)';
        return (
          <div
            key={entry.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
            }}
            title={`${entry.id}\n${formatMs(dur)}\n${new Date(start).toLocaleString()} → ${new Date(end).toLocaleString()}`}
          >
            <span style={{ minWidth: 130, color: 'var(--text-3)', flexShrink: 0 }}>
              {LAYER_LABELS[entry.fromRoleLayer]} → {LAYER_LABELS[entry.toRoleLayer]}
            </span>
            <span
              style={{
                flex: 1,
                height: 14,
                borderRadius: 4,
                background: 'color-mix(in srgb, var(--bg-2) 70%, transparent)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${widthPct}%`,
                  background: color,
                  opacity: 0.65,
                  borderRadius: 4,
                }}
              />
            </span>
            <span
              style={{
                minWidth: 64,
                textAlign: 'right',
                color: 'var(--text)',
                fontVariantNumeric: 'tabular-nums',
                flexShrink: 0,
              }}
            >
              {formatMs(dur)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
