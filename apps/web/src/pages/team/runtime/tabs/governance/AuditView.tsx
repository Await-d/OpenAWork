/**
 * 260516-team-page-v2 · T-13 · AuditView
 *
 * 「审计日志」tab：列出 collaboration.auditLogs，按 entityType / actor 过滤。
 *
 * 数据来源：useTeamRuntimeReferenceViewData().auditLogs
 */

import { useMemo, useState, type CSSProperties } from 'react';
import type { TeamAuditLogRecord } from '@openAwork/web-client';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { formatTimelineDetail } from '../../data/team-runtime-reference-formatters.js';
import { TabContainer } from '../TabContainer.js';
import { collectSessionScope, isSessionInScope } from '../../data/team-runtime-session-scope.js';
import { SecurityIcon } from '../../shared/TeamIcons.js';
import { TeamGovernanceWorkbenchHeader } from './TeamGovernanceWorkbenchHeader.js';

const ACTION_LABELS: Record<TeamAuditLogRecord['action'], string> = {
  capability_violation: '能力越权',
  constitution_check: '宪法检查',
  quality_review: '质量评审',
  share_created: '创建共享',
  share_deleted: '删除共享',
  share_permission_updated: '权限变更',
  shared_comment_created: '共享评论',
  shared_permission_replied: '权限回复',
  shared_question_replied: '问题回复',
  runtime_incident: '运行异常',
  runtime_alert_control: '告警控制',
  runtime_remediation: '运行修复',
  handoff_control: '派发控制',
  escape_hatch_used: '逃生舱',
  route_decision: '路由决策',
  task_created: '任务创建',
};

const ENTITY_LABELS: Record<TeamAuditLogRecord['entityType'], string> = {
  artifact: '产物',
  layer: '层级',
  session_share: '会话共享',
  shared_session_comment: '共享评论',
  permission_request: '权限申请',
  question_request: '问题请求',
  team_task: '团队任务',
  session_inbound_message: '入站消息',
  handoff: '派发任务',
  runtime_incident: '运行异常',
  runtime_alert: '运行告警',
  session: '会话',
};

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const FILTER_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const FILTER_BTN_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--fg-muted)',
};

const FILTER_BTN_ACTIVE_STYLE: CSSProperties = {
  ...FILTER_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--fg-strong)',
};

const ROW_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

type AuditScopeMode = 'workspace' | 'session';

export interface AuditViewProps {
  selectedSessionId?: string | null;
  selectedSessionTitle?: string | null;
}

