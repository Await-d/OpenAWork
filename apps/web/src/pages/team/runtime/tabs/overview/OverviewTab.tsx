import { useState, useCallback, useMemo } from 'react';
import { AGENT_TEAMS_EVENT_CONFIG } from '../../data/team-runtime-ui-config.js';
import type {
  AgentTeamsSidebarTeam,
  AgentTeamsTimelineEventType,
} from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { PANEL_STYLE, TREND_META } from '../../shared/team-runtime-shared.js';
import { Icon, ChevronDownIcon } from '../../shared/TeamIcons.js';
import type { IconKey } from '../../shared/TeamIcons.js';
import { TabContainer } from '../TabContainer.js';

export function OverviewTab({
  selectedTeam = null,
}: {
  selectedTeam?: AgentTeamsSidebarTeam | null;
}) {
  const { activityStats, overviewCards, timelineEvents } = useTeamRuntimeReferenceViewData();
  const [timelineFilter, setTimelineFilter] = useState<Set<AgentTeamsTimelineEventType>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(new Set());
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());

  const filteredEvents = useMemo(() => {
    let result = timelineEvents;
    if (timelineFilter.size > 0) result = result.filter((e) => timelineFilter.has(e.type));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) => e.detail.toLowerCase().includes(q) || e.type.toLowerCase().includes(q),
      );
    }
    return result;
  }, [searchQuery, timelineEvents, timelineFilter]);

  const totalActivityCount = Math.max(
    1,
    Object.values(activityStats).reduce((a, b) => a + b, 0),
  );

  const toggleFilter = useCallback((type: AgentTeamsTimelineEventType) => {
    setTimelineFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleCardExpand = useCallback((id: string) => {
    setExpandedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleEventExpand = useCallback((id: string) => {
    setExpandedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <TabContainer title="运行概览" subtitle="当前团队会话的关键指标 + 活动时间线，按选中会话联动。">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {selectedTeam ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              padding: '10px 12px',
              borderRadius: 12,
              background:
                'linear-gradient(135deg, color-mix(in oklch, var(--accent) 8%, var(--bg-overlay) 0%, var(--bg-base)',
              border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                当前会话
              </span>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: 'var(--fg-strong)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {selectedTeam.title}
              </span>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                {selectedTeam.subtitle}
              </span>
            </div>
            {(() => {
              const statusColor =
                selectedTeam.status === 'running'
                  ? 'var(--success))'
                  : selectedTeam.status === 'paused'
                    ? 'var(--warning))'
                    : selectedTeam.status === 'failed'
                      ? 'var(--danger))'
                      : 'var(--fg-muted)';
              const statusLabel =
                selectedTeam.status === 'running'
                  ? '运行中'
                  : selectedTeam.status === 'paused'
                    ? '已暂停'
                    : selectedTeam.status === 'failed'
                      ? '失败'
                      : '已完成';
              return (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    borderRadius: 999,
                    background: `color-mix(in srgb, ${statusColor} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${statusColor} 38%, transparent)`,
                    color: statusColor,
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: statusColor,
                    }}
                  />
                  {statusLabel}
                </span>
              );
            })()}
          </div>
        ) : null}

        {/* Overview metric cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          {overviewCards.map((card) => {
            const trend = TREND_META[card.trend ?? 'stable'];
            const isExpanded = expandedCardIds.has(card.id);
            return (
              <div
                key={card.id}
                style={{
                  ...PANEL_STYLE,
                  padding: '10px 12px',
                  borderRadius: 10,
                  display: 'grid',
                  gap: 6,
                  borderLeft: `3px solid var(--accent)`,
                  transition: 'background 0.15s, outline 0.15s, box-shadow 0.15s',
                  outline: isExpanded ? '1px solid var(--accent)' : 'none',
                  outlineOffset: -1,
                  boxShadow: isExpanded ? 'var(--shadow-md)' : 'var(--shadow-sm)',
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
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      color: 'var(--fg-muted)',
                      fontSize: 11,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                        flexShrink: 0,
                      }}
                    >
                      <Icon name={card.icon as IconKey} size={11} color="var(--accent)" />
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--fg-default)' }}>
                      {card.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {trend ? (
                      <span
                        style={{
                          color: trend.color,
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                          fontSize: 10,
                        }}
                      >
                        <Icon name={trend.icon} size={10} color={trend.color} />
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCardExpand(card.id);
                      }}
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
                <span
                  style={{
                    fontSize: 26,
                    lineHeight: 1.1,
                    fontWeight: 800,
                    color: 'var(--fg-strong)',
                  }}
                >
                  {card.value}
                </span>
                <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.4 }}>
                  {card.note}
                </span>
                {isExpanded && (
                  <div
                    style={{
                      padding: '6px 0 0',
                      borderTop: '1px solid var(--border-subtle)',
                      display: 'grid',
                      gap: 3,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--fg-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      详细指标
                    </span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--fg-default)' }}>
                        当前值: <strong style={{ color: 'var(--fg-strong)' }}>{card.value}</strong>
                      </span>
                      {trend && (
                        <span
                          style={{
                            fontSize: 10,
                            color: trend.color,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                          }}
                        >
                          <Icon name={trend.icon} size={9} color={trend.color} /> {card.trend}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Two-column layout: activity distribution + timeline */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 260px) minmax(0, 1fr)',
            gap: 10,
          }}
        >
          {/* Activity distribution */}
          <div
            style={{
              ...PANEL_STYLE,
              padding: '10px 12px',
              borderRadius: 10,
              display: 'grid',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--fg-strong)' }}>
              活动类型分布
            </span>
            {Object.entries(activityStats)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => {
                const config = AGENT_TEAMS_EVENT_CONFIG[type as AgentTeamsTimelineEventType];
                if (!config) return null;
                const pct = Math.round((count / totalActivityCount) * 100);
                const isFiltered = timelineFilter.has(type as AgentTeamsTimelineEventType);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleFilter(type as AgentTeamsTimelineEventType)}
                    style={{
                      display: 'grid',
                      gap: 4,
                      cursor: 'pointer',
                      opacity: isFiltered || timelineFilter.size === 0 ? 1 : 0.5,
                      transition: 'opacity 0.15s',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        <Icon name={config.icon as IconKey} size={10} color={config.color} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-default)' }}>
                          {config.label}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                        {count} 次 ({pct}%)
                      </span>
                    </div>
                    <div
                      style={{
                        height: 5,
                        borderRadius: 999,
                        background: 'var(--border-subtle)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          borderRadius: 999,
                          background: config.color,
                          transition: 'width 0.3s ease',
                          boxShadow: `0 0 6px ${config.color}44`,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            {timelineFilter.size > 0 && (
              <button
                type="button"
                onClick={() => setTimelineFilter(new Set())}
                style={{
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-default)',
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  fontSize: 10,
                  cursor: 'pointer',
                  justifySelf: 'start',
                }}
              >
                清除筛选
              </button>
            )}
          </div>

          {/* Timeline section */}
          <div
            style={{
              ...PANEL_STYLE,
              padding: '10px 12px',
              borderRadius: 10,
              display: 'grid',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--fg-strong)' }}>
                活动时间线
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: 'var(--bg-surface)',
                }}
              >
                {filteredEvents.length} / {timelineEvents.length} 事件
              </span>
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索事件..."
                className="team-input-focusable"
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-overlay)',
                  color: 'var(--fg-strong)',
                  fontSize: 11,
                  outline: 'none',
                }}
              />
            </div>

            {/* Type filters */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Object.entries(AGENT_TEAMS_EVENT_CONFIG).map(([type, config]) => {
                const isActive = timelineFilter.has(type as AgentTeamsTimelineEventType);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleFilter(type as AgentTeamsTimelineEventType)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '2px 7px',
                      borderRadius: 999,
                      border: 'none',
                      background: isActive ? `${config.color}25` : `${config.color}10`,
                      color: config.color,
                      fontSize: 9,
                      fontWeight: 600,
                      cursor: 'pointer',
                      opacity: isActive ? 1 : 0.5,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <Icon name={config.icon as IconKey} size={9} color={config.color} />
                    <span>{config.label}</span>
                  </button>
                );
              })}
              {timelineFilter.size > 0 && (
                <button
                  type="button"
                  onClick={() => setTimelineFilter(new Set())}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--fg-muted)',
                    fontSize: 9,
                    cursor: 'pointer',
                    padding: '2px 5px',
                  }}
                >
                  清除
                </button>
              )}
            </div>

            {/* Event list */}
            <div
              style={{ display: 'grid', gap: 4, maxHeight: 420, overflow: 'auto', paddingRight: 4 }}
            >
              {filteredEvents.map((event) => {
                const config = AGENT_TEAMS_EVENT_CONFIG[event.type];
                const time = new Date(event.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const isExpanded = expandedEventIds.has(event.id);
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => toggleEventExpand(event.id)}
                    style={{
                      display: 'flex',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: isExpanded
                        ? 'color-mix(in oklch, var(--accent) 4%, var(--bg-overlay))'
                        : 'var(--bg-overlay)',
                      alignItems: 'flex-start',
                      cursor: 'pointer',
                      borderLeft: `3px solid ${isExpanded ? config.color : 'transparent'}`,
                      boxShadow: isExpanded ? 'var(--shadow-sm)' : 'none',
                      borderTop: 'none',
                      borderRight: 'none',
                      borderBottom: 'none',
                      width: '100%',
                      textAlign: 'left',
                    }}
                    className={isExpanded ? undefined : 'team-hover-surface'}
                  >
                    <div style={{ display: 'grid', gap: 3, flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span
                          style={{
                            fontSize: 9,
                            color: 'var(--fg-muted)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {time}
                        </span>
                        <span
                          style={{
                            padding: '1px 5px',
                            borderRadius: 999,
                            background: `${config.color}15`,
                            color: config.color,
                            fontSize: 9,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                          }}
                        >
                          <Icon name={config.icon as IconKey} size={9} color={config.color} />{' '}
                          {config.label}
                        </span>
                        <span
                          style={{
                            padding: '1px 5px',
                            borderRadius: 999,
                            background: `${event.agentAccent}12`,
                            color: event.agentAccent,
                            fontSize: 9,
                            fontWeight: 600,
                          }}
                        >
                          {event.agentName}
                        </span>
                        <span style={{ flex: 1 }} />
                        <ChevronDownIcon
                          size={9}
                          color="var(--fg-muted)"
                          style={{
                            transition: 'transform 0.15s',
                            transform: isExpanded ? 'rotate(180deg)' : 'none',
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--fg-default)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: isExpanded ? 'normal' : 'nowrap',
                          lineHeight: 1.4,
                        }}
                      >
                        {event.detail}
                      </span>
                      {isExpanded && (
                        <div
                          style={{
                            padding: '4px 0 0',
                            display: 'grid',
                            gap: 2,
                            borderTop: '1px solid var(--border-subtle)',
                            marginTop: 2,
                          }}
                        >
                          <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
                            时间: {new Date(event.timestamp).toLocaleString()}
                          </span>
                          <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
                            主体: {event.agentName}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </TabContainer>
  );
}
