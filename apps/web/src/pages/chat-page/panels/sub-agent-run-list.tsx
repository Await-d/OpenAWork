import React from 'react';
import type { Session, SessionTask } from '@openAwork/web-client';
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

function getStatusStyle(status: SubAgentRunStatus): React.CSSProperties {
  if (status === 'running') {
    return {
      background: 'color-mix(in oklch, var(--accent) 18%, var(--bg-overlay))',
      border: '1px solid color-mix(in oklch, var(--accent) 42%, var(--border-default))',
      color: 'var(--accent)',
    };
  }

  if (status === 'paused') {
    return {
      background: 'color-mix(in srgb, var(--warning) 10%, var(--bg-overlay))',
      border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border-default))',
      color: 'var(--warning)',
    };
  }

  if (status === 'completed') {
    return {
      background: 'color-mix(in srgb, var(--success) 12%, var(--bg-overlay))',
      border: '1px solid color-mix(in srgb, var(--success) 35%, var(--border-default))',
      color: 'var(--success)',
    };
  }

  if (status === 'failed' || status === 'cancelled') {
    return {
      background: 'color-mix(in srgb, var(--danger) 10%, var(--bg-overlay))',
      border: '1px solid color-mix(in srgb, var(--danger) 30%, var(--border-default))',
      color: 'var(--danger)',
    };
  }

  if (status === 'ended') {
    return {
      background: 'var(--bg-overlay)',
      border: '1px solid var(--border-subtle)',
      color: 'var(--fg-muted)',
    };
  }

  return {
    background: 'color-mix(in srgb, var(--warning) 10%, var(--bg-overlay))',
    border: '1px solid color-mix(in srgb, var(--warning) 30%, var(--border-default))',
    color: 'var(--warning)',
  };
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

function shouldShowTaskLabel(item: SubAgentRunItem): boolean {
  return item.taskLabel.trim().length > 0 && item.taskLabel.trim() !== item.title.trim();
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

export function SubAgentRunList({
  items,
  selectedSessionId,
  onSelectSession,
  onStopSession,
  stoppingSessionIds,
}: {
  items: SubAgentRunItem[];
  onSelectSession: (sessionId: string) => void;
  selectedSessionId: string | null;
  onStopSession?: (sessionId: string) => void;
  stoppingSessionIds?: ReadonlySet<string>;
}) {
  // 浮动栏的显示条件：只要有任何子代理（含已完成 / 失败 / 取消的历史子代理）
  // 就在主对话区左侧悬浮显示，方便随时跳查。判断已经在 `buildSubAgentRunItems`
  // 阶段剔除了「自己」，所以这里的 items.length === 0 直接代表「本会话没有派发过
  // 子代理」，对应需求：「如果子代理下中的对话没有开启子代理就不应该显示」。
  if (items.length === 0) {
    return null;
  }

  const running = activeCount(items);

  return (
    <section
      aria-label="子代理运行列表"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 200,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 0 12px 8px',
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        pointerEvents: 'auto',
        background: 'transparent',
      }}
    >
      <style>{`
        @keyframes sub-agent-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
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
      `}</style>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '0 7px 6px',
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: 'var(--fg-default)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            子代理
          </div>
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
            {items.length}
          </span>
          {running > 0 && (
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
              {running} 活跃
            </span>
          )}
        </div>

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
      </div>
    </section>
  );
}
