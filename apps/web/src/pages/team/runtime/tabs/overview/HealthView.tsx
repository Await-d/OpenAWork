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
  useTeamEventsConnectionStore,
  type HandoffEntry,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { TabContainer } from '../TabContainer.js';
import type { TeamRuntimeDiagnostics } from '@openAwork/web-client';
import type { TeamRuntimeHandoffContextInput } from '../team-runtime-navigation.js';
import {
  StatCard,
  MetricGrid,
  EmptyState,
  CK_SECTION_LABEL_STYLE,
  CK_BORDER,
  CK_SURFACE,
} from '../../shared/content-kit/index.js';

const STUCK_THRESHOLD_MS = 2 * 60 * 1000;

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const SECTION_TITLE_STYLE = CK_SECTION_LABEL_STYLE;

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderRadius: 10,
  border: `1px solid ${CK_BORDER}`,
  background: CK_SURFACE,
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

function formatAttemptTime(atMs: number | null): string {
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return '—';
  return new Date(atMs).toLocaleTimeString();
}

function describeAlertLifecycleStatus(
  status: TeamRuntimeDiagnostics['activeAlerts'][number]['status'],
): string {
  switch (status) {
    case 'open':
      return '新出现';
    case 'ongoing':
      return '持续中';
    case 'reopened':
      return '再次出现';
    case 'acknowledged':
      return '已确认';
    case 'suppressed':
      return '已静音';
    case 'resolved':
      return '已恢复';
  }
}

export interface HealthViewProps {
  onCancelHandoff?: (handoffId: string) => void;
  onOpenHandoffContext?: (input: TeamRuntimeHandoffContextInput) => void;
}

function resolvePreferredTabForLayer(layer: TeamRoleLayer): 'artifacts' | 'health' | 'review' {
  if (layer === 'pm2') {
    return 'review';
  }
  if (layer === 'executor' || layer === 'tester' || layer === 'reviewer') {
    return 'artifacts';
  }
  return 'health';
}

function contextActionButtonStyle(): CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
    color: 'var(--accent)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
  };
}

function contextActionLabel(tab: 'artifacts' | 'health' | 'review'): string {
  return tab === 'review' ? '查看评审' : tab === 'artifacts' ? '查看任务与产物' : '查看健康详情';
}

