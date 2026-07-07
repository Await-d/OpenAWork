import type { CSSProperties } from 'react';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { ChromeBadge } from '../../shell/team-runtime-shell-primitives.js';
import { Icon, PlusIcon } from '../../shared/TeamIcons.js';
import { formatSidebarTeamStatus } from '../../data/team-runtime-status.js';

export type TaskBoardFilterMode = 'all' | 'active' | 'done';

export interface TaskBoardStats {
  readonly todo: number;
  readonly doing: number;
  readonly review: number;
  readonly total: number;
  readonly done: number;
  readonly active: number;
  readonly progress: number;
}

interface TeamTasksWorkbenchHeaderProps {
  readonly selectedTeam: AgentTeamsSidebarTeam;
  readonly statusSubtitle: string | null;
  readonly canManageSessionEntries: boolean;
  readonly stats: TaskBoardStats;
  readonly filter: TaskBoardFilterMode;
  readonly onFilterChange: (filter: TaskBoardFilterMode) => void;
}

interface TeamTasksEmptyBoardStateProps {
  readonly canManageSessionEntries: boolean;
  readonly onAddTask: () => void;
}

const HERO_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid var(--border-default)',
  background:
    'linear-gradient(180deg, color-mix(in oklch, var(--bg-overlay) 94%, var(--accent) 6%), var(--bg-raised))',
  boxShadow: 'var(--shadow-sm)',
};

const HERO_TOP_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  gap: 12,
  alignItems: 'start',
};

const ICON_FRAME_STYLE: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 8,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid var(--accent-border)',
  background: 'var(--accent-subtle)',
  color: 'var(--accent)',
};

const EYEBROW_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: 'var(--fg-muted)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const TITLE_STYLE: CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: 'var(--fg-strong)',
  lineHeight: 1.25,
  wordBreak: 'keep-all',
};

const DESCRIPTION_STYLE: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.55,
  color: 'var(--fg-muted)',
  wordBreak: 'keep-all',
  textWrap: 'pretty',
};

const SUMMARY_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
  gap: 8,
};

const SUMMARY_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '9px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'color-mix(in oklch, var(--bg-overlay) 72%, transparent)',
  minWidth: 0,
};

const SUMMARY_LABEL_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const SUMMARY_VALUE_STYLE: CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  lineHeight: 1.05,
  fontVariantNumeric: 'tabular-nums',
};

const PROGRESS_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(140px, 1fr) auto',
  gap: 12,
  alignItems: 'center',
};

const PROGRESS_TRACK_STYLE: CSSProperties = {
  position: 'relative',
  height: 6,
  borderRadius: 999,
  background: 'color-mix(in oklch, var(--border-default) 40%, transparent)',
  overflow: 'hidden',
};

const FILTER_GROUP_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const FILTER_BTN_BASE: CSSProperties = {
  minHeight: 24,
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

const READ_ONLY_NOTICE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 30,
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid var(--warning-border)',
  background: 'var(--warning-muted)',
  color: 'var(--warning)',
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.45,
};

const EMPTY_STATE_STYLE: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  gap: 8,
  padding: 32,
  borderRadius: 12,
  border: '1px dashed color-mix(in oklch, var(--border-default) 56%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 13,
  textAlign: 'center',
};

function ProgressBar({ progress }: { readonly progress: number }) {
  const progressPercent = Math.round(progress * 100);
  const progressColor =
    progress === 1 ? 'var(--success)' : progress > 0.5 ? 'var(--accent)' : 'var(--warning)';

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-muted)' }}>完成度</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 800,
            color: 'var(--fg-default)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {progressPercent}%
        </span>
      </div>
      <div style={PROGRESS_TRACK_STYLE} aria-label={`任务完成度 ${progressPercent}%`}>
        <div
          style={{
            position: 'absolute',
            inset: '0 auto 0 0',
            width: `${progressPercent}%`,
            borderRadius: 999,
            background: progressColor,
            transition: 'width 200ms ease',
          }}
        />
      </div>
    </div>
  );
}

function FilterButton({
  active,
  label,
  onClick,
  tone,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly tone: 'accent' | 'warning';
}) {
  const toneColor = tone === 'warning' ? 'var(--warning)' : 'var(--accent)';
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="team-hover-surface"
      style={{
        ...FILTER_BTN_BASE,
        ...(active
          ? {
              background: `color-mix(in oklch, ${toneColor} 14%, transparent)`,
              color: toneColor,
              fontWeight: 700,
            }
          : { color: 'var(--fg-muted)' }),
      }}
    >
      {label}
    </button>
  );
}

