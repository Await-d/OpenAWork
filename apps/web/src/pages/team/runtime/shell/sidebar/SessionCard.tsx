/**
 * 260517-team-page-v2 · 左侧会话栏卡片（富信息版）
 *
 * 基于共享的 BaseSessionRow 骨架，通过 icon / meta / extra 插槽注入
 * team 特有的丰富上下文：状态徽章、任务进度条、当前任务、agent 头像。
 *
 * 视觉结构（自上而下，每行仅在有数据时渲染）：
 *   1. 标题行：图标盒（24×24，含 status 指示点）+ 标题 + 相对时间  ← BaseSessionRow
 *   2. 状态行：状态徽章 · 任务进度文字 · 失败/运行中数字徽章 · 子会话标记  ← meta slot
 *   3. 进度条：仅当 taskTotal > 0  ← extra slot
 *   4. 当前任务 / 最新消息：单行截断，带 ▶ 或 💬 前缀  ← extra slot
 *   5. Agent 头像行：圆形 chip，最多 4 个，超出折叠为「+N」  ← extra slot
 *
 * 设计方向：Refined Industrial — 精密工具感，克制但信息密度高。
 * - 通过纯背景色 + 阴影区分选中/hover 态（无额外边框/色条）
 * - 状态徽章采用柔和胶囊背景色 + 同色文字
 * - 弹性缓动动画提升交互手感
 *
 * 选中态：accent 背景 + accent 边框 + 标题加粗。
 * Hover：微妙浮起 + 轻阴影。
 */

import React, { type CSSProperties, type MouseEvent, useMemo } from 'react';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import {
  formatSidebarTeamStatus,
  refineFailedStatus,
  formatRefinedFailedStatus,
  refinedFailedStatusColor,
} from '../../data/team-runtime-status.js';
import {
  BaseSessionRow,
  DeleteIcon,
  type BaseSessionRowAction,
} from '../../../../../components/layout/sidebar/BaseSessionRow.js';

// ─── Props ───────────────────────────────────────────────────────────────────

interface SessionCardProps {
  session: AgentTeamsSidebarTeam;
  active: boolean;
  hovered: boolean;
  onSelect: (sessionId: string) => void;
  onContextMenu: (event: MouseEvent, session: AgentTeamsSidebarTeam) => void;
  onHoverChange: (sessionId: string | null) => void;
  onDelete?: (sessionId: string, sessionTitle: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<AgentTeamsSidebarTeam['status'], string> = {
  idle: 'var(--fg-subtle)',
  running: 'var(--success)',
  paused: 'var(--contrast)',
  completed: 'var(--fg-muted)',
  failed: 'var(--complement)',
};

const ICON_BOX_STYLE: CSSProperties = {
  position: 'relative',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 7,
  transition:
    'background 160ms cubic-bezier(0.4, 0, 0.2, 1), color 160ms cubic-bezier(0.4, 0, 0.2, 1)',
};

const STATUS_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '1.5px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.03em',
  flexShrink: 0,
  lineHeight: '1.6',
};

const PROGRESS_TRACK_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: 3,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--border-default) 50%, transparent)',
  overflow: 'hidden',
};

const PROGRESS_FILL_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 999,
  transformOrigin: 'left center',
  transition: 'transform 320ms cubic-bezier(0.4, 0, 0.2, 1)',
};

const TASK_LINE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: 'var(--fg-default)',
  lineHeight: 1.5,
  minWidth: 0,
};

const TASK_TEXT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const SUBTITLE_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  lineHeight: '1.5',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  maxWidth: '70%',
  opacity: 0.8,
};

const AGENTS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};

const AGENT_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: '50%',
  fontSize: 9,
  fontWeight: 700,
  color: 'var(--fg-on-accent)',
  letterSpacing: '0.01em',
  flexShrink: 0,
  border: '1.5px solid var(--bg-overlay, rgba(0,0,0,0.3))',
  marginLeft: -3,
  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
};

const AGENT_PALETTE = [
  'var(--aux)',
  'var(--chart-5)',
  'var(--complement)',
  'var(--warning)',
  'var(--success)',
  'var(--chart-7)',
  'var(--danger)',
  'var(--chart-5)',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function agentColor(name: string, idx: number): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AGENT_PALETTE[hash % AGENT_PALETTE.length] ?? AGENT_PALETTE[idx % AGENT_PALETTE.length]!;
}

