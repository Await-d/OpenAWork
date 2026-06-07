import { useCallback, type CSSProperties } from 'react';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { resolveMatchedSharedSessionDetail } from '../../data/team-runtime-shared-context.js';
import { EmptyState } from '../../shared/content-kit/index.js';

const CONTAINER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
};

const SUMMARY_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  boxShadow: 'var(--shadow-sm)',
};

const ITEM_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

const ACTION_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const ACTION_BTN_STYLE: CSSProperties = {
  padding: '5px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

const PRIMARY_ACTION_BTN_STYLE: CSSProperties = {
  ...ACTION_BTN_STYLE,
  borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  color: 'var(--accent)',
};

function formatSharedStatus(status: AgentTeamsSidebarTeam['status']): string {
  if (status === 'running') return '运行中';
  if (status === 'paused') return '已暂停';
  if (status === 'failed') return '失败';
  return '已完成';
}

export function SharedSessionMentionsView({
  selectedTeam,
}: {
  selectedTeam: AgentTeamsSidebarTeam;
}) {
  const {
    activeSharedSession,
    canManageSessionEntries,
    replyReview,
    reviewBusy,
    selectedSharedSession,
    sharedSessionLoading,
  } = useTeamRuntimeReferenceViewData();
  const sharedSession = resolveMatchedSharedSessionDetail({
    selectedTeamId: selectedTeam.id,
    activeSharedSession,
    selectedSharedSession,
  });
  const pendingPermissions = sharedSession?.pendingPermissions ?? [];
  const pendingQuestions = sharedSession?.pendingQuestions ?? [];

  const handlePermissionDecision = useCallback(
    (requestId: string, approved: boolean) => {
      if (!canManageSessionEntries) {
        return;
      }
      void replyReview(`permission-${requestId}`, approved ? 'approved' : 'rejected');
    },
    [canManageSessionEntries, replyReview],
  );

  const handleQuestionDecision = useCallback(
    (requestId: string, approved: boolean) => {
      if (!canManageSessionEntries) {
        return;
      }
      void replyReview(`question-${requestId}`, approved ? 'approved' : 'rejected');
    },
    [canManageSessionEntries, replyReview],
  );

  if (sharedSessionLoading && !sharedSession) {
    return (
      <EmptyState
        emoji="🔔"
        title="正在同步共享待办"
        description="共享会话详情加载完成后，这里会展示待处理的权限请求和问题请求。"
      />
    );
  }

  if (!sharedSession) {
    return (
      <EmptyState
        emoji="🔔"
        title="共享待办暂不可用"
        description="当前只拿到了共享会话选择状态，协作待办详情还未同步。"
      />
    );
  }

  if (pendingPermissions.length === 0 && pendingQuestions.length === 0) {
    return (
      <EmptyState
        emoji="🔔"
        title="暂无共享待办"
        description="共享会话当前没有待处理的权限请求或问题请求。"
      />
    );
  }

  return (
    <div data-testid="shared-mentions-view" style={CONTAINER_STYLE}>
      <div style={SUMMARY_CARD_STYLE}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 700 }}>
          当前协作会话
        </span>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-strong)' }}>
          {selectedTeam.title}
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {formatSharedStatus(selectedTeam.status)} · 审批 {pendingPermissions.length} · 问题{' '}
          {pendingQuestions.length}
        </span>
      </div>

      {pendingPermissions.map((request) => (
        <div key={request.requestId} style={ITEM_STYLE}>
          <div style={{ display: 'grid', gap: 3 }}>
            <strong style={{ color: 'var(--fg-strong)', fontSize: 13 }}>
              权限请求 · {request.previewAction ?? request.toolName}
            </strong>
            <span style={{ color: 'var(--fg-default)', fontSize: 11 }}>
              作用域：{request.scope} · 风险：{request.riskLevel}
            </span>
            <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.6 }}>
              {request.reason}
            </span>
          </div>
          <div style={ACTION_ROW_STYLE}>
            <button
              type="button"
              disabled={!canManageSessionEntries || reviewBusy}
              onClick={() => handlePermissionDecision(request.requestId, true)}
              style={PRIMARY_ACTION_BTN_STYLE}
            >
              允许本会话
            </button>
            <button
              type="button"
              disabled={!canManageSessionEntries || reviewBusy}
              onClick={() => handlePermissionDecision(request.requestId, false)}
              style={ACTION_BTN_STYLE}
            >
              拒绝
            </button>
          </div>
        </div>
      ))}

      {pendingQuestions.map((request) => (
        <div key={request.requestId} style={ITEM_STYLE}>
          <div style={{ display: 'grid', gap: 3 }}>
            <strong style={{ color: 'var(--fg-strong)', fontSize: 13 }}>
              问题请求 · {request.title}
            </strong>
            <span style={{ color: 'var(--fg-default)', fontSize: 11 }}>
              {request.toolName} · {request.questions.length} 个问题
            </span>
            <div style={{ display: 'grid', gap: 4 }}>
              {request.questions.map((question, index) => (
                <span
                  key={`${request.requestId}-${index}`}
                  style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.6 }}
                >
                  {question.header}：{question.question}
                </span>
              ))}
            </div>
          </div>
          <div style={ACTION_ROW_STYLE}>
            <button
              type="button"
              disabled={!canManageSessionEntries || reviewBusy}
              onClick={() => handleQuestionDecision(request.requestId, true)}
              style={PRIMARY_ACTION_BTN_STYLE}
            >
              标记已答复
            </button>
            <button
              type="button"
              disabled={!canManageSessionEntries || reviewBusy}
              onClick={() => handleQuestionDecision(request.requestId, false)}
              style={ACTION_BTN_STYLE}
            >
              忽略
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
