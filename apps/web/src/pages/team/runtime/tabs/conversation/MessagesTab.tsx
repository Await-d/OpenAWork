import { useState, useCallback, useEffect, useMemo } from 'react';
import type {
  AgentTeamsMessageCard,
  AgentTeamsSidebarTeam,
} from '../../data/team-runtime-types.js';
import { formatSidebarTeamStatus } from '../../data/team-runtime-status.js';
import { resolveSidebarTeamSubtitle } from '../../data/team-runtime-status.js';
import { resolveMatchedSharedSessionDetail } from '../../data/team-runtime-shared-context.js';
import { ChromeBadge } from '../../shell/team-runtime-shell-primitives.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { PANEL_STYLE, MSG_TYPE_META } from '../../shared/team-runtime-shared.js';
import { Icon, DirectIcon, SendIcon, XIcon } from '../../shared/TeamIcons.js';
import MarkdownMessageContent from '../../../../../components/chat/markdown/markdown-message-content.js';
import { SharedSessionMessagesView } from './shared-session-messages-view.js';
import { tryFormatJson, looksLikeJson } from '../../../../../utils/format-json.js';
import {
  tryParseIncidentJson,
  IncidentReadableCard,
} from '../../../conversation/extras/incident-readable-card.js';

const INITIAL_PAGE_SIZE = 8;
const LOAD_MORE_STEP = 10;

