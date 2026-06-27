import { useMemo, type CSSProperties } from 'react';
import type { Message } from '@openAwork/shared';
import type { TeamAuditLogRecord } from '@openAwork/web-client';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { formatSidebarTeamStatus } from '../../data/team-runtime-status.js';
import { resolveSidebarTeamSubtitle } from '../../data/team-runtime-status.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import {
  resolveMatchedSharedSessionDetail,
  resolveMatchedSharedSummary,
} from '../../data/team-runtime-shared-context.js';
import { formatTimelineDetail } from '../../data/team-runtime-reference-formatters.js';
import { tryFormatJson } from '../../../../../utils/format-json.js';
import {
  CK_GAP_LG,
  CK_PAD_LG,
  CK_RADIUS_LG,
  EmptyState,
  MetricGrid,
  SectionPanel,
  StatCard,
} from '../../shared/content-kit/index.js';

const ACTION_LABELS: Record<string, string> = {
  share_created: '创建共享',
  share_deleted: '删除共享',
  share_permission_updated: '权限变更',
  shared_comment_created: '共享评论',
  shared_permission_replied: '权限回复',
  shared_question_replied: '问题回复',
  runtime_alert_control: '告警控制',
  runtime_remediation: '运行修复',
  'resume-all': '恢复全部运行',
  'pause-all': '暂停全部运行',
  'stop-all': '停止全部运行',
  'restart-all': '重启全部运行',
  'cancel-all': '取消全部运行',
  resume: '恢复运行',
  pause: '暂停运行',
  stop: '停止运行',
  start: '开始运行',
  restart: '重启运行',
  cancel: '取消运行',
  create: '创建',
  update: '更新',
  delete: '删除',
  plan: '规划',
  review: '评审',
  execute: '执行',
  run: '执行',
};

const TIMELINE_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

function formatSharedStatus(status: AgentTeamsSidebarTeam['status']): {
  color: string;
  label: string;
} {
  if (status === 'idle') {
    return { color: 'var(--fg-subtle)', label: formatSidebarTeamStatus(status) };
  }
  if (status === 'running') {
    return { color: 'var(--success)', label: '运行中' };
  }
  if (status === 'paused') {
    return { color: 'var(--warning)', label: '已暂停' };
  }
  if (status === 'failed') {
    return { color: 'var(--danger)', label: '失败' };
  }
  return { color: 'var(--fg-muted)', label: formatSidebarTeamStatus(status) };
}

