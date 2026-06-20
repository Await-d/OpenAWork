/**
 * TaskQuickOverview · 对话区任务清单
 *
 * 在对话界面消息流底部显示完整的任务清单，让用户在对话 tab 就能看到
 * 哪些任务已完成、哪些还在进行中。已完成的任务打勾并灰化，
 * 未完成的任务按状态高亮显示。
 *
 * 数据来源：useHandoffStore（WS 实时同步），按当前选中 session 过滤。
 */

import { useMemo, useState, type CSSProperties } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import {
  computeTeamStatusBarStats,
  filterHandoffsForStatusBar,
} from '../header/team-status-bar-helpers.js';

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  margin: '4px 0 2px',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 35%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, transparent)',
  flexShrink: 0,
};

const HEADER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const HEADER_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const PROGRESS_TRACK_STYLE: CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 60,
  maxWidth: 200,
  height: 4,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--border-default) 40%, transparent)',
  overflow: 'hidden',
};

const PROGRESS_FILL_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  height: '100%',
  borderRadius: 999,
  transition: 'width 300ms ease',
};

const STAT_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '1px 7px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const TASK_LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 280,
  overflowY: 'auto',
};

const TASK_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
  padding: '5px 6px',
  borderRadius: 6,
  fontSize: 11,
  lineHeight: 1.4,
  width: '100%',
  textAlign: 'left',
};

const STATE_ICON_STYLE: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: '50%',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 9,
  fontWeight: 700,
  marginTop: 1,
};

const LAYER_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1px 5px',
  borderRadius: 4,
  fontSize: 9,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  minWidth: 30,
  marginTop: 1,
};

const TASK_INFO_STYLE: CSSProperties = {
  minWidth: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};

const TASK_TITLE_STYLE: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const TASK_META_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 9,
  color: 'var(--fg-subtle)',
  whiteSpace: 'nowrap',
};

const STATE_TAG_STYLE: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  marginTop: 1,
};

const FILTER_BTN_STYLE: CSSProperties = {
  padding: '2px 8px',
  borderRadius: 5,
  border: 'none',
  background: 'transparent',
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background 100ms ease, color 100ms ease',
};

const FILTER_BTN_ACTIVE_STYLE: CSSProperties = {
  ...FILTER_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  color: 'var(--accent)',
  fontWeight: 700,
};

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

const LAYER_COLORS: Record<TeamRoleLayer, string> = {
  user: 'var(--fg-muted)',
  reception: 'var(--accent)',
  pm1: 'var(--chart-5)',
  pm2: 'var(--chart-5)',
  executor: 'var(--success)',
  tester: 'var(--aux)',
  reviewer: 'var(--warning)',
};

const STATE_COLORS: Record<HandoffEntry['state'], string> = {
  pending: 'var(--fg-muted)',
  claimed: 'var(--aux)',
  running: 'var(--accent)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-subtle)',
};

const STATE_LABELS: Record<HandoffEntry['state'], string> = {
  pending: '等待',
  claimed: '已领',
  running: '运行',
  completed: '完成',
  failed: '失败',
  cancelled: '取消',
};

const STATE_RANK: Record<HandoffEntry['state'], number> = {
  running: 0,
  claimed: 1,
  pending: 2,
  failed: 3,
  cancelled: 4,
  completed: 5,
};

/** 根据层级流转生成动作描述 */

function getTaskTitle(task: HandoffEntry): string {
  // 优先用 summary（后端从 payload 中提取的任务描述：rewrittenIntent / goal 等）
  const summary = task.summary?.trim();
  if (summary) return summary;

  // 其次用 failureReason
  const reason = task.failureReason?.trim();
  if (reason) return reason;

  // 回退：层级 + id 短码（截断 id 避免过长）
  const shortId = task.id.length > 8 ? `${task.id.slice(0, 4)}…${task.id.slice(-3)}` : task.id;
  return `${LAYER_LABELS[task.toRoleLayer]} · ${shortId}`;
}

function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

