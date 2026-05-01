/* ── TodoListPreview (todowrite / todoread family) ── */

export interface TodoLikeItem {
  content: string;
  status?: string;
  priority?: string;
  id?: string;
}

/**
 * Render a todowrite/subtodowrite todos array as a checklist instead of
 * dumping its JSON. Consumed by InlineToolCall's expand panel so users can
 * see exactly which items the model wrote on a given tick.
 */
export function TodoListPreview({ todos }: { todos: TodoLikeItem[] }) {
  const statusGlyph = (s: string | undefined): string => {
    if (s === 'completed') return '✓';
    if (s === 'in_progress') return '◐';
    if (s === 'cancelled') return '✗';
    return '○';
  };
  return (
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
