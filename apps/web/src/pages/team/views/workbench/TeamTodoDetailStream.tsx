/**
 * TeamTodoDetailStream · 任务详情消息流
 *
 * 顶部 context（层/角色/状态/标题），下方消息列表简版；
 * 无消息时展示「暂无该任务明细消息」；可选消息过滤 all/dialog/tool/error/handoff。
 * 默认只渲染最近 50 条，上滑到顶部自动加载更早消息（与 MultiLayerFeed 一致）。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from 'react';

/* ─── props types ─── */

export interface TeamTodoDetailMessage {
  readonly id: string;
  readonly role?: string;
  readonly who?: string;
  readonly when?: string;
  readonly text: string;
  readonly tags?: readonly string[];
}

export interface TeamTodoDetailStreamTodo {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly layerName?: string;
  readonly layerColor?: string;
  readonly roleName?: string;
  readonly status: string;
}

export type MsgFilterKey = 'all' | 'dialog' | 'tool' | 'error' | 'handoff';

export interface TeamTodoDetailStreamProps {
  readonly todo: TeamTodoDetailStreamTodo | null;
  readonly messages?: readonly TeamTodoDetailMessage[];
  readonly msgFilter?: MsgFilterKey;
  readonly onMsgFilterChange?: (filter: MsgFilterKey) => void;
}

/* ─── constants ─── */

const MSG_FILTER_OPTIONS: ReadonlyArray<{ key: MsgFilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'dialog', label: '对话' },
  { key: 'tool', label: '工具' },
  { key: 'error', label: '错误' },
  { key: 'handoff', label: '交接' },
];

/** 默认只展示最近 50 条，与 team 对话流一致。 */
const INITIAL_VISIBLE_MESSAGE_COUNT = 50;
const LOAD_MORE_BATCH_SIZE = 50;
const LOAD_MORE_SCROLL_THRESHOLD_PX = 48;

/* ─── helpers ─── */

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return '等待';
    case 'running':
      return '运行中';
    case 'blocked':
      return '阻塞';
    case 'done':
      return '完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'var(--success)';
    case 'blocked':
      return 'var(--warning)';
    case 'failed':
      return 'var(--error, var(--warning))';
    case 'done':
      return 'var(--fg-subtle)';
    default:
      return 'var(--fg-muted)';
  }
}

function tagColor(tag: string): string {
  switch (tag) {
    case 'error':
    case 'fail':
      return 'var(--error, var(--warning))';
    case 'tool':
      return 'var(--accent)';
    case 'handoff':
      return 'var(--warning)';
    case 'dialog':
      return 'var(--fg-muted)';
    default:
      return 'var(--fg-subtle)';
  }
}

function msgMatchesFilter(msg: TeamTodoDetailMessage, filter: MsgFilterKey): boolean {
  if (filter === 'all') return true;
  return msg.tags?.includes(filter) ?? false;
}

/* ─── inline styles ─── */

const wrapperStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  minHeight: 0,
  overflow: 'hidden',
  height: '100%',
};

const contextBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  fontSize: 11,
  flexShrink: 0,
  flexWrap: 'wrap',
  borderBottom: '1px solid var(--border-default)',
  background: 'var(--bg-base)',
};

const contextBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 20,
  padding: '0 7px',
  borderRadius: 0,
  border: '1px solid var(--border-default)',
  fontSize: 10.5,
  fontWeight: 650,
  color: 'var(--fg-muted)',
  background: 'transparent',
};

const dotBase: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  flexShrink: 0,
};

const filterRow: CSSProperties = {
  display: 'flex',
  gap: 0,
  padding: 0,
  flexShrink: 0,
  borderBottom: '1px solid var(--border-default)',
  background: 'var(--bg-base)',
};

const filterChip = (isActive: boolean): CSSProperties => ({
  minHeight: 22,
  padding: '0 8px',
  borderRadius: 0,
  border: 'none',
  borderRight: '1px solid var(--border-default)',
  background: isActive ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-base))' : 'transparent',
  color: isActive ? 'var(--fg-strong, var(--fg-default))' : 'var(--fg-muted)',
  fontSize: 10.5,
  fontWeight: 650,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

const messageList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
  scrollbarWidth: 'thin',
  scrollbarColor: 'var(--border-default) transparent',
};

const messageRow: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '7px 10px',
  borderRadius: 0,
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 70%, transparent)',
  background: 'transparent',
  fontSize: 12,
  lineHeight: 1.45,
};

const messageMeta: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 10.5,
  color: 'var(--fg-faint, var(--fg-subtle))',
};

const emptyState: CSSProperties = {
  padding: '20px 10px',
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--fg-faint, var(--fg-subtle))',
};

const loadMoreHintStyle: CSSProperties = {
  padding: '6px 10px',
  textAlign: 'center',
  fontSize: 10.5,
  color: 'var(--fg-subtle)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 70%, transparent)',
  flexShrink: 0,
};

const windowSummaryStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 10,
  color: 'var(--fg-subtle)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 70%, transparent)',
  flexShrink: 0,
  background: 'var(--bg-base)',
};

/* ─── component ─── */

