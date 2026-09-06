/**
 * TeamTodoListPanel · 任务列表面板
 *
 * 列表项显示 key/title/sub/status/priority/time；
 * filter chips: all/active/blocked/done；空态文案。
 */

import type { CSSProperties, ChangeEvent } from 'react';

export type TodoFilterKey = 'all' | 'active' | 'blocked' | 'done';

export interface TeamTodoListItem {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly sub?: string;
  readonly status: 'pending' | 'running' | 'blocked' | 'done' | 'failed' | string;
  readonly priority?: 'critical' | 'high' | 'medium' | 'low' | string;
  readonly time?: string;
}

export interface TeamTodoListPanelProps {
  readonly todos: readonly TeamTodoListItem[];
  readonly activeTodoId: string | null;
  readonly filter: TodoFilterKey;
  readonly onFilterChange: (filter: TodoFilterKey) => void;
  readonly onSelectTodo: (todoId: string) => void;
}

const FILTER_OPTIONS: ReadonlyArray<{ key: TodoFilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'blocked', label: '阻塞' },
  { key: 'done', label: '已完成' },
];

/**
 * 列表层仅做展示兜底过滤。父层（view-model）已按 layer/role/filter 过滤时，
 * 传入的 todos 应已是最终结果；此处规则必须与 model 对齐，避免 failed 被「阻塞」滤掉。
 */
function filterMatch(todo: TeamTodoListItem, filter: TodoFilterKey): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'active':
      return todo.status === 'pending' || todo.status === 'running';
    case 'blocked':
      return todo.status === 'blocked' || todo.status === 'failed';
    case 'done':
      return todo.status === 'done';
    default:
      return true;
  }
}

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

function priorityColor(priority: string): string {
  switch (priority) {
    case 'critical':
      return 'var(--error, var(--warning))';
    case 'high':
      return 'var(--warning)';
    case 'medium':
      return 'var(--accent)';
    default:
      return 'var(--fg-subtle)';
  }
}

/* ─── inline styles ─── */

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  minHeight: 0,
  overflow: 'hidden',
  height: '100%',
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  gap: 0,
  padding: 0,
  flexShrink: 0,
  borderBottom: '1px solid var(--border-default)',
  background: 'var(--bg-base)',
};

const filterChipStyle = (isActive: boolean): CSSProperties => ({
  minHeight: 24,
  padding: '0 9px',
  borderRadius: 0,
  borderTop: 'none',
  borderBottom: 'none',
  borderLeft: 'none',
  borderRight: '1px solid var(--border-default)',
  background: isActive ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-base))' : 'transparent',
  color: isActive ? 'var(--fg-strong, var(--fg-default))' : 'var(--fg-muted)',
  fontSize: 10.5,
  fontWeight: 650,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
  scrollbarWidth: 'thin',
  scrollbarColor: 'var(--border-default) transparent',
};

const itemStyle = (isActive: boolean): CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '7px 10px',
  borderRadius: 6,
  borderTop: isActive ? '1px solid var(--border-default)' : '1px solid var(--border-subtle)',
  borderRight: isActive ? '1px solid var(--border-default)' : '1px solid var(--border-subtle)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 70%, transparent)',
  borderLeft: isActive ? '1px solid var(--border-default)' : '1px solid var(--border-subtle)',
  background: isActive ? 'var(--bg-raised)' : 'var(--bg-overlay)',
  boxShadow: isActive ? 'var(--shadow-md)' : 'none',
  cursor: 'pointer',
});

const itemHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  lineHeight: 1.4,
};

const statusDot: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  flexShrink: 0,
};

const emptyStyle: CSSProperties = {
  padding: '24px 0',
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--fg-subtle)',
};

const monospace: CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 11,
  color: 'var(--fg-muted)',
};

const subTitleStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle)',
  lineHeight: 1.3,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '100%',
};

const timeStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 10,
  color: 'var(--fg-subtle)',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

/* ─── component ─── */

export function TeamTodoListPanel({
  todos,
  activeTodoId,
  filter,
  onFilterChange,
  onSelectTodo,
}: TeamTodoListPanelProps) {
  const filtered = todos.filter((t) => filterMatch(t, filter));

  return (
    <section style={panelStyle} aria-label="任务列表">
      {/* filter chips */}
      <div style={toolbarStyle} role="group" aria-label="任务筛选">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            aria-pressed={filter === opt.key}
            style={filterChipStyle(filter === opt.key)}
            onClick={() => onFilterChange(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* list */}
      {filtered.length === 0 ? (
        <div style={emptyStyle} aria-label="暂无任务">
          暂无符合条件的任务
        </div>
      ) : (
        <div style={listStyle}>
          {filtered.map((todo) => {
            const isActive = todo.id === activeTodoId;
            return (
              <button
                key={todo.id}
                type="button"
                aria-pressed={isActive}
                style={itemStyle(isActive)}
                onClick={() => onSelectTodo(todo.id)}
              >
                <div style={itemHeaderStyle}>
                  <span
                    style={{ ...statusDot, background: statusColor(todo.status) }}
                    aria-label={statusLabel(todo.status)}
                  />
                  <span style={monospace}>{todo.key}</span>
                  <span style={{ fontWeight: isActive ? 600 : 400, color: 'var(--fg-default)' }}>
                    {todo.title}
                  </span>

                  {todo.priority ? (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '0 4px',
                        borderRadius: 4,
                        border: `1px solid ${priorityColor(todo.priority)}`,
                        color: priorityColor(todo.priority),
                        flexShrink: 0,
                      }}
                    >
                      {todo.priority}
                    </span>
                  ) : null}

                  {todo.time ? <span style={timeStyle}>{todo.time}</span> : null}
                </div>

                {todo.sub ? (
                  <div style={subTitleStyle} title={todo.sub}>
                    {todo.sub}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
