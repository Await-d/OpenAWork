import { useState, useCallback, useEffect, useMemo } from 'react';
import type {
  AgentTeamsMessageCard,
  AgentTeamsSidebarTeam,
} from '../../data/team-runtime-types.js';
import { ChromeBadge } from '../../shell/team-runtime-shell-primitives.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { PANEL_STYLE, MSG_TYPE_META } from '../../shared/team-runtime-shared.js';
import { Icon, DirectIcon, SendIcon, XIcon } from '../../shared/TeamIcons.js';
import MarkdownMessageContent from '../../../../../components/chat/markdown/markdown-message-content.js';

export function MessagesTab({
  selectedTeam = null,
}: {
  selectedTeam?: AgentTeamsSidebarTeam | null;
}) {
  const { busy, messageCards, sendMessage } = useTeamRuntimeReferenceViewData();
  const [typeFilter, setTypeFilter] = useState<Set<AgentTeamsMessageCard['type']>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState('');
  const [replies, setReplies] = useState<Record<string, string[]>>({});
  const [broadcastInput, setBroadcastInput] = useState('');
  const [broadcasts, setBroadcasts] = useState<string[]>([]);

  useEffect(() => {
    setTypeFilter(new Set());
    setReplyingTo(null);
    setReplyInput('');
    setReplies({});
    setBroadcastInput('');
    setBroadcasts([]);
  }, [selectedTeam?.id]);

  const toggleTypeFilter = useCallback((type: AgentTeamsMessageCard['type']) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const filteredCards = useMemo(() => {
    let result = messageCards;
    if (typeFilter.size > 0) result = result.filter((c) => typeFilter.has(c.type));
    return result;
  }, [messageCards, typeFilter]);

  const handleReply = useCallback(
    (cardId: string) => {
      if (!replyInput.trim()) return;
      void sendMessage({ content: replyInput.trim(), type: 'result' }).then((succeeded) => {
        if (!succeeded) return;
        setReplies((prev) => ({ ...prev, [cardId]: [...(prev[cardId] ?? []), replyInput.trim()] }));
        setReplyInput('');
        setReplyingTo(null);
      });
    },
    [replyInput, sendMessage],
  );

  const handleBroadcast = useCallback(() => {
    if (!broadcastInput.trim()) return;
    void sendMessage({ content: broadcastInput.trim(), type: 'update' }).then((succeeded) => {
      if (!succeeded) return;
      setBroadcasts((prev) => [...prev, broadcastInput.trim()]);
      setBroadcastInput('');
    });
  }, [broadcastInput, sendMessage]);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--fg-strong)' }}>消息总线</span>
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
          P2P
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{filteredCards.length} 条</span>
        <span style={{ flex: 1 }} />
        {/* Type filters */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
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
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 7px',
                  borderRadius: 999,
                  border: 'none',
                  background: isActive ? `${meta.color}25` : `${meta.color}10`,
                  color: meta.color,
                  fontSize: 9,
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: isActive ? 1 : 0.5,
                  transition: 'opacity 0.15s, background 0.15s',
                }}
              >
                <Icon name={meta.icon} size={9} color={meta.color} />
                <span>{meta.label}</span>
              </button>
            );
          })}
          {typeFilter.size > 0 && (
            <button
              type="button"
              onClick={() => setTypeFilter(new Set())}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--fg-muted)',
                fontSize: 9,
                cursor: 'pointer',
                padding: '2px 5px',
              }}
            >
              清除筛选
            </button>
          )}
        </div>
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
            background: 'var(--bg-overlay)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'grid', gap: 3 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 700 }}>
              当前消息会话
            </span>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg-strong)' }}>
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

      {/* Two-column layout: messages + broadcast panel */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 280px)',
          gap: 16,
        }}
      >
        {/* Message list */}
        <div style={{ display: 'grid', gap: 6 }}>
          {filteredCards.map((card) => {
            const meta = MSG_TYPE_META[card.type];
            const cardReplies = replies[card.id] ?? [];
            return (
              <div
                key={card.id}
                className="team-card-tinted"
                style={{
                  ...PANEL_STYLE,
                  padding: '10px 12px',
                  borderRadius: 10,
                  display: 'grid',
                  gap: 6,
                  borderLeft: `3px solid ${meta.color}`,
                  ['--tint' as string]: meta.color,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        background: `${card.fromAccent}15`,
                        color: card.fromAccent,
                        fontSize: 9,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {card.from.slice(0, 1)}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: `${card.fromAccent}12`,
                        color: card.fromAccent,
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      {card.from}
                    </span>
                    <DirectIcon size={9} color="var(--fg-muted)" />
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: `${card.toAccent}12`,
                        color: card.toAccent,
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      {card.to}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                    <span
                      style={{
                        padding: '1px 5px',
                        borderRadius: 999,
                        background:
                          card.route === 'broadcast'
                            ? 'color-mix(in oklch, var(--accent) 15%, transparent)'
                            : 'color-mix(in oklch, var(--fg-muted) 10%, transparent)',
                        color: card.route === 'broadcast' ? 'var(--accent)' : 'var(--fg-muted)',
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    >
                      {card.route === 'broadcast' ? '广播' : '单播'}
                    </span>
                    <span
                      style={{
                        padding: '1px 5px',
                        borderRadius: 999,
                        background: `${meta.color}15`,
                        color: meta.color,
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    >
                      {meta.label}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        color: 'var(--fg-muted)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {card.timestamp}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--fg-default)',
                    lineHeight: 1.55,
                  }}
                >
                  <MarkdownMessageContent content={card.summary} />
                </div>

                {cardReplies.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gap: 4,
                      padding: '4px 0 0',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    {cardReplies.map((r, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          background: 'color-mix(in oklch, var(--success) 8%, transparent)',
                          fontSize: 11,
                          color: 'var(--fg-default)',
                          borderLeft: '2px solid var(--success)',
                        }}
                      >
                        <MarkdownMessageContent content={r} />
                      </div>
                    ))}
                  </div>
                )}

                {replyingTo === card.id ? (
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
                      value={replyInput}
                      onChange={(e) => setReplyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleReply(card.id);
                        if (e.key === 'Escape') {
                          setReplyingTo(null);
                          setReplyInput('');
                        }
                      }}
                      placeholder="回复..."
                      autoFocus
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
                      onClick={() => handleReply(card.id)}
                      disabled={busy || !replyInput.trim()}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: 'none',
                        background: 'var(--accent)',
                        color: 'var(--bg-base)',
                        cursor: replyInput.trim() && !busy ? 'pointer' : 'not-allowed',
                        opacity: replyInput.trim() && !busy ? 1 : 0.5,
                        fontSize: 10,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <SendIcon size={9} color="var(--bg-base)" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingTo(null);
                        setReplyInput('');
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 1,
                        display: 'inline-flex',
                      }}
                    >
                      <XIcon size={10} color="var(--fg-muted)" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReplyingTo(card.id)}
                    className="team-btn-outline"
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      padding: '2px 8px',
                      color: 'var(--fg-muted)',
                      fontSize: 10,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      justifySelf: 'start',
                    }}
                  >
                    <SendIcon size={9} color="var(--fg-muted)" /> 回复
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Broadcast panel */}
        <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
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
              广播消息
            </span>
            <input
              value={broadcastInput}
              onChange={(e) => setBroadcastInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleBroadcast();
              }}
              placeholder="发送广播消息..."
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
              onClick={handleBroadcast}
              disabled={busy || !broadcastInput.trim()}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent)',
                color: 'var(--bg-base)',
                cursor: broadcastInput.trim() && !busy ? 'pointer' : 'not-allowed',
                opacity: broadcastInput.trim() && !busy ? 1 : 0.5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                fontWeight: 700,
                transition: 'opacity 0.15s',
              }}
            >
              <SendIcon size={10} color="var(--bg-base)" /> {busy ? '发送中…' : '广播'}
            </button>
          </div>

          {/* Sent broadcasts */}
          {broadcasts.length > 0 && (
            <div
              style={{
                ...PANEL_STYLE,
                padding: '10px 12px',
                borderRadius: 10,
                display: 'grid',
                gap: 6,
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
                已发送广播
              </span>
              {broadcasts.map((msg, i) => (
                <div
                  key={`bc-${i}`}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    display: 'grid',
                    gap: 3,
                    borderLeft: '3px solid var(--accent)',
                    background: 'color-mix(in oklch, var(--accent) 4%, var(--bg-overlay))',
                  }}
                >
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span
                      style={{
                        padding: '1px 5px',
                        borderRadius: 999,
                        background: 'color-mix(in oklch, var(--accent) 15%, transparent)',
                        color: 'var(--accent)',
                        fontSize: 8,
                        fontWeight: 700,
                      }}
                    >
                      广播
                    </span>
                    <span style={{ fontSize: 8, color: 'var(--fg-muted)' }}>刚刚</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.5 }}>
                    <MarkdownMessageContent content={msg} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
