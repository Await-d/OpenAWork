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
 * 选中态：accent-muted 背景 + 标题加粗，无 box-shadow 干扰。
 * Hover：副行右侧切换为操作按钮（删除）。
 */

import React, { type CSSProperties, type MouseEvent, useMemo } from 'react';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
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

const STATUS_LABEL: Record<AgentTeamsSidebarTeam['status'], string> = {
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
};

const STATUS_COLOR: Record<AgentTeamsSidebarTeam['status'], string> = {
  running: 'var(--success))',
  paused: 'var(--warning))',
  completed: 'var(--fg-muted)',
  failed: 'var(--danger))',
};

const ICON_BOX_STYLE: CSSProperties = {
  position: 'relative',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 5,
  transition: 'background 120ms ease, color 120ms ease',
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
  height: 2,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--border-default) 40%, transparent)',
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
  color: 'var(--fg-default)',
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
  width: 18,
  height: 18,
  borderRadius: '50%',
  fontSize: 9,
  fontWeight: 700,
  color: 'var(--fg-on-accent))',
  letterSpacing: '0.01em',
  flexShrink: 0,
  border: '1.5px solid var(--bg-overlay)',
  marginLeft: -4,
};

const AGENT_PALETTE = [
  'var(--aux))',
  'var(--chart-5))',
  'var(--complement))',
  'var(--warning))',
  'var(--success))',
  'var(--chart-7))',
  'var(--danger))',
  'var(--chart-5))',
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
        color,
        fontWeight: 700,
        flexShrink: 0,
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

  const ariaLabel =
    `会话：${session.title}，${label}` +
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
          ? 'color-mix(in oklch, var(--accent) 18%, transparent)'
          : 'color-mix(in oklch, var(--fg-muted) 10%, transparent)',
        color: active ? 'var(--accent)' : 'var(--fg-default)',
      }}
    >
      {isDerived ? (
        <svg
          width="12"
          height="12"
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
          width="12"
          height="12"
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
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: dot,
          border: '2px solid var(--bg-overlay)',
          boxShadow: session.status === 'running' ? `0 0 5px ${dot}` : undefined,
          animation: session.status === 'running' ? 'pulse 1.5s ease-in-out infinite' : undefined,
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
        <Chip color="var(--success))" title={`${taskRunning} 个任务运行中`}>
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--success))',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
          {taskRunning}
        </Chip>
      ) : null}

      {taskFailed > 0 ? (
        <Chip color="var(--danger))" title={`${taskFailed} 个任务失败`}>
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
      {/* 进度条 */}
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

      {/* 当前任务 / 最近消息 */}
      {showTaskLine ? (
        <div style={TASK_LINE_STYLE}>
          <span
            aria-hidden
            style={{ flexShrink: 0, color: currentTask ? 'var(--success))' : 'var(--fg-muted)' }}
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