function formatIsoTime(value: string | undefined): string {
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

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function summarizeAssistantMessage(message: Message): string {
  const text = message.content
    .flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
    .find((part) => part.length > 0);
  return text ? (text.length > 56 ? `${text.slice(0, 53)}…` : text) : '共享输出已更新';
}

export function SharedSessionOverviewView({
  selectedTeam,
}: {
  selectedTeam: AgentTeamsSidebarTeam;
}) {
  const {
    activeSharedSession,
    auditLogs,
    selectedSharedSession,
    sharedSessionLoading,
    sharedSessions,
  } = useTeamRuntimeReferenceViewData();
  const sharedSession = resolveMatchedSharedSessionDetail({
    selectedTeamId: selectedTeam.id,
    activeSharedSession,
    selectedSharedSession,
  });
  const sharedSummary = resolveMatchedSharedSummary({
    selectedTeamId: selectedTeam.id,
    activeSharedSession,
    selectedSharedSession,
    sharedSessions,
  });
  const assistantMessages =
    sharedSession?.session.messages?.filter((message) => message.role === 'assistant') ?? [];
  const activePresenceCount = sharedSession?.presence.filter((entry) => entry.active).length ?? 0;
  const sharedAuditLogs = useMemo(
    () =>
      auditLogs
        .filter((log) => log.sessionId === selectedTeam.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 8),
    [auditLogs, selectedTeam.id],
  );
  const timelineItems = useMemo(() => {
    const assistantItems = assistantMessages.map((message, index) => ({
      detail: summarizeAssistantMessage(message),
      id: `assistant-${message.id}`,
      tag: 'Assistant 输出',
      timestamp: message.createdAt,
      title: `共享输出 #${index + 1}`,
    }));
    const commentItems = (sharedSession?.comments ?? []).map((comment) => ({
      detail: comment.content,
      id: `comment-${comment.id}`,
      tag: '共享评论',
      timestamp: Date.parse(comment.createdAt),
      title: comment.authorEmail,
    }));
    const auditItems = sharedAuditLogs.map((log) => ({
      detail: formatTimelineDetail(log.detail ?? log.summary, 200),
      id: `audit-${log.id}`,
      tag: ACTION_LABELS[log.action] ?? log.action,
      timestamp: Date.parse(log.createdAt),
      title: log.actorEmail ?? log.actorUserId ?? '系统',
    }));

    return [...assistantItems, ...commentItems, ...auditItems]
      .filter((item) => Number.isFinite(item.timestamp))
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 12);
  }, [assistantMessages, sharedAuditLogs, sharedSession?.comments]);
  const statusSubtitle = resolveSidebarTeamSubtitle(selectedTeam.status, selectedTeam.subtitle);

  if (sharedSessionLoading && !sharedSession) {
    return (
      <EmptyState
        emoji="🛰️"
        title="正在同步共享概览"
        description="共享会话详情加载完成后，这里会展示输出、评论和协作轨迹。"
      />
    );
  }

  if (!sharedSummary) {
    return (
      <EmptyState
        emoji="🛰️"
        title="共享概览暂不可用"
        description="当前只拿到了共享会话选择状态，详细共享快照稍后会自动同步。"
      />
    );
  }

  const status = formatSharedStatus(selectedTeam.status);

  return (
    <div data-testid="shared-overview-view" style={{ display: 'grid', gap: CK_GAP_LG }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: CK_PAD_LG,
          borderRadius: CK_RADIUS_LG,
          background:
            'linear-gradient(135deg, color-mix(in oklch, var(--accent) 8%, var(--bg-overlay)) 0%, var(--bg-base) 100%)',
          border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-muted)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            当前共享会话
          </span>
          <span
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: 'var(--fg-strong)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {selectedTeam.title}
          </span>
          {statusSubtitle ? (
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{statusSubtitle}</span>
          ) : null}
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 999,
            background: `color-mix(in srgb, ${status.color} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${status.color} 38%, transparent)`,
            color: status.color,
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: status.color,
            }}
          />
          {status.label}
        </span>
      </div>

      <MetricGrid minColumnWidth={180} fill="auto-fit" gap={12}>
        <StatCard
          label="Assistant 输出"
          value={String(assistantMessages.length)}
          note={
            assistantMessages.length > 0
              ? `最近一条 ${formatTimestamp(assistantMessages[assistantMessages.length - 1]!.createdAt)}`
              : '暂无输出'
          }
          accentBar
        />
        <StatCard
          label="协作评论"
          value={String(sharedSession?.comments.length ?? 0)}
          note={
            sharedSession?.comments.length
              ? `最近同步 ${formatIsoTime(sharedSummary.shareUpdatedAt)}`
              : '暂无评论'
          }
          accentBar
        />
        <StatCard
          label="在线查看"
          value={String(activePresenceCount)}
          note={`Presence 总数 ${sharedSession?.presence.length ?? 0}`}
          accentBar
        />
        <StatCard
          label="待审批"
          value={String(sharedSession?.pendingPermissions.length ?? 0)}
          note={sharedSession?.pendingPermissions.length ? '共享请求待处理' : '当前无待审批'}
          tone={(sharedSession?.pendingPermissions.length ?? 0) > 0 ? 'warning' : 'default'}
          accentBar
        />
        <StatCard
          label="待回答"
          value={String(sharedSession?.pendingQuestions.length ?? 0)}
          note={sharedSession?.pendingQuestions.length ? '共享问题待答复' : '当前无待答复'}
          tone={(sharedSession?.pendingQuestions.length ?? 0) > 0 ? 'warning' : 'default'}
          accentBar
        />
        <StatCard
          label="共享轨迹"
          value={String(sharedAuditLogs.length)}
          note={
            sharedAuditLogs.length
              ? `最近一条 ${formatIsoTime(sharedAuditLogs[0]?.createdAt)}`
              : '暂无共享审计'
          }
          accentBar
        />
      </MetricGrid>

      <SectionPanel title="共享活动时间线" hint={`${timelineItems.length} 事件`}>
        {timelineItems.length > 0 ? (
          <div
            style={{ display: 'grid', gap: 4, maxHeight: 420, overflow: 'auto', paddingRight: 4 }}
          >
            {timelineItems.map((item) => (
              <div key={item.id} style={TIMELINE_CARD_STYLE}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--fg-muted)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatTimestamp(item.timestamp)}
                  </span>
                  <span
                    style={{
                      padding: '1px 5px',
                      borderRadius: 999,
                      background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                      color: 'var(--accent)',
                      fontSize: 9,
                      fontWeight: 700,
                    }}
                  >
                    {item.tag}
                  </span>
                  <span
                    style={{
                      padding: '1px 5px',
                      borderRadius: 999,
                      background: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
                      color: 'var(--fg-default)',
                      fontSize: 9,
                      fontWeight: 600,
                    }}
                  >
                    {item.title}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.5 }}>
                  {tryFormatJson(item.detail)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            emoji="🛰️"
            title="暂无共享活动"
            description="共享输出、评论或权限处理出现后，这里会形成共享时间线。"
          />
        )}
      </SectionPanel>
    </div>
  );
}
