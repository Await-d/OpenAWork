import React, { useId, useState } from 'react';
import type { Session, SessionTask } from '@openAwork/web-client';
import type { BackgroundTaskRow, BackgroundTaskState } from './background-task-model.js';
import { formatTaskStateLabel } from './background-task-rows.js';
import {
  BackgroundTaskConfirmDialog,
  type BackgroundTaskPendingConfirm,
} from './background-task-confirm-dialog.js';
import {
  aggregateSubAgentTask,
  resolveSubAgentRunStatus,
  type SubAgentRunStatus,
} from './sub-agent-status.js';

export interface SubAgentRunItem {
  sessionId: string;
  shortSessionId: string;
  status: SubAgentRunStatus;
  taskLabel: string;
  title: string;
  assignedAgent?: string;
  result?: string;
  errorMessage?: string;
  terminalReason?: string;
  timeoutSource?: SessionTask['timeoutSource'];
  messageCount: number;
}

export function formatTimeoutSourceLabel(timeoutSource: SessionTask['timeoutSource']): string {
  return timeoutSource === 'first_response' ? '首响应未到' : '执行超时';
}

/** 状态胶囊 / 状态点的 tone 词表：与 `background-task-rows.tsx` 的行语义保持一致。 */
type StatusTone = 'accent' | 'warning' | 'success' | 'danger' | 'muted';

const STATUS_TONE_COLOR: Record<StatusTone, string> = {
  accent: 'var(--accent)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  danger: 'var(--danger)',
  muted: 'var(--fg-muted)',
};

/** 状态胶囊配色：子代理卡与命令行卡共用同一份实现，避免两处漂移。 */
function statusToneStyle(tone: StatusTone): React.CSSProperties {
  if (tone === 'accent') {
    return {
      background: 'color-mix(in oklch, var(--accent) 18%, var(--bg-overlay))',
      border: '1px solid color-mix(in oklch, var(--accent) 42%, var(--border-default))',
      color: 'var(--accent)',
    };
  }

  if (tone === 'warning') {
    return {
      background: 'color-mix(in srgb, var(--warning) 10%, var(--bg-overlay))',
      border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border-default))',
      color: 'var(--warning)',
    };
  }

  if (tone === 'success') {
    return {
      background: 'color-mix(in srgb, var(--success) 12%, var(--bg-overlay))',
      border: '1px solid color-mix(in srgb, var(--success) 35%, var(--border-default))',
      color: 'var(--success)',
    };
  }

  if (tone === 'danger') {
    return {
      background: 'color-mix(in srgb, var(--danger) 10%, var(--bg-overlay))',
      border: '1px solid color-mix(in srgb, var(--danger) 30%, var(--border-default))',
      color: 'var(--danger)',
    };
  }

  return {
    background: 'var(--bg-overlay)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--fg-muted)',
  };
}

function resolveSubAgentStatusTone(status: SubAgentRunStatus): StatusTone {
  if (status === 'running') return 'accent';
  if (status === 'paused') return 'warning';
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'ended') return 'muted';
  return 'warning';
}

function getStatusStyle(status: SubAgentRunStatus): React.CSSProperties {
  return statusToneStyle(resolveSubAgentStatusTone(status));
}

/** 命令行状态 tone：running=accent / pending=warning / failed=danger / 其余终态=muted。 */
function resolveShellStateTone(state: BackgroundTaskState): StatusTone {
  if (state === 'running') return 'accent';
  if (state === 'pending') return 'warning';
  if (state === 'failed') return 'danger';
  return 'muted';
}

function getShellStatusStyle(state: BackgroundTaskState): React.CSSProperties {
  return statusToneStyle(resolveShellStateTone(state));
}

export function getStatusLabel(status: SubAgentRunStatus): string {
  if (status === 'running') return '运行中';
  if (status === 'paused') return '等待处理';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  if (status === 'ended') return '已结束';
  return '待执行';
}

