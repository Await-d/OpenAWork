import { useCallback, useEffect, useState } from 'react';
import type { AgentTeamsSidebarTeam, AgentTeamsTaskCard } from '../../data/team-runtime-types.js';
import { ChromeBadge } from '../../shell/team-runtime-shell-primitives.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { PANEL_STYLE, PRIORITY_META } from '../../shared/team-runtime-shared.js';
import { CheckIcon, ChevronRightIcon, PlusIcon } from '../../shared/TeamIcons.js';

function TaskCard({
  card,
  expanded,
  onAdvance,
  canAdvance,
  canMoveLeft,
  canMoveRight,
  advanceTitle,
  onMove,
  onToggleExpand,
}: {
  card: AgentTeamsTaskCard;
  expanded: boolean;
  onAdvance: (id: string) => void;
  canAdvance: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  advanceTitle: string;
  onMove: (id: string, direction: 'left' | 'right') => void;
  onToggleExpand: () => void;
}) {
  const priorityMeta = PRIORITY_META[card.priority];
  const movable = card.mutable !== false;
  const leftEnabled = movable && canMoveLeft;
  const rightEnabled = movable && canMoveRight;
  const advanceEnabled = movable && canAdvance;

  return (
    <div
      className="team-card-soft"
      style={{
        display: 'grid',
        gap: 5,
        padding: '8px 10px',
        borderRadius: 8,
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${priorityMeta.color}`,
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}
      >
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0, flex: 1 }}>
          <button
            type="button"
            onClick={onToggleExpand}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              transition: 'transform 0.15s',
              transform: expanded ? 'rotate(90deg)' : 'none',
            }}
          >
            <ChevronRightIcon size={9} color="var(--fg-muted)" />
          </button>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--fg-strong)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {card.title}
          </span>
        </div>
        <span
          style={{
            padding: '1px 5px',
            borderRadius: 999,
            background: priorityMeta.bg,
            color: priorityMeta.color,
            fontSize: 9,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {priorityMeta.label}
        </span>
      </div>

      {expanded && card.description ? (
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.4 }}>
          {card.description}
        </span>
      ) : null}

      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '1px 5px',
            borderRadius: 999,
            background: `${card.assigneeAccent}15`,
            color: card.assigneeAccent,
            fontSize: 9,
            fontWeight: 600,
          }}
        >
          {card.assignee}
        </span>
        {card.tags.map((tag) => (
          <span
            key={`${card.id}-${tag}`}
            style={{
              padding: '1px 5px',
              borderRadius: 4,
              background: 'var(--border-subtle)',
              color: 'var(--fg-muted)',
              fontSize: 9,
            }}
          >
            {tag}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => onMove(card.id, 'left')}
          aria-label={`任务 ${card.title} 向左移动`}
          title={leftEnabled ? '向左移动' : '当前卡片无法再向左移动'}
          disabled={!leftEnabled}
          style={{
            background: 'none',
            border: 'none',
            cursor: leftEnabled ? 'pointer' : 'not-allowed',
            padding: '1px 3px',
            color: 'var(--fg-muted)',
            fontSize: 9,
            display: 'inline-flex',
            alignItems: 'center',
            opacity: leftEnabled ? 0.6 : 0.3,
          }}
        >
          ◀
        </button>
        <button
          type="button"
          onClick={() => onMove(card.id, 'right')}
          aria-label={`任务 ${card.title} 向右移动`}
          title={rightEnabled ? '向右移动' : '当前卡片无法再向右移动'}
          disabled={!rightEnabled}
          style={{
            background: 'none',
            border: 'none',
            cursor: rightEnabled ? 'pointer' : 'not-allowed',
            padding: '1px 3px',
            color: 'var(--fg-muted)',
            fontSize: 9,
            display: 'inline-flex',
            alignItems: 'center',
            opacity: rightEnabled ? 0.6 : 0.3,
          }}
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => onAdvance(card.id)}
          aria-label={`任务 ${card.title} ${advanceTitle}`}
          title={advanceTitle}
          disabled={!advanceEnabled}
          style={{
            background: 'none',
            border: 'none',
            cursor: advanceEnabled ? 'pointer' : 'not-allowed',
            padding: '1px 3px',
            display: 'inline-flex',
            alignItems: 'center',
            opacity: advanceEnabled ? 0.6 : 0.3,
          }}
        >
          <CheckIcon size={10} color={advanceEnabled ? 'var(--success)' : 'var(--fg-muted)'} />
        </button>
      </div>
    </div>
  );
}

export function TasksTab({ selectedTeam = null }: { selectedTeam?: AgentTeamsSidebarTeam | null }) {
  const { busy, canManageSessionEntries, createTask, moveTask, taskLanes } =
    useTeamRuntimeReferenceViewData();
  const [addingLane, setAddingLane] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    setAddingLane(null);
    setExpandedTaskIds(new Set());
    setNewTitle('');
  }, [selectedTeam?.id]);

  const toggleExpandTask = useCallback((id: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleAddTask = useCallback(
    (laneId: string) => {
      if (!canManageSessionEntries) {
        return;
      }
      if (!newTitle.trim()) {
        return;
      }

      const status =
        laneId === 'doing' ? 'in_progress' : laneId === 'review' ? 'completed' : 'pending';
      void createTask({ priority: 'medium', status, title: newTitle.trim() }).then((succeeded) => {
        if (!succeeded) {
          return;
        }
        setNewTitle('');
        setAddingLane(null);
      });
    },
    [canManageSessionEntries, createTask, newTitle],
  );

  const handleMoveTask = useCallback(
    (taskId: string, direction: 'left' | 'right') => {
      if (!canManageSessionEntries) {
        return;
      }
      void moveTask(taskId, direction);
    },
    [canManageSessionEntries, moveTask],
  );

  const handleAdvanceTask = useCallback(
    (taskId: string) => {
      if (!canManageSessionEntries) {
        return;
      }
      void moveTask(taskId, 'right');
    },
    [canManageSessionEntries, moveTask],
  );

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--fg-strong)' }}>任务看板</span>
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
          {taskLanes.reduce((sum, l) => sum + l.cards.length, 0)}
        </span>
        {!canManageSessionEntries ? (
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
            当前工作区不可写，无法新增或推进任务。
          </span>
        ) : null}
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
              当前任务会话
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

      {/* Kanban lanes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        {taskLanes.map((lane) => {
          const laneColor =
            lane.id === 'todo'
              ? 'var(--fg-muted)'
              : lane.id === 'doing'
                ? 'var(--accent)'
                : 'var(--warning)';
          const visibleCards = lane.cards;

          return (
            <section
              key={lane.id}
              style={{
                ...PANEL_STYLE,
                padding: 0,
                borderRadius: 10,
                display: 'grid',
                gap: 0,
                alignContent: 'start',
                overflow: 'hidden',
              }}
            >
              {/* Lane header with gradient */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  alignItems: 'center',
                  padding: '10px 12px',
                  background: `linear-gradient(135deg, color-mix(in oklch, ${laneColor} 8%, var(--bg-overlay)), var(--bg-overlay))`,
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: laneColor,
                      flexShrink: 0,
                      boxShadow: `0 0 6px ${laneColor}60`,
                    }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-strong)' }}>
                    {lane.title}
                  </span>
                </div>
                <span
                  style={{
                    minWidth: 20,
                    height: 20,
                    borderRadius: 6,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--bg-surface)',
                    color: 'var(--fg-default)',
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {visibleCards.length}
                </span>
              </div>

              {/* Lane cards */}
              <div style={{ display: 'grid', gap: 5, padding: '8px 10px' }}>
                {visibleCards.map((card) =>
                  (() => {
                    const canMoveLeft = lane.id !== 'todo';
                    const canMoveRight = lane.id !== 'review';
                    const advanceTitle =
                      lane.id === 'todo'
                        ? '开始处理'
                        : lane.id === 'doing'
                          ? '标记完成'
                          : '当前卡片已在最终列';
                    return (
                      <TaskCard
                        key={card.id}
                        card={card}
                        expanded={expandedTaskIds.has(card.id)}
                        onAdvance={handleAdvanceTask}
                        canAdvance={canManageSessionEntries && lane.id !== 'review'}
                        canMoveLeft={canManageSessionEntries && canMoveLeft}
                        canMoveRight={canManageSessionEntries && canMoveRight}
                        advanceTitle={advanceTitle}
                        onMove={handleMoveTask}
                        onToggleExpand={() => toggleExpandTask(card.id)}
                      />
                    );
                  })(),
                )}
              </div>

              {/* Add task */}
              <div style={{ padding: '0 10px 10px' }}>
                {addingLane === lane.id ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <input
                      value={newTitle}
                      onChange={(event) => setNewTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          handleAddTask(lane.id);
                        }
                        if (event.key === 'Escape') {
                          setAddingLane(null);
                          setNewTitle('');
                        }
                      }}
                      placeholder="输入任务标题..."
                      autoFocus
                      disabled={!canManageSessionEntries}
                      style={{
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--accent)',
                        background: 'var(--bg-overlay)',
                        color: 'var(--fg-strong)',
                        fontSize: 12,
                        outline: 'none',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleAddTask(lane.id)}
                        disabled={busy || !newTitle.trim()}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 6,
                          border: 'none',
                          background: 'var(--accent)',
                          color: 'var(--bg-base)',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: busy || !newTitle.trim() ? 'not-allowed' : 'pointer',
                          opacity: busy || !newTitle.trim() ? 0.5 : 1,
                          transition: 'opacity 0.15s',
                        }}
                      >
                        {busy ? '提交中…' : '确认'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingLane(null);
                          setNewTitle('');
                        }}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--border-default)',
                          background: 'transparent',
                          color: 'var(--fg-muted)',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!canManageSessionEntries) {
                        return;
                      }
                      setAddingLane(lane.id);
                    }}
                    disabled={!canManageSessionEntries}
                    style={{
                      width: '100%',
                      minHeight: 28,
                      borderRadius: 8,
                      border:
                        '1px dashed color-mix(in oklch, var(--border-default) 50%, transparent)',
                      color: 'var(--fg-muted)',
                      background: 'transparent',
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: canManageSessionEntries ? 'pointer' : 'not-allowed',
                      opacity: canManageSessionEntries ? 1 : 0.5,
                    }}
                    className="team-dashed-add-accent"
                  >
                    <PlusIcon size={12} color="var(--fg-muted)" /> 添加任务
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