function formatRelativeShort(timestamp: string | undefined): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h${remMin}m` : `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function Chip({
  color,
  title,
  children,
}: {
  color: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        fontWeight: 500,
        flexShrink: 0,
        padding: '1px 6px',
        borderRadius: 999,
        background: 'color-mix(in srgb, var(--border-subtle) 35%, transparent)',
        color,
        lineHeight: '1.5',
      }}
    >
      {children}
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SessionCard({
  session,
  active,
  hovered,
  onSelect,
  onContextMenu,
  onHoverChange,
  onDelete,
}: SessionCardProps) {
  const dot = STATUS_COLOR[session.status];
  const isFailed = session.status === 'failed';

  // 细分失败状态
  const refinedFailed = useMemo(
    () =>
      refineFailedStatus({
        status: session.status,
        taskTotal: session.taskTotal,
        taskCompleted: session.taskCompleted,
        taskFailed: session.taskFailed,
        taskRunning: session.taskRunning,
      }),
    [
      session.status,
      session.taskTotal,
      session.taskCompleted,
      session.taskFailed,
      session.taskRunning,
    ],
  );

  const label =
    isFailed && refinedFailed
      ? formatRefinedFailedStatus(refinedFailed)
      : formatSidebarTeamStatus(session.status);
  const labelColor = isFailed && refinedFailed ? refinedFailedStatusColor(refinedFailed) : dot;

  const isLiveRunning = session.status === 'running';

  const taskTotal = session.taskTotal ?? 0;
  const taskCompleted = session.taskCompleted ?? 0;
  const taskRunning = session.taskRunning ?? 0;
  const taskFailed = session.taskFailed ?? 0;
  const taskProgress = taskTotal > 0 ? taskCompleted / taskTotal : 0;
  const taskFailedRatio = taskTotal > 0 ? taskFailed / taskTotal : 0;
  const childCount = session.childSessionCount ?? 0;
  const isDerived = session.isDerived ?? false;
  const agents = session.agents ?? [];
  const visibleAgents = agents.slice(0, 4);
  const overflowAgents = Math.max(0, agents.length - visibleAgents.length);

  const currentTask = session.currentTaskTitle;
  const lastMessage = session.lastMessage;
  const showTaskLine = Boolean(currentTask) || Boolean(lastMessage);
  const subtitle = session.subtitle;

  const ariaLabel =
    `会话：${session.title}，${label}` +
    (subtitle ? `，${subtitle}` : '') +
    (taskTotal > 0 ? `，任务 ${taskCompleted}/${taskTotal}` : '') +
    (childCount > 0 ? `，${childCount} 个子会话` : '') +
    (isDerived ? '，派生自其他会话' : '') +
    (currentTask ? `，正在执行：${currentTask}` : '') +
    (lastMessage ? `，最新：${lastMessage}` : '');

  // ─── Icon slot ───────────────────────────────────────────────────────────

  const iconNode = (
    <span
      aria-hidden="true"
      style={{
        ...ICON_BOX_STYLE,
        background: active
          ? 'color-mix(in oklch, var(--accent) 22%, transparent)'
          : 'color-mix(in oklch, var(--fg-muted) 12%, transparent)',
        color: active ? 'var(--accent)' : 'var(--fg-default)',
      }}
    >
      {isDerived ? (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 7v6a4 4 0 0 0 4 4h11" />
          <polyline points="14 13 18 17 14 21" />
        </svg>
      ) : (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )}
      {/* 状态指示点 */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: -1.5,
          bottom: -1.5,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dot,
          border: '2px solid var(--bg-overlay, rgba(0,0,0,0.6))',
          boxShadow: isLiveRunning
            ? `0 0 5px ${dot}, 0 0 10px color-mix(in srgb, ${dot} 35%, transparent)`
            : '0 1px 2px rgba(0,0,0,0.35)',
          animation: isLiveRunning ? 'pulse 2s ease-in-out infinite' : undefined,
        }}
      />
    </span>
  );

  // ─── Meta slot (status badges + task counts) ─────────────────────────────

  const metaNode = (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        flexWrap: 'wrap',
        minHeight: 18,
      }}
    >
      {/* 主状态徽章 — 柔和背景色 */}
      <span
        style={{
          ...STATUS_BADGE_STYLE,
          background: `color-mix(in srgb, ${labelColor} 8%, var(--bg-overlay))`,
          color: labelColor,
        }}
      >
        {isLiveRunning ? (
          <span
            aria-hidden
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: dot,
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        ) : null}
        {label}
      </span>

      {taskTotal > 0 ? (
        <Chip color="var(--fg-default)" title={`已完成 ${taskCompleted} / 共 ${taskTotal}`}>
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
            {taskCompleted}/{taskTotal}
          </span>
        </Chip>
      ) : null}

      {taskRunning > 0 ? (
        <Chip color="var(--success)" title={`${taskRunning} 个任务运行中`}>
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--success)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
          {taskRunning}
        </Chip>
      ) : null}

      {taskFailed > 0 ? (
        <Chip color="var(--complement)" title={`${taskFailed} 个任务失败`}>
          <span aria-hidden style={{ fontWeight: 800, lineHeight: 1 }}>
            !
          </span>
          {taskFailed}
        </Chip>
      ) : null}

      {childCount > 0 ? (
        <Chip color="var(--fg-muted)" title={`${childCount} 个子会话`}>
          <span aria-hidden>↳</span>
          {childCount}
        </Chip>
      ) : null}
    </span>
  );

  // ─── Actions ─────────────────────────────────────────────────────────────

  const actions: BaseSessionRowAction[] = useMemo(() => {
    if (!onDelete) return [];
    return [
      {
        key: 'delete',
        title: '删除',
        icon: DeleteIcon,
        onClick: () => onDelete(session.id, session.title),
        danger: true,
      },
    ];
  }, [onDelete, session.id, session.title]);

  // ─── Extra slot (progress bar + task line + agents) ──────────────────────

  const extraNode = (
    <>
      {/* 副标题 */}
      {subtitle ? (
        <div style={SUBTITLE_STYLE} title={subtitle}>
          {subtitle}
        </div>
      ) : null}

      {/* 进度条 — 绿红分段（完成 vs 失败） */}
      {taskTotal > 0 ? (
        <div style={PROGRESS_TRACK_STYLE} aria-hidden>
          {/* 绿色：已完成 */}
          <span
            style={{
              ...PROGRESS_FILL_STYLE,
              background: 'var(--success)',
              transform: `scaleX(${taskProgress})`,
            }}
          />
          {/* 红色叠加：失败部分 */}
          {taskFailed > 0 ? (
            <span
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${taskProgress * 100}%`,
                width: `${taskFailedRatio * 100}%`,
                borderRadius: 999,
                background: 'var(--complement)',
                transition:
                  'width 320ms cubic-bezier(0.4, 0, 0.2, 1), left 320ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          ) : null}
        </div>
      ) : null}

      {/* 当前任务 / 最近消息 */}
      {showTaskLine ? (
        <div style={TASK_LINE_STYLE}>
          <span
            aria-hidden
            style={{ flexShrink: 0, color: currentTask ? 'var(--success)' : 'var(--fg-muted)' }}
          >
            {currentTask ? '▶' : '💬'}
          </span>
          <span style={TASK_TEXT_STYLE}>{currentTask ?? lastMessage}</span>
        </div>
      ) : null}

      {/* Agents */}
      {visibleAgents.length > 0 ? (
        <div style={AGENTS_ROW_STYLE} title={agents.join(' · ')}>
          {visibleAgents.map((name, idx) => {
            const color = agentColor(name, idx);
            const initial = name.slice(0, 2).toUpperCase();
            return (
              <span key={name} style={{ ...AGENT_CHIP_STYLE, background: color }}>
                {initial}
              </span>
            );
          })}
          {overflowAgents > 0 ? (
            <span
              style={{
                ...AGENT_CHIP_STYLE,
                background:
                  'var(--surface-2, color-mix(in srgb, var(--fg-muted) 16%, transparent))',
                color: 'var(--fg-default)',
              }}
            >
              +{overflowAgents}
            </span>
          ) : null}
          {session.durationMs && session.durationMs > 0 ? (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                color: 'var(--fg-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
              title={`累计运行 ${formatDuration(session.durationMs)}`}
            >
              ⏱ {formatDuration(session.durationMs)}
            </span>
          ) : null}
        </div>
      ) : session.durationMs && session.durationMs > 0 ? (
        <span
          style={{
            fontSize: 10,
            color: 'var(--fg-muted)',
            fontVariantNumeric: 'tabular-nums',
            alignSelf: 'flex-end',
          }}
          title={`累计运行 ${formatDuration(session.durationMs)}`}
        >
          ⏱ {formatDuration(session.durationMs)}
        </span>
      ) : null}
    </>
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <BaseSessionRow
      sessionId={session.id}
      title={session.title}
      timeLabel={formatRelativeShort(session.updatedAt)}
      timeTitle={
        session.updatedAt ? new Date(session.updatedAt).toLocaleString('zh-CN') : undefined
      }
      active={active}
      hovered={hovered}
      icon={iconNode}
      meta={metaNode}
      extra={extraNode}
      actions={actions}
      hideMetaOnHover={false}
      onSelect={onSelect}
      onContextMenu={(event, _id) => onContextMenu(event, session)}
      onHoverChange={onHoverChange}
      dataState={session.status}
      ariaLabel={ariaLabel}
    />
  );
}
