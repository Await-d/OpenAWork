import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { AgentTeamsSidebarTeam, AgentTeamsTaskCard } from '../../data/team-runtime-types.js';
import { resolveSidebarTeamSubtitle } from '../../data/team-runtime-status.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { PANEL_STYLE, PRIORITY_META } from '../../shared/team-runtime-shared.js';
import {
  CheckIcon,
  ChevronRightIcon,
  CollapseLeftIcon,
  ExpandRightIcon,
  PlusIcon,
} from '../../shared/TeamIcons.js';
import { TabContainer } from '../TabContainer.js';
import {
  TeamTasksEmptyBoardState,
  TeamTasksNoSessionState,
  TeamTasksWorkbenchHeader,
  type TaskBoardFilterMode,
} from './TeamTasksWorkbenchHeader.js';

/* ──────────────────────────────────────────────────────────────
 * Constants & Style Tokens
 * ────────────────────────────────────────────────────────────── */

const LANE_META: Record<
  'todo' | 'doing' | 'review',
  { color: string; label: string; dotLabel: string }
> = {
  todo: { color: 'var(--fg-muted)', label: '待办', dotLabel: '待办' },
  doing: { color: 'var(--accent)', label: '进行中', dotLabel: '进行' },
  review: { color: 'var(--warning)', label: '待评审', dotLabel: '评审' },
};

const ACTION_BTN_STYLE: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 4px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
  transition: 'background 120ms ease, opacity 120ms ease',
};

/* ──────────────────────────────────────────────────────────────
 * TaskCard
 * ────────────────────────────────────────────────────────────── */

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
        gap: 6,
        padding: '10px 12px',
        borderRadius: 8,
        background: 'white',
        border: `1px solid color-mix(in oklch, ${priorityMeta.color} 40%, var(--border-default) 60%)`,
        boxShadow: `0 1px 3px color-mix(in oklch, ${priorityMeta.color} 10%, transparent)`,
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
      }}
    >
      {/* Title row */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}
      >
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', minWidth: 0, flex: 1 }}>
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={expanded ? '收起任务详情' : '展开任务详情'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              transition: 'transform 0.15s',
              transform: expanded ? 'rotate(90deg)' : 'none',
              flexShrink: 0,
            }}
          >
            <ChevronRightIcon size={10} color="var(--fg-muted)" />
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
            padding: '1px 6px',
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

      {/* Expanded description */}
      {expanded && card.description ? (
        <span
          style={{
            fontSize: 11,
            color: 'var(--fg-muted)',
            lineHeight: 1.5,
            padding: '4px 6px',
            background: 'color-mix(in oklch, var(--bg-base) 50%, transparent)',
            borderRadius: 6,
          }}
        >
          {card.description}
        </span>
      ) : null}

      {/* Footer: assignee + tags + actions */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '1px 6px',
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
            ...ACTION_BTN_STYLE,
            cursor: leftEnabled ? 'pointer' : 'not-allowed',
            color: 'var(--fg-muted)',
            fontSize: 10,
            opacity: leftEnabled ? 0.7 : 0.25,
          }}
        >
          <CollapseLeftIcon size={11} color="currentColor" />
        </button>
        <button
          type="button"
          onClick={() => onMove(card.id, 'right')}
          aria-label={`任务 ${card.title} 向右移动`}
          title={rightEnabled ? '向右移动' : '当前卡片无法再向右移动'}
          disabled={!rightEnabled}
          style={{
            ...ACTION_BTN_STYLE,
            cursor: rightEnabled ? 'pointer' : 'not-allowed',
            color: 'var(--fg-muted)',
            fontSize: 10,
            opacity: rightEnabled ? 0.7 : 0.25,
          }}
        >
          <ExpandRightIcon size={11} color="currentColor" />
        </button>
        <button
          type="button"
          onClick={() => onAdvance(card.id)}
          aria-label={`任务 ${card.title} ${advanceTitle}`}
          title={advanceTitle}
          disabled={!advanceEnabled}
          style={{
            ...ACTION_BTN_STYLE,
            cursor: advanceEnabled ? 'pointer' : 'not-allowed',
            opacity: advanceEnabled ? 0.8 : 0.25,
          }}
        >
          <CheckIcon size={11} color={advanceEnabled ? 'var(--success)' : 'var(--fg-muted)'} />
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 * Lane (Kanban column)
 * ────────────────────────────────────────────────────────────── */

