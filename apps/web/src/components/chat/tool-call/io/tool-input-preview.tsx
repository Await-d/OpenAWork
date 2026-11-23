import { ChannelMessagePreview } from '../previews/channel-message-preview.js';
import { ParameterListPreview } from '../previews/parameter-list-preview.js';
import { type TodoLikeItem, TodoListPreview } from '../previews/todo-list-preview.js';
import {
  resolveDisplayedInputFields,
  resolveToolInputExtraFields,
  resolveToolInputMessage,
  type ToolInputKind,
} from '../shared/tool-input-fields.js';

/**
 * Render a tool's input parameters expansion panel. Special-cases known
 * shapes (`todowrite.todos` → checklist, 渠道发送类 → 消息正文) and falls back
 * to a structured key/value table for everything else (skill, MCP, lsp_, read, grep, ...).
 *
 * 字段的取舍规则（MCP 元数据过滤 / 渠道路由字段 / 展平 `arguments`）统一放在
 * `shared/tool-input-fields`：卡片的抽屉标题也读同一处，标题计数才不会与实际渲染打架。
 */
export function ToolInputPreview({
  toolName,
  input,
  kind,
}: {
  toolName: string;
  input: Record<string, unknown>;
  kind?: ToolInputKind;
}) {
  const normalized = toolName.trim().toLowerCase();

  // Special case: todowrite 使用专门的待办列表预览
  if ((normalized === 'todowrite' || normalized === 'subtodowrite') && Array.isArray(input.todos)) {
    return <TodoListPreview todos={input.todos as TodoLikeItem[]} />;
  }

  // 渠道发送类：`plugin_id` / `chat_id` 由运行时自动填充，铺出来只是两串无意义 id；
  // 真正的内容是发给用户的那条消息，按 markdown 渲染（见 shared/channel-send-input）。
  const sendBody = resolveToolInputMessage(toolName, input, kind);
  if (sendBody) {
    // 正文之外的字段仍要可见（发图的 `file_path`、回复目标等），否则带图注时反而看不到发了什么。
    const extraFields = resolveToolInputExtraFields(toolName, input, kind);
    return (
      <div className="channel-send-preview">
        <ChannelMessagePreview body={sendBody.body} hint={sendBody.hint} />
        {Object.keys(extraFields).length > 0 && <ParameterListPreview input={extraFields} />}
      </div>
    );
  }

  return <ParameterListPreview input={resolveDisplayedInputFields(toolName, input, kind)} />;
}