export function MessagesTab({
  selectedTeam = null,
}: {
  selectedTeam?: AgentTeamsSidebarTeam | null;
}) {
  const {
    activeSharedSession,
    busy,
    canManageSessionEntries,
    createSharedSessionComment,
    error,
    feedback,
    messageCards,
    reviewBusy,
    selectedSharedSession,
    sendMessage,
    sharedSessionLoading,
  } = useTeamRuntimeReferenceViewData();
  const [typeFilter, setTypeFilter] = useState<Set<AgentTeamsMessageCard['type']>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState('');
  const [broadcastInput, setBroadcastInput] = useState('');
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE);
  const sharedSession =
    selectedTeam?.isSharedSession === true
      ? resolveMatchedSharedSessionDetail({
          selectedTeamId: selectedTeam.id,
          activeSharedSession,
          selectedSharedSession,
        })
      : null;
  const scopedSessionId = selectedTeam && !selectedTeam.isSharedSession ? selectedTeam.id : null;

  useEffect(() => {
    setTypeFilter(new Set());
    setReplyingTo(null);
    setReplyInput('');
    setBroadcastInput('');
    setVisibleCount(INITIAL_PAGE_SIZE);
  }, [selectedTeam?.id]);

  const toggleTypeFilter = useCallback((type: AgentTeamsMessageCard['type']) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    setVisibleCount(INITIAL_PAGE_SIZE);
  }, []);

  const filteredCards = useMemo(() => {
    let result =
      scopedSessionId === null
        ? messageCards
        : messageCards.filter((card) => card.sessionId === scopedSessionId);
    if (typeFilter.size > 0) result = result.filter((c) => typeFilter.has(c.type));
    return result;
  }, [messageCards, scopedSessionId, typeFilter]);

  const validCards = useMemo(
    () => filteredCards.filter((card) => card.id !== 'empty-message'),
    [filteredCards],
  );

  const visibleCards = useMemo(() => validCards.slice(0, visibleCount), [validCards, visibleCount]);

  const hasMore = validCards.length > visibleCount;

  const visibleMessageCount = validCards.length;

  const recentBroadcastCards = useMemo(
    () => validCards.filter((card) => card.route === 'broadcast').slice(0, 4),
    [validCards],
  );

  const messageCardById = useMemo(
    () => new Map(filteredCards.map((card) => [card.id, card])),
    [filteredCards],
  );

  const handleReply = useCallback(() => {
    if (!canManageSessionEntries) return;
    const trimmed = replyInput.trim();
    if (!trimmed) return;

    const sourceCard = replyingTo ? messageCardById.get(replyingTo) : null;
    const contextualContent = sourceCard
      ? `【跟进 ${sourceCard.from} · ${sourceCard.timestamp}】${trimmed}`
      : trimmed;

    void sendMessage({
      content: contextualContent,
      recipientMemberId: sourceCard?.memberId ?? null,
      replyToMessageId: sourceCard?.id ?? null,
      ...(scopedSessionId ? { sessionId: scopedSessionId } : {}),
      type: 'result',
    }).then((succeeded) => {
      if (!succeeded) return;
      setReplyInput('');
      setReplyingTo(null);
    });
  }, [
    canManageSessionEntries,
    messageCardById,
    replyInput,
    replyingTo,
    scopedSessionId,
    sendMessage,
  ]);

  const handleBroadcast = useCallback(() => {
    if (!canManageSessionEntries) return;
    if (!broadcastInput.trim()) return;
    void sendMessage({
      content: broadcastInput.trim(),
      ...(scopedSessionId ? { sessionId: scopedSessionId } : {}),
      type: 'update',
    }).then((succeeded) => {
      if (!succeeded) return;
      setBroadcastInput('');
    });
  }, [broadcastInput, canManageSessionEntries, scopedSessionId, sendMessage]);

  if (selectedTeam?.isSharedSession) {
    return (
      <SharedSessionMessagesView
        canManageSessionEntries={canManageSessionEntries}
        createSharedSessionComment={createSharedSessionComment}
        reviewBusy={reviewBusy}
        selectedTeam={selectedTeam}
        sharedSession={sharedSession}
        sharedSessionLoading={sharedSessionLoading}
      />
    );
  }

  const statusLabel = selectedTeam ? formatSidebarTeamStatus(selectedTeam.status) : '';
  const statusSubtitle = selectedTeam
    ? resolveSidebarTeamSubtitle(selectedTeam.status, selectedTeam.subtitle)
    : null;

  const showFeedback = feedback && feedback.tone === 'error';
  const showError = !showFeedback && error;
  const showSuccess = feedback && feedback.tone === 'success';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ─── 操作反馈 / 错误提示 ─── */}
      {showFeedback ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid color-mix(in oklch, var(--danger) 40%, transparent)',
            background: 'color-mix(in oklch, var(--danger) 8%, var(--bg-overlay))',
            color: 'var(--danger)',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          <Icon name="error" size={14} color="var(--danger)" />
          <span>{feedback.message}</span>
        </div>
      ) : null}
      {showSuccess ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid color-mix(in oklch, var(--success) 40%, transparent)',
            background: 'color-mix(in oklch, var(--success) 8%, var(--bg-overlay))',
            color: 'var(--success)',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          <Icon name="check" size={14} color="var(--success)" />
          <span>{feedback.message}</span>
        </div>
      ) : null}
      {showError ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid color-mix(in oklch, var(--danger) 40%, transparent)',
            background: 'color-mix(in oklch, var(--danger) 8%, var(--bg-overlay))',
            color: 'var(--danger)',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          <Icon name="error" size={14} color="var(--danger)" />
          <span>{error}</span>
        </div>
      ) : null}
      {/* ─── 顶部标题栏 + 筛选器 ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          padding: '12px 16px',
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'color-mix(in srgb, var(--bg-overlay) 92%, var(--bg-base))',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
              color: 'var(--accent)',
            }}
          >
            <Icon name="messages" size={16} color="var(--accent)" />
          </span>
          <div style={{ display: 'grid', gap: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--fg-strong)' }}>
              消息总线
            </span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              {visibleMessageCount} 条消息
            </span>
          </div>
        </div>
        <span style={{ flex: 1 }} />
        {/* 类型筛选 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {(
            Object.entries(MSG_TYPE_META) as [
              AgentTeamsMessageCard['type'],
              (typeof MSG_TYPE_META)[AgentTeamsMessageCard['type']],
            ][]
          ).map(([type, meta]) => {
            const isActive = typeFilter.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleTypeFilter(type)}
                className="team-btn-focusable"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 999,
                  border: `1px solid ${
                    isActive
                      ? 'color-mix(in oklch, var(--accent) 40%, transparent)'
                      : 'var(--border-subtle)'
                  }`,
                  background: isActive
                    ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
                    : 'transparent',
                  color: isActive ? 'var(--fg-strong)' : meta.color,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              >
                <Icon name={meta.icon} size={12} color={isActive ? 'var(--accent)' : meta.color} />
                <span>{meta.label}</span>
              </button>
            );
          })}
          {typeFilter.size > 0 && (
            <button
              type="button"
              onClick={() => {
                setTypeFilter(new Set());
                setVisibleCount(INITIAL_PAGE_SIZE);
              }}
              className="team-btn-focusable"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--fg-muted)',
                fontSize: 11,
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: 6,
                transition: 'color 150ms ease',
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* ─── 工作区信息卡 ─── */}
      {selectedTeam ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '12px 16px',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-overlay)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'grid', gap: 3 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 700 }}>
              当前工作区
            </span>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-strong)' }}>
              {selectedTeam.title}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <ChromeBadge>{statusLabel}</ChromeBadge>
            {statusSubtitle ? <ChromeBadge>{statusSubtitle}</ChromeBadge> : null}
          </div>
        </div>
      ) : null}

      {/* ─── 两栏布局：消息列表 + 广播面板 ─── */}
      <div className="team-conversation-message-layout">
        {/* ─── 消息列表 ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibleCards.length === 0 ? (
            <div
              className="team-conversation-empty-prompt"
              style={{
                display: 'grid',
                gap: 12,
                justifyItems: 'center',
                textAlign: 'center',
                padding: '40px 20px',
                borderRadius: 16,
                border: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
                background: 'color-mix(in srgb, var(--bg-overlay) 40%, transparent)',
                color: 'var(--fg-muted)',
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                  color: 'var(--accent)',
                }}
              >
                <Icon name="messages" size={24} color="var(--accent)" />
              </span>
              <div style={{ display: 'grid', gap: 4 }}>
                <strong style={{ color: 'var(--fg-default)', fontSize: 14 }}>
                  {typeFilter.size > 0 ? '筛选无结果' : '暂无团队消息'}
                </strong>
                <span style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 320 }}>
                  {typeFilter.size > 0
                    ? '当前筛选条件下没有消息，换个类型或清除筛选试试。'
                    : '团队运行中的广播、提问、结果汇报与跟进消息会出现在这里。可在右侧广播面板主动给团队发条消息。'}
                </span>
              </div>
            </div>
          ) : null}

          {visibleCards.map((card) => {
            const meta = MSG_TYPE_META[card.type];
            const isReplying = replyingTo === card.id;
            return (
              <div
                key={card.id}
                className="team-card-tinted team-message-card-enter"
                style={{
                  ...PANEL_STYLE,
                  padding: '12px 14px',
                  borderRadius: 12,
                  display: 'grid',
                  gap: 8,
                  borderLeft: `3px solid ${meta.color}`,
                  ['--tint' as string]: meta.color,
                }}
              >
                {/* 发送链路行 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* from 头像 */}
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        background: `${card.fromAccent}15`,
                        color: card.fromAccent,
                        fontSize: 11,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {card.from.slice(0, 1)}
                    </span>
                    {/* from 名 */}
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: `${card.fromAccent}12`,
                        color: card.fromAccent,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {card.from}
                    </span>
                    {/* 箭头 */}
                    <DirectIcon size={11} color="var(--fg-muted)" />
                    {/* to 名 */}
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: `${card.toAccent}12`,
                        color: card.toAccent,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {card.to}
                    </span>
                  </div>
                  {/* 右侧标签组 */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 4,
                      alignItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        padding: '2px 7px',
                        borderRadius: 999,
                        background:
                          card.route === 'broadcast'
                            ? 'color-mix(in oklch, var(--accent) 15%, transparent)'
                            : 'color-mix(in oklch, var(--fg-muted) 10%, transparent)',
                        color: card.route === 'broadcast' ? 'var(--accent)' : 'var(--fg-muted)',
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {card.route === 'broadcast' ? '广播' : '跟进'}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: `${meta.color}15`,
                        color: meta.color,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      <Icon name={meta.icon} size={10} color={meta.color} />
                      {meta.label}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--fg-muted)',
                        fontVariantNumeric: 'tabular-nums',
                        marginLeft: 2,
                      }}
                    >
                      {card.timestamp}
                    </span>
                  </div>
                </div>

                {/* 消息正文 */}
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--fg-default)',
                    lineHeight: 1.6,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {(() => {
                    const incident = tryParseIncidentJson(card.summary);
                    if (incident) return <IncidentReadableCard data={incident} />;
                    if (looksLikeJson(card.summary)) {
                      return (
                        <pre
                          style={{
                            margin: 0,
                            padding: '8px 10px',
                            borderRadius: 6,
                            background: 'var(--bg-base)',
                            border: '1px solid var(--border-subtle)',
                            fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                            fontSize: 11.5,
                            lineHeight: 1.6,
                            whiteSpace: 'pre',
                            overflowX: 'auto',
                          }}
                        >
                          {tryFormatJson(card.summary)}
                        </pre>
                      );
                    }
                    return <MarkdownMessageContent content={card.summary} />;
                  })()}
                </div>

                {/* 跟进回复区 */}
                {isReplying ? (
                  <div
                    className="team-reply-expand"
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      paddingTop: 8,
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <input
                      value={replyInput}
                      onChange={(e) => setReplyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleReply();
                        if (e.key === 'Escape') {
                          setReplyingTo(null);
                          setReplyInput('');
                        }
                      }}
                      aria-label={`跟进 ${card.from}`}
                      placeholder="补充一条结果消息（会附带跟进上下文）..."
                      autoFocus
                      disabled={!canManageSessionEntries}
                      className="team-input-focusable"
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border-default)',
                        background: 'var(--bg-base)',
                        color: 'var(--fg-strong)',
                        fontSize: 12,
                        outline: 'none',
                        transition: 'border-color 150ms ease',
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleReply}
                      disabled={!canManageSessionEntries || busy || !replyInput.trim()}
                      aria-label={`发送关于 ${card.from} 的跟进消息`}
                      className="team-btn-focusable"
                      style={{
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'var(--accent)',
                        color: 'var(--fg-on-accent)',
                        cursor:
                          canManageSessionEntries && replyInput.trim() && !busy
                            ? 'pointer'
                            : 'not-allowed',
                        opacity: canManageSessionEntries && replyInput.trim() && !busy ? 1 : 0.5,
                        fontSize: 11,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        transition: 'opacity 150ms ease',
                      }}
                    >
                      <SendIcon size={11} color="var(--fg-on-accent)" />
                      发送
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingTo(null);
                        setReplyInput('');
                      }}
                      aria-label={`取消跟进 ${card.from}`}
                      className="team-btn-focusable"
                      style={{
                        background: 'none',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        cursor: 'pointer',
                        padding: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 32,
                        color: 'var(--fg-muted)',
                        transition: 'color 150ms ease, border-color 150ms ease',
                      }}
                    >
                      <XIcon size={12} color="currentColor" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!canManageSessionEntries) return;
                      setReplyingTo(card.id);
                    }}
                    aria-label={`跟进 ${card.from}`}
                    disabled={!canManageSessionEntries}
                    className="team-btn-outline team-btn-focusable"
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      padding: '4px 10px',
                      color: 'var(--fg-muted)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: canManageSessionEntries ? 'pointer' : 'not-allowed',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      justifySelf: 'start',
                      opacity: canManageSessionEntries ? 1 : 0.5,
                      transition: 'all 150ms ease',
                    }}
                  >
                    <SendIcon size={10} color="var(--fg-muted)" /> 跟进
                  </button>
                )}
              </div>
            );
          })}

          {/* 查看更多 */}
          {hasMore ? (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => prev + LOAD_MORE_STEP)}
              className="team-btn-focusable"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '10px 16px',
                borderRadius: 10,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-muted)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              查看更多（剩余 {validCards.length - visibleCount} 条）
            </button>
          ) : null}
        </div>

        {/* ─── 广播面板侧栏 ─── */}
        <div className="team-conversation-broadcast-rail">
          {/* 广播输入卡 */}
          <div
            style={{
              ...PANEL_STYLE,
              padding: '14px 16px',
              borderRadius: 12,
              display: 'grid',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                  color: 'var(--accent)',
                }}
              >
                <Icon name="broadcast" size={13} color="var(--accent)" />
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--fg-strong)',
                  letterSpacing: '0.02em',
                }}
              >
                广播消息
              </span>
            </div>
            <textarea
              value={broadcastInput}
              onChange={(e) => setBroadcastInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleBroadcast();
                }
              }}
              aria-label="广播内容"
              placeholder="输入广播内容，回车发送…"
              rows={3}
              disabled={!canManageSessionEntries}
              className="team-input-focusable"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-base)',
                color: 'var(--fg-strong)',
                fontSize: 12,
                lineHeight: 1.5,
                outline: 'none',
                resize: 'vertical',
                minHeight: 56,
                fontFamily: 'inherit',
                transition: 'border-color 150ms ease',
              }}
            />
            <button
              type="button"
              onClick={handleBroadcast}
              disabled={!canManageSessionEntries || busy || !broadcastInput.trim()}
              aria-label="发送广播"
              className="team-btn-focusable"
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                cursor:
                  canManageSessionEntries && broadcastInput.trim() && !busy
                    ? 'pointer'
                    : 'not-allowed',
                opacity: canManageSessionEntries && broadcastInput.trim() && !busy ? 1 : 0.5,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                fontSize: 12,
                fontWeight: 700,
                transition: 'opacity 150ms ease',
              }}
            >
              <SendIcon size={12} color="var(--fg-on-accent)" />
              {busy ? '发送中…' : '广播'}
            </button>
            {!canManageSessionEntries ? (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--fg-muted)',
                  lineHeight: 1.5,
                  textAlign: 'center',
                }}
              >
                当前工作区不可写，无法发送广播或跟进消息。
              </span>
            ) : null}
          </div>

          {/* 最近广播 */}
          {recentBroadcastCards.length > 0 ? (
            <div
              style={{
                ...PANEL_STYLE,
                padding: '14px 16px',
                borderRadius: 12,
                display: 'grid',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                    color: 'var(--accent)',
                  }}
                >
                  <Icon name="sync" size={13} color="var(--accent)" />
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--fg-strong)',
                    letterSpacing: '0.02em',
                  }}
                >
                  最近广播
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    fontWeight: 600,
                    marginLeft: 'auto',
                  }}
                >
                  {recentBroadcastCards.length} 条
                </span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {recentBroadcastCards.map((card) => (
                  <div
                    key={card.id}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      display: 'grid',
                      gap: 4,
                      borderLeft: `3px solid var(--accent)`,
                      background: 'color-mix(in oklch, var(--accent) 4%, var(--bg-overlay))',
                    }}
                  >
                    <div
                      style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <span
                        style={{
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: 'color-mix(in oklch, var(--accent) 15%, transparent)',
                          color: 'var(--accent)',
                          fontSize: 9,
                          fontWeight: 700,
                        }}
                      >
                        广播
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--fg-muted)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {card.timestamp}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--fg-subtle)',
                          fontWeight: 600,
                        }}
                      >
                        {card.from}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--fg-default)',
                        lineHeight: 1.55,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {(() => {
                        const incident = tryParseIncidentJson(card.summary);
                        if (incident) return <IncidentReadableCard data={incident} />;
                        if (looksLikeJson(card.summary)) {
                          return (
                            <pre
                              style={{
                                margin: 0,
                                padding: '6px 8px',
                                borderRadius: 6,
                                background: 'var(--bg-base)',
                                border: '1px solid var(--border-subtle)',
                                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                                fontSize: 11,
                                lineHeight: 1.5,
                                whiteSpace: 'pre',
                                overflowX: 'auto',
                              }}
                            >
                              {tryFormatJson(card.summary)}
                            </pre>
                          );
                        }
                        return <MarkdownMessageContent content={card.summary} />;
                      })()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
