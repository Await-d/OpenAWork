/**
 * 260517-team-page-v2 · 左侧会话栏卡片（富信息版）
 *
 * 借鉴 chat 端 SessionSidebarSessionRow 的紧凑骨架，但额外暴露 team
 * 特有的丰富上下文：当前任务、agent 头像、任务进度条、子会话计数。
 *
 * 视觉结构（自上而下，每行仅在有数据时渲染）：
 *   1. 标题行：图标盒（24×24，含 status 指示点）+ 标题 + 相对时间
 *   2. 状态行：状态徽章 · 任务进度文字 · 失败/运行中数字徽章 · 子会话标记
 *   3. 进度条：仅当 taskTotal > 0
 *   4. 当前任务 / 最新消息：单行截断，带 ▶ 或 💬 前缀
 *   5. Agent 头像行：圆形 chip，最多 4 个，超出折叠为「+N」
 *
 * 高度：60–110px（取决于数据丰富程度）。运行中且任务多的会话最高，
 *      已完成且无 agent 的会话最矮。
 *
 * 选中态：accent-muted 背景 + 标题加粗，无 box-shadow 干扰。
 * Hover：副行右侧切换为操作按钮（删除）。
 */

import React, { type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import type { AgentTeamsSidebarTeam } from '../data/team-runtime-types.js';

interface SessionCardProps {
  session: AgentTeamsSidebarTeam;
  active: boolean;
  hovered: boolean;
  onSelect: (sessionId: string) => void;
  onContextMenu: (event: MouseEvent, session: AgentTeamsSidebarTeam) => void;
  onHoverChange: (sessionId: string | null) => void;
  onDelete?: (sessionId: string, sessionTitle: string) => void;
}

const STATUS_LABEL: Record<AgentTeamsSidebarTeam['status'], string> = {
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
};

const STATUS_COLOR: Record<AgentTeamsSidebarTeam['status'], string> = {
  running: '#22c55e',
  paused: 'var(--warning, #f59e0b)',
  completed: 'var(--text-3)',
  failed: 'var(--danger, #d4574e)',
};

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 10px',
  margin: '0 6px 4px',
  borderRadius: 8,
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'background 120ms ease, border-color 120ms ease',
  outline: 'none',
};

const HEAD_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const ICON_BOX_STYLE: CSSProperties = {
  position: 'relative',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 6,
  transition: 'background 120ms ease, color 120ms ease',
};

const TITLE_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  lineHeight: '1.3',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  letterSpacing: '-0.005em',
};

const TIME_STYLE: CSSProperties = {
  flexShrink: 0,
  fontSize: 10,
  color: 'var(--text-3)',
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
};

const META_ROW_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 10,
  flexWrap: 'wrap',
  minHeight: 18,
};

const STATUS_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 7px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.02em',
  flexShrink: 0,
};

const PROGRESS_TRACK_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: 3,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--border) 40%, transparent)',
  overflow: 'hidden',
};

const PROGRESS_FILL_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: 999,
  transformOrigin: 'left center',
  transition: 'transform 240ms ease',
};

const TASK_LINE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: 'var(--text-2)',
  lineHeight: 1.4,
  minWidth: 0,
};

const TASK_TEXT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
  width: 22,
  height: 22,
  borderRadius: '50%',
  fontSize: 10,
  fontWeight: 700,
  color: '#fff',
  letterSpacing: '0.01em',
  flexShrink: 0,
  border: '1.5px solid var(--surface)',
  marginLeft: -4,
};

const ACTIONS_STYLE: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 0,
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  background:
    'linear-gradient(to right, transparent, color-mix(in srgb, var(--surface) 96%, transparent) 30%)',
  paddingLeft: 14,
  transition: 'opacity 120ms ease-out',
  willChange: 'opacity',
};

const ACTION_BTN_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 5,
  background: 'transparent',
  border: 'none',
  color: 'var(--text-3)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

const AGENT_PALETTE = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#22c55e',
  '#06b6d4',
  '#ef4444',
  '#a855f7',
];

function isNestedInteractiveTarget(target: EventTarget | null): target is Element {
  return target instanceof Element && target.closest('button, input, textarea, select, a') !== null;
}

