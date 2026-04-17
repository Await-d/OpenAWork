import { useState, useCallback, useEffect } from 'react';
import type { AgentTeamsReviewCard, AgentTeamsSidebarTeam } from './team-runtime-types.js';
import { ChromeBadge } from './team-runtime-shell-primitives.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import {
  PANEL_STYLE,
  REVIEW_STATUS_META,
  REVIEW_TYPE_META,
  PRIORITY_META,
} from './team-runtime-shared.js';
import { Icon, ChevronDownIcon, UndoIcon } from './TeamIcons.js';

export function ReviewTab({
  selectedTeam = null,
}: {
  selectedTeam?: AgentTeamsSidebarTeam | null;
}) {
  const { replyReview, reviewBusy, reviewCards, submitReviewComment } =
    useTeamRuntimeReferenceViewData();
  const [reviewStatuses, setReviewStatuses] = useState<
    Record<string, AgentTeamsReviewCard['status']>
  >(() => {
    const map: Record<string, AgentTeamsReviewCard['status']> = {};
    for (const card of reviewCards) map[card.id] = card.status;
    return map;
  });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [commentingId, setCommentingId] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [comments, setComments] = useState<Record<string, string[]>>({});

  const updateStatus = useCallback((id: string, status: AgentTeamsReviewCard['status']) => {
    setReviewStatuses((prev) => ({ ...prev, [id]: status }));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAddComment = useCallback(
    (cardId: string) => {
      if (!commentInput.trim()) return;
      void submitReviewComment(cardId, commentInput.trim()).then((succeeded) => {
        if (!succeeded) {
          return;
        }
        setComments((prev) => ({
          ...prev,
          [cardId]: [...(prev[cardId] ?? []), commentInput.trim()],
        }));
        setCommentInput('');
        setCommentingId(null);
      });
    },
    [commentInput, submitReviewComment],
  );

  useEffect(() => {
    const nextStatuses: Record<string, AgentTeamsReviewCard['status']> = {};
    for (const card of reviewCards) {
      nextStatuses[card.id] = card.status;
    }
    setReviewStatuses(nextStatuses);
  }, [reviewCards]);

  useEffect(() => {
    setExpandedIds(new Set());
    setCommentingId(null);
    setCommentInput('');
    setComments({});
  }, [selectedTeam?.id]);

  const pendingCount = Object.values(reviewStatuses).filter((s) => s === 'pending').length;
  const approvedCount = Object.values(reviewStatuses).filter((s) => s === 'approved').length;
  const rejectedCount = Object.values(reviewStatuses).filter((s) => s === 'rejected').length;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>评审队列</span>
        <span
          style={{
            padding: '1px 8px',
            borderRadius: 999,
            background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
            color: 'var(--accent)',
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          {reviewCards.length}
        </span>
      </div>

      {selectedTeam ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: 'var(--card-bg)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'grid', gap: 3 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700 }}>
              当前评审会话
            </span>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
              {selectedTeam.title}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <ChromeBadge>
              {selectedTeam.status === 'running'
                ? '运行中'
                : selectedTeam.status === 'paused'
                  ? '已暂停'
                  : selectedTeam.status === 'failed'
                    ? '失败'
                    : '已完成'}
            </ChromeBadge>
            <ChromeBadge>{selectedTeam.subtitle}</ChromeBadge>
          </div>
        </div>
      ) : null}

      {/* Two-column layout: review cards + summary sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 12 }}>
        {/* Review cards */}
        <div style={{ display: 'grid', gap: 6 }}>
          {reviewCards.map((card) => {
            const currentStatus = reviewStatuses[card.id] ?? card.status;
            const statusMeta = REVIEW_STATUS_META[currentStatus];
            const typeMeta = REVIEW_TYPE_META[card.type];
            const p = PRIORITY_META[card.priority];
            const isPending = currentStatus === 'pending';
            const isExpanded = expandedIds.has(card.id);
            const cardComments = comments[card.id] ?? [];
            const canReply = Boolean(card.actionable && card.requestId && card.sessionId);
            return (
              <div
                key={card.id}
                style={{
                  ...PANEL_STYLE,
                  padding: '12px 14px',
                  borderRadius: 10,
                  display: 'grid',
                  gap: 8,
                  borderLeft: `3px solid ${typeMeta.color}`,
                  transition: 'background 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `color-mix(in oklch, ${typeMeta.color} 3%, var(--card-bg))`;
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--card-bg)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        background: `${typeMeta.color}15`,
                        flexShrink: 0,
                      }}
                    >
                      <Icon name={typeMeta.icon} size={11} color={typeMeta.color} />
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {card.title}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: p.bg,
                        color: p.color,
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    >
                      {p.label}
                    </span>
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: statusMeta.bg,
                        color: statusMeta.color,
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    >
                      {statusMeta.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleExpand(card.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        transition: 'transform 0.15s',
                        transform: isExpanded ? 'rotate(180deg)' : 'none',
                      }}
                    >
                      <ChevronDownIcon size={10} color="var(--text-3)" />
                    </button>
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>
                  {card.summary}
                </span>

                {isExpanded && cardComments.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gap: 4,
                      padding: '4px 0 0',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    {cardComments.map((c, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                          fontSize: 11,
                          color: 'var(--text-2)',
                          borderLeft: '2px solid var(--accent)',
                        }}
                      >
                        {c}
                      </div>
                    ))}
                  </div>
                )}

                {commentingId === card.id ? (
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      paddingTop: 4,
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <input
                      value={commentInput}
                      onChange={(e) => setCommentInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddComment(card.id);
                        if (e.key === 'Escape') {
                          setCommentingId(null);
                          setCommentInput('');
                        }
                      }}
                      placeholder="添加评论..."
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        fontSize: 11,
                        outline: 'none',
                        transition: 'border-color 0.15s',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleAddComment(card.id)}
                      disabled={reviewBusy || !commentInput.trim()}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: 'none',
                        background: 'var(--accent)',
                        color: 'var(--bg)',
                        cursor: reviewBusy || !commentInput.trim() ? 'not-allowed' : 'pointer',
                        opacity: reviewBusy || !commentInput.trim() ? 0.5 : 1,
                        fontSize: 10,
                        fontWeight: 700,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      {reviewBusy ? '提交中…' : '提交'}
                    </button>
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: `${card.assigneeAccent}12`,
                      color: card.assigneeAccent,
                      fontSize: 9,
                      fontWeight: 600,
                    }}
                  >
                    {card.assignee}
                  </span>
                  {isPending && (
                    <>
                      <span style={{ flex: 1 }} />
                      <button
                        type="button"
                        onClick={() => setCommentingId(commentingId === card.id ? null : card.id)}
                        disabled={reviewBusy || !card.sessionId}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'transparent',
                          color: 'var(--text-3)',
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: reviewBusy || !card.sessionId ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          transition: 'all 0.15s',
                          opacity: reviewBusy || !card.sessionId ? 0.5 : 1,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border)';
                          e.currentTarget.style.color = 'var(--text-2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border-subtle)';
                          e.currentTarget.style.color = 'var(--text-3)';
                        }}
                      >
                        <Icon name="comment" size={9} color="var(--text-3)" /> 评论
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void replyReview(card.id, 'approved').then((succeeded) => {
                            if (succeeded) updateStatus(card.id, 'approved');
                          });
                        }}
                        disabled={reviewBusy || !canReply}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: 'none',
                          background: 'var(--success)',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: reviewBusy || !canReply ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          opacity: reviewBusy || !canReply ? 0.5 : 1,
                          transition: 'opacity 0.15s',
                        }}
                      >
                        <Icon name="check" size={9} color="#fff" /> 通过
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void replyReview(card.id, 'rejected').then((succeeded) => {
                            if (succeeded) updateStatus(card.id, 'rejected');
                          });
                        }}
                        disabled={reviewBusy || !canReply}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: 'none',
                          background: 'var(--danger)',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: reviewBusy || !canReply ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          opacity: reviewBusy || !canReply ? 0.5 : 1,
                          transition: 'opacity 0.15s',
                        }}
                      >
                        <Icon name="x" size={9} color="#fff" /> 驳回
                      </button>
                    </>
                  )}
                  {!isPending && (
                    <>
                      <span style={{ flex: 1 }} />
                      <button
                        type="button"
                        onClick={() => updateStatus(card.id, 'pending')}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'transparent',
                          color: 'var(--text-3)',
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          transition: 'border-color 0.15s, color 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border)';
                          e.currentTarget.style.color = 'var(--text-2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border-subtle)';
                          e.currentTarget.style.color = 'var(--text-3)';
                        }}
                      >
                        <UndoIcon size={9} color="var(--text-3)" /> 撤回
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary sidebar */}
        <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
          <div
            style={{
              ...PANEL_STYLE,
              padding: '12px 14px',
              borderRadius: 10,
              display: 'grid',
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              评审统计
            </span>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--warning)',
                    boxShadow: '0 0 6px var(--warning)60',
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-2)', flex: 1 }}>待审</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                  {pendingCount}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--success)',
                    boxShadow: '0 0 6px var(--success)60',
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-2)', flex: 1 }}>已通过</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                  {approvedCount}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--danger)',
                    boxShadow: '0 0 6px var(--danger)60',
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-2)', flex: 1 }}>已驳回</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                  {rejectedCount}
                </span>
              </div>
            </div>
            {/* Progress bar */}
            {reviewCards.length > 0 && (
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: 'var(--border-subtle)',
                  overflow: 'hidden',
                  display: 'flex',
                }}
              >
                <div
                  style={{
                    width: `${(approvedCount / reviewCards.length) * 100}%`,
                    background: 'var(--success)',
                    transition: 'width 0.3s',
                  }}
                />
                <div
                  style={{
                    width: `${(rejectedCount / reviewCards.length) * 100}%`,
                    background: 'var(--danger)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
