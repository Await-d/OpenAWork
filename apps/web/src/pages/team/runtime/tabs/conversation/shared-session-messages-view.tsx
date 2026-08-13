import { useCallback, useState, type CSSProperties } from 'react';
import type { SharedSessionDetailRecord } from '@openAwork/web-client';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { formatSidebarTeamStatus } from '../../data/team-runtime-status.js';
import { resolveSidebarTeamSubtitle } from '../../data/team-runtime-status.js';
import MarkdownMessageContent from '../../../../../components/chat/markdown/markdown-message-content.js';
import { PANEL_STYLE } from '../../shared/team-runtime-shared.js';
import { SendIcon } from '../../shared/TeamIcons.js';

const HEADER_PILL_STYLE: CSSProperties = {
  padding: '1px 6px',
  borderRadius: 999,
  background: 'color-mix(in oklch, var(--accent) 15%, transparent)',
  color: 'var(--accent)',
  fontSize: 9,
  fontWeight: 700,
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

const COMMENT_CARD_STYLE: CSSProperties = {
  ...PANEL_STYLE,
  padding: '10px 12px',
  borderRadius: 10,
  display: 'grid',
  gap: 6,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-raised)',
  boxShadow: 'var(--shadow-md)',
};

const EMPTY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  justifyItems: 'center',
  textAlign: 'center',
  padding: '28px 16px',
  borderRadius: 12,
  border: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 40%, transparent)',
  color: 'var(--fg-muted)',
};

function formatSharedStatus(status: AgentTeamsSidebarTeam['status']): string {
  return formatSidebarTeamStatus(status);
}

function formatCommentTime(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return createdAt;
  }
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SharedSessionMessagesView({
  canManageSessionEntries,
  createSharedSessionComment,
  reviewBusy,
  selectedTeam,
  sharedSession,
  sharedSessionLoading,
}: {
  canManageSessionEntries: boolean;
  createSharedSessionComment: (content: string) => Promise<boolean>;
  reviewBusy: boolean;
  selectedTeam: AgentTeamsSidebarTeam;
  sharedSession: SharedSessionDetailRecord | null;
  sharedSessionLoading: boolean;
}) {
  const [commentInput, setCommentInput] = useState('');
  const statusSubtitle = resolveSidebarTeamSubtitle(selectedTeam.status, selectedTeam.subtitle);

  const handleSubmitComment = useCallback(() => {
    if (!canManageSessionEntries) {
      return;
    }
    const trimmed = commentInput.trim();
    if (!trimmed) {
      return;
    }
    void createSharedSessionComment(trimmed).then((succeeded) => {
      if (!succeeded) {
        return;
      }
      setCommentInput('');
    });
  }, [canManageSessionEntries, commentInput, createSharedSessionComment]);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--fg-strong)' }}>共享协作流</span>
        <span style={HEADER_PILL_STYLE}>共享会话</span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          {sharedSession?.comments.length ?? 0} 条评论
        </span>
      </div>

      <div style={SUMMARY_CARD_STYLE}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 700 }}>
          当前消息会话
        </span>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-strong)' }}>
          {selectedTeam.title}
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={HEADER_PILL_STYLE}>{formatSharedStatus(selectedTeam.status)}</span>
          {statusSubtitle ? <span style={HEADER_PILL_STYLE}>{statusSubtitle}</span> : null}
          {sharedSession ? (
            <span style={HEADER_PILL_STYLE}>
              审批 {sharedSession.pendingPermissions.length} · 问题{' '}
              {sharedSession.pendingQuestions.length}
            </span>
          ) : null}
        </div>
      </div>

      <div
        style={{
          ...PANEL_STYLE,
          padding: '10px 12px',
          borderRadius: 10,
          display: 'grid',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          共享评论
        </span>
        <input
          value={commentInput}
          onChange={(event) => setCommentInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleSubmitComment();
            }
          }}
          aria-label="共享评论内容"
          placeholder="发送一条共享评论..."
          disabled={!canManageSessionEntries}
          className="team-input-focusable"
          style={{
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-overlay)',
            color: 'var(--fg-strong)',
            fontSize: 11,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={handleSubmitComment}
          disabled={!canManageSessionEntries || reviewBusy || !commentInput.trim()}
          aria-label="发送共享评论"
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--bg-base)',
            cursor:
              canManageSessionEntries && commentInput.trim() && !reviewBusy
                ? 'pointer'
                : 'not-allowed',
            opacity: canManageSessionEntries && commentInput.trim() && !reviewBusy ? 1 : 0.5,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            fontWeight: 700,
            transition: 'opacity 0.15s',
            justifySelf: 'start',
          }}
        >
          <SendIcon size={10} color="var(--bg-base)" /> {reviewBusy ? '发送中…' : '发送评论'}
        </button>
        {!canManageSessionEntries ? (
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
            当前工作区不可写，无法发送共享评论。
          </span>
        ) : null}
      </div>

      {sharedSessionLoading ? (
        <div style={EMPTY_STYLE}>
          <span aria-hidden style={{ fontSize: 26 }}>
            💬
          </span>
          <strong style={{ color: 'var(--fg-default)', fontSize: 13 }}>正在同步共享评论</strong>
          <span style={{ fontSize: 11, lineHeight: 1.6, maxWidth: 320 }}>
            共享会话详情加载完成后，这里会显示最新的协作评论。
          </span>
        </div>
      ) : sharedSession?.comments.length ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {sharedSession.comments
            .slice()
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .map((comment) => (
              <div key={comment.id} style={COMMENT_CARD_STYLE}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--fg-strong)', fontWeight: 700 }}>
                    {comment.authorEmail}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatCommentTime(comment.createdAt)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-default)', lineHeight: 1.6 }}>
                  <MarkdownMessageContent content={comment.content} />
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div style={EMPTY_STYLE}>
          <span aria-hidden style={{ fontSize: 26 }}>
            💬
          </span>
          <strong style={{ color: 'var(--fg-default)', fontSize: 13 }}>暂无共享评论</strong>
          <span style={{ fontSize: 11, lineHeight: 1.6, maxWidth: 320 }}>
            这条共享会话还没有产生协作评论。发送第一条评论后，这里会展示真实协作流。
          </span>
        </div>
      )}
    </div>
  );
}
