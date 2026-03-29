import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

interface SessionTodoItem {
  content: string;
  lane?: 'main' | 'temp';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

type SessionTodoLane = 'main' | 'temp';

interface TodoTone {
  background: string;
  border: string;
  color: string;
}

const STATUS_META: Record<
  SessionTodoItem['status'],
  {
    label: string;
    marker: string;
    rowBackground: string;
    rowBorder: string;
    tone: TodoTone;
  }
> = {
  pending: {
    label: '待开始',
    marker: '○',
    rowBorder: '1px solid var(--border-subtle)',
    rowBackground: 'color-mix(in oklch, var(--surface) 90%, var(--bg-2) 10%)',
    tone: {
      border: '1px solid var(--border)',
      color: 'var(--text-3)',
      background: 'color-mix(in srgb, var(--surface) 72%, transparent)',
    },
  },
  in_progress: {
    label: '进行中',
    marker: '◐',
    rowBorder: '1px solid color-mix(in oklch, var(--accent) 16%, var(--border) 84%)',
    rowBackground: 'color-mix(in oklch, var(--accent) 5%, var(--surface) 95%)',
    tone: {
      border: '1px solid color-mix(in srgb, #38bdf8 38%, var(--border))',
      color: '#7dd3fc',
      background: 'color-mix(in srgb, #38bdf8 10%, transparent)',
    },
  },
  completed: {
    label: '已完成',
    marker: '●',
    rowBorder: '1px solid var(--border-subtle)',
    rowBackground: 'color-mix(in oklch, var(--surface) 88%, var(--bg-2) 12%)',
    tone: {
      border: '1px solid color-mix(in srgb, #34d399 40%, var(--border))',
      color: '#86efac',
      background: 'color-mix(in srgb, #34d399 10%, transparent)',
    },
  },
  cancelled: {
    label: '已取消',
    marker: '△',
    rowBorder: '1px solid var(--border-subtle)',
    rowBackground: 'color-mix(in oklch, var(--surface) 88%, var(--bg-2) 12%)',
    tone: {
      border: '1px solid color-mix(in srgb, #f59e0b 45%, var(--border))',
      color: '#fcd34d',
      background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
    },
  },
};

const PRIORITY_META: Record<
  SessionTodoItem['priority'],
  {
    label: string;
    tone: TodoTone;
  }
> = {
  high: {
    label: '高优先级',
    tone: {
      border: '1px solid color-mix(in srgb, var(--danger) 40%, var(--border))',
      color: 'color-mix(in oklch, var(--danger) 88%, white 12%)',
      background: 'color-mix(in oklch, var(--danger) 10%, transparent)',
    },
  },
  medium: {
    label: '中优先级',
    tone: {
      border: '1px solid var(--border-subtle)',
      color: 'var(--text-2)',
      background: 'color-mix(in oklch, var(--surface) 84%, var(--bg-2) 16%)',
    },
  },
  low: {
    label: '低优先级',
    tone: {
      border: '1px solid var(--border-subtle)',
      color: 'var(--text-3)',
      background: 'transparent',
    },
  },
};

function createIconStyle(status: SessionTodoItem['status']): React.CSSProperties {
  const meta = STATUS_META[status];
  return {
    background: meta.tone.background,
    border: meta.tone.border,
    color: meta.tone.color,
  };
}

function createItemStyle(todo: SessionTodoItem): React.CSSProperties {
  const meta = STATUS_META[todo.status];
  return {
    background: meta.rowBackground,
    border: meta.rowBorder,
  };
}

function splitSessionTodosByLane(sessionTodos: SessionTodoItem[]): {
  mainTodos: SessionTodoItem[];
  tempTodos: SessionTodoItem[];
} {
  return {
    mainTodos: sessionTodos.filter((todo) => todo.lane !== 'temp'),
    tempTodos: sessionTodos.filter((todo) => todo.lane === 'temp'),
  };
}

function getLaneLabel(lane: SessionTodoLane): string {
  return lane === 'temp' ? '临时待办' : '主待办';
}

function getSummaryDescription(summary: {
  activeCount: number;
  cancelledCount: number;
  completedCount: number;
  inProgress?: SessionTodoItem;
  pendingCount: number;
  totalCount: number;
}): string {
  if (summary.inProgress) {
    return `正在进行：${summary.inProgress.content}`;
  }

  if (summary.pendingCount > 0) {
    if (summary.completedCount > 0) {
      return `${summary.pendingCount} 项待开始，${summary.completedCount} 项已完成`;
    }

    return `${summary.pendingCount} 项待开始`;
  }

  if (summary.completedCount === summary.totalCount) {
    return '当前待办已全部完成';
  }

  if (summary.cancelledCount === summary.totalCount) {
    return '当前待办已全部取消';
  }

  return `${summary.totalCount} 项待办已收尾`;
}

function getSummaryCountLabel(summary: {
  activeCount: number;
  cancelledCount: number;
  completedCount: number;
  totalCount: number;
}): string {
  if (summary.activeCount > 0) {
    return `${summary.activeCount} 活跃`;
  }

  if (summary.completedCount === summary.totalCount) {
    return '全部完成';
  }

  if (summary.cancelledCount === summary.totalCount) {
    return '全部取消';
  }

  return `${summary.totalCount} 项`;
}

function buildSummary(sessionTodos: SessionTodoItem[]) {
  const inProgress = sessionTodos.find((todo) => todo.status === 'in_progress');
  const pendingCount = sessionTodos.filter((todo) => todo.status === 'pending').length;
  const completedCount = sessionTodos.filter((todo) => todo.status === 'completed').length;
  const cancelledCount = sessionTodos.filter((todo) => todo.status === 'cancelled').length;
  const activeCount = sessionTodos.filter(
    (todo) => todo.status === 'pending' || todo.status === 'in_progress',
  ).length;
  const totalCount = sessionTodos.length;

  const summaryState: SessionTodoItem['status'] = inProgress
    ? 'in_progress'
    : activeCount > 0
      ? 'pending'
      : completedCount > 0
        ? 'completed'
        : 'cancelled';

  return {
    activeCount,
    cancelledCount,
    completedCount,
    description: getSummaryDescription({
      activeCount,
      cancelledCount,
      completedCount,
      inProgress,
      pendingCount,
      totalCount,
    }),
    pendingCount,
    summaryCountLabel: getSummaryCountLabel({
      activeCount,
      cancelledCount,
      completedCount,
      totalCount,
    }),
    summaryState,
    totalCount,
  };
}

export function ChatTodoBar(props: {
  editorMode: boolean;
  rightOpen: boolean;
  sessionTodos: SessionTodoItem[];
}) {
  const { editorMode, rightOpen, sessionTodos } = props;
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const previousTodoFingerprintRef = useRef<string | null>(null);

  const todoFingerprint = useMemo(
    () =>
      sessionTodos
        .map((todo) => `${todo.lane ?? 'main'}|${todo.content}|${todo.status}|${todo.priority}`)
        .join('||'),
    [sessionTodos],
  );

  const { mainTodos, tempTodos } = useMemo(
    () => splitSessionTodosByLane(sessionTodos),
    [sessionTodos],
  );

  useEffect(() => {
    if (previousTodoFingerprintRef.current === null) {
      previousTodoFingerprintRef.current = todoFingerprint;
      return;
    }

    if (previousTodoFingerprintRef.current !== todoFingerprint) {
      previousTodoFingerprintRef.current = todoFingerprint;
      setExpanded(false);
    }
  }, [todoFingerprint]);

  const summary = useMemo(() => buildSummary(sessionTodos), [sessionTodos]);
  const laneGroups = useMemo(
    () =>
      [
        { lane: 'main' as const, summary: buildSummary(mainTodos), todos: mainTodos },
        { lane: 'temp' as const, summary: buildSummary(tempTodos), todos: tempTodos },
      ].filter((group) => group.todos.length > 0),
    [mainTodos, tempTodos],
  );

  if (sessionTodos.length === 0) {
    return null;
  }

  return (
    <div className="chat-todo-shell">
      <div
        data-testid="chat-todo-bar"
        className="chat-todo-card"
        data-expanded={expanded ? 'true' : 'false'}
        style={{ maxWidth: editorMode ? 680 : rightOpen ? 700 : 740 }}
      >
        <button
          type="button"
          data-testid="chat-todo-toggle"
          className="chat-todo-toggle"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
        >
          <div className="chat-todo-summary-main">
            <span
              aria-hidden="true"
              className="chat-todo-summary-icon"
              style={createIconStyle(summary.summaryState)}
            >
              {STATUS_META[summary.summaryState].marker}
            </span>
            <div className="chat-todo-summary-copy">
              <div className="chat-todo-summary-head">
                <span className="chat-todo-summary-label">待办清单</span>
                <span aria-hidden="true" className="chat-todo-summary-separator">
                  ·
                </span>
                <span className="chat-todo-summary-description">{summary.description}</span>
              </div>
              <div className="chat-todo-summary-lanes">
                {laneGroups.map((group) => (
                  <span key={group.lane} className="chat-todo-summary-lane" data-lane={group.lane}>
                    <span className="chat-todo-summary-lane-label">{getLaneLabel(group.lane)}</span>
                    <span aria-hidden="true" className="chat-todo-summary-lane-separator">
                      ·
                    </span>
                    <span className="chat-todo-summary-lane-text">{group.summary.description}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="chat-todo-summary-side">
            <span className="chat-todo-count-pill">{summary.summaryCountLabel}</span>
            <span className="chat-todo-toggle-indicator" aria-hidden="true">
              {expanded ? '▴' : '▾'}
            </span>
          </div>
        </button>

        {expanded && (
          <section id={detailsId} className="chat-todo-panel" aria-label="会话待办详情">
            <div className="chat-todo-list-head">
              <span>{summary.totalCount} 项待办</span>
              <span>
                {summary.activeCount > 0
                  ? `${summary.activeCount} 项仍在推进`
                  : summary.completedCount > 0
                    ? '当前没有活跃待办'
                    : '当前没有可执行待办'}
              </span>
            </div>

            <div className="chat-todo-groups">
              {laneGroups.map((group) => (
                <section
                  key={group.lane}
                  className="chat-todo-lane-group"
                  data-lane={group.lane}
                  aria-label={getLaneLabel(group.lane)}
                >
                  <div className="chat-todo-lane-head">
                    <span className="chat-todo-lane-title">{getLaneLabel(group.lane)}</span>
                    <span className="chat-todo-lane-count">{group.summary.summaryCountLabel}</span>
                  </div>

                  <div className="chat-todo-list">
                    {group.todos.map((todo, index) => {
                      const isDone = todo.status === 'completed' || todo.status === 'cancelled';
                      const statusMeta = STATUS_META[todo.status];
                      const priorityMeta = PRIORITY_META[todo.priority];

                      return (
                        <div
                          key={`${group.lane}-${todo.content}-${index}`}
                          className="chat-todo-item"
                          data-done={isDone ? 'true' : 'false'}
                          data-active={todo.status === 'in_progress' ? 'true' : 'false'}
                          style={createItemStyle(todo)}
                        >
                          <span
                            aria-hidden="true"
                            className="chat-todo-item-marker"
                            style={{ color: statusMeta.tone.color }}
                          >
                            {statusMeta.marker}
                          </span>

                          <div className="chat-todo-item-main">
                            <div className="chat-todo-item-title">{todo.content}</div>
                            <div className="chat-todo-item-meta">
                              <span className="chat-todo-status-pill" style={statusMeta.tone}>
                                {statusMeta.label}
                              </span>
                              <span className="chat-todo-priority-pill" style={priorityMeta.tone}>
                                {priorityMeta.label}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