export function TeamTodoDetailStream({
  todo,
  messages = [],
  msgFilter = 'all',
  onMsgFilterChange,
}: TeamTodoDetailStreamProps) {
  const effectiveFilter = msgFilter;
  const filtered = useMemo(
    () => messages.filter((m) => msgMatchesFilter(m, effectiveFilter)),
    [messages, effectiveFilter],
  );

  const totalCount = filtered.length;
  const listRef = useRef<HTMLDivElement | null>(null);
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const historyExpansionRef = useRef(false);
  const previousTotalCountRef = useRef(0);
  const previousTodoIdRef = useRef<string | null>(todo?.id ?? null);
  const previousFilterRef = useRef(effectiveFilter);

  const [visibleStartIndex, setVisibleStartIndex] = useState(() =>
    Math.max(totalCount - INITIAL_VISIBLE_MESSAGE_COUNT, 0),
  );

  // todo / filter 切换时重置窗口
  useEffect(() => {
    const todoChanged = previousTodoIdRef.current !== (todo?.id ?? null);
    const filterChanged = previousFilterRef.current !== effectiveFilter;
    previousTodoIdRef.current = todo?.id ?? null;
    previousFilterRef.current = effectiveFilter;

    if (todoChanged || filterChanged) {
      historyExpansionRef.current = false;
      setVisibleStartIndex(Math.max(totalCount - INITIAL_VISIBLE_MESSAGE_COUNT, 0));
      previousTotalCountRef.current = totalCount;
    }
  }, [todo?.id, effectiveFilter, totalCount]);

  // 消息总数变化：未展开历史时贴齐最新 50 条
  useEffect(() => {
    const nextDefaultStart = Math.max(totalCount - INITIAL_VISIBLE_MESSAGE_COUNT, 0);
    const prevTotal = previousTotalCountRef.current;

    if (totalCount < prevTotal) {
      historyExpansionRef.current = false;
      setVisibleStartIndex(nextDefaultStart);
    } else if (totalCount > prevTotal && !historyExpansionRef.current) {
      setVisibleStartIndex(nextDefaultStart);
    }

    previousTotalCountRef.current = totalCount;
  }, [totalCount]);

  const visibleMessages = useMemo(
    () => filtered.slice(visibleStartIndex),
    [filtered, visibleStartIndex],
  );

  const hasHiddenHistory = visibleStartIndex > 0;
  const visibleRenderedCount = visibleMessages.length;

  const loadOlderMessages = useCallback(() => {
    if (visibleStartIndex <= 0 || prependAnchorRef.current) {
      return;
    }
    const el = listRef.current;
    if (!el) return;
    prependAnchorRef.current = {
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    };
    historyExpansionRef.current = true;
    setVisibleStartIndex((current) => Math.max(0, current - LOAD_MORE_BATCH_SIZE));
  }, [visibleStartIndex]);

  // 锚点恢复：加载更多后保持滚动位置
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const el = listRef.current;
    if (!anchor || !el) return;
    const delta = el.scrollHeight - anchor.scrollHeight;
    el.scrollTop = anchor.scrollTop + delta;
    prependAnchorRef.current = null;
  }, [visibleMessages]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      if (el.scrollTop <= LOAD_MORE_SCROLL_THRESHOLD_PX) {
        loadOlderMessages();
      }
    },
    [loadOlderMessages],
  );

  const windowSummary = hasHiddenHistory
    ? `已显示最近 ${visibleRenderedCount} / ${totalCount} 条消息`
    : totalCount > 0
      ? `共 ${totalCount} 条消息`
      : null;

  return (
    <section style={wrapperStyle} aria-label="任务详情">
      {/* context */}
      {todo ? (
        <div style={contextBar}>
          {todo.layerName && (
            <span
              style={{ ...contextBadge, borderColor: todo.layerColor ?? 'var(--border-default)' }}
            >
              <span
                style={{ ...dotBase, background: todo.layerColor ?? 'var(--fg-muted)' }}
                aria-hidden="true"
              />
              {todo.layerName}
            </span>
          )}

          {todo.roleName && <span style={contextBadge}>{todo.roleName}</span>}

          <span style={contextBadge}>
            <span style={{ ...dotBase, background: statusColor(todo.status) }} aria-hidden="true" />
            {statusLabel(todo.status)}
          </span>

          <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--fg-default)' }}>
            {todo.key}
          </span>
          <span style={{ fontSize: 12, color: 'var(--fg-default)' }}>{todo.title}</span>
        </div>
      ) : (
        <div style={{ ...emptyState, padding: '16px 0' }}>请选择一个任务查看详情</div>
      )}

      {/* message filter row */}
      {onMsgFilterChange && (
        <div style={filterRow} role="group" aria-label="消息类型过滤">
          {MSG_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              aria-pressed={effectiveFilter === opt.key}
              style={filterChip(effectiveFilter === opt.key)}
              onClick={() => onMsgFilterChange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {windowSummary ? <div style={windowSummaryStyle}>{windowSummary}</div> : null}

      {/* message list */}
      {filtered.length === 0 ? (
        <div style={emptyState} aria-label="暂无消息">
          暂无该任务明细消息
        </div>
      ) : (
        <div
          ref={listRef}
          style={messageList}
          onScroll={handleScroll}
          role="log"
          aria-label="任务明细消息"
        >
          {hasHiddenHistory ? (
            <div style={loadMoreHintStyle}>
              上滑继续加载更早 {Math.min(LOAD_MORE_BATCH_SIZE, visibleStartIndex)} 条
            </div>
          ) : null}

          {visibleMessages.map((msg) => (
            <div key={msg.id} style={messageRow}>
              <div style={messageMeta}>
                {msg.role && <span style={{ fontWeight: 600 }}>{msg.role}</span>}
                {msg.who && <span>{msg.who}</span>}
                {msg.when && <span style={{ marginLeft: 'auto' }}>{msg.when}</span>}
              </div>

              <div style={{ color: 'var(--fg-default)', whiteSpace: 'pre-wrap' }}>{msg.text}</div>

              {msg.tags && msg.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                  {msg.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 4,
                        border: `1px solid ${tagColor(tag)}`,
                        color: tagColor(tag),
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
