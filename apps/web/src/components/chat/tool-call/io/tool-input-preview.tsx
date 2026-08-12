import { ParameterListPreview } from '../previews/parameter-list-preview.js';
import { type TodoLikeItem, TodoListPreview } from '../previews/todo-list-preview.js';

/**
 * MCP 工具调用时的元数据字段，这些字段对用户无意义，只在输入预览中过滤
 */
const MCP_METADATA_FIELDS = new Set([
  'serverId',
  'serverName',
  'toolName',
  '_meta',
  'method',
]);

/**
 * 过滤 MCP 工具输入中的元数据字段，只保留实际业务参数。
 * 如果存在 arguments 字段，将其内容展平到顶层。
 */
function filterMcpInput(input: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};

  // 先提取 arguments 内容（如果存在）
  if (input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)) {
    Object.assign(filtered, input.arguments as Record<string, unknown>);
  }

  // 然后添加其他非元数据字段
  for (const [key, value] of Object.entries(input)) {
    if (!MCP_METADATA_FIELDS.has(key) && key !== 'arguments') {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Render a tool's input parameters expansion panel. Special-cases known
 * shapes (`todowrite.todos` → checklist) and falls back to a structured
 * key/value table for everything else (skill, MCP, lsp_, read, grep, ...).
 *
 * For MCP tools, filters out metadata fields (serverId, toolName) that are
 * redundant in the UI — the tool header already shows what MCP tool was called.
 */
export function ToolInputPreview({
  toolName,
  input,
  kind,
}: {
  toolName: string;
  input: Record<string, unknown>;
  kind?: 'agent' | 'mcp' | 'skill' | 'tool';
}) {
  const normalized = toolName.trim().toLowerCase();

  // Special case: todowrite 使用专门的待办列表预览
  if ((normalized === 'todowrite' || normalized === 'subtodowrite') && Array.isArray(input.todos)) {
    return <TodoListPreview todos={input.todos as TodoLikeItem[]} />;
  }

  // MCP 工具：过滤元数据字段
  const displayInput =
    kind === 'mcp' || normalized === 'mcp_call' || normalized.startsWith('mcp_')
      ? filterMcpInput(input)
      : input;

  return <ParameterListPreview input={displayInput} />;
}
