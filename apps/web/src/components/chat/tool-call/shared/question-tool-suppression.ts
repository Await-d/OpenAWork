/**
 * `AskUserQuestion`（网关工具名 `question`）在消息流里的显隐裁决 —— 渲染层唯一真相源。
 *
 * 背景
 * ----
 * 提问是**唯一**既有流内工具条目、又有专属交互面板（`InlineQuestionPanel`）的工具。
 * 两种呈现绑定不同的数据源：
 *   - 工具条目来自 `tool_call_delta` 流式事件（先到，入参没收全时还会先渲染骨架卡）；
 *   - 专属面板要等 `question_asked` 事件 + 一次 `listPending` HTTP 拉取拿到全量
 *     `questions` 选项（后到）。
 *
 * 于是同一个提问会先以「工具调用」形态出现在消息流里，随后在 composer 上方弹出专属
 * 面板 —— 用户看到的是「先当工具调用、再跳成提问面板」的跳变，且等待期间同一件事在
 * 界面上存在两份。
 *
 * 裁决
 * ----
 * 等待回答期间（调用尚未结算）**消息流不渲染该工具条目**，专属面板是唯一入口；
 * 一旦结算（`output` 到达 / `isError` / `completed` / `failed`），条目重新可见并展示
 * 只读问答摘要 —— 历史会话重载时不存在 pending 面板，这条只读记录是用户回看「当时问
 * 了什么、答了什么」的唯一依据，因此**不允许**在结算后继续隐藏。
 *
 * 判据必须是「未结算」而不是「没有 output」：`completed` / `failed` 但结果被裁剪时也
 * 不能藏，否则那次提问会从历史里彻底消失。
 */
const QUESTION_TOOL_NAMES: ReadonlySet<string> = new Set(['question', 'askuserquestion']);

export interface QuestionToolSuppressionProbe {
  isError?: boolean | undefined;
  output?: unknown;
  status?: 'running' | 'paused' | 'completed' | 'failed' | undefined;
  toolName: string;
}

export function isQuestionToolName(toolName: string): boolean {
  return QUESTION_TOOL_NAMES.has(toolName.trim().toLowerCase());
}

/**
 * `true` ⇒ 调用方应渲染 `null`（不产出任何工具条目 / 骨架卡）。
 */
export function shouldSuppressQuestionToolCall(probe: QuestionToolSuppressionProbe): boolean {
  if (!isQuestionToolName(probe.toolName)) return false;
  // 已结算的三种信号，任一成立都必须保留可见性（见文件头「判据」）。
  if (probe.isError === true) return false;
  if (probe.output !== undefined) return false;
  if (probe.status === 'completed' || probe.status === 'failed') return false;
  return true;
}