function agentColor(name: string, idx: number): string {
  // 名字稳定派生颜色，避免每次刷新闪烁；fallback 到顺序色板。
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AGENT_PALETTE[hash % AGENT_PALETTE.length] ?? AGENT_PALETTE[idx % AGENT_PALETTE.length]!;
}

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
  const label = STATUS_LABEL[session.status];

  const taskTotal = session.taskTotal ?? 0;
  const taskCompleted = session.taskCompleted ?? 0;
  const taskRunning = session.taskRunning ?? 0;
  const taskFailed = session.taskFailed ?? 0;
  const taskProgress = taskTotal > 0 ? taskCompleted / taskTotal : 0;
  const childCount = session.childSessionCount ?? 0;
  const isDerived = session.isDerived ?? false;
  const agents = session.agents ?? [];
  const visibleAgents = agents.slice(0, 4);
  const overflowAgents = Math.max(0, agents.length - visibleAgents.length);

  const currentTask = session.currentTaskTitle;
  const lastMessage = session.lastMessage;
  const showTaskLine = Boolean(currentTask) || Boolean(lastMessage);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isNestedInteractiveTarget(event.target)) return;
    onSelect(session.id);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isNestedInteractiveTarget(event.target)) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(session.id);
    }
  };

  const ariaLabel =
    `会话：${session.title}，${label}` +
    (taskTotal > 0 ? `，任务 ${taskCompleted}/${taskTotal}` : '') +
    (childCount > 0 ? `，${childCount} 个子会话` : '') +
    (isDerived ? '，派生自其他会话' : '') +
    (currentTask ? `，正在执行：${currentTask}` : '') +
    (lastMessage ? `，最新：${lastMessage}` : '');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event, session);
      }}
      onMouseEnter={() => onHoverChange(session.id)}
      onMouseLeave={() => onHoverChange(null)}
      data-session-id={session.id}
      data-session-state={session.status}
      style={{
        ...ROW_STYLE,
        background: active
          ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))'
          : hovered
            ? 'color-mix(in srgb, var(--text-3) 5%, transparent)'
            : 'transparent',
        borderColor: active ? 'color-mix(in srgb, var(--accent) 32%, transparent)' : 'transparent',
      }}
      title={session.title}
      aria-current={active ? 'true' : undefined}
      aria-label={ariaLabel}
    >
      {/* Row 1: 图标盒 + 标题 + 时间 */}
      <div style={HEAD_ROW_STYLE}>
        <span
          aria-hidden="true"
          style={{
            ...ICON_BOX_STYLE,
            background: active
              ? 'color-mix(in oklch, var(--accent) 18%, transparent)'
              : 'color-mix(in oklch, var(--text-3) 10%, transparent)',
            color: active ? 'var(--accent)' : 'var(--text-2)',
          }}
        >
          {isDerived ? (
            <svg
              width="14"
              height="14"
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
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
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
              right: -2,
              bottom: -2,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: dot,
              border: '2px solid var(--surface)',
              boxShadow: session.status === 'running' ? `0 0 6px ${dot}` : undefined,
              animation:
                session.status === 'running' ? 'pulse 1.5s ease-in-out infinite' : undefined,
            }}
          />
        </span>

        <span
          style={{
            ...TITLE_STYLE,
            fontWeight: active ? 700 : 600,
            color: active ? 'var(--text)' : 'var(--text)',
          }}
        >
          {session.title}
        </span>

        <span
          style={TIME_STYLE}
          title={
            session.updatedAt ? new Date(session.updatedAt).toLocaleString('zh-CN') : undefined
          }
        >
          {formatRelativeShort(session.updatedAt)}
        </span>
      </div>

      {/* Row 2: 状态徽章 + 任务计数 + 失败/运行中 + 子会话 */}
      <div style={META_ROW_STYLE}>
        <span
          style={{
            ...STATUS_BADGE_STYLE,
            background: `color-mix(in srgb, ${dot} 16%, transparent)`,
            color: dot,
          }}
        >
          {session.status === 'running' ? (
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
          <Chip color="var(--text-2)" title={`已完成 ${taskCompleted} / 共 ${taskTotal}`}>
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
          <Chip color="#22c55e" title={`${taskRunning} 个任务运行中`}>
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: '#22c55e',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            {taskRunning}
          </Chip>
        ) : null}

        {taskFailed > 0 ? (
          <Chip color="var(--danger, #d4574e)" title={`${taskFailed} 个任务失败`}>
            <span aria-hidden style={{ fontWeight: 800, lineHeight: 1 }}>
              !
            </span>
            {taskFailed}
          </Chip>
        ) : null}

        {childCount > 0 ? (
          <Chip color="var(--text-3)" title={`${childCount} 个子会话`}>
            <span aria-hidden>↳</span>
            {childCount}
          </Chip>
        ) : null}

        {hovered && onDelete ? (
          <div style={ACTIONS_STYLE} aria-hidden={!hovered}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(session.id, session.title);
              }}
              tabIndex={hovered ? 0 : -1}
              title="删除"
              className="team-menu-item"
              data-tone="danger"
              style={{ ...ACTION_BTN_STYLE, color: 'var(--danger, #d4574e)' }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>

      {/* Row 3: 进度条 */}
      {taskTotal > 0 ? (
        <div style={PROGRESS_TRACK_STYLE} aria-hidden>
          <span
            style={{
              ...PROGRESS_FILL_STYLE,
              background: dot,
              transform: `scaleX(${taskProgress})`,
            }}
          />
        </div>
      ) : null}

      {/* Row 4: 当前任务 / 最近消息 */}
      {showTaskLine ? (
        <div style={TASK_LINE_STYLE}>
          <span
            aria-hidden
            style={{ flexShrink: 0, color: currentTask ? '#22c55e' : 'var(--text-3)' }}
          >
            {currentTask ? '▶' : '💬'}
          </span>
          <span style={TASK_TEXT_STYLE}>{currentTask ?? lastMessage}</span>
        </div>
      ) : null}

      {/* Row 5: agents */}
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
                background: 'var(--surface-2, color-mix(in srgb, var(--text-3) 16%, transparent))',
                color: 'var(--text-2)',
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
                color: 'var(--text-3)',
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
            color: 'var(--text-3)',
            fontVariantNumeric: 'tabular-nums',
            alignSelf: 'flex-end',
          }}
          title={`累计运行 ${formatDuration(session.durationMs)}`}
        >
          ⏱ {formatDuration(session.durationMs)}
        </span>
      ) : null}
    </div>
  );
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
        color,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
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
