import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

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

// ---------------------------------------------------------------------------
// Hook：共享 expanded 状态 + 摘要计算（header bar / floating panel 同一份）。
// ---------------------------------------------------------------------------

export interface ChatTodoController {
  expanded: boolean;
  setExpanded: (next: boolean) => void;
  toggle: () => void;
  collapse: () => void;
  laneGroups: Array<{
    lane: SessionTodoLane;
    summary: ReturnType<typeof buildSummary>;
    todos: SessionTodoItem[];
  }>;
  summary: ReturnType<typeof buildSummary>;
  sessionTodos: SessionTodoItem[];
}

export function useChatTodoController(sessionTodos: SessionTodoItem[]): ChatTodoController {
  const [expanded, setExpanded] = useState(false);
  const previousFingerprintRef = useRef<string | null>(null);

  const fingerprint = useMemo(
    () =>
      sessionTodos
        .map((todo) => `${todo.lane ?? 'main'}|${todo.content}|${todo.status}|${todo.priority}`)
        .join('||'),
    [sessionTodos],
  );

  // 待办内容变化时自动收起浮层，避免用户看到"过时"展开内容。
  useEffect(() => {
    if (previousFingerprintRef.current === null) {
      previousFingerprintRef.current = fingerprint;
      return;
    }
    if (previousFingerprintRef.current !== fingerprint) {
      previousFingerprintRef.current = fingerprint;
      setExpanded(false);
    }
  }, [fingerprint]);

  const summary = useMemo(() => buildSummary(sessionTodos), [sessionTodos]);

  const laneGroups = useMemo(() => {
    const { mainTodos, tempTodos } = splitSessionTodosByLane(sessionTodos);
    return [
      { lane: 'main' as const, summary: buildSummary(mainTodos), todos: mainTodos },
      { lane: 'temp' as const, summary: buildSummary(tempTodos), todos: tempTodos },
    ].filter((group) => group.todos.length > 0);
  }, [sessionTodos]);

  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const collapse = useCallback(() => setExpanded(false), []);

  return { expanded, setExpanded, toggle, collapse, laneGroups, summary, sessionTodos };
}

// ---------------------------------------------------------------------------
// 内部辅助：与消息列内宽对齐。editor 分屏时收窄到 680，普通模式 768。
// ---------------------------------------------------------------------------

function getTodoMaxWidth(editorMode: boolean): number {
  return editorMode ? 680 : 768;
}

// ---------------------------------------------------------------------------
// ChatTopBar 内嵌入口（2+4 自适应方案）。
// - compact=false：完整摘要按钮 `◐ 进行中：xxx · 4 项 · ▾`
// - compact=true ：徽章按钮 `◐ 4`
// 是否 compact 由 ChatTopBar 用 ResizeObserver 测量自身宽度决定。
// 浮层 anchor 仍由 ChatTodoFloatingPanel 在 composer 上方挂载。
// ---------------------------------------------------------------------------

