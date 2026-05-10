/* ── TodoListPreview (todowrite / todoread family) ── */

export interface TodoLikeItem {
  content: string;
  status?: string;
  priority?: string;
  id?: string;
}

const STATUS_GLYPH: Record<string, string> = {
  completed: '✓',
  in_progress: '◐',
  cancelled: '✗',
  pending: '○',
};

function statusGlyph(status: string | undefined): string {
  return STATUS_GLYPH[status ?? 'pending'] ?? '○';
}

/**
 * Tally todos by status so the panel header can render a compact
 * "<glyph> <count> <label>" recap. Order is fixed (in_progress →
 * pending → completed → cancelled) so the eye learns one rhythm
 * across calls.
 */
function tallyTodos(todos: TodoLikeItem[]): {
  inProgress: number;
  pending: number;
  completed: number;
  cancelled: number;
} {
  let inProgress = 0;
  let pending = 0;
  let completed = 0;
  let cancelled = 0;
  for (const todo of todos) {
    switch (todo.status) {
      case 'in_progress':
        inProgress += 1;
        break;
      case 'completed':
        completed += 1;
        break;
      case 'cancelled':
        cancelled += 1;
        break;
      default:
        pending += 1;
    }
  }
  return { inProgress, pending, completed, cancelled };
}

/**
 * Render a todowrite/subtodowrite todos array as a checklist instead of
 * dumping its JSON. Consumed by InlineToolCall's expand panel so users can
 * see exactly which items the model wrote on a given tick. Wraps the list
 * in a soft panel container with a status-count summary header so the
 * collapsed pill (which already shows "N 项 · X 待办/Y 进行中") and the
 * expanded body share the same recap rhythm without the heavy uppercase
 * `参数 / 输出` section labels.
 */
export function TodoListPreview({ todos }: { todos: TodoLikeItem[] }) {
  const counts = tallyTodos(todos);
  return (
    <div className="tool-call-todo-panel">
      <div className="tool-call-todo-summary">
        <span className="tool-call-todo-summary-total">{todos.length} 项</span>
        {counts.inProgress > 0 && (
          <span className="tool-call-todo-summary-stat" data-status="in_progress">
            <span aria-hidden="true">◐</span> {counts.inProgress} 进行中
          </span>
        )}
        {counts.pending > 0 && (
          <span className="tool-call-todo-summary-stat" data-status="pending">
            <span aria-hidden="true">○</span> {counts.pending} 待办
          </span>
        )}
        {counts.completed > 0 && (
          <span className="tool-call-todo-summary-stat" data-status="completed">
            <span aria-hidden="true">✓</span> {counts.completed} 完成
          </span>
        )}
        {counts.cancelled > 0 && (
          <span className="tool-call-todo-summary-stat" data-status="cancelled">
            <span aria-hidden="true">✗</span> {counts.cancelled} 取消
          </span>
        )}
      </div>
      <ul className="tool-call-todo-list">
        {todos.map((todo, idx) => (
          <li
            key={todo.id ?? idx}
            className="tool-call-todo-item"
            data-status={todo.status ?? 'pending'}
          >
            <span className="tool-call-todo-glyph" aria-hidden="true">
              {statusGlyph(todo.status)}
            </span>
            <span className="tool-call-todo-content">{todo.content}</span>
            {todo.priority && (
              <span className="tool-call-todo-priority" data-priority={todo.priority}>
                {todo.priority}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Heuristically pull a `metadata.todos` array out of a tool output. Used by
 * the todoread/subtodoread/todowrite renderers to surface the post-execution
 * state of the todo lane without dumping the whole `{title, output, metadata}`
 * envelope as raw JSON.
 */
export function extractTodosFromOutput(output: unknown): TodoLikeItem[] | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const meta = record.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const todos = (meta as Record<string, unknown>).todos;
    if (Array.isArray(todos)) return todos as TodoLikeItem[];
  }
  // Fallback: some tools place the array on output.todos directly.
  const direct = record.todos;
  if (Array.isArray(direct)) return direct as TodoLikeItem[];
  return null;
}
