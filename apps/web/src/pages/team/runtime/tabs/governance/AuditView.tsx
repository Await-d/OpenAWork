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
import { TabContainer } from '../TabContainer.js';

const ACTION_LABELS: Record<TeamAuditLogRecord['action'], string> = {
  share_created: '创建共享',
  share_deleted: '删除共享',
  share_permission_updated: '权限变更',
  shared_comment_created: '共享评论',
  shared_permission_replied: '权限回复',
  shared_question_replied: '问题回复',
};

const ENTITY_LABELS: Record<TeamAuditLogRecord['entityType'], string> = {
  session_share: '会话共享',
  shared_session_comment: '共享评论',
  permission_request: '权限申请',
  question_request: '问题请求',
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
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--text-3)',
};

const FILTER_BTN_ACTIVE_STYLE: CSSProperties = {
  ...FILTER_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 16%, var(--surface))',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--text)',
};

const ROW_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
};

export function AuditView() {
  const { auditLogs } = useTeamRuntimeReferenceViewData();

  const [entityFilter, setEntityFilter] = useState<TeamAuditLogRecord['entityType'] | 'all'>('all');
  const [actorFilter, setActorFilter] = useState<string>('');

  const filtered = useMemo(() => {
    let list = auditLogs;
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
  }, [auditLogs, entityFilter, actorFilter]);

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

  if (auditLogs.length === 0) {
    return (
      <TabContainer title="审计日志" subtitle="共享 / 评论 / 权限变更等敏感操作的完整轨迹。">
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
              📜
            </span>
            <strong style={{ color: 'var(--text-2)' }}>暂无审计记录</strong>
            <span>共享、评论、权限变更等操作发生后会自动出现在这里。</span>
          </div>
        </div>
      </TabContainer>
    );
  }

  return (
    <TabContainer title="审计日志" subtitle="共享 / 评论 / 权限变更等敏感操作的完整轨迹。">
      <div style={CONTAINER_STYLE}>
        <div style={FILTER_BAR_STYLE}>
          <FilterBtn
            label={`全部 · ${auditLogs.length}`}
            active={entityFilter === 'all'}
            onClick={() => setEntityFilter('all')}
          />
          {(Object.keys(ENTITY_LABELS) as TeamAuditLogRecord['entityType'][]).map((entity) => {
            const count = auditLogs.filter((log) => log.entityType === entity).length;
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
              border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
              background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
              color: 'var(--text)',
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
            <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 12 }}>
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
                      background: 'color-mix(in srgb, var(--accent) 14%, var(--surface))',
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
                      background: 'color-mix(in srgb, var(--surface) 60%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
                      color: 'var(--text-2)',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {ENTITY_LABELS[log.entityType] ?? log.entityType}
                  </span>
                  {log.actorEmail ? (
                    <span style={{ color: 'var(--text-3)' }}>by {log.actorEmail}</span>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  <span style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
                  {log.summary}
                </span>
                {log.detail ? (
                  <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                    {log.detail}
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
