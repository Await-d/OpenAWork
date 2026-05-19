import { ParameterListPreview } from '../previews/parameter-list-preview.js';
import { type TodoLikeItem, TodoListPreview } from '../previews/todo-list-preview.js';

/**
 * Render a tool's input parameters expansion panel. Special-cases known
 * shapes (`todowrite.todos` → checklist) and falls back to a structured
 * key/value table for everything else (skill, MCP, lsp_, read, grep, ...).
 */
export function ToolInputPreview({
  toolName,
  input,
}: {
  toolName: string;
  input: Record<string, unknown>;
}) {
  const normalized = toolName.trim().toLowerCase();
  if ((normalized === 'todowrite' || normalized === 'subtodowrite') && Array.isArray(input.todos)) {
    return <TodoListPreview todos={input.todos as TodoLikeItem[]} />;
  }
  return <ParameterListPreview input={input} />;
}
