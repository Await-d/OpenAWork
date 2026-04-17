import { useState, useCallback, useMemo } from 'react';
import { AGENT_TEAMS_EVENT_CONFIG } from './team-runtime-ui-config.js';
import type { AgentTeamsSidebarTeam, AgentTeamsTimelineEventType } from './team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { PANEL_STYLE, TREND_META } from './team-runtime-shared.js';
import { Icon, ChevronDownIcon } from './TeamIcons.js';
import type { IconKey } from './TeamIcons.js';

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
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>运行概览</span>
      </div>

      {selectedTeam ? (
        <div
          style={{
            ...PANEL_STYLE,
            padding: '12px 14px',
            borderRadius: 10,
            display: 'grid',
            gap: 10,
            borderLeft: '3px solid var(--accent)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700 }}>
                当前会话摘要
              </span>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
                {selectedTeam.title}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 9px',
                  borderRadius: 999,
                  background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                  color: 'var(--accent)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {selectedTeam.status === 'running'
                  ? '运行中'
                  : selectedTeam.status === 'paused'
                    ? '已暂停'
                    : selectedTeam.status === 'failed'
                      ? '失败'
                      : '已完成'}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 9px',
                  borderRadius: 999,
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                {selectedTeam.subtitle}
              </span>
            </div>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.65 }}>
            当前右侧概览已与左侧会话选择联动。切换会话后，这里的标题与状态摘要会同步变化，方便确认你正在查看的是哪一个团队运行实例。
          </span>
        </div>
      ) : null}

      {/* Overview metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        {overviewCards.map((card) => {
          const trend = TREND_META[card.trend ?? 'stable'];
          const isExpanded = expandedCardIds.has(card.id);
          return (
            <div
              key={card.id}
              style={{
                ...PANEL_STYLE,
                padding: '12px 14px',
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
                    color: 'var(--text-3)',
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
                  <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{card.label}</span>
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
                    <ChevronDownIcon size={10} color="var(--text-3)" />
                  </button>
                </div>
              </div>
              <span
                style={{ fontSize: 26, lineHeight: 1.1, fontWeight: 800, color: 'var(--text)' }}
              >
                {card.value}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>
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
                      color: 'var(--text-3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    详细指标
                  </span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
                      当前值: <strong style={{ color: 'var(--text)' }}>{card.value}</strong>
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
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12 }}>
        {/* Activity distribution */}
        <div
          style={{
            ...PANEL_STYLE,
            padding: '12px 14px',
            borderRadius: 10,
            display: 'grid',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>活动类型分布</span>
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
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>
                        {config.label}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
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
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-3)',
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
            padding: '12px 14px',
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
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>活动时间线</span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-3)',
                padding: '1px 6px',
                borderRadius: 999,
                background: 'var(--surface-2)',
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
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 8,
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
                  color: 'var(--text-3)',
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
                      ? 'color-mix(in oklch, var(--accent) 4%, var(--surface))'
                      : 'var(--surface)',
                    alignItems: 'flex-start',
                    cursor: 'pointer',
                    transition: 'background 0.15s, box-shadow 0.15s',
                    borderLeft: `3px solid ${isExpanded ? config.color : 'transparent'}`,
                    boxShadow: isExpanded ? 'var(--shadow-sm)' : 'none',
                    borderTop: 'none',
                    borderRight: 'none',
                    borderBottom: 'none',
                    width: '100%',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => {
                    if (!isExpanded) {
                      e.currentTarget.style.background = 'var(--surface-hover)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isExpanded) {
                      e.currentTarget.style.background = 'var(--surface)';
                      e.currentTarget.style.boxShadow = 'none';
                    }
                  }}
                >
                  <div style={{ display: 'grid', gap: 3, flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: 9,
                          color: 'var(--text-3)',
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
                        color="var(--text-3)"
                        style={{
                          transition: 'transform 0.15s',
                          transform: isExpanded ? 'rotate(180deg)' : 'none',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--text-2)',
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
                        <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
                          时间: {new Date(event.timestamp).toLocaleString()}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
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
  );
}
