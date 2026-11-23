import { toolCallSummary } from '../shared/tool-call-presentation.js';
import { ToolIcon } from './tool-icon.js';

/**
 * 流式工具调用的「参数接收中」占位卡。
 *
 * 用在 `isToolInputPending()` 判定为 true 的那段时间里：此刻网关只发出了
 * 工具名（`tool-input-start`）与参数 JSON 的前几段，卡片渲染真实内容只会
 * 把半截原始格式（`{"patchText":"*** Begin Patch…`）铺给用户，等尾部 `}`
 * 到了又跳成正常的文件变更 —— 两次闪烁、一段噪声。
 *
 * 因此这段时间只给「图标 + 中文动作 + 骨架屏」，参数收全或 `tool_result`
 * 到达后由调用方切回真正的卡片，视觉上是一次平滑的骨架 → 内容替换。
 */
export function ToolCallPendingCard({
  embedded = false,
  toolName,
}: {
  /** 嵌在 batch 子行展开区里渲染：外层行已提供缩进，这里不再叠一层。 */
  embedded?: boolean;
  toolName: string;
}) {
  // 复用折叠标题的中文口径（`edit` → 编辑文件、`patch` → 应用补丁），
  // 不让占位态突然退回英文工具名。
  const label = toolCallSummary(toolName, {}, undefined, 'running');

  return (
    <div
      aria-busy="true"
      className="tool-call-block tool-call-pending"
      data-embedded={embedded ? 'true' : undefined}
      data-tool-status="running"
    >
      <div className="tool-call-pending-header">
        <ToolIcon size={embedded ? 12 : 14} status="running" toolName={toolName} />
        <span className="tool-call-block-title tool-call-pending-title">{label}</span>
        <span className="tool-call-pending-hint">正在接收参数…</span>
      </div>
      <div aria-hidden="true" className="tool-call-pending-skeleton">
        <span className="tool-call-pending-skel-line" />
        <span className="tool-call-pending-skel-line" data-width="short" />
      </div>
    </div>
  );
}
