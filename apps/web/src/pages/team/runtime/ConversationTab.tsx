import { useState, useCallback, useEffect, useMemo } from 'react';
import type { AgentTeamsSidebarTeam } from './team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { ChromeBadge } from './team-runtime-shell-primitives.js';
import { CONV_TYPE_META } from './team-runtime-shared.js';
import { Icon, ChevronDownIcon, SendIcon } from './TeamIcons.js';

export function ConversationTab({
  selectedAgentId = '',
  selectedTeam = null,
}: {
  selectedAgentId?: string;
  selectedTeam?: AgentTeamsSidebarTeam | null;
}) {
  const { busy, conversationCards, roleChips, sendMessage } = useTeamRuntimeReferenceViewData();
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [expandedConvIds, setExpandedConvIds] = useState<Set<string>>(new Set());
  const [messageInput, setMessageInput] = useState('');
  const [sentMessages, setSentMessages] = useState<Record<string, string[]>>({});
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    setSelectedConvId(null);
    setExpandedConvIds(new Set());
    setMessageInput('');
  }, [selectedTeam?.id]);

  const filteredCards = useMemo(() => {
    let result = conversationCards;
    if (selectedAgentId) result = result.filter((c) => c.agentId === selectedAgentId);
    if (typeFilter !== 'all') result = result.filter((c) => c.type === typeFilter);
    return result;
  }, [conversationCards, selectedAgentId, typeFilter]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedConvIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSend = useCallback(
    (convId: string) => {
      if (!messageInput.trim()) return;
      void sendMessage({ content: messageInput.trim(), type: 'update' }).then((succeeded) => {
        if (!succeeded) return;
        setSentMessages((prev) => ({
          ...prev,
          [convId]: [...(prev[convId] ?? []), messageInput.trim()],
        }));
        setMessageInput('');
      });
    },
    [messageInput, sendMessage],
  );

  const typeOptions = [
    { key: 'all', label: '全部' },
    ...Object.entries(CONV_TYPE_META).map(([key, m]) => ({ key, label: m.label })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      {/* ── Header bar ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>团队对话</span>
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
          {filteredCards.length}
        </span>
        {selectedAgentId && (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
              color: 'var(--accent)',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {selectedAgentId}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {/* Type filter pills */}
        <div style={{ display: 'flex', gap: 3 }}>
          {typeOptions.map((opt) => {
            const isActive = typeFilter === opt.key;
            const meta =
              opt.key !== 'all' ? CONV_TYPE_META[opt.key as keyof typeof CONV_TYPE_META] : null;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTypeFilter(opt.key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 9px',
                  borderRadius: 999,
                  border: `1px solid ${isActive ? (meta?.color ?? 'var(--accent)') : 'var(--border-subtle)'}`,
                  background: isActive
                    ? meta
                      ? `color-mix(in oklch, ${meta.color} 14%, transparent)`
                      : 'color-mix(in oklch, var(--accent) 14%, transparent)'
                    : 'transparent',
                  color: isActive ? (meta?.color ?? 'var(--accent)') : 'var(--text-3)',
                  fontSize: 10,
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {meta && (
                  <Icon name={meta.icon} size={9} color={isActive ? meta.color : 'var(--text-3)'} />
                )}
                {opt.label}
              </button>
            );
          })}
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
            background: 'var(--card-bg)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'grid', gap: 3 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700 }}>
              当前对话会话
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

      {/* ── Main content: conversation list + sidebar ──────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 240px',
          gap: 12,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Conversation cards */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            overflowY: 'auto',
            paddingRight: 2,
          }}
        >
          {filteredCards.length === 0 && (
            <div
              style={{
                padding: '32px 16px',
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-3)',
                borderRadius: 10,
                border: '1px dashed var(--border-subtle)',
              }}
            >
              暂无匹配对话
            </div>
          )}
          {filteredCards.map((card) => {
            const meta = CONV_TYPE_META[card.type];
            const isSelected = selectedConvId === card.id;
            const isExpanded = expandedConvIds.has(card.id);
            const replies = sentMessages[card.id] ?? [];
            const roleChip = roleChips.find((c) => c.id === card.agentId);
            return (
              <div
                key={card.id}
                onClick={() => setSelectedConvId(isSelected ? null : card.id)}
                style={{
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  cursor: 'pointer',
                  border: '1px solid var(--border-subtle)',
                  background: isSelected
                    ? `color-mix(in oklch, ${meta.color} 5%, var(--card-bg))`
                    : 'var(--card-bg)',
                  boxShadow: isSelected ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                  transition: 'background 0.15s, box-shadow 0.15s, border-color 0.15s',
                  overflow: 'hidden',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = `color-mix(in oklch, ${meta.color} 3%, var(--card-bg))`;
                    e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                    e.currentTarget.style.borderColor = `color-mix(in oklch, ${meta.color} 25%, var(--border-subtle))`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'var(--card-bg)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  }
                }}
              >
                {/* Colored top accent bar */}
                <div
                  style={{
                    height: 3,
                    background: `linear-gradient(90deg, ${meta.color}, color-mix(in oklch, ${meta.color} 40%, transparent))`,
                  }}
                />

                {/* Card body */}
                <div
                  style={{
                    padding: '10px 14px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {/* Top row: role avatar + title + meta */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    {/* Role avatar */}
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        display: 'grid',
                        placeItems: 'center',
                        background: `color-mix(in oklch, ${card.roleAccent} 14%, var(--surface))`,
                        color: card.roleAccent,
                        fontSize: 12,
                        fontWeight: 800,
                        flexShrink: 0,
                        border: `1px solid color-mix(in oklch, ${card.roleAccent} 20%, transparent)`,
                      }}
                    >
                      {card.role.charAt(0)}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: 'var(--text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {card.title}
                        </span>
                        <span
                          style={{
                            padding: '1px 7px',
                            borderRadius: 999,
                            background: `color-mix(in oklch, ${meta.color} 14%, transparent)`,
                            color: meta.color,
                            fontSize: 9,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: card.roleAccent,
                          }}
                        >
                          {card.role}
                        </span>
                        <span style={{ color: 'var(--border)', fontSize: 8 }}>·</span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{card.meta}</span>
                      </div>
                    </div>
                  </div>

                  {/* Body text */}
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-2)',
                      lineHeight: 1.6,
                      padding: '0 0 0 42px',
                    }}
                  >
                    {card.body}
                  </div>

                  {/* Bottom row: timestamp + expand */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      padding: '0 0 0 42px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--text-3)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {card.timestamp}
                    </span>
                    {roleChip && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          fontSize: 9,
                          color: 'var(--success)',
                          padding: '0 5px',
                          borderRadius: 999,
                          background: 'color-mix(in oklch, var(--success) 10%, transparent)',
                        }}
                      >
                        <span
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: '50%',
                            background: 'var(--success)',
                          }}
                        />
                        {roleChip.status}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(card.id);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        borderRadius: 4,
                        transition: 'transform 0.15s, background 0.15s',
                        transform: isExpanded ? 'rotate(180deg)' : 'none',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--surface)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'none';
                      }}
                    >
                      <ChevronDownIcon size={12} color="var(--text-3)" />
                    </button>
                  </div>

                  {/* Expanded replies */}
                  {isExpanded && replies.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '8px 0 0',
                        marginLeft: 42,
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      {replies.map((msg, i) => (
                        <div
                          key={i}
                          style={{
                            padding: '8px 12px',
                            borderRadius: '8px 8px 2px 8px',
                            background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                            fontSize: 12,
                            color: 'var(--text-2)',
                            borderLeft: `2px solid var(--accent)`,
                            lineHeight: 1.5,
                          }}
                        >
                          {msg}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Reply input (selected card only) */}
                  {isSelected && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        paddingTop: 8,
                        marginLeft: 42,
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSend(card.id);
                        }}
                        placeholder="回复此对话…"
                        style={{
                          flex: 1,
                          padding: '7px 12px',
                          borderRadius: 7,
                          border: '1px solid var(--border-subtle)',
                          background: 'var(--surface)',
                          color: 'var(--text)',
                          fontSize: 12,
                          outline: 'none',
                          transition: 'border-color 0.15s, box-shadow 0.15s',
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = 'var(--accent)';
                          e.currentTarget.style.boxShadow =
                            '0 0 0 2px color-mix(in oklch, var(--accent) 12%, transparent)';
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border-subtle)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSend(card.id)}
                        disabled={busy || !messageInput.trim()}
                        style={{
                          padding: '7px 14px',
                          borderRadius: 7,
                          border: 'none',
                          background: 'var(--accent)',
                          color: 'var(--accent-text)',
                          cursor: messageInput.trim() && !busy ? 'pointer' : 'not-allowed',
                          opacity: messageInput.trim() && !busy ? 1 : 0.5,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 11,
                          fontWeight: 700,
                          transition: 'opacity 0.15s',
                        }}
                      >
                        <SendIcon size={11} color="var(--accent-text)" />
                        {busy ? '发送中…' : '发送'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Sidebar: role status ──────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignContent: 'start' }}>
          {/* Role status panel */}
          <div
            style={{
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'var(--card-bg)',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '8px 12px 6px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--text-2)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                角色状态
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: 'var(--text-3)',
                  padding: '0 5px',
                  borderRadius: 999,
                  background: 'var(--surface)',
                }}
              >
                {roleChips.length}
              </span>
            </div>
            <div
              style={{ padding: '6px 6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}
            >
              {roleChips.map((chip) => {
                const isActive = selectedAgentId === chip.id;
                return (
                  <div
                    key={chip.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      padding: '6px 8px',
                      borderRadius: 8,
                      background: isActive
                        ? `color-mix(in oklch, ${chip.accent} 8%, transparent)`
                        : 'var(--surface)',
                      border: `1px solid ${isActive ? `color-mix(in oklch, ${chip.accent} 25%, transparent)` : 'transparent'}`,
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'var(--surface-hover)';
                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'var(--surface)';
                        e.currentTarget.style.borderColor = 'transparent';
                      }
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        display: 'grid',
                        placeItems: 'center',
                        background: `linear-gradient(135deg, ${chip.accent}, color-mix(in oklch, ${chip.accent} 70%, #000))`,
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 800,
                        flexShrink: 0,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {chip.badge}
                    </span>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
                        {chip.role}
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--text-3)' }}>{chip.provider}</span>
                    </div>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--success)',
                        flexShrink: 0,
                        boxShadow: '0 0 4px var(--success)',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick stats */}
          <div
            style={{
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'var(--card-bg)',
              boxShadow: 'var(--shadow-sm)',
              padding: '10px 12px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            {[
              {
                label: '广播',
                count: conversationCards.filter((c) => c.type === 'broadcast').length,
                color: 'var(--accent)',
              },
              {
                label: '提问',
                count: conversationCards.filter((c) => c.type === 'question').length,
                color: 'var(--warning)',
              },
              {
                label: '单播',
                count: conversationCards.filter((c) => c.type === 'direct').length,
                color: 'var(--accent)',
              },
              {
                label: '结果',
                count: conversationCards.filter((c) => c.type === 'result').length,
                color: 'var(--success)',
              },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  padding: '6px 8px',
                  borderRadius: 7,
                  background: `color-mix(in oklch, ${stat.color} 6%, transparent)`,
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 800, color: stat.color, lineHeight: 1 }}>
                  {stat.count}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 500 }}>
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
