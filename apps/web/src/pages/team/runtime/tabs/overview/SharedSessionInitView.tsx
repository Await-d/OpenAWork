import type {} from '@openAwork/web-client';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import {
  resolveMatchedSharedSessionDetail,
  resolveMatchedSharedSummary,
} from '../../data/team-runtime-shared-context.js';
import { EmptyState, MetricGrid, StatCard } from '../../shared/content-kit/index.js';

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

export function SharedSessionInitView({ selectedTeam }: { selectedTeam: AgentTeamsSidebarTeam }) {
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

  if (sharedSessionLoading && !sharedSession) {
    return (
      <EmptyState
        emoji="🧭"
        title="正在同步共享接入摘要"
        description="共享会话详情加载完成后，这里会展示共享来源、权限和接入上下文。"
      />
    );
  }

  if (!sharedSummary) {
    return (
      <EmptyState
        emoji="🧭"
        title="共享接入摘要暂不可用"
        description="当前只拿到了共享会话选择状态，详细共享快照还未同步。"
      />
    );
  }

  return (
    <div data-testid="shared-init-view" style={{ display: 'grid', gap: 10 }}>
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
        共享会话没有本地 teamInit
        初始化记录。这里展示的是共享接入摘要，帮助你快速判断这条共享运行来自哪里、可用到什么程度。
      </div>

      <MetricGrid minColumnWidth={180} fill="auto-fit" gap={12}>
        <StatCard
          label="共享者"
          value={sharedSummary.sharedByEmail}
          note={sharedSummary.title ?? sharedSummary.sessionId}
          accentBar
        />
        <StatCard
          label="权限"
          value={
            sharedSummary.permission === 'operate'
              ? '可操作'
              : sharedSummary.permission === 'comment'
                ? '评论'
                : '只读'
          }
          note={`状态 ${sharedSummary.stateStatus}`}
          accentBar
        />
        <StatCard
          label="工作区"
          value={sharedSummary.workspacePath ?? '未绑定工作区'}
          note={`共享建立 ${formatIsoTime(sharedSummary.shareCreatedAt)}`}
          accentBar
        />
        <StatCard
          label="最近同步"
          value={formatIsoTime(sharedSummary.shareUpdatedAt)}
          note={
            sharedSession?.session.fileChangesSummary?.latestSnapshotAt
              ? `最近快照 ${formatIsoTime(sharedSession.session.fileChangesSummary.latestSnapshotAt)}`
              : '暂无快照'
          }
          accentBar
        />
      </MetricGrid>

      <div
        style={{
          display: 'grid',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 10,
          border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
          background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
        }}
      >
        <strong style={{ color: 'var(--fg-strong)', fontSize: 13 }}>当前已知上下文</strong>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          Assistant 输出{' '}
          {sharedSession?.session.messages?.filter((message) => message.role === 'assistant')
            .length ?? 0}{' '}
          条 · 评论 {sharedSession?.comments.length ?? 0} 条 · 待审批{' '}
          {sharedSession?.pendingPermissions.length ?? 0} 项 · 待回答{' '}
          {sharedSession?.pendingQuestions.length ?? 0} 项。
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          {sharedSession?.session.fileChangesSummary
            ? `当前共享快照已记录 ${sharedSession.session.fileChangesSummary.snapshotCount} 个快照，来源类型 ${sharedSession.session.fileChangesSummary.sourceKinds.length} 种。`
            : '当前共享会话还没有同步到文件快照摘要。'}
        </span>
      </div>
    </div>
  );
}
