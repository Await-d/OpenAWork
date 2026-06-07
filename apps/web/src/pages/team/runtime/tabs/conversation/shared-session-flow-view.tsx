import { useMemo, type CSSProperties } from 'react';
import type { Message } from '@openAwork/shared';
import type { TeamAuditLogRecord } from '@openAwork/web-client';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import {
  resolveMatchedSharedSessionDetail,
  resolveMatchedSharedSummary,
} from '../../data/team-runtime-shared-context.js';
import { EmptyState, MetricGrid, StatCard } from '../../shared/content-kit/index.js';
import { TabContainer } from '../TabContainer.js';

const FLOW_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 0,
  padding: '18px 8px',
  borderRadius: 14,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
  overflowX: 'auto',
};

const FLOW_NODE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  width: 150,
  padding: '10px 8px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-overlay))',
  flexShrink: 0,
};

const FLOW_EDGE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 40,
  color: 'var(--accent)',
  fontSize: 12,
  fontWeight: 700,
  flexShrink: 0,
};

const EVENT_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

function formatTimeMs(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function summarizeAssistantMessage(message: Message): string {
  const text = message.content
    .flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
    .find((part) => part.length > 0);
  return text ? (text.length > 56 ? `${text.slice(0, 53)}…` : text) : '共享输出已更新';
}

export function SharedSessionFlowView({ selectedTeam }: { selectedTeam: AgentTeamsSidebarTeam }) {
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
  const flowNodes = [
    {
      detail: sharedSummary?.sharedByEmail ?? '待同步共享者',
      label: '共享来源',
      value: sharedSummary?.workspacePath ?? '未绑定工作区',
    },
    {
      detail: assistantMessages.length
        ? summarizeAssistantMessage(assistantMessages[assistantMessages.length - 1]!)
        : '暂无输出',
      label: '共享输出',
      value: `${assistantMessages.length} 条`,
    },
    {
      detail: `${sharedSession?.comments.length ?? 0} 条评论 · ${
        sharedSession?.presence.filter((entry) => entry.active).length ?? 0
      } 人在线`,
      label: '协作互动',
      value: `${sharedSession?.comments.length ?? 0}`,
    },
    {
      detail: `审批 ${sharedSession?.pendingPermissions.length ?? 0} · 问题 ${
        sharedSession?.pendingQuestions.length ?? 0
      }`,
      label: '待处理项',
      value: String(
        (sharedSession?.pendingPermissions.length ?? 0) +
          (sharedSession?.pendingQuestions.length ?? 0),
      ),
    },
  ];

  const recentEvents = useMemo(() => {
    const items = [
      ...assistantMessages.map((message) => ({
        detail: summarizeAssistantMessage(message),
        id: `assistant-${message.id}`,
        tag: '输出',
        timestampMs: message.createdAt,
      })),
      ...(sharedSession?.comments ?? []).map((comment) => ({
        detail: comment.content,
        id: `comment-${comment.id}`,
        tag: '评论',
        timestampMs: parseIsoMs(comment.createdAt) ?? 0,
      })),
      ...auditLogs
        .filter((log) => log.sessionId === selectedTeam.id)
        .map((log) => ({
          detail: log.summary,
          id: `audit-${log.id}`,
          tag: '审计',
          timestampMs: parseIsoMs(log.createdAt) ?? 0,
        })),
    ]
      .filter((item) => item.timestampMs > 0)
      .sort((left, right) => right.timestampMs - left.timestampMs)
      .slice(0, 8);

    return items;
  }, [assistantMessages, auditLogs, selectedTeam.id, sharedSession?.comments]);

  if (sharedSessionLoading && !sharedSession) {
    return (
      <TabContainer
        title="层级流动"
        subtitle="共享会话展示共享协作流，而不是本地 runtime handoff 流水线。"
      >
        <EmptyState
          emoji="🪜"
          title="正在同步共享协作流"
          description="共享会话详情加载完成后，这里会展示共享来源、输出、评论和待处理项的真实流动。"
        />
      </TabContainer>
    );
  }

  if (!sharedSummary) {
    return (
      <TabContainer
        title="层级流动"
        subtitle="共享会话展示共享协作流，而不是本地 runtime handoff 流水线。"
      >
        <EmptyState
          emoji="🪜"
          title="共享协作流暂不可用"
          description="当前只拿到了共享会话选择状态，详细共享快照还未同步。"
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="层级流动"
      subtitle="共享会话展示共享来源 → 输出 → 评论/在线 → 待处理项 的协作流。"
    >
      <div data-testid="shared-flow-view" style={{ display: 'grid', gap: 14 }}>
        <MetricGrid minColumnWidth={180} fill="auto-fit" gap={12}>
          <StatCard label="共享输出" value={String(assistantMessages.length)} accentBar />
          <StatCard
            label="协作评论"
            value={String(sharedSession?.comments.length ?? 0)}
            accentBar
          />
          <StatCard
            label="待处理项"
            value={String(
              (sharedSession?.pendingPermissions.length ?? 0) +
                (sharedSession?.pendingQuestions.length ?? 0),
            )}
            accentBar
          />
        </MetricGrid>

        <div style={FLOW_ROW_STYLE}>
          {flowNodes.map((node, index) => (
            <div key={node.label} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={FLOW_NODE_STYLE}>
                <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>
                  {node.label}
                </span>
                <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>{node.value}</strong>
                <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                  {node.detail}
                </span>
              </div>
              {index < flowNodes.length - 1 ? <span style={FLOW_EDGE_STYLE}>→</span> : null}
            </div>
          ))}
        </div>

        {recentEvents.length > 0 ? (
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
              最近共享事件
            </span>
            <div style={{ display: 'grid', gap: 6 }}>
              {recentEvents.map((item) => (
                <div key={item.id} style={EVENT_ROW_STYLE}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span
                      style={{
                        padding: '1px 8px',
                        borderRadius: 999,
                        background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                        color: 'var(--accent)',
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {item.tag}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                      {formatTimeMs(item.timestampMs)}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--fg-default)', lineHeight: 1.6 }}>
                    {item.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            emoji="📭"
            title="暂无共享流动事件"
            description="共享输出、评论或协作审计出现后，这里会形成共享流动轨迹。"
          />
        )}
      </div>
    </TabContainer>
  );
}