export function ChatTopBarTodoSlot(props: {
  controller: ChatTodoController;
  detailsId: string;
  compact: boolean;
}): React.ReactElement | null {
  const { controller, detailsId, compact } = props;
  const { expanded, toggle, summary, sessionTodos } = controller;

  if (sessionTodos.length === 0) {
    return null;
  }

  const marker = STATUS_META[summary.summaryState].marker;

  if (compact) {
    return (
      <button
        type="button"
        data-testid="chat-todo-header-toggle"
        className="chat-todo-topbar-badge"
        aria-expanded={expanded}
        aria-controls={detailsId}
        aria-label={`待办 ${summary.totalCount} 项,${summary.description}`}
        title={summary.description}
        onClick={toggle}
        data-active={expanded ? 'true' : 'false'}
      >
        <span
          aria-hidden="true"
          className="chat-todo-topbar-badge-icon"
          style={createIconStyle(summary.summaryState)}
        >
          {marker}
        </span>
        <span className="chat-todo-topbar-badge-count">
          {summary.activeCount > 0 ? summary.activeCount : summary.totalCount}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid="chat-todo-header-toggle"
      className="chat-todo-topbar-summary"
      aria-expanded={expanded}
      aria-controls={detailsId}
      onClick={toggle}
      data-active={expanded ? 'true' : 'false'}
    >
      <span
        aria-hidden="true"
        className="chat-todo-summary-icon"
        style={createIconStyle(summary.summaryState)}
      >
        {marker}
      </span>
      <span className="chat-todo-topbar-summary-text" title={summary.description}>
        {summary.description}
      </span>
      <span className="chat-todo-topbar-summary-count">{summary.summaryCountLabel}</span>
      <span className="chat-todo-topbar-summary-caret" aria-hidden="true">
        {expanded ? '▴' : '▾'}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 浮层（方案 A 展开 UI）。
// 由 SessionConversationView 在 composer 上方挂载，position: absolute。
// 父级容器需要是 position: relative。
// ---------------------------------------------------------------------------

const PRIORITY_GLYPH: Record<SessionTodoItem['priority'], string> = {
  high: '▲',
  medium: '',
  low: '▽',
};

export function ChatTodoFloatingPanel(props: {
  controller: ChatTodoController;
  detailsId: string;
  /**
   * 当浮层挂在 composer 上方（旧 anchor）时，传入 editorMode 让浮层最大宽度
   * 与消息列对齐。挂在 ChatTopBar 内部（顶部 popover）时无需传入。
   */
  editorMode?: boolean;
  /**
   * 顶部 popover 模式下,浮层用 fixed + getBoundingClientRect 计算位置,
   * 这样不会被 ChatTopBar 父级的 `overflow: hidden` 截断(我们把根容器
   * 改成 nowrap + overflow:hidden 是为了防止 chip 换行错位,代价是
   * absolute 子节点会被裁)。anchorRef 指向触发按钮(slot 行为),
   * 浮层贴在它的下方右对齐。
   */
  anchorRef?: React.RefObject<HTMLElement | null>;
}): React.ReactElement | null {
  const { controller, detailsId, editorMode, anchorRef } = props;
  const { expanded, collapse, summary, laneGroups, sessionTodos } = controller;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [fixedPosition, setFixedPosition] = useState<{ top: number; right: number } | null>(null);

  // 顶部 popover 模式下,根据 anchor 实时计算视口坐标。
  useEffect(() => {
    if (!expanded || editorMode !== undefined || !anchorRef?.current) {
      setFixedPosition(null);
      return;
    }
    const update = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setFixedPosition({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [expanded, editorMode, anchorRef]);

  // Esc 关闭。
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        collapse();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded, collapse]);

  // 点击浮层外部关闭。点击 header bar 上的按钮交给 toggle 处理。
  useEffect(() => {
    if (!expanded) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      // header bar 自己会 toggle，不在这里关闭。
      const headerToggle = (target as HTMLElement).closest?.(
        '[data-testid="chat-todo-header-toggle"]',
      );
      if (headerToggle) return;
      collapse();
    };
    window.addEventListener('mousedown', onPointer, true);
    return () => window.removeEventListener('mousedown', onPointer, true);
  }, [expanded, collapse]);

  if (!expanded || sessionTodos.length === 0) {
    return null;
  }

  const showLaneTitles = laneGroups.length > 1;

  return (
    <div
      ref={panelRef}
      id={detailsId}
      className="chat-todo-floating-panel"
      role="dialog"
      aria-label="会话待办详情"
      data-testid="chat-todo-floating-panel"
      data-anchor={editorMode === undefined ? 'topbar' : 'composer'}
      style={
        editorMode === undefined
          ? // 顶部 popover 模式:fixed 定位,通过 anchor 计算的视口坐标
            // 摆放,绕开 ChatTopBar 的 overflow:hidden 截断。
            fixedPosition
            ? {
                position: 'fixed',
                top: fixedPosition.top,
                right: fixedPosition.right,
              }
            : undefined
          : { maxWidth: getTodoMaxWidth(editorMode) }
      }
    >
      <div className="chat-todo-floating-head">
        <span className="chat-todo-floating-title">待办</span>
        <span className="chat-todo-floating-meta">
          {summary.totalCount} 项 · {summary.summaryCountLabel}
        </span>
        <button
          type="button"
          className="chat-todo-floating-close"
          onClick={collapse}
          aria-label="关闭待办浮层"
        >
          ✕
        </button>
      </div>

      <div className="chat-todo-floating-body">
        {laneGroups.map((group) => (
          <section
            key={group.lane}
            className="chat-todo-lane-block"
            data-lane={group.lane}
            aria-label={getLaneLabel(group.lane)}
          >
            {showLaneTitles ? (
              <header className="chat-todo-lane-row">
                <span className="chat-todo-lane-dot" data-lane={group.lane} aria-hidden="true" />
                <span className="chat-todo-lane-name">{getLaneLabel(group.lane)}</span>
                <span className="chat-todo-lane-stat">{group.summary.summaryCountLabel}</span>
              </header>
            ) : null}

            <ul className="chat-todo-rows">
              {group.todos.map((todo, index) => {
                const isDone = todo.status === 'completed' || todo.status === 'cancelled';
                const statusMeta = STATUS_META[todo.status];
                const priorityGlyph = PRIORITY_GLYPH[todo.priority];

                return (
                  <li
                    key={`${group.lane}-${todo.content}-${index}`}
                    className="chat-todo-row"
                    data-status={todo.status}
                    data-priority={todo.priority}
                    data-done={isDone ? 'true' : 'false'}
                    title={todo.content}
                  >
                    <span
                      aria-hidden="true"
                      className="chat-todo-row-marker"
                      style={{ color: statusMeta.tone.color }}
                    >
                      {statusMeta.marker}
                    </span>
                    <span className="chat-todo-row-title">{todo.content}</span>
                    {priorityGlyph ? (
                      <span
                        className="chat-todo-row-priority"
                        data-priority={todo.priority}
                        aria-label={`${todo.priority === 'high' ? '高' : '低'}优先级`}
                      >
                        {priorityGlyph}
                      </span>
                    ) : null}
                    <span className="chat-todo-row-status-label" aria-hidden="true">
                      {statusMeta.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 历史 API 兼容：旧的 ChatTodoBar（composer 上方折叠条 + 内联展开）。
// 当前布局已切换到 ChatTopBarTodoSlot + ChatTodoFloatingPanel；保留导出
// 是为了让外部消费方（若有）在过渡期不破坏。在 SessionConversationView 中
// 已不再使用此组件。
// ---------------------------------------------------------------------------

export function ChatTodoBar(props: {
  editorMode: boolean;
  rightOpen: boolean;
  sessionTodos: SessionTodoItem[];
}): React.ReactElement | null {
  const { editorMode, rightOpen, sessionTodos } = props;
  const controller = useChatTodoController(sessionTodos);
  const detailsId = useId();
  const { expanded, toggle, summary, laneGroups } = controller;

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
          onClick={toggle}
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