function formatDuration(startedAt: number | undefined, endedAt: number | undefined): string {
  if (!startedAt) return '';
  const end = endedAt ?? Date.now();
  const diff = end - startedAt;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

type FilterMode = 'all' | 'active' | 'done';

export interface TaskQuickOverviewProps {
  /** 当前选中的会话 ID，用于过滤 handoff */
  selectedSessionId?: string | null;
}

export function TaskQuickOverview({ selectedSessionId }: TaskQuickOverviewProps) {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const nodes = useLayerStore((s) => s.nodes);
  const [filter, setFilter] = useState<FilterMode>('active');

  const scopedHandoffs = useMemo(
    () => filterHandoffsForStatusBar(handoffs.values(), nodes.values(), selectedSessionId),
    [handoffs, nodes, selectedSessionId],
  );

  const stats = useMemo(() => computeTeamStatusBarStats(scopedHandoffs), [scopedHandoffs]);

  const allTasks = useMemo(() => {
    return [...scopedHandoffs].sort((a, b) => {
      const rankDelta = STATE_RANK[a.state] - STATE_RANK[b.state];
      if (rankDelta !== 0) return rankDelta;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
  }, [scopedHandoffs]);

  const filteredTasks = useMemo(() => {
    if (filter === 'active') {
      return allTasks.filter((t) => t.state !== 'completed' && t.state !== 'cancelled');
    }
    if (filter === 'done') {
      return allTasks.filter((t) => t.state === 'completed' || t.state === 'cancelled');
    }
    return allTasks;
  }, [allTasks, filter]);

  if (stats.total === 0) return null;

  const remaining = stats.pending + stats.running + stats.failed;
  const doneCount = stats.completed + stats.cancelled;

  return (
    <div style={CONTAINER_STYLE} aria-label="任务清单">
      {/* 头部：进度条 + 统计 */}
      <div style={HEADER_ROW_STYLE}>
        <span style={HEADER_LABEL_STYLE}>任务清单</span>
        <div style={PROGRESS_TRACK_STYLE} aria-label={`进度 ${Math.round(stats.progress * 100)}%`}>
          <div
            style={{
              ...PROGRESS_FILL_STYLE,
              width: `${stats.progress * 100}%`,
              background:
                stats.failed > 0
                  ? 'var(--warning)'
                  : remaining === 0
                    ? 'var(--success)'
                    : 'var(--accent)',
            }}
          />
        </div>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {stats.completed}/{stats.total}
        </span>
        {stats.running > 0 ? (
          <span style={{ ...STAT_PILL_STYLE, color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}>
            ● {stats.running} 运行
          </span>
        ) : null}
        {stats.pending > 0 ? (
          <span style={{ ...STAT_PILL_STYLE, color: 'var(--fg-muted)', background: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)' }}>
            ◌ {stats.pending} 等待
          </span>
        ) : null}
        {stats.failed > 0 ? (
          <span style={{ ...STAT_PILL_STYLE, color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}>
            ✗ {stats.failed}
          </span>
        ) : null}
      </div>

      {/* 筛选条 */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setFilter('active')}
          style={filter === 'active' ? FILTER_BTN_ACTIVE_STYLE : FILTER_BTN_STYLE}
          className="team-hover-surface"
        >
          进行中 ({remaining})
        </button>
        <button
          type="button"
          onClick={() => setFilter('done')}
          style={filter === 'done' ? FILTER_BTN_ACTIVE_STYLE : FILTER_BTN_STYLE}
          className="team-hover-surface"
        >
          已完成 ({doneCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter('all')}
          style={filter === 'all' ? FILTER_BTN_ACTIVE_STYLE : FILTER_BTN_STYLE}
          className="team-hover-surface"
        >
          全部 ({stats.total})
        </button>
      </div>

      {/* 任务列表 */}
      {filteredTasks.length > 0 ? (
        <div style={TASK_LIST_STYLE}>
          {filteredTasks.map((task) => {
            const isDone = task.state === 'completed' || task.state === 'cancelled';
            const layerColor = LAYER_COLORS[task.toRoleLayer];
            const stateColor = STATE_COLORS[task.state];
            const title = getTaskTitle(task);
            const timeLabel = isDone
              ? formatRelativeTime(task.endedAt ?? task.updatedAt)
              : formatDuration(task.startedAt, undefined);
            return (
              <div
                key={task.id}
                style={{
                  ...TASK_ROW_STYLE,
                  opacity: isDone ? 0.55 : 1,
                }}
              >
                {/* 状态图标 */}
                <span
                  style={{
                    ...STATE_ICON_STYLE,
                    background:
                      task.state === 'completed'
                        ? 'color-mix(in srgb, var(--success) 18%, transparent)'
                        : task.state === 'failed'
                          ? 'color-mix(in srgb, var(--danger) 18%, transparent)'
                          : task.state === 'running'
                            ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                            : 'transparent',
                    border:
                      task.state === 'pending' || task.state === 'claimed'
                        ? `1.5px solid ${stateColor}`
                        : 'none',
                    color: stateColor,
                  }}
                >
                  {task.state === 'completed'
                    ? '✓'
                    : task.state === 'failed'
                      ? '✗'
                      : task.state === 'running'
                        ? '●'
                        : ''}
                </span>

                {/* 层级标签 */}
                <span
                  style={{
                    ...LAYER_CHIP_STYLE,
                    color: isDone ? 'var(--fg-subtle)' : layerColor,
                    border: `1px solid ${isDone ? 'var(--border-default)' : layerColor}40`,
                    background: isDone ? 'transparent' : `${layerColor}10`,
                  }}
                >
                  {LAYER_LABELS[task.toRoleLayer]}
                </span>

                {/* 任务信息：标题 + 元数据 */}
                <span style={TASK_INFO_STYLE}>
                  <span
                    style={{
                      ...TASK_TITLE_STYLE,
                      color: isDone ? 'var(--fg-muted)' : 'var(--fg-default)',
                      textDecoration: isDone ? 'line-through' : 'none',
                      fontWeight: task.state === 'running' ? 600 : 400,
                    }}
                    title={title}
                  >
                    {title}
                  </span>
                  <span style={TASK_META_STYLE}>
                    <span>{LAYER_LABELS[task.fromRoleLayer]} → {LAYER_LABELS[task.toRoleLayer]}</span>
                    {timeLabel ? (
                      <>
                        <span>·</span>
                        <span>{timeLabel}</span>
                      </>
                    ) : null}
                    {task.retryCount && task.retryCount > 0 ? (
                      <>
                        <span>·</span>
                        <span style={{ color: 'var(--warning)' }}>重试 {task.retryCount}</span>
                      </>
                    ) : null}
                  </span>
                </span>

                {/* 状态文字 */}
                <span style={{ ...STATE_TAG_STYLE, color: stateColor }}>
                  {STATE_LABELS[task.state]}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', padding: '8px 6px', textAlign: 'center' }}>
          {filter === 'active' ? '没有进行中的任务' : filter === 'done' ? '还没有已完成的任务' : '暂无任务'}
        </div>
      )}
    </div>
  );
}