function LaneColumn({
  lane,
  cards,
  expandedTaskIds,
  canManageSessionEntries,
  onToggleExpand,
  onMove,
  onAdvance,
  addingLane,
  setAddingLane,
  newTitle,
  setNewTitle,
  onAddTask,
  busy,
}: {
  lane: { id: 'todo' | 'doing' | 'review'; title: string };
  cards: AgentTeamsTaskCard[];
  expandedTaskIds: Set<string>;
  canManageSessionEntries: boolean;
  onToggleExpand: (id: string) => void;
  onMove: (id: string, dir: 'left' | 'right') => void;
  onAdvance: (id: string) => void;
  addingLane: string | null;
  setAddingLane: (id: string | null) => void;
  newTitle: string;
  setNewTitle: (v: string) => void;
  onAddTask: (laneId: string) => void;
  busy: boolean;
}) {
  const meta = LANE_META[lane.id];
  const canMoveLeft = lane.id !== 'todo';
  const canMoveRight = lane.id !== 'review';
  const advanceTitle =
    lane.id === 'todo' ? '开始处理' : lane.id === 'doing' ? '标记完成' : '当前卡片已在最终列';

  return (
    <section
      style={{
        ...PANEL_STYLE,
        padding: 0,
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {/* Lane header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          alignItems: 'center',
          padding: '10px 12px',
          background: `linear-gradient(135deg, color-mix(in oklch, ${meta.color} 10%, var(--bg-overlay)), var(--bg-overlay))`,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: meta.color,
              flexShrink: 0,
              boxShadow: `0 0 6px ${meta.color}60`,
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
          {cards.length}
        </span>
      </div>

      {/* Cards */}
      <div
        style={{
          display: 'grid',
          gap: 6,
          padding: '8px 10px',
          minHeight: 60,
          flex: 1,
          overflowY: 'auto',
        }}
      >
        {cards.length === 0 ? (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              minHeight: 48,
              fontSize: 11,
              color: 'var(--fg-subtle)',
              border: '1px dashed color-mix(in oklch, var(--border-default) 40%, transparent)',
              borderRadius: 8,
            }}
          >
            暂无任务
          </div>
        ) : (
          cards.map((card) => (
            <TaskCard
              key={card.id}
              card={card}
              expanded={expandedTaskIds.has(card.id)}
              onAdvance={onAdvance}
              canAdvance={canManageSessionEntries && lane.id !== 'review'}
              canMoveLeft={canManageSessionEntries && canMoveLeft}
              canMoveRight={canManageSessionEntries && canMoveRight}
              advanceTitle={advanceTitle}
              onMove={onMove}
              onToggleExpand={() => onToggleExpand(card.id)}
            />
          ))
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
                  onAddTask(lane.id);
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
                onClick={() => onAddTask(lane.id)}
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
              border: '1px dashed color-mix(in oklch, var(--border-default) 50%, transparent)',
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
}

/* ──────────────────────────────────────────────────────────────
 * TasksTab (main)
 * ────────────────────────────────────────────────────────────── */

export function TasksTab({ selectedTeam = null }: { selectedTeam?: AgentTeamsSidebarTeam | null }) {
  const statusSubtitle = selectedTeam
    ? resolveSidebarTeamSubtitle(selectedTeam.status, selectedTeam.subtitle)
    : null;
  const { busy, canManageSessionEntries, createTask, moveTask, taskLanes } =
    useTeamRuntimeReferenceViewData();
  const [addingLane, setAddingLane] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [newTitle, setNewTitle] = useState('');
  const [filter, setFilter] = useState<TaskBoardFilterMode>('all');

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

  /* ── 统计 ── */
  const stats = useMemo(() => {
    const todo = taskLanes.find((l) => l.id === 'todo')?.cards.length ?? 0;
    const doing = taskLanes.find((l) => l.id === 'doing')?.cards.length ?? 0;
    const review = taskLanes.find((l) => l.id === 'review')?.cards.length ?? 0;
    const total = todo + doing + review;
    const done = review; // review 列 = completed + failed
    const active = todo + doing;
    const progress = total === 0 ? 0 : done / total;
    return { todo, doing, review, total, done, active, progress };
  }, [taskLanes]);

  /* ── 按筛选过滤卡片 ── */
  const filteredLanes = useMemo(() => {
    if (filter === 'all') {
      return taskLanes;
    }
    return taskLanes.map((lane) => ({
      ...lane,
      cards:
        filter === 'active'
          ? lane.cards.filter((c) => lane.id !== 'review')
          : lane.cards.filter((c) => lane.id === 'review'),
    }));
  }, [filter, taskLanes]);

  if (!selectedTeam) {
    return <TeamTasksNoSessionState />;
  }

  return (
    <TabContainer
      title="任务看板"
      subtitle="待办 / 进行中 / 待评审三列看板，实时同步运行时任务状态。"
      scroll={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
        <TeamTasksWorkbenchHeader
          selectedTeam={selectedTeam}
          statusSubtitle={statusSubtitle}
          canManageSessionEntries={canManageSessionEntries}
          stats={stats}
          filter={filter}
          onFilterChange={setFilter}
        />

        {/* ── 看板列 ── */}
        {stats.total === 0 ? (
          <TeamTasksEmptyBoardState
            canManageSessionEntries={canManageSessionEntries}
            onAddTask={() => setAddingLane('todo')}
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 10,
              flex: 1,
              minHeight: 0,
            }}
          >
            {filteredLanes.map((lane) => (
              <LaneColumn
                key={lane.id}
                lane={lane}
                cards={lane.cards}
                expandedTaskIds={expandedTaskIds}
                canManageSessionEntries={canManageSessionEntries}
                onToggleExpand={toggleExpandTask}
                onMove={handleMoveTask}
                onAdvance={handleAdvanceTask}
                addingLane={addingLane}
                setAddingLane={setAddingLane}
                newTitle={newTitle}
                setNewTitle={setNewTitle}
                onAddTask={handleAddTask}
                busy={busy}
              />
            ))}
          </div>
        )}
      </div>
    </TabContainer>
  );
}
