import { useMemo, type CSSProperties } from 'react';
import type { Message } from '@openAwork/shared';
import type {} from '@openAwork/web-client';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { resolveSidebarTeamSubtitle } from '../../data/team-runtime-status.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import {
  resolveMatchedSharedSessionDetail,
  resolveMatchedSharedSummary,
} from '../../data/team-runtime-shared-context.js';
import { EmptyState, MetricGrid, StatCard } from '../../shared/content-kit/index.js';

const GRAPH_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

const NODE_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  minWidth: 150,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

function summarizeAssistantMessage(message: Message): string {
  const text = message.content
    .flatMap((part) => (part.type === 'text' ? [part.text.trim()] : []))
    .find((part) => part.length > 0);
  return text ? (text.length > 48 ? `${text.slice(0, 45)}…` : text) : '共享输出已更新';
}

export function SharedSessionGraphView({ selectedTeam }: { selectedTeam: AgentTeamsSidebarTeam }) {
  const { activeSharedSession, selectedSharedSession, sharedSessionLoading, sharedSessions } =
    useTeamRuntimeReferenceViewData();
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
  const graphNodes = useMemo(
    () => [
      {
        description: sharedSummary?.sharedByEmail ?? '待同步共享者',
        title: '共享来源',
      },
      {
        description:
          sharedSession?.session.fileChangesSummary?.snapshotCount != null
            ? `${sharedSession.session.fileChangesSummary.snapshotCount} 个快照`
            : '暂无快照',
        title: '工作区快照',
      },
      {
        description:
          assistantMessages.length > 0
            ? summarizeAssistantMessage(assistantMessages[assistantMessages.length - 1]!)
            : '暂无 assistant 输出',
        title: '共享输出',
      },
      {
        description: `${sharedSession?.comments.length ?? 0} 条评论 · ${
          sharedSession?.presence.filter((entry) => entry.active).length ?? 0
        } 人在线`,
        title: '协作状态',
      },
      {
        description: `审批 ${sharedSession?.pendingPermissions.length ?? 0} · 问题 ${
          sharedSession?.pendingQuestions.length ?? 0
        }`,
        title: '待处理项',
      },
    ],
    [assistantMessages, sharedSession, sharedSummary?.sharedByEmail],
  );
  const statusSubtitle = resolveSidebarTeamSubtitle(selectedTeam.status, selectedTeam.subtitle);

  if (sharedSessionLoading && !sharedSession) {
    return (
      <EmptyState
        emoji="🕸️"
        title="正在同步共享关系图"
        description="共享会话详情加载完成后，这里会展示共享来源、输出、快照和待处理项之间的关系。"
      />
    );
  }

  if (!sharedSummary) {
    return (
      <EmptyState
        emoji="🕸️"
        title="共享关系图暂不可用"
        description="当前只拿到了共享会话选择状态，详细共享快照还未同步。"
      />
    );
  }

  return (
    <div data-testid="shared-graph-view" style={{ display: 'grid', gap: 10 }}>
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
        共享会话没有本地多层 runtime 树。这里展示共享来源、快照、输出和待处理项之间的实际关系。
      </div>

      <MetricGrid minColumnWidth={180} fill="auto-fit" gap={12}>
        <StatCard label="共享输出" value={String(assistantMessages.length)} accentBar />
        <StatCard
          label="快照数"
          value={String(sharedSession?.session.fileChangesSummary?.snapshotCount ?? 0)}
          accentBar
        />
        <StatCard label="协作评论" value={String(sharedSession?.comments.length ?? 0)} accentBar />
        <StatCard
          label="待处理项"
          value={String(
            (sharedSession?.pendingPermissions.length ?? 0) +
              (sharedSession?.pendingQuestions.length ?? 0),
          )}
          accentBar
        />
      </MetricGrid>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={GRAPH_ROW_STYLE}>
          <div style={{ ...NODE_STYLE, minWidth: 180 }}>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>
              共享会话
            </span>
            <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
              {selectedTeam.title}
            </strong>
            {statusSubtitle ? (
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{statusSubtitle}</span>
            ) : null}
          </div>
          <span style={{ color: 'var(--fg-muted)', fontWeight: 700 }}>→</span>
          {graphNodes.map((node) => (
            <div key={node.title} style={NODE_STYLE}>
              <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>
                {node.title}
              </span>
              <span style={{ fontSize: 12, color: 'var(--fg-strong)', lineHeight: 1.5 }}>
                {node.description}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