function normalizeTitle(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function truncateSummary(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function isActiveStatus(status: SubAgentRunStatus): boolean {
  return status === 'running' || status === 'paused';
}

function statusSortBucket(status: SubAgentRunStatus): number {
  // Active (running/paused) = 0, failed/cancelled = 1, 终态 completed/ended = 2, pending = 3
  if (status === 'running') return 0;
  if (status === 'paused') return 0;
  if (status === 'failed' || status === 'cancelled') return 1;
  if (status === 'completed' || status === 'ended') return 2;
  return 3;
}

export function buildSubAgentRunItems(
  childSessions: Session[],
  sessionTasks: SessionTask[],
  /**
   * 当前正在查看的会话 id。父会话派发任务时 task.sessionId 指向被派发的子会话；
   * 如果当前正处于该子会话视图中，recovery 返回的 tasks 会带上「父会话派发给本会话」
   * 那条任务（task.sessionId === currentSessionId），这里需要剔除以避免子代理列表
   * 显示「自己」。
   */
  currentSessionId?: string | null,
): SubAgentRunItem[] {
  const childSessionsById = new Map(childSessions.map((session) => [session.id, session]));
  const tasksBySessionId = new Map<string, SessionTask[]>();

  for (const task of sessionTasks) {
    if (!task.sessionId) {
      continue;
    }

    if (currentSessionId && task.sessionId === currentSessionId) {
      continue;
    }

    const groupedTasks = tasksBySessionId.get(task.sessionId);
    if (groupedTasks) {
      groupedTasks.push(task);
    } else {
      tasksBySessionId.set(task.sessionId, [task]);
    }
  }

  const itemsBySessionId = new Map<string, SubAgentRunItem>();
  // 同一次构建共用一个时钟：宽限期判断不应随每个 item 的遍历时刻漂移。
  const nowMs = Date.now();

  for (const [sessionId, groupedTasks] of tasksBySessionId) {
    // 同一子代理可能有多条任务（重启 / 重派），必须以最新一条为准，不能依赖遍历顺序。
    const aggregatedTask = aggregateSubAgentTask(groupedTasks);
    const childSession = childSessionsById.get(sessionId);
    const shortSessionId = sessionId.slice(0, 8);
    const fallbackLabel = `子代理 ${shortSessionId}`;

    if (aggregatedTask === null) {
      continue;
    }

    itemsBySessionId.set(sessionId, {
      sessionId,
      shortSessionId,
      status: resolveSubAgentRunStatus({
        task: aggregatedTask,
        childStateStatus: childSession?.state_status,
        nowMs,
      }),
      taskLabel: normalizeTitle(aggregatedTask.title, fallbackLabel),
      title: normalizeTitle(
        childSession?.title,
        normalizeTitle(aggregatedTask.title, fallbackLabel),
      ),
      assignedAgent: aggregatedTask.assignedAgent,
      result: aggregatedTask.result,
      errorMessage: aggregatedTask.errorMessage,
      terminalReason: aggregatedTask.terminalReason,
      timeoutSource: aggregatedTask.timeoutSource,
      messageCount: childSession?.messages?.length ?? 0,
    });
  }

  for (const session of childSessions) {
    if (currentSessionId && session.id === currentSessionId) {
      continue;
    }

    if (itemsBySessionId.has(session.id)) {
      continue;
    }

    const shortSessionId = session.id.slice(0, 8);
    const fallbackLabel = normalizeTitle(session.title, `子代理 ${shortSessionId}`);
    itemsBySessionId.set(session.id, {
      sessionId: session.id,
      shortSessionId,
      status: resolveSubAgentRunStatus({
        task: null,
        childStateStatus: session.state_status,
        nowMs,
      }),
      taskLabel: fallbackLabel,
      title: fallbackLabel,
      messageCount: session.messages?.length ?? 0,
    });
  }

  return Array.from(itemsBySessionId.values()).sort((left, right) => {
    const byBucket = statusSortBucket(left.status) - statusSortBucket(right.status);
    if (byBucket !== 0) {
      return byBucket;
    }

    // Within same bucket: most recent (higher sessionId lexicographically) first
    return right.sessionId.localeCompare(left.sessionId);
  });
}

const activeCount = (items: SubAgentRunItem[]): number =>
  items.filter((i) => isActiveStatus(i.status)).length;

function SubAgentItemCard({
  item,
  selected,
  onSelect,
  onStop,
  stopping,
}: {
  item: SubAgentRunItem;
  selected: boolean;
  onSelect: () => void;
  onStop?: () => void;
  stopping: boolean;
}) {
  const statusStyle = getStatusStyle(item.status);
  const summary = item.errorMessage
    ? truncateSummary(item.errorMessage, 28)
    : item.result
      ? truncateSummary(item.result, 28)
      : undefined;
  const timeoutHint =
    item.terminalReason === 'timeout' && item.timeoutSource
      ? `超时原因：${formatTimeoutSourceLabel(item.timeoutSource)}`
      : undefined;
  // 仅活跃（running / paused）行、且父级提供停止回调时才展示停止按钮
  const showStop = isActiveStatus(item.status) && onStop !== undefined;

  return (
    // 外层用 div 承载选中态样式：停止按钮必须与选择控件同级，避免 button 嵌套。
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        width: '100%',
        borderRadius: 8,
        border: selected
          ? '1px solid color-mix(in oklch, var(--accent) 50%, var(--border-subtle))'
          : '1px solid transparent',
        background: selected
          ? 'color-mix(in oklch, var(--bg-overlay) 84%, var(--accent) 16%)'
          : 'transparent',
        transition: 'background 140ms ease, border-color 140ms ease',
      }}
    >
      <button
        type="button"
        className="sub-agent-run-item__select"
        onClick={onSelect}
        aria-pressed={selected}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          padding: '6px 7px',
          flex: 1,
          minWidth: 0,
          borderRadius: 8,
          border: 'none',
          background: 'transparent',
          color: 'var(--fg-strong)',
          boxShadow: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              flexShrink: 0,
              background:
                item.status === 'running'
                  ? 'var(--accent)'
                  : item.status === 'completed'
                    ? 'var(--success)'
                    : item.status === 'failed'
                      ? 'var(--danger)'
                      : item.status === 'ended'
                        ? 'var(--fg-muted)'
                        : 'var(--warning)',
              boxShadow:
                item.status === 'running'
                  ? '0 0 0 2px color-mix(in oklch, var(--accent) 16%, transparent)'
                  : 'none',
              animation:
                item.status === 'running' ? 'sub-agent-pulse 1.5s ease-in-out infinite' : 'none',
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: selected ? 'var(--fg-strong)' : 'var(--fg-default)',
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={item.title}
          >
            {item.title}
          </span>
          <span
            style={{
              ...statusStyle,
              fontSize: 7.5,
              fontWeight: 700,
              padding: '0 4px',
              borderRadius: 999,
              lineHeight: '14px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {getStatusLabel(item.status)}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingLeft: 12,
            fontSize: 8.5,
            color: 'var(--fg-muted)',
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.assignedAgent && <span>{item.assignedAgent}</span>}
          {item.messageCount > 0 && <span>{item.messageCount} 条</span>}
        </div>
        {summary && (
          <div
            style={{
              paddingLeft: 12,
              fontSize: 8,
              color: item.errorMessage ? 'var(--danger)' : 'var(--fg-muted)',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={item.errorMessage ?? item.result}
          >
            {summary}
          </div>
        )}
        {timeoutHint && (
          <div
            style={{
              paddingLeft: 12,
              fontSize: 8,
              color: 'var(--warning)',
              lineHeight: 1.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={timeoutHint}
          >
            {timeoutHint}
          </div>
        )}
      </button>
      {showStop && (
        <button
          type="button"
          className="sub-agent-run-item__stop"
          disabled={stopping}
          aria-busy={stopping}
          aria-label={`停止子代理 ${item.title}`}
          title={stopping ? '正在停止该子代理' : '停止该子代理'}
          onClick={(event) => {
            // 阻止冒泡：点击停止不得触发行选中
            event.stopPropagation();
            onStop?.();
          }}
        >
          {stopping ? '停止中' : '停止'}
        </button>
      )}
    </div>
  );
}

/**
 * 后台命令行（紧凑卡片，风格对齐子代理卡）。
 *
 * - 状态点颜色：running=accent / pending=warning / failed=danger / 其余终态=fg-muted；
 * - `command` 单行省略、`title` 给全文；`terminalId` 只显示短号（悬停给全量）；
 * - 「终止」是破坏性操作：本层只触发回调，确认弹窗由列表层统一承担（禁止各自实现）。
 */
function ShellItemCard({
  row,
  onPreview,
  onKill,
  pendingKill,
}: {
  row: BackgroundTaskRow;
  onPreview?: () => void;
  onKill?: () => void;
  pendingKill: boolean;
}) {
  const terminalId = row.terminalId?.trim() ?? '';
  // 展示完整命令（CSS nowrap + 省略号压成单行），缺失时退回任务标题 / 终端短号。
  const fullCommand = (row.command ?? row.title)?.trim() ?? '';
  const command = fullCommand.length > 0 ? fullCommand : terminalId;
  const shortTerminalId = terminalId.slice(0, 8);
  const hasTerminal = terminalId.length > 0;
  const showPreview = onPreview !== undefined && hasTerminal;
  // 仅运行中行、且父级提供终止回调时才展示终止按钮（终态再 kill 只会得到 alreadyClosed）。
  const showKill = row.state === 'running' && onKill !== undefined && hasTerminal;

  return (
    <div
      data-testid="sub-agent-run-list-shell-item"
      data-state={row.state}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        width: '100%',
        borderRadius: 8,
        border: '1px solid transparent',
        transition: 'background 140ms ease, border-color 140ms ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          padding: '6px 7px',
          flex: 1,
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              flexShrink: 0,
              background: STATUS_TONE_COLOR[resolveShellStateTone(row.state)],
              boxShadow:
                row.state === 'running'
                  ? '0 0 0 2px color-mix(in oklch, var(--accent) 16%, transparent)'
                  : 'none',
              animation:
                row.state === 'running' ? 'sub-agent-pulse 1.5s ease-in-out infinite' : 'none',
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--fg-default)',
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
            title={command}
          >
            {command}
          </span>
          <span
            style={{
              ...getShellStatusStyle(row.state),
              fontSize: 7.5,
              fontWeight: 700,
              padding: '0 4px',
              borderRadius: 999,
              lineHeight: '14px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {formatTaskStateLabel(row.state)}
          </span>
        </div>
        {shortTerminalId.length > 0 && (
          <div
            style={{
              paddingLeft: 12,
              fontSize: 8.5,
              color: 'var(--fg-muted)',
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={terminalId}
          >
            {shortTerminalId}
          </div>
        )}
      </div>
      {(showPreview || showKill) && (
        <div className="sub-agent-run-item__actions">
          {showPreview && (
            <button
              type="button"
              className="sub-agent-run-item__action"
              aria-label={`查看后台命令 ${terminalId}`}
              title="查看该后台命令的输出"
              onClick={onPreview}
            >
              查看
            </button>
          )}
          {showKill && (
            <button
              type="button"
              className="sub-agent-run-item__action sub-agent-run-item__action--danger"
              disabled={pendingKill}
              aria-busy={pendingKill}
              aria-label={`终止后台命令 ${terminalId}`}
              title={pendingKill ? '正在终止该后台命令' : '终止该后台命令'}
              onClick={onKill}
            >
              {pendingKill ? '终止中' : '终止'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 折叠状态的持久化键。这是**视图偏好**（不是会话数据），全局记忆：
 * 无记录时默认展开（首次见到列表即展开）；存储不可用时静默回落，不阻塞交互。
 */
const COLLAPSED_STORAGE_KEY = 'chat.subagentRunList.collapsed';

function readCollapsedPreference(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    /* swallow — 隐私模式 / 沙箱下不可读，回落默认展开 */
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* swallow — 仅保留内存态，不影响本次交互 */
  }
}

/** 分组标题（两组共存时才出现）：弱化的小号标签，计数与标题同一文本节点便于读取。 */
const GROUP_HEADER_STYLE: React.CSSProperties = {
  padding: '4px 7px 2px',
  fontSize: 8.5,
  fontWeight: 800,
  letterSpacing: '0.04em',
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

export function SubAgentRunList({
  items,
  selectedSessionId,
  onSelectSession,
  onStopSession,
  stoppingSessionIds,
  shellItems,
  onPreviewShell,
  onKillShell,
  pendingKillShellIds,
}: {
  items: SubAgentRunItem[];
  onSelectSession: (sessionId: string) => void;
  selectedSessionId: string | null;
  onStopSession?: (sessionId: string) => void;
  stoppingSessionIds?: ReadonlySet<string>;
  /** 后台命令行（调用方保证只含 `kind === 'shell'`）；不传时行为与「仅子代理」现状一致。 */
  shellItems?: readonly BackgroundTaskRow[];
  onPreviewShell?: (terminalId: string) => void;
  onKillShell?: (terminalId: string) => void;
  /** 终止在途的 terminalId 集合：命中时禁用「终止」并显示「终止中」。 */
  pendingKillShellIds?: ReadonlySet<string>;
}) {
  // 折叠状态：默认展开（首访）/ 记忆上次选择（刷新与重新挂载后保持）。
  // 折叠时收起卡片列表，表头收缩为迷你胶囊（箭头 + 总数 + 活跃提示），
  // 让出消息区空间的同时保留「有后台任务在跑」的可见性。
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  // 终止后台命令是破坏性操作：与完整面板 / 常驻胶囊共用同一确认弹窗（禁止各自实现一套）。
  const [pendingConfirm, setPendingConfirm] = useState<BackgroundTaskPendingConfirm | null>(null);
  const listId = useId();

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsedPreference(next);
  };

  const shells = shellItems ?? [];

  // 浮动栏的显示条件：只要有任何子代理（含已完成 / 失败 / 取消的历史子代理）或后台命令
  // 就在主对话区左侧悬浮显示，方便随时跳查。子代理判断已经在 `buildSubAgentRunItems`
  // 阶段剔除了「自己」，所以这里的 items.length === 0 直接代表「本会话没有派发过
  // 子代理」；两者皆空时不渲染（对应需求：「没开启子代理就不应该显示」）。
  if (items.length === 0 && shells.length === 0) {
    return null;
  }

  // 活跃口径：子代理沿用既有 `isActiveStatus`（running / paused），命令只算运行中。
  const running = activeCount(items);
  const runningShells = shells.filter((row) => row.state === 'running').length;
  const activeTotal = running + runningShells;
  const hasShells = shells.length > 0;
  const hasSubAgents = items.length > 0;
  // 单组时不渲染分组标题：表头本身即组标题，保持既有观感；两组共存才需要分区。
  const showGroupHeaders = hasSubAgents && hasShells;
  const railTitle = showGroupHeaders ? '后台任务' : hasShells ? '后台命令' : '子代理';
  const toggleLabel = collapsed ? `展开${railTitle}列表` : `折叠${railTitle}列表`;

  const handleConfirm = () => {
    const pending = pendingConfirm;
    setPendingConfirm(null);
    if (pending === null || pending.kind !== 'kill-shell') {
      return;
    }
    onKillShell?.(pending.terminalId);
  };

  return (
    <section
      aria-label={hasShells ? '后台任务运行列表' : '子代理运行列表'}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        // 折叠后容器高度收缩为表头高度、宽度收缩为内容宽（迷你胶囊），
        // 避免占满整列、遮挡消息区点击。
        bottom: collapsed ? 'auto' : 0,
        width: collapsed ? 'auto' : 200,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 0 12px 8px',
        overflowY: collapsed ? 'visible' : 'auto',
        scrollbarWidth: 'thin',
        pointerEvents: 'auto',
        background: 'transparent',
      }}
    >
      <style>{`
        @keyframes sub-agent-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        /*
         * 默认视觉属性放在类里（而不是内联 style）：内联样式的优先级高于
         * :hover 规则，若把 background / color 写在内联，hover 会被静默覆盖。
         */
        .sub-agent-run-list__toggle {
          background: transparent;
          color: var(--fg-muted);
          transition: background 140ms ease, color 140ms ease;
        }
        .sub-agent-run-list__toggle:hover {
          background: var(--bg-hover);
          color: var(--fg-default);
        }
        .sub-agent-run-list__toggle:active {
          transform: translateY(1px);
        }
        .sub-agent-run-list__toggle:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px var(--accent-subtle);
        }
        .sub-agent-run-item__select:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          border-radius: 8px;
        }
        .sub-agent-run-item__stop {
          flex-shrink: 0;
          margin: 6px 7px 0 0;
          padding: 1px 6px;
          border-radius: 999px;
          border: 1px solid var(--danger-border);
          background: var(--danger-muted);
          color: var(--danger);
          font-size: 8.5px;
          font-weight: 700;
          line-height: 14px;
          white-space: nowrap;
          cursor: pointer;
          transition: background 140ms ease, border-color 140ms ease;
        }
        .sub-agent-run-item__stop:hover:not(:disabled) {
          background: color-mix(in oklch, var(--danger) 20%, transparent);
          border-color: color-mix(in oklch, var(--danger) 45%, transparent);
        }
        .sub-agent-run-item__stop:active:not(:disabled) {
          transform: translateY(1px);
        }
        .sub-agent-run-item__stop:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px var(--accent-subtle);
        }
        .sub-agent-run-item__stop:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        /*
         * 命令行动作（查看 / 终止）：与子代理「停止」同属行内动作按钮，
         * 默认态放类里、hover / active / focus 齐备（禁止裸样式按钮）。
         */
        .sub-agent-run-item__actions {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
          flex-shrink: 0;
          margin: 6px 7px 0 0;
        }
        .sub-agent-run-item__action {
          padding: 1px 6px;
          border-radius: 999px;
          border: 1px solid var(--border-default);
          background: transparent;
          color: var(--fg-default);
          font-size: 8.5px;
          font-weight: 700;
          line-height: 14px;
          white-space: nowrap;
          cursor: pointer;
          transition: background 140ms ease, border-color 140ms ease;
        }
        .sub-agent-run-item__action:hover:not(:disabled) {
          background: var(--bg-hover);
          border-color: var(--border-strong);
        }
        .sub-agent-run-item__action:active:not(:disabled) {
          transform: translateY(1px);
        }
        .sub-agent-run-item__action:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px var(--accent-subtle);
        }
        .sub-agent-run-item__action:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .sub-agent-run-item__action--danger {
          border-color: var(--danger-border);
          background: var(--danger-muted);
          color: var(--danger);
        }
        .sub-agent-run-item__action--danger:hover:not(:disabled) {
          background: color-mix(in oklch, var(--danger) 20%, transparent);
          border-color: color-mix(in oklch, var(--danger) 45%, transparent);
        }
      `}</style>
      <button
        type="button"
        className="sub-agent-run-list__toggle"
        aria-expanded={!collapsed}
        aria-controls={listId}
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={toggleCollapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 7px 6px',
          width: collapsed ? 'auto' : '100%',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 150ms ease',
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {!collapsed && (
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: 'var(--fg-default)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {railTitle}
          </div>
        )}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 5px',
            borderRadius: 999,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-overlay)',
            fontSize: 8,
            fontWeight: 700,
            color: 'var(--fg-muted)',
          }}
        >
          {items.length + shells.length}
        </span>
        {activeTotal > 0 &&
          (collapsed ? (
            // 折叠态不显示「N 活跃」，改为「后台 N 运行中」小胶囊（脉冲点 + 文案），
            // title 保留「N 个运行中」的悬停提示；无活跃项时该胶囊整体不渲染。
            <span
              title={`${activeTotal} 个运行中`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '0 5px',
                borderRadius: 999,
                border: '1px solid color-mix(in oklch, var(--accent) 36%, var(--border-subtle))',
                background: 'color-mix(in oklch, var(--accent) 14%, var(--bg-overlay))',
                fontSize: 8,
                fontWeight: 700,
                color: 'var(--accent)',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: 'sub-agent-pulse 1.5s ease-in-out infinite',
                  flexShrink: 0,
                }}
              />
              后台 {activeTotal} 运行中
            </span>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '0 5px',
                borderRadius: 999,
                border: '1px solid color-mix(in oklch, var(--accent) 36%, var(--border-subtle))',
                background: 'color-mix(in oklch, var(--accent) 14%, var(--bg-overlay))',
                fontSize: 8,
                fontWeight: 700,
                color: 'var(--accent)',
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: 'sub-agent-pulse 1.5s ease-in-out infinite',
                }}
              />
              {activeTotal} 活跃
            </span>
          ))}
      </button>

      <div
        id={listId}
        style={{
          display: collapsed ? 'none' : 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {showGroupHeaders && (
          <div
            data-testid="sub-agent-run-list-group-header"
            data-group="subagent"
            style={GROUP_HEADER_STYLE}
          >
            子代理 {items.length}
          </div>
        )}
        {items.map((item) => (
          <SubAgentItemCard
            key={item.sessionId}
            item={item}
            selected={item.sessionId === selectedSessionId}
            onSelect={() => onSelectSession(item.sessionId)}
            {...(onStopSession ? { onStop: () => onStopSession(item.sessionId) } : {})}
            stopping={stoppingSessionIds?.has(item.sessionId) ?? false}
          />
        ))}
        {showGroupHeaders && (
          <div
            data-testid="sub-agent-run-list-group-header"
            data-group="shell"
            style={{ ...GROUP_HEADER_STYLE, marginTop: 4 }}
          >
            后台命令 {shells.length}
          </div>
        )}
        {shells.map((row) => (
          <ShellItemCard
            key={row.key}
            row={row}
            pendingKill={pendingKillShellIds?.has(row.terminalId ?? '') ?? false}
            {...(onPreviewShell ? { onPreview: () => onPreviewShell(row.terminalId ?? '') } : {})}
            {...(onKillShell
              ? {
                  onKill: () =>
                    setPendingConfirm({
                      kind: 'kill-shell',
                      terminalId: row.terminalId ?? '',
                      command: row.command ?? row.title,
                    }),
                }
              : {})}
          />
        ))}
      </div>

      <BackgroundTaskConfirmDialog
        pending={pendingConfirm}
        onConfirm={handleConfirm}
        onDismiss={() => setPendingConfirm(null)}
      />
    </section>
  );
}
