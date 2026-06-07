import type {
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  TeamAuditLogRecord,
  TeamRuntimeDiagnostics,
} from '@openAwork/web-client';
import { getSharedSessionStateLabel } from '../../data/team-runtime-model.js';
import { EmptyState, MetricGrid, StatCard } from '../../shared/content-kit/index.js';

const ACTION_LABELS: Record<string, string> = {
  share_created: '创建共享',
  share_deleted: '删除共享',
  share_permission_updated: '权限变更',
  shared_comment_created: '共享评论',
  shared_permission_replied: '权限回复',
  shared_question_replied: '问题回复',
  runtime_alert_control: '告警控制',
  runtime_remediation: '运行修复',
};

function formatTime(value: string | undefined): string {
  if (!value) {
    return '未记录';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resolveHealthLabel(status: TeamRuntimeDiagnostics['health']['status']): string {
  if (status === 'critical') {
    return '严重异常';
  }
  if (status === 'degraded') {
    return '已降级';
  }
  return '健康';
}

export function SharedSessionHealthView({
  auditLogs,
  diagnostics,
  selectedSessionId,
  selectedSessionTitle,
  sharedSession,
  sharedSessionLoading,
  sharedSummary,
}: {
  auditLogs: TeamAuditLogRecord[];
  diagnostics: TeamRuntimeDiagnostics | undefined;
  selectedSessionId: string;
  selectedSessionTitle?: string | null;
  sharedSession: SharedSessionDetailRecord | null;
  sharedSessionLoading: boolean;
  sharedSummary: SharedSessionSummaryRecord | null;
}) {
  const summary = sharedSession?.share ?? sharedSummary;
  const activePresenceCount = sharedSession?.presence.filter((entry) => entry.active).length ?? 0;
  const sharedAuditLogs = auditLogs
    .filter((log) => log.sessionId === selectedSessionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);

  if (sharedSessionLoading && !sharedSession) {
    return (
      <EmptyState
        emoji="🩺"
        title="正在同步共享健康信息"
        description="共享会话详情加载完成后，这里会展示审批、问题、评论和协作审计的真实状态。"
      />
    );
  }

  if (!summary) {
    return (
      <EmptyState
        emoji="🩺"
        title="共享健康详情暂不可用"
        description="当前只拿到了共享会话选择状态，详细协作健康信息稍后会自动同步。"
      />
    );
  }

  return (
    <div data-testid="shared-health-view" style={{ display: 'grid', gap: 10 }}>
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
        共享会话不参与本地团队 handoff
        树。这里展示的是共享协作本身的健康状态，以及后端全局运行健康信号。
      </div>

      <MetricGrid minColumnWidth={140}>
        <StatCard
          label="后端健康"
          value={resolveHealthLabel(diagnostics?.health.status ?? 'healthy')}
          tone={
            diagnostics?.health.status === 'critical'
              ? 'danger'
              : diagnostics?.health.status === 'degraded'
                ? 'warning'
                : 'success'
          }
        />
        <StatCard
          label="共享状态"
          value={getSharedSessionStateLabel(summary.stateStatus)}
          tone={summary.stateStatus === 'running' ? 'success' : 'warning'}
          note={selectedSessionTitle ?? summary.title ?? summary.sessionId}
        />
        <StatCard
          label="在线查看"
          value={String(activePresenceCount)}
          note={`Presence 总数 ${sharedSession?.presence.length ?? 0}`}
        />
        <StatCard
          label="待审批"
          value={String(sharedSession?.pendingPermissions.length ?? 0)}
          tone={(sharedSession?.pendingPermissions.length ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="待回答"
          value={String(sharedSession?.pendingQuestions.length ?? 0)}
          tone={(sharedSession?.pendingQuestions.length ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="协作评论"
          value={String(sharedSession?.comments.length ?? 0)}
          note={`最近同步 ${formatTime(summary.shareUpdatedAt)}`}
        />
        <StatCard
          label="活跃告警"
          value={String(diagnostics?.activeAlerts.length ?? 0)}
          tone={(diagnostics?.activeAlerts.length ?? 0) > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="运行事件"
          value={String(diagnostics?.incidents.length ?? 0)}
          tone={(diagnostics?.incidents.length ?? 0) > 0 ? 'warning' : 'default'}
        />
      </MetricGrid>

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
          共享协作轨迹
        </span>
        {sharedAuditLogs.length > 0 ? (
          <div style={{ display: 'grid', gap: 6 }}>
            {sharedAuditLogs.map((log) => (
              <div
                key={log.id}
                style={{
                  display: 'grid',
                  gap: 4,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
                  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      padding: '1px 8px',
                      borderRadius: 999,
                      background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                      color: 'var(--accent)',
                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    {ACTION_LABELS[log.action] ?? log.action}
                  </span>
                  <span style={{ color: 'var(--fg-muted)' }}>
                    {log.actorEmail ?? log.actorUserId ?? '系统'}
                  </span>
                  <span style={{ color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(log.createdAt)}
                  </span>
                </div>
                <strong style={{ color: 'var(--fg-strong)', fontSize: 12 }}>{log.summary}</strong>
                {log.detail ? (
                  <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.6 }}>
                    {log.detail}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            emoji="📜"
            title="暂无共享协作异常"
            description="共享评论、权限处理和问题回复等记录出现后，会在这里形成健康轨迹。"
          />
        )}
      </div>
    </div>
  );
}
