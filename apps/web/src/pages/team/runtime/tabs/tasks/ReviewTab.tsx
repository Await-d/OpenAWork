import { useState, useCallback, useEffect, useMemo } from 'react';
import type { AgentTeamsReviewCard, AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { ChromeBadge } from '../../shell/team-runtime-shell-primitives.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { resolveMatchedSharedSessionDetail } from '../../data/team-runtime-shared-context.js';
import { getSharedSessionStateLabel } from '../../data/team-runtime-model.js';
import {
  PANEL_STYLE,
  REVIEW_STATUS_META,
  REVIEW_TYPE_META,
  PRIORITY_META,
} from '../../shared/team-runtime-shared.js';
import { Icon, ChevronDownIcon } from '../../shared/TeamIcons.js';
import { EmptyState } from '../../shared/content-kit/index.js';
import { TabContainer } from '../TabContainer.js';
import { useConverge } from '../../hooks/use-converge.js';
import { tryFormatJson } from '../../../../../utils/format-json.js';

export function ReviewTab({
  selectedTeam = null,
}: {
  selectedTeam?: AgentTeamsSidebarTeam | null;
}) {
  const {
    activeSharedSession,
    canManageSessionEntries,
    replyReview,
    reviewBusy,
    reviewCards,
    selectedSharedSession,
    sharedSessionLoading,
    submitReviewComment,
  } = useTeamRuntimeReferenceViewData();
  const isSharedSelected = selectedTeam?.isSharedSession === true;
  const sharedSession = isSharedSelected
    ? resolveMatchedSharedSessionDetail({
        selectedTeamId: selectedTeam.id,
        activeSharedSession,
        selectedSharedSession,
      })
    : (activeSharedSession ?? (selectedTeam ? null : selectedSharedSession));
  const sharedReviewLoading =
    (isSharedSelected || !selectedTeam) && sharedSessionLoading && !sharedSession;
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

  const converge = useConverge();

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
      if (!canManageSessionEntries) return;
      if (!commentInput.trim()) return;
      void submitReviewComment(cardId, commentInput.trim()).then((succeeded) => {
        if (!succeeded) {
          return;
        }
        setCommentInput('');
        setCommentingId(null);
      });
    },
    [canManageSessionEntries, commentInput, submitReviewComment],
  );

  const reviewSessionKey = sharedSession?.share.sessionId ?? selectedTeam?.id ?? null;
  const commentContents = useMemo(
    () => sharedSession?.comments.map((comment) => comment.content) ?? [],
    [sharedSession],
  );
  const reviewHeaderContext = useMemo(() => {
    if (sharedSession) {
      return {
        statusLabel: getSharedSessionStateLabel(sharedSession.share.stateStatus),
        subtitle: sharedSession.share.sharedByEmail,
        title: sharedSession.share.title ?? `共享会话 ${sharedSession.share.sessionId}`,
      };
    }
    if (!selectedTeam) {
      return null;
    }
    return {
      statusLabel:
        selectedTeam.status === 'running'
          ? '运行中'
          : selectedTeam.status === 'paused'
            ? '已暂停'
            : selectedTeam.status === 'failed'
              ? '失败'
              : '已完成',
      subtitle: selectedTeam.subtitle,
      title: selectedTeam.title,
    };
  }, [sharedSession, selectedTeam]);

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
  }, [reviewSessionKey]);

  const pendingCount = Object.values(reviewStatuses).filter((s) => s === 'pending').length;
  const approvedCount = Object.values(reviewStatuses).filter((s) => s === 'approved').length;
  const rejectedCount = Object.values(reviewStatuses).filter((s) => s === 'rejected').length;

  if (sharedReviewLoading) {
    return (
      <EmptyState
        emoji="🧾"
        title="正在同步共享评审队列"
        description="共享会话详情加载完成后，这里会展示真实待办和评论上下文。"
      />
    );
  }

  if (isSharedSelected && !sharedSession) {
    return (
      <EmptyState
        emoji="🧾"
        title="共享评审详情暂不可用"
        description="当前只拿到了共享会话选择状态，评审待办和评论上下文还未同步。"
      />
    );
  }

  return (
    <TabContainer
      title="评审队列"
      subtitle="查看待审、已通过、已驳回的评审卡片，支持评论、通过、驳回操作。"
      scroll={false}
    >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--fg-strong)' }}>评审队列</span>
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
        {!canManageSessionEntries ? (
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
            当前工作区不可写，无法评论或处理评审项。
          </span>
        ) : null}
      </div>

      {reviewHeaderContext ? (
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
            background: 'var(--bg-overlay)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'grid', gap: 3 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 700 }}>
              当前评审会话
            </span>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-strong)' }}>
              {reviewHeaderContext.title}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <ChromeBadge>{reviewHeaderContext.statusLabel}</ChromeBadge>
            <ChromeBadge>{reviewHeaderContext.subtitle}</ChromeBadge>
          </div>
        </div>
      ) : null}

      {/* Two-column layout: review cards + summary sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 12, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Review cards */}
        <div style={{ display: 'grid', gap: 6, minHeight: 0, overflowY: 'auto', alignContent: 'start' }}>
          {reviewCards.map((card) => {
            const currentStatus = reviewStatuses[card.id] ?? card.status;
            const statusMeta = REVIEW_STATUS_META[currentStatus];
            const typeMeta = REVIEW_TYPE_META[card.type];
            const p = PRIORITY_META[card.priority];
            const isPending = currentStatus === 'pending';
            const isExpanded = expandedIds.has(card.id);
            const cardComments = commentContents.filter((content) =>
              content.startsWith(`[${card.id}] `),
            );
            const canReply = Boolean(card.actionable && card.requestId && card.sessionId);
            return (
              <div
                key={card.id}
                className="team-card-tinted"
                style={{
                  ...PANEL_STYLE,
                  padding: '12px 14px',
                  borderRadius: 10,
                  display: 'grid',
                  gap: 8,
                  borderLeft: `3px solid ${typeMeta.color}`,
                  ['--tint' as string]: typeMeta.color,
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
                        color: 'var(--fg-strong)',
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
                      <ChevronDownIcon size={10} color="var(--fg-muted)" />
                    </button>
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--fg-default)', lineHeight: 1.55 }}>
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
                          color: 'var(--fg-default)',
                          borderLeft: '2px solid var(--accent)',
                        }}
                      >
                        {c.replace(`[${card.id}] `, '')}
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
                      disabled={!canManageSessionEntries}
                      className="team-input-focusable"
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border-default)',
                        background: 'var(--bg-overlay)',
                        color: 'var(--fg-strong)',
                        fontSize: 11,
                        outline: 'none',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleAddComment(card.id)}
                      disabled={!canManageSessionEntries || reviewBusy || !commentInput.trim()}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: 'none',
                        background: 'var(--accent)',
                        color: 'var(--bg-base)',
                        cursor:
                          canManageSessionEntries && !reviewBusy && commentInput.trim()
                            ? 'pointer'
                            : 'not-allowed',
                        opacity:
                          canManageSessionEntries && !reviewBusy && commentInput.trim() ? 1 : 0.5,
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
                        onClick={() => {
                          if (!canManageSessionEntries) return;
                          setCommentingId(commentingId === card.id ? null : card.id);
                        }}
                        disabled={!canManageSessionEntries || reviewBusy || !card.sessionId}
                        className="team-btn-outline"
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-default)',
                          background: 'transparent',
                          color: 'var(--fg-muted)',
                          fontSize: 10,
                          fontWeight: 600,
                          cursor:
                            canManageSessionEntries && !reviewBusy && card.sessionId
                              ? 'pointer'
                              : 'not-allowed',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          opacity:
                            canManageSessionEntries && !reviewBusy && card.sessionId ? 1 : 0.5,
                        }}
                      >
                        <Icon name="comment" size={9} color="var(--fg-muted)" /> 评论
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!canManageSessionEntries) return;
                          void replyReview(card.id, 'approved').then((succeeded) => {
                            if (succeeded) updateStatus(card.id, 'approved');
                          });
                        }}
                        disabled={!canManageSessionEntries || reviewBusy || !canReply}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: 'none',
                          background: 'var(--success)',
                          color: 'var(--fg-on-accent)',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor:
                            canManageSessionEntries && !reviewBusy && canReply
                              ? 'pointer'
                              : 'not-allowed',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          opacity: canManageSessionEntries && !reviewBusy && canReply ? 1 : 0.5,
                          transition: 'opacity 0.15s',
                        }}
                      >
                        <Icon name="check" size={9} color="var(--fg-on-accent)" /> 通过
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!canManageSessionEntries) return;
                          void replyReview(card.id, 'rejected').then((succeeded) => {
                            if (succeeded) updateStatus(card.id, 'rejected');
                          });
                        }}
                        disabled={!canManageSessionEntries || reviewBusy || !canReply}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: 'none',
                          background: 'var(--danger)',
                          color: 'var(--fg-on-accent)',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor:
                            canManageSessionEntries && !reviewBusy && canReply
                              ? 'pointer'
                              : 'not-allowed',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          opacity: canManageSessionEntries && !reviewBusy && canReply ? 1 : 0.5,
                          transition: 'opacity 0.15s',
                        }}
                      >
                        <Icon name="x" size={9} color="var(--fg-on-accent)" /> 驳回
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary sidebar */}
        <div style={{ display: 'grid', gap: 8, alignContent: 'start', minHeight: 0, overflowY: 'auto' }}>
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
                color: 'var(--fg-muted)',
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
                <span style={{ fontSize: 11, color: 'var(--fg-default)', flex: 1 }}>待审</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--fg-strong)' }}>
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
                <span style={{ fontSize: 11, color: 'var(--fg-default)', flex: 1 }}>已通过</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--fg-strong)' }}>
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
                <span style={{ fontSize: 11, color: 'var(--fg-default)', flex: 1 }}>已驳回</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--fg-strong)' }}>
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

      {/* Converge — 一致性评估面板 */}
      {reviewSessionKey && (
        <div
          style={{
            ...PANEL_STYLE,
            padding: '12px 14px',
            borderRadius: 10,
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              一致性评估
            </span>
            <button
              type="button"
              onClick={() => {
                if (reviewSessionKey) void converge.runConverge(reviewSessionKey);
              }}
              disabled={converge.loading}
              className="team-btn-outline"
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--border-default)',
                background: 'transparent',
                color: 'var(--accent)',
                fontSize: 10,
                fontWeight: 700,
                cursor: converge.loading ? 'not-allowed' : 'pointer',
                opacity: converge.loading ? 0.5 : 1,
              }}
            >
              {converge.loading ? '评估中…' : '执行评估'}
            </button>
          </div>

          {converge.error && (
            <div
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: 'color-mix(in oklch, var(--danger) 8%, transparent)',
                borderLeft: '2px solid var(--danger)',
                fontSize: 11,
                color: 'var(--fg-default)',
              }}
            >
              {converge.error}
            </div>
          )}

          {converge.result && (
            <div style={{ display: 'grid', gap: 6 }}>
              {converge.result.hasCriticalDeviations && (
                <div
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'color-mix(in oklch, var(--danger) 12%, transparent)',
                    borderLeft: '2px solid var(--danger)',
                    fontSize: 11,
                    color: 'var(--danger)',
                    fontWeight: 700,
                  }}
                >
                  发现 Critical 偏差，请立即处理
                </div>
              )}
              {converge.result.deviations.length === 0 ? (
                <div
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'color-mix(in oklch, var(--success) 8%, transparent)',
                    borderLeft: '2px solid var(--success)',
                    fontSize: 11,
                    color: 'var(--success)',
                  }}
                >
                  代码库与 spec/plan/tasks 一致，无偏差
                </div>
              ) : (
                converge.result.deviations.map((d, i) => {
                  const descFormatted = tryFormatJson(d.description);
                  const actionFormatted = tryFormatJson(d.suggestedAction);
                  const isDescJson = looksLikeJson(d.description);
                  return (
                  <div
                    key={i}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      background:
                        d.severity === 'warning'
                          ? 'color-mix(in oklch, var(--warning) 8%, transparent)'
                          : d.severity === 'critical'
                            ? 'color-mix(in oklch, var(--danger) 8%, transparent)'
                            : 'color-mix(in oklch, var(--accent) 6%, transparent)',
                      borderLeft: `2px solid ${
                        d.severity === 'warning'
                          ? 'var(--warning)'
                          : d.severity === 'critical'
                            ? 'var(--danger)'
                            : 'var(--accent)'
                      }`,
                      fontSize: 11,
                      color: 'var(--fg-default)',
                      display: 'grid',
                      gap: 2,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>
                      {d.severity === 'warning' ? '⚡' : d.severity === 'critical' ? '⠠' : 'ℹ'}{' '}
                      {d.type}
                    </span>
                    <span
                      style={isDescJson ? {
                        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                        fontSize: 10.5,
                        whiteSpace: 'pre',
                        overflowX: 'auto',
                        lineHeight: 1.5,
                      } : undefined}
                    >{descFormatted}</span>
                    <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>
                      建议: {actionFormatted}
                    </span>
                  </div>
                  );
                })
              )}
              {converge.result.report && (
                <details style={{ marginTop: 4 }}>
                  <summary
                    style={{
                      cursor: 'pointer',
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      fontWeight: 600,
                    }}
                  >
                    查看完整报告
                  </summary>
                  <pre
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-default)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'var(--bg-overlay)',
                      border: '1px solid var(--border-subtle)',
                      margin: '4px 0 0',
                      maxHeight: 200,
                      overflowY: 'auto',
                    }}
                  >
                    {tryFormatJson(converge.result.report)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
    </TabContainer>
  );
}
