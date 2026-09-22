/**
 * GUI Agent 主循环常量与 Prompt 模板（T-08）。
 *
 * 参考 `temp/UI-TARS-desktop/packages/ui-tars/sdk/src/constants.ts`（Apache-2.0），
 * 按本仓实际情况做了三处改造：
 * 1. `MAX_LOOP_COUNT` 取上游源码实测值 100（上游 README 写的 25 已过时）；
 * 2. 动作空间不照抄上游全集，只保留 `desktop_control` 真正支持的动作，
 *    并把坐标格式明确为 **0–1000 归一化** `[x1, y1, x2, y2]`（运行时由 `coordinates.ts` 换算成像素）；
 * 3. 内部动作抽成只读常量数组，供主循环判断「不交给 operator 执行」。
 */

/** 主循环最大步数（迭代次数上限），达到后主循环以失败收尾。 */
export const GUI_MAX_LOOP_COUNT = 100;

/** 传给模型的截图滑动窗口长度：每次只发送最近 N 张（按时间正序）。 */
export const GUI_MAX_IMAGE_LENGTH = 5;

/**
 * `wait()` 动作的默认等待毫秒数。
 *
 * 注意：等待由 operator 内部消费，主循环**不会**额外 `sleep`，
 * 因此该常量只对外暴露给 Operator 实现使用。
 */
export const GUI_WAIT_MS_DEFAULT = 5000;

/**
 * 主循环内部动作：命中这些动作时**不调用** `operator.execute()`，由主循环自行处理。
 *
 * - `finished` / `call_user`：终止主循环（成功 / 请求用户介入）；
 * - `max_loop`：判定为达到循环上限，以失败收尾；
 * - `error_env`：判定为运行环境错误，抛错并由异常通道上报。
 */
export const GUI_INTERNAL_ACTIONS: readonly string[] = [
  'call_user',
  'max_loop',
  'error_env',
  'finished',
];

/**
 * 默认动作空间文本（发给模型的能力清单）。
 *
 * 只列出 `desktop_control` 支持的动作；坐标统一为 **0–1000 归一化** 的
 * `[x1, y1, x2, y2]`，其中 `(0, 0)` 为左上角、`(1000, 1000)` 为右下角，
 * 由运行时经 `coordinates.ts` 映射回截图逻辑像素。
 */
export const GUI_DEFAULT_ACTION_SPACES = `click(start_box='[x1, y1, x2, y2]')
left_double(start_box='[x1, y1, x2, y2]')
right_single(start_box='[x1, y1, x2, y2]')
drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]')
hotkey(key='')
type(content='') #若要提交输入，请在 content 末尾加 "\\n"。
scroll(start_box='[x1, y1, x2, y2]', direction='down or up or right or left')
wait() #等待 5 秒后重新截图，观察界面变化。
finished()
call_user() #任务无法完成或需要用户帮助时调用，交还控制权给用户。`;

/**
 * System Prompt 模板：`{{action_spaces_holder}}` 由 {@link buildGuiSystemPrompt} 填充，
 * `{{extra_note_holder}}` 用于追加调用方自定义约束（为空时不留多余空行）。
 */
const GUI_SYSTEM_PROMPT_TEMPLATE = `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
\`\`\`
Thought: ...
Action: ...
\`\`\`

## Action Space
{{action_spaces_holder}}

## Note
{{extra_note_holder}}- Coordinates are in a 0-1000 normalized space: [x1, y1, x2, y2], where (0, 0) is the top-left corner and (1000, 1000) is the bottom-right corner.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in \`Thought\` part.

## User Instruction
`;

/**
 * 组装 System Prompt。
 *
 * @param options.actionSpaces 自定义动作空间（默认 {@link GUI_DEFAULT_ACTION_SPACES}）。
 * @param options.extraNote    追加到 `## Note` 的一条额外约束（以 `- ` 前缀输出）。
 */
export function buildGuiSystemPrompt(
  options: {
    readonly actionSpaces?: string;
    readonly extraNote?: string;
  } = {},
): string {
  const actionSpaces = options.actionSpaces ?? GUI_DEFAULT_ACTION_SPACES;
  const extraNote =
    options.extraNote !== undefined && options.extraNote.trim().length > 0
      ? `- ${options.extraNote.trim()}\n`
      : '';
  return GUI_SYSTEM_PROMPT_TEMPLATE.replace('{{action_spaces_holder}}', actionSpaces).replace(
    '{{extra_note_holder}}',
    extraNote,
  );
}

/** 默认 System Prompt（等价于 `buildGuiSystemPrompt()`）。 */
export const GUI_DEFAULT_SYSTEM_PROMPT: string = buildGuiSystemPrompt();

/** 指令为空时使用的占位文本，保证用户提示词始终非空。 */
const GUI_EMPTY_INSTRUCTION_PLACEHOLDER = '（未提供任务指令）';

/**
 * 组装用户提示词（即 System Prompt 末尾 `## User Instruction` 段落的内容）。
 *
 * 仅做首尾空白归一：空指令回退为占位文本，避免向模型发送空用户回合。
 */
export function buildGuiUserPrompt(instruction: string): string {
  const normalized = instruction.trim();
  return normalized.length > 0 ? normalized : GUI_EMPTY_INSTRUCTION_PLACEHOLDER;
}