export function HealthView({ onCancelHandoff, onOpenHandoffContext }: HealthViewProps) {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const {
    acknowledgeRuntimeAlert,
    clearRuntimeAlertControl,
    diagnostics,
    runRuntimeAlertRemediation,
    suppressRuntimeAlert,
  } = useTeamRuntimeReferenceViewData();
  const [now, setNow] = useState(() => Date.now());
  const teamEventsConnection = useTeamEventsConnectionStore();
  const [alertActionBusy, setAlertActionBusy] = useState<string | null>(null);

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

  const backendHealth = diagnostics?.health?.status ?? 'healthy';
  const backendReasons = diagnostics?.health?.reasons ?? [];
  const qualityReview = diagnostics?.qualityReview;
  const healthLabel =
    backendHealth === 'critical' ? '严重异常' : backendHealth === 'degraded' ? '已降级' : '健康';
  const teamEventsLabel =
    teamEventsConnection.state === 'connected'
      ? '已连接'
      : teamEventsConnection.state === 'reconnecting'
        ? '重连中'
        : teamEventsConnection.state === 'offline'
          ? '离线'
          : teamEventsConnection.state === 'connecting'
            ? '连接中'
            : teamEventsConnection.lastProtocolErrorCode === 'UNAUTHORIZED'
              ? '认证失效'
              : '已停止';
  const teamEventsTone =
    teamEventsConnection.state === 'connected'
      ? 'success'
      : teamEventsConnection.lastProtocolErrorCode === 'UNAUTHORIZED'
        ? 'danger'
        : teamEventsConnection.state === 'offline' || teamEventsConnection.state === 'reconnecting'
          ? 'warning'
          : 'default';
  const overallHealthy = failed.length === 0 && stuck.length === 0 && backendHealth === 'healthy';

  return (
    <TabContainer
      title="健康度"
      subtitle="优先展示后端真实健康态，再下钻到 handoff 失败与卡住任务。"
    >
      <div style={CONTAINER_STYLE}>
        {/* 概览 */}
        <div style={{ display: 'grid', gap: 8 }}>
          <span style={SECTION_TITLE_STYLE}>健康概览</span>
          <MetricGrid minColumnWidth={140}>
            <StatCard
              label="后端健康"
              value={healthLabel}
              tone={
                backendHealth === 'critical'
                  ? 'danger'
                  : backendHealth === 'degraded'
                    ? 'warning'
                    : 'success'
              }
            />
            <StatCard
              label="失败 handoff"
              value={String(failed.length)}
              tone={failed.length > 0 ? 'danger' : 'default'}
            />
            <StatCard
              label="卡住 (>2min)"
              value={String(stuck.length)}
              tone={stuck.length > 0 ? 'warning' : 'default'}
            />
            <StatCard label="运行中" value={String(running.length)} tone="default" />
            <StatCard
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
            <StatCard
              label="活跃运行线程"
              value={String(diagnostics?.runtimeThreads.activeCount ?? 0)}
              tone="default"
            />
            <StatCard
              label="过期线程"
              value={String(diagnostics?.runtimeThreads.staleCount ?? 0)}
              tone={(diagnostics?.runtimeThreads.staleCount ?? 0) > 0 ? 'danger' : 'default'}
            />
            <StatCard
              label="等待交互"
              value={String(diagnostics?.pendingInteractions.affectedSessionCount ?? 0)}
              tone={
                (diagnostics?.pendingInteractions.affectedSessionCount ?? 0) > 0
                  ? 'warning'
                  : 'default'
              }
            />
            <StatCard
              label="运行事件"
              value={String(diagnostics?.incidents.length ?? 0)}
              tone={(diagnostics?.incidents.length ?? 0) > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="待重试评审"
              value={String(qualityReview?.pendingCount ?? 0)}
              tone={(qualityReview?.pendingCount ?? 0) > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="评审重派"
              value={String(qualityReview?.redispatchCount ?? 0)}
              tone={(qualityReview?.redispatchCount ?? 0) > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="退回 PM1"
              value={String(qualityReview?.returnToCCount ?? 0)}
              tone={(qualityReview?.returnToCCount ?? 0) > 0 ? 'danger' : 'default'}
            />
            <StatCard
              label="等待人工"
              value={String(qualityReview?.escalateToUserCount ?? 0)}
              tone={(qualityReview?.escalateToUserCount ?? 0) > 0 ? 'danger' : 'default'}
            />
            <StatCard label="事件通道" value={teamEventsLabel} tone={teamEventsTone} />
          </MetricGrid>
        </div>

        {(teamEventsConnection.lastError || teamEventsConnection.reconnectAttempt > 0) && (
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={SECTION_TITLE_STYLE}>事件通道状态</span>
            <div
              style={
                teamEventsConnection.lastProtocolErrorCode === 'UNAUTHORIZED'
                  ? FAILED_ROW_STYLE
                  : STUCK_ROW_STYLE
              }
            >
              <span aria-hidden style={{ fontSize: 14 }}>
                📡
              </span>
              <div style={{ display: 'grid', gap: 2, flex: 1 }}>
                <strong style={{ color: 'var(--fg-strong)' }}>
                  当前状态：{teamEventsConnection.state}
                </strong>
                <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                  重连次数 {teamEventsConnection.reconnectAttempt}
                  {teamEventsConnection.nextRetryAt
                    ? ` · 下次重试 ${new Date(teamEventsConnection.nextRetryAt).toLocaleTimeString()}`
                    : ''}
                  {teamEventsConnection.lastOpenAt
                    ? ` · 最近连通 ${new Date(teamEventsConnection.lastOpenAt).toLocaleTimeString()}`
                    : ''}
                  {teamEventsConnection.lastCloseCode !== null
                    ? ` · 关闭码 ${teamEventsConnection.lastCloseCode}`
                    : ''}
                  {teamEventsConnection.lastProtocolErrorCode
                    ? ` · 协议码 ${teamEventsConnection.lastProtocolErrorCode}`
                    : ''}
                  {teamEventsConnection.lastError ? ` · ${teamEventsConnection.lastError}` : ''}
                </span>
              </div>
            </div>
          </div>
        )}

        {qualityReview &&
        (qualityReview.redispatchCount > 0 ||
          qualityReview.returnToCCount > 0 ||
          qualityReview.escalateToUserCount > 0) ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={SECTION_TITLE_STYLE}>评审分流</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {qualityReview.redispatchCount > 0 ? (
                <div style={STUCK_ROW_STYLE}>
                  <span aria-hidden style={{ fontSize: 14 }}>
                    🔄
                  </span>
                  <span style={{ color: 'var(--fg-strong)', fontWeight: 700 }}>
                    近期有 {qualityReview.redispatchCount} 次实现型失败重派，执行层可能反复卡在测试或实现质量问题上。
                  </span>
                </div>
              ) : null}
              {qualityReview.pendingCount > 0 ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={STUCK_ROW_STYLE}>
                    <span aria-hidden style={{ fontSize: 14 }}>
                      🧪
                    </span>
                    <span style={{ color: 'var(--fg-strong)', fontWeight: 700 }}>
                      当前有 {qualityReview.pendingCount} 条评审待收口
                      {qualityReview.retryableErrorCount > 0
                        ? `，其中 ${qualityReview.retryableErrorCount} 条上次评审执行失败。`
                        : '。'}
                    </span>
                  </div>
                  {qualityReview.pendingHandoffs.map((pending) => (
                    <div
                      key={pending.handoffId}
                      style={{
                        ...ROW_STYLE,
                        paddingLeft: 16,
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'grid', gap: 2 }}>
                        <strong style={{ color: 'var(--fg-strong)', fontSize: 12 }}>
                          PM2 评审 #{pending.handoffId.slice(0, 8)}
                        </strong>
                        <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                          {pending.lastError ? `最近错误：${pending.lastError}` : '最近一次评审未记录错误。'}
                        </span>
                        <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                          {pending.readyNow
                            ? `当前已满足重试条件${pending.lastAttemptAtMs ? `，上次尝试 ${formatAttemptTime(pending.lastAttemptAtMs)}` : ''}。`
                            : pending.nextAttemptAtMs
                              ? `冷却中，系统将于 ${formatAttemptTime(pending.nextAttemptAtMs)} 自动重试（约 ${formatMs(pending.nextAttemptAtMs - now)} 后）。`
                              : '冷却中，等待下一次自动重试窗口。'}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={alertActionBusy === pending.handoffId}
                        onClick={async () => {
                          setAlertActionBusy(pending.handoffId);
                          try {
                            await runRuntimeAlertRemediation('quality-review-pending', {
                              force: true,
                              handoffId: pending.handoffId,
                            });
                          } finally {
                            setAlertActionBusy(null);
                          }
                        }}
                        style={alertActionButtonStyle('warning')}
                      >
                        {pending.readyNow ? '立即重试评审' : '强制立即重试'}
                      </button>
                      {onOpenHandoffContext ? (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenHandoffContext({
                              handoffId: pending.handoffId,
                              preferredTab: 'review',
                              sessionId: pending.sessionId,
                            })
                          }
                          style={contextActionButtonStyle()}
                        >
                          查看评审
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {qualityReview.returnToCCount > 0 ? (
                <div style={FAILED_ROW_STYLE}>
                  <span aria-hidden style={{ fontSize: 14 }}>
                    ↩️
                  </span>
                  <span style={{ color: 'var(--fg-strong)', fontWeight: 700 }}>
                    近期有 {qualityReview.returnToCCount} 次规划型失败退回 PM1，优先复查 spec / plan / tasks 是否跑偏。
                  </span>
                </div>
              ) : null}
              {qualityReview.escalateToUserCount > 0 ? (
                <div style={FAILED_ROW_STYLE}>
                  <span aria-hidden style={{ fontSize: 14 }}>
                    ⬆️
                  </span>
                  <span style={{ color: 'var(--fg-strong)', fontWeight: 700 }}>
                    当前有 {qualityReview.escalateToUserCount} 次评审失败已升级给用户，团队正在等待人工介入决策。
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {backendReasons.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={SECTION_TITLE_STYLE}>后端判定原因</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {backendReasons.map((reason: string) => (
                <div key={reason} style={backendHealth === 'critical' ? FAILED_ROW_STYLE : STUCK_ROW_STYLE}>
                  <span aria-hidden style={{ fontSize: 14 }}>
                    {backendHealth === 'critical' ? '🛑' : '🩺'}
                  </span>
                  <span style={{ color: 'var(--fg-strong)', fontWeight: 700 }}>{reason}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {diagnostics?.activeAlerts && diagnostics.activeAlerts.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={SECTION_TITLE_STYLE}>活跃告警</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {diagnostics.activeAlerts.slice(0, 6).map((alert) => (
                <div
                  key={`${alert.code}-${alert.status}`}
                  style={alert.severity === 'critical' ? FAILED_ROW_STYLE : STUCK_ROW_STYLE}
                >
                  <span aria-hidden style={{ fontSize: 14 }}>
                    {alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '🛠️' : 'ℹ️'}
                  </span>
                  <div style={{ display: 'grid', gap: 2, flex: 1 }}>
                    <strong style={{ color: 'var(--fg-strong)' }}>
                      {alert.message}
                      <span style={{ marginLeft: 8, color: 'var(--fg-muted)', fontSize: 11 }}>
                        {describeAlertLifecycleStatus(alert.status)} · 次数 {alert.occurrenceCount}
                      </span>
                    </strong>
                    <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                      {alert.suggestedAction}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {alert.status === 'open' || alert.status === 'ongoing' ? (
                      <>
                        {alert.remediable ? (
                          <button
                            type="button"
                            disabled={alertActionBusy === alert.code}
                            onClick={async () => {
                              setAlertActionBusy(alert.code);
                              try {
                                await runRuntimeAlertRemediation(alert.code);
                              } finally {
                                setAlertActionBusy(null);
                              }
                            }}
                            style={alertActionButtonStyle('warning')}
                          >
                            {alert.code === 'stale-runtime-threads'
                              ? '修复线程'
                              : alert.code === 'stale-decisions'
                                ? '释放超时交互'
                                : alert.code === 'quality-review-pending'
                                  ? '立即重试评审'
                                : '重试可恢复失败'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={alertActionBusy === alert.code}
                          onClick={async () => {
                            setAlertActionBusy(alert.code);
                            try {
                              await acknowledgeRuntimeAlert(alert.code, '已确认');
                            } finally {
                              setAlertActionBusy(null);
                            }
                          }}
                          style={alertActionButtonStyle('default')}
                        >
                          确认已知
                        </button>
                        <button
                          type="button"
                          disabled={alertActionBusy === alert.code}
                          onClick={async () => {
                            setAlertActionBusy(alert.code);
                            try {
                              await suppressRuntimeAlert(alert.code, { minutes: 60, note: '静音 1 小时' });
                            } finally {
                              setAlertActionBusy(null);
                            }
                          }}
                          style={alertActionButtonStyle('warning')}
                        >
                          静音 1h
                        </button>
                      </>
                    ) : null}
                    {alert.status === 'acknowledged' || alert.status === 'suppressed' ? (
                      <button
                        type="button"
                        disabled={alertActionBusy === alert.code}
                        onClick={async () => {
                          setAlertActionBusy(alert.code);
                          try {
                            await clearRuntimeAlertControl(alert.code);
                          } finally {
                            setAlertActionBusy(null);
                          }
                        }}
                        style={alertActionButtonStyle('danger')}
                      >
                        清除控制
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {diagnostics?.recentResolvedAlerts && diagnostics.recentResolvedAlerts.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={SECTION_TITLE_STYLE}>最近恢复</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {diagnostics.recentResolvedAlerts.slice(0, 4).map((alert) => (
                <div key={`${alert.code}-${alert.resolvedAt ?? alert.lastDetectedAt}`} style={ROW_STYLE}>
                  <span aria-hidden style={{ fontSize: 14 }}>
                    ✅
                  </span>
                  <div style={{ display: 'grid', gap: 2, flex: 1 }}>
                    <strong style={{ color: 'var(--fg-strong)' }}>{alert.message}</strong>
                    <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                      已恢复 · 最近出现 {new Date(alert.lastDetectedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {diagnostics?.incidents && diagnostics.incidents.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={SECTION_TITLE_STYLE}>运行时事件（最近 {diagnostics.incidents.length} 条）</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {diagnostics.incidents.slice(0, 8).map((incident: TeamRuntimeDiagnostics['incidents'][number]) => (
                <div
                  key={`${incident.code}-${incident.timestamp}`}
                  style={incident.severity === 'error' ? FAILED_ROW_STYLE : STUCK_ROW_STYLE}
                >
                  <span aria-hidden style={{ fontSize: 14 }}>
                    {incident.severity === 'error' ? '⚠️' : 'ℹ️'}
                  </span>
                  <span style={{ minWidth: 120, color: 'var(--fg-strong)', fontWeight: 700 }}>
                    {incident.category}
                  </span>
                  <span style={{ flex: 1, color: 'var(--fg-default)' }}>{incident.message}</span>
                  <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>
                    {new Date(incident.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {overallHealthy ? (
          <EmptyState
            emoji="✅"
            title="团队运行正常"
            description="无失败 handoff，无超时卡住的任务。"
          />
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
                      color: 'var(--danger)',
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
                <FailedRow
                  key={entry.id}
                  entry={entry}
                  onOpenContext={onOpenHandoffContext}
                />
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
                    onOpenContext={onOpenHandoffContext}
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

function alertActionButtonStyle(tone: 'danger' | 'default' | 'warning'): CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 6,
    border:
      tone === 'danger'
        ? '1px solid color-mix(in srgb, var(--danger) 40%, transparent)'
        : tone === 'warning'
          ? '1px solid color-mix(in srgb, var(--warning) 40%, transparent)'
          : '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
    background:
      tone === 'danger'
        ? 'color-mix(in srgb, var(--danger) 8%, transparent)'
        : tone === 'warning'
          ? 'color-mix(in srgb, var(--warning) 10%, transparent)'
          : 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
    color:
      tone === 'danger'
        ? 'var(--danger)'
        : tone === 'warning'
          ? 'var(--warning)'
          : 'var(--fg-strong)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
  };
}

function FailedRow({
  entry,
  onOpenContext,
}: {
  entry: HandoffEntry;
  onOpenContext?: (input: {
    handoffId: string;
    preferredTab: 'artifacts' | 'health' | 'review';
    sessionId?: string | null;
  }) => void;
}) {
  const dateStr = new Date(entry.endedAt ?? entry.updatedAt).toLocaleString();
  const preferredTab = resolvePreferredTabForLayer(entry.toRoleLayer);
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
      {onOpenContext ? (
        <button
          type="button"
          onClick={() =>
            onOpenContext({
              handoffId: entry.id,
              preferredTab,
              sessionId: entry.sessionId ?? null,
            })
          }
          style={contextActionButtonStyle()}
        >
          {contextActionLabel(preferredTab)}
        </button>
      ) : null}
    </div>
  );
}

function StuckRow({
  entry,
  waitedMs,
  onCancel,
  onOpenContext,
}: {
  entry: HandoffEntry;
  waitedMs: number;
  onCancel?: (id: string) => void;
  onOpenContext?: (input: {
    handoffId: string;
    preferredTab: 'artifacts' | 'health' | 'review';
    sessionId?: string | null;
  }) => void;
}) {
  const preferredTab = resolvePreferredTabForLayer(entry.toRoleLayer);
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
          color: 'var(--warning)',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
        }}
      >
        {entry.state}
      </span>
      <span style={{ flex: 1 }} />
      <span
        style={{ color: 'var(--fg-strong)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
      >
        已等待 {formatMs(waitedMs)}
      </span>
      {onOpenContext ? (
        <button
          type="button"
          onClick={() =>
            onOpenContext({
              handoffId: entry.id,
              preferredTab,
              sessionId: entry.sessionId ?? null,
            })
          }
          style={contextActionButtonStyle()}
        >
          {contextActionLabel(preferredTab)}
        </button>
      ) : null}
      {onCancel ? (
        <button
          type="button"
          onClick={() => onCancel(entry.id)}
          style={{
            padding: '2px 10px',
            borderRadius: 6,
            border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
            background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
            color: 'var(--danger)',
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
