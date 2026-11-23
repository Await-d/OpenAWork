import { INCOMPLETE_TOOL_INPUT_KEY } from '../../../conversation-runtime/messages/copied-tool-card.js';

/**
 * 流式工具入参「尚未收全」的判定（渲染层唯一裁决处）。
 *
 * 背景
 * ----
 * `tool_call_delta` 是**增量文本**：网关先把工具名发出来（`tool-input-start`
 * 甚至带一个空的 `inputDelta`），参数 JSON 才一段段追加。协议层
 * `parseToolCallInputText` 在 JSON 还不合法时只能退化成
 * `{ raw: '<半截 JSON>' }`，而卡片一旦拿到这个对象，折叠标题 / 参数抽屉
 * 就会把半截原文铺出来（典型表现：编辑 / 补丁卡先渲染出
 * `{"patchText":"*** Begin Patch\n*** Update File:…`，等尾部 `}` 到了才变成
 * 正常的文件变更）。这属于「数据没收完就开画」的展示事故，不是信息。
 *
 * 判定口径
 * ----
 * 只有在**还没有任何结算信号**时才算未收全：
 *   - `output` 已到（`tool_result`）⇒ 参数必然定稿；
 *   - `isError` 已置位 ⇒ 调用已结算；
 *   - `status` 是 `completed` / `failed` / `paused` ⇒ 已是终态或待审批
 *     （待审批意味着网关已经读完参数并发出权限请求）；
 *   - `input` 是真正的对象（哪怕是 `{ command: 'ls' }` 这种半截也可能是
 *     合法 JSON 但语义不完整的场景——无法从形状判断，交给卡片自己处理）。
 *
 * 未收全的形状只有两种：
 *   - `{}`：工具名到了、参数一个字节都还没到；
 *   - `{ raw: '<非空文本>' }`：JSON 解析失败的兜底（见
 *     `INCOMPLETE_TOOL_INPUT_KEY`）。
 */
export interface ToolInputPendingProbe {
  input: Record<string, unknown>;
  isError?: boolean | undefined;
  output?: unknown;
  status?: 'running' | 'paused' | 'completed' | 'failed' | undefined;
}

export function isToolInputPending(probe: ToolInputPendingProbe): boolean {
  if (probe.isError === true) return false;
  if (probe.output !== undefined) return false;
  if (probe.status !== undefined && probe.status !== 'running') return false;

  const keys = Object.keys(probe.input);
  if (keys.length === 0) return true;
  if (keys.length !== 1 || keys[0] !== INCOMPLETE_TOOL_INPUT_KEY) return false;

  const raw = probe.input[INCOMPLETE_TOOL_INPUT_KEY];
  return typeof raw === 'string' && raw.trim().length > 0;
}
