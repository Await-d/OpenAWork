import { useCallback, useEffect, useState } from 'react';
import type { AgentTeamsSidebarTeam, AgentTeamsTaskCard } from '../../data/team-runtime-types.js';
import { ChromeBadge } from '../../shell/team-runtime-shell-primitives.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { PANEL_STYLE, PRIORITY_META } from '../../shared/team-runtime-shared.js';
import { ChevronRightIcon, PlusIcon, TrashIcon } from '../../shared/TeamIcons.js';

function TaskCard({
  card,
  expanded,
  onDelete,
  onMove,
  onToggleExpand,
}: {
  card: AgentTeamsTaskCard;
  expanded: boolean;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'left' | 'right') => void;
  onToggleExpand: () => void;
}) {
  const priorityMeta = PRIORITY_META[card.priority];
  const movable = card.mutable !== false;

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
          title={movable ? '向左移动' : '当前卡片仅支持查看'}
          disabled={!movable}
          style={{
            background: 'none',
            border: 'none',
            cursor: movable ? 'pointer' : 'not-allowed',
            padding: '1px 3px',
            color: 'var(--fg-muted)',
            fontSize: 9,
            display: 'inline-flex',
            alignItems: 'center',
            opacity: movable ? 0.6 : 0.3,
          }}
        >
          ◀
        </button>
        <button
          type="button"
          onClick={() => onMove(card.id, 'right')}
          title={movable ? '向右移动' : '当前卡片仅支持查看'}
          disabled={!movable}
          style={{
            background: 'none',
            border: 'none',
            cursor: movable ? 'pointer' : 'not-allowed',
            padding: '1px 3px',
            color: 'var(--fg-muted)',
            fontSize: 9,
            display: 'inline-flex',
            alignItems: 'center',
            opacity: movable ? 0.6 : 0.3,
          }}
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => onDelete(card.id)}
          title="推进到下一状态"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '1px 3px',
            display: 'inline-flex',
            alignItems: 'center',
            opacity: 0.5,
          }}
        >
          <TrashIcon size={10} color="var(--danger)" />
        </button>
      </div>
    </div>
  );
}

export function TasksTab({ selectedTeam = null }: { selectedTeam?: AgentTeamsSidebarTeam | null }) {
  const { busy, createTask, moveTask, taskLanes } = useTeamRuntimeReferenceViewData();
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
    [createTask, newTitle],
  );

  const handleMoveTask = useCallback(
    (taskId: string, direction: 'left' | 'right') => {
      void moveTask(taskId, direction);
    },
    [moveTask],
  );

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      void moveTask(taskId, 'right');
    },
    [moveTask],
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
                {visibleCards.map((card) => (
                  <TaskCard
                    key={card.id}
                    card={card}
                    expanded={expandedTaskIds.has(card.id)}
                    onDelete={handleDeleteTask}
                    onMove={handleMoveTask}
                    onToggleExpand={() => toggleExpandTask(card.id)}
                  />
                ))}
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
                    onClick={() => setAddingLane(lane.id)}
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
                      cursor: 'pointer',
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
