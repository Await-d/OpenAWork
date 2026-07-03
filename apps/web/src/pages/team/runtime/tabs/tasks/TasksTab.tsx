import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { AgentTeamsSidebarTeam, AgentTeamsTaskCard } from '../../data/team-runtime-types.js';
import { formatSidebarTeamStatus } from '../../data/team-runtime-status.js';
import { resolveSidebarTeamSubtitle } from '../../data/team-runtime-status.js';
import { ChromeBadge } from '../../shell/team-runtime-shell-primitives.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { PANEL_STYLE, PRIORITY_META } from '../../shared/team-runtime-shared.js';
import { CheckIcon, ChevronRightIcon, PlusIcon } from '../../shared/TeamIcons.js';
import { EmptyState } from '../../shared/content-kit/EmptyState.js';
import { TabContainer } from '../TabContainer.js';

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

const STAT_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  minWidth: 0,
};

const STAT_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.03em',
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const STAT_VALUE_STYLE: CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  lineHeight: 1.1,
};

const PROGRESS_TRACK_STYLE: CSSProperties = {
  position: 'relative',
  flex: 1,
  height: 6,
  borderRadius: 999,
  background: 'color-mix(in oklch, var(--border-default) 40%, transparent)',
  overflow: 'hidden',
};

const FILTER_BTN_BASE: CSSProperties = {
  padding: '3px 10px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background 120ms ease, color 120ms ease',
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

type FilterMode = 'all' | 'active' | 'done';

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
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${priorityMeta.color}`,
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
          ◀
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
          ▶
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
  const [filter, setFilter] = useState<FilterMode>('all');

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
    return (
      <EmptyState
        emoji="📋"
        title="先选择一个团队会话"
        description="选中左侧会话后，这里会展示该会话下所有任务的看板视图。"
        action={
          <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
            任务看板会实时同步运行时任务状态。
          </span>
        }
      />
    );
  }

  return (
    <TabContainer
      title="任务看板"
      subtitle="待办 / 进行中 / 待评审三列看板，实时同步运行时任务状态。"
      scroll={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
        {/* ── Header ── */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
            {stats.total}
          </span>
          {!canManageSessionEntries ? (
            <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
              当前工作区不可写，无法新增或推进任务。
            </span>
          ) : null}
        </div>

        {/* ── 会话信息条 ── */}
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
            <ChromeBadge>{formatSidebarTeamStatus(selectedTeam.status)}</ChromeBadge>
            {statusSubtitle ? <ChromeBadge>{statusSubtitle}</ChromeBadge> : null}
          </div>
        </div>

        {/* ── 统计概览 ── */}
        {stats.total > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
              gap: 8,
            }}
          >
            <div style={STAT_CARD_STYLE}>
              <span style={STAT_LABEL_STYLE}>总任务</span>
              <span style={{ ...STAT_VALUE_STYLE, color: 'var(--fg-strong)' }}>{stats.total}</span>
            </div>
            <div style={STAT_CARD_STYLE}>
              <span style={STAT_LABEL_STYLE}>进行中</span>
              <span style={{ ...STAT_VALUE_STYLE, color: 'var(--accent)' }}>{stats.doing}</span>
            </div>
            <div style={STAT_CARD_STYLE}>
              <span style={STAT_LABEL_STYLE}>待办</span>
              <span style={{ ...STAT_VALUE_STYLE, color: 'var(--fg-muted)' }}>{stats.todo}</span>
            </div>
            <div style={STAT_CARD_STYLE}>
              <span style={STAT_LABEL_STYLE}>已完成/失败</span>
              <span style={{ ...STAT_VALUE_STYLE, color: 'var(--warning)' }}>{stats.review}</span>
            </div>
          </div>
        ) : null}

        {/* ── 进度条 + 筛选 ── */}
        {stats.total > 0 ? (
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-overlay)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 120 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)' }}>进度</span>
              <div style={PROGRESS_TRACK_STYLE}>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: '100%',
                    borderRadius: 999,
                    width: `${stats.progress * 100}%`,
                    background:
                      stats.progress === 1
                        ? 'var(--success)'
                        : stats.progress > 0.5
                          ? 'var(--accent)'
                          : 'var(--warning)',
                    transition: 'width 300ms ease',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--fg-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.round(stats.progress * 100)}%
              </span>
            </div>

            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setFilter('all')}
                style={{
                  ...FILTER_BTN_BASE,
                  ...(filter === 'all'
                    ? {
                        background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
                        color: 'var(--accent)',
                        fontWeight: 700,
                      }
                    : { color: 'var(--fg-muted)' }),
                }}
                className="team-hover-surface"
              >
                全部 ({stats.total})
              </button>
              <button
                type="button"
                onClick={() => setFilter('active')}
                style={{
                  ...FILTER_BTN_BASE,
                  ...(filter === 'active'
                    ? {
                        background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
                        color: 'var(--accent)',
                        fontWeight: 700,
                      }
                    : { color: 'var(--fg-muted)' }),
                }}
                className="team-hover-surface"
              >
                进行中 ({stats.active})
              </button>
              <button
                type="button"
                onClick={() => setFilter('done')}
                style={{
                  ...FILTER_BTN_BASE,
                  ...(filter === 'done'
                    ? {
                        background: 'color-mix(in oklch, var(--warning) 14%, transparent)',
                        color: 'var(--warning)',
                        fontWeight: 700,
                      }
                    : { color: 'var(--fg-muted)' }),
                }}
                className="team-hover-surface"
              >
                已完成 ({stats.done})
              </button>
            </div>
          </div>
        ) : null}

        {/* ── 看板列 ── */}
        {stats.total === 0 ? (
          <EmptyState
            emoji="🗒️"
            title="暂无任务"
            description={
              canManageSessionEntries
                ? '点击下方按钮添加第一个任务，任务会实时同步到运行时。'
                : '当前会话还没有任务数据。'
            }
            action={
              canManageSessionEntries ? (
                <button
                  type="button"
                  onClick={() => setAddingLane('todo')}
                  style={{
                    padding: '6px 16px',
                    borderRadius: 8,
                    border: '1px solid color-mix(in oklch, var(--accent) 40%, transparent)',
                    background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                    color: 'var(--accent)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <PlusIcon size={12} color="var(--accent)" /> 添加任务
                </button>
              ) : null
            }
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