export function AuditView({
  selectedSessionId = null,
  selectedSessionTitle = null,
}: AuditViewProps = {}) {
  const { auditLogs, sessions } = useTeamRuntimeReferenceViewData();

  const [entityFilter, setEntityFilter] = useState<TeamAuditLogRecord['entityType'] | 'all'>('all');
  const [actorFilter, setActorFilter] = useState<string>('');
  const [scopeMode, setScopeMode] = useState<AuditScopeMode>('workspace');

  const sessionScope = useMemo(
    () => (selectedSessionId ? collectSessionScope(selectedSessionId, sessions) : null),
    [selectedSessionId, sessions],
  );

  const scopedAuditLogs = useMemo(() => {
    if (scopeMode !== 'session' || !sessionScope) {
      return auditLogs;
    }
    return auditLogs.filter(
      (log) => !log.sessionId || isSessionInScope(log.sessionId, sessionScope),
    );
  }, [auditLogs, scopeMode, sessionScope]);

  const filtered = useMemo(() => {
    let list = scopedAuditLogs;
    if (entityFilter !== 'all') {
      list = list.filter((log) => log.entityType === entityFilter);
    }
    if (actorFilter.trim()) {
      const q = actorFilter.toLowerCase();
      list = list.filter(
        (log) =>
          (log.actorEmail ?? '').toLowerCase().includes(q) ||
          (log.actorUserId ?? '').toLowerCase().includes(q),
      );
    }
    return list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [scopedAuditLogs, entityFilter, actorFilter]);

  const actorCount = useMemo(() => {
    const actors = new Set<string>();
    for (const log of scopedAuditLogs) {
      const actor = log.actorEmail ?? log.actorUserId;
      if (actor) {
        actors.add(actor);
      }
    }
    return actors.size;
  }, [scopedAuditLogs]);

  const entityTypeCount = useMemo(
    () => new Set(scopedAuditLogs.map((log) => log.entityType)).size,
    [scopedAuditLogs],
  );

  const exportCsv = () => {
    const header = 'createdAt,action,entityType,entityId,actor,summary\n';
    const rows = filtered
      .map((log) =>
        [
          log.createdAt,
          log.action,
          log.entityType,
          log.entityId,
          log.actorEmail ?? log.actorUserId ?? '',
          (log.summary ?? '').replaceAll('"', '""'),
        ]
          .map((v) => `"${String(v)}"`)
          .join(','),
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `team-audit-${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summaryHeader = (
    <TeamGovernanceWorkbenchHeader
      area="audit"
      eyebrow="Governance · Audit"
      title="治理工作台摘要"
      description="把审计范围、实体类型、操作者和导出动作放在同一首屏，先确认追踪边界，再进入过滤列表。"
      metrics={[
        {
          label: '审计记录',
          value: scopedAuditLogs.length,
          detail: scopeMode === 'session' ? '当前会话子树' : '工作区全部',
          tone: scopedAuditLogs.length > 0 ? 'warning' : 'muted',
        },
        {
          label: '实体类型',
          value: entityTypeCount,
          detail: '敏感对象覆盖',
          tone: entityTypeCount > 0 ? 'aux' : 'muted',
        },
        {
          label: '操作者',
          value: actorCount,
          detail: 'actor 去重统计',
          tone: actorCount > 0 ? 'accent' : 'muted',
        },
        {
          label: '过滤结果',
          value: filtered.length,
          detail:
            entityFilter === 'all' ? '全部类型' : (ENTITY_LABELS[entityFilter] ?? entityFilter),
          tone: filtered.length > 0 ? 'success' : 'warning',
        },
      ]}
      signals={[
        {
          label: '范围',
          value:
            scopeMode === 'session'
              ? (selectedSessionTitle ?? selectedSessionId?.slice(0, 8) ?? '当前会话')
              : '工作区全部',
          tone: scopeMode === 'session' ? 'accent' : 'muted',
        },
        {
          label: 'Actor 过滤',
          value: actorFilter.trim() ? actorFilter.trim() : '未启用',
          tone: actorFilter.trim() ? 'aux' : 'muted',
        },
      ]}
    />
  );

  if (scopedAuditLogs.length === 0) {
    return (
      <TabContainer title="审计日志" subtitle="共享 / 评论 / 权限变更等敏感操作的完整轨迹。">
        <div style={CONTAINER_STYLE}>
          {summaryHeader}
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              padding: 32,
              borderRadius: 12,
              border: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
              color: 'var(--fg-muted)',
              fontSize: 13,
              gap: 6,
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 10,
                color: 'var(--fg-muted)',
                border: '1px solid color-mix(in srgb, var(--border-default) 48%, transparent)',
                background: 'color-mix(in srgb, var(--bg-overlay) 82%, var(--bg-base))',
              }}
              aria-hidden
            >
              <SecurityIcon size={18} color="currentColor" />
            </span>
            <strong style={{ color: 'var(--fg-default)' }}>暂无审计记录</strong>
            <span>共享、评论、权限变更等操作发生后会自动出现在这里。</span>
          </div>
        </div>
      </TabContainer>
    );
  }

  return (
    <TabContainer title="审计日志" subtitle="共享 / 评论 / 权限变更等敏感操作的完整轨迹。">
      <div style={CONTAINER_STYLE}>
        {summaryHeader}
        <div style={FILTER_BAR_STYLE}>
          {selectedSessionId ? (
            <>
              <FilterBtn
                label="工作区全部"
                active={scopeMode === 'workspace'}
                onClick={() => setScopeMode('workspace')}
              />
              <FilterBtn
                label={`当前会话子树 · ${selectedSessionTitle ?? selectedSessionId.slice(0, 8)}`}
                active={scopeMode === 'session'}
                onClick={() => setScopeMode('session')}
              />
            </>
          ) : null}
          <FilterBtn
            label={`全部 · ${scopedAuditLogs.length}`}
            active={entityFilter === 'all'}
            onClick={() => setEntityFilter('all')}
          />
          {(Object.keys(ENTITY_LABELS) as TeamAuditLogRecord['entityType'][]).map((entity) => {
            const count = scopedAuditLogs.filter((log) => log.entityType === entity).length;
            if (count === 0) return null;
            return (
              <FilterBtn
                key={entity}
                label={`${ENTITY_LABELS[entity]} · ${count}`}
                active={entityFilter === entity}
                onClick={() => setEntityFilter(entity)}
              />
            );
          })}
          <input
            type="text"
            placeholder="按 actor 过滤"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
              background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
              color: 'var(--fg-strong)',
              fontSize: 11,
              minWidth: 140,
            }}
          />
          <span style={{ flex: 1 }} />
          <button type="button" onClick={exportCsv} style={FILTER_BTN_STYLE}>
            导出 CSV
          </button>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 12 }}>
              当前过滤条件下无记录。
            </div>
          ) : (
            filtered.map((log) => (
              <div key={log.id} style={ROW_STYLE}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      padding: '1px 8px',
                      borderRadius: 999,
                      background: 'color-mix(in srgb, var(--accent) 14%, var(--bg-overlay))',
                      color: 'var(--accent)',
                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    {ACTION_LABELS[log.action] ?? log.action}
                  </span>
                  <span
                    style={{
                      padding: '1px 8px',
                      borderRadius: 999,
                      background: 'var(--bg-overlay)',
                      border:
                        '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
                      color: 'var(--fg-default)',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {ENTITY_LABELS[log.entityType] ?? log.entityType}
                  </span>
                  {scopeMode === 'session' && log.sessionId ? (
                    <span style={{ color: 'var(--fg-muted)' }}>
                      session {log.sessionId.slice(0, 8)}
                    </span>
                  ) : null}
                  {log.actorEmail ? (
                    <span style={{ color: 'var(--fg-muted)' }}>by {log.actorEmail}</span>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  <span style={{ color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--fg-strong)', lineHeight: 1.5 }}>
                  {formatTimelineDetail(log.summary, 120)}
                </span>
                {log.detail ? (
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                    {formatTimelineDetail(log.detail, 200)}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </TabContainer>
  );
}

function FilterBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={active ? FILTER_BTN_ACTIVE_STYLE : FILTER_BTN_STYLE}
    >
      {label}
    </button>
  );
}