export function TeamTasksWorkbenchHeader({
  selectedTeam,
  statusSubtitle,
  canManageSessionEntries,
  stats,
  filter,
  onFilterChange,
}: TeamTasksWorkbenchHeaderProps) {
  const totalLabel = stats.total > 0 ? `${stats.done}/${stats.total}` : '0/0';

  return (
    <section aria-label="任务工作台摘要" style={HERO_STYLE}>
      <div style={HERO_TOP_STYLE}>
        <span style={ICON_FRAME_STYLE}>
          <Icon name="tasks" size={18} color="currentColor" />
        </span>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <span style={EYEBROW_STYLE}>Team tasks</span>
          <span style={TITLE_STYLE}>任务编排面板</span>
          <span style={DESCRIPTION_STYLE}>
            按会话子树追踪待办、执行与评审，让任务流和产物状态在同一首屏对齐。
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <ChromeBadge>{formatSidebarTeamStatus(selectedTeam.status)}</ChromeBadge>
          {statusSubtitle ? <ChromeBadge>{statusSubtitle}</ChromeBadge> : null}
          {!canManageSessionEntries ? <ChromeBadge>只读</ChromeBadge> : null}
        </div>
      </div>

      <div style={SUMMARY_GRID_STYLE}>
        <SummaryCard label="当前会话" value={selectedTeam.title} compact />
        <SummaryCard label="完成/总数" value={totalLabel} color="var(--fg-strong)" />
        <SummaryCard label="进行中" value={String(stats.doing)} color="var(--accent)" />
        <SummaryCard label="待办" value={String(stats.todo)} color="var(--fg-muted)" />
        <SummaryCard label="待评审" value={String(stats.review)} color="var(--warning)" />
      </div>

      {stats.total > 0 ? (
        <div style={PROGRESS_ROW_STYLE}>
          <ProgressBar progress={stats.progress} />
          <div style={FILTER_GROUP_STYLE} role="group" aria-label="任务筛选">
            <FilterButton
              active={filter === 'all'}
              label={`全部 ${stats.total}`}
              onClick={() => onFilterChange('all')}
              tone="accent"
            />
            <FilterButton
              active={filter === 'active'}
              label={`活跃 ${stats.active}`}
              onClick={() => onFilterChange('active')}
              tone="accent"
            />
            <FilterButton
              active={filter === 'done'}
              label={`完成 ${stats.done}`}
              onClick={() => onFilterChange('done')}
              tone="warning"
            />
          </div>
        </div>
      ) : null}

      {!canManageSessionEntries ? (
        <div style={READ_ONLY_NOTICE_STYLE}>
          <span aria-hidden="true" style={{ fontSize: 10 }}>
            ●
          </span>
          <span>当前工作区只读，无法新增或推进任务。</span>
        </div>
      ) : null}
    </section>
  );
}

function SummaryCard({
  compact = false,
  color = 'var(--fg-strong)',
  label,
  value,
}: {
  readonly compact?: boolean;
  readonly color?: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div style={SUMMARY_CARD_STYLE}>
      <span style={SUMMARY_LABEL_STYLE}>{label}</span>
      <span
        style={{
          ...SUMMARY_VALUE_STYLE,
          color,
          fontSize: compact ? 12 : SUMMARY_VALUE_STYLE.fontSize,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={compact ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

export function TeamTasksNoSessionState() {
  return (
    <div style={EMPTY_STATE_STYLE}>
      <span style={ICON_FRAME_STYLE} aria-hidden>
        <Icon name="tasks" size={18} color="currentColor" />
      </span>
      <strong style={{ color: 'var(--fg-default)' }}>先选择一个团队会话</strong>
      <span style={{ maxWidth: 420, lineHeight: 1.5 }}>
        选中左侧会话后，这里会展示该会话下所有任务的看板视图。
      </span>
      <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>任务状态会实时同步运行时。</span>
    </div>
  );
}

export function TeamTasksEmptyBoardState({
  canManageSessionEntries,
  onAddTask,
}: TeamTasksEmptyBoardStateProps) {
  return (
    <div style={EMPTY_STATE_STYLE}>
      <span style={ICON_FRAME_STYLE} aria-hidden>
        <Icon name="tasks" size={18} color="currentColor" />
      </span>
      <strong style={{ color: 'var(--fg-default)' }}>暂无任务</strong>
      <span style={{ maxWidth: 420, lineHeight: 1.5 }}>
        {canManageSessionEntries
          ? '添加第一个任务后，看板会同步待办、执行与评审状态。'
          : '当前会话还没有任务数据。'}
      </span>
      {canManageSessionEntries ? (
        <button
          type="button"
          onClick={onAddTask}
          className="team-dashed-add-accent"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 30,
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid var(--accent-border)',
            background: 'var(--accent-subtle)',
            color: 'var(--accent)',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <PlusIcon size={12} color="currentColor" />
          添加任务
        </button>
      ) : null}
    </div>
  );
}
