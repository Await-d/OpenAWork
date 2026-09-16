/**
 * 终端面板级快捷键的判定与共用文案（T-13，TASK 1）。
 *
 * 与 `terminal-key-handlers.ts` 的分工：那份是**终端实例内部**的按键矩阵，挂在
 * 每个 xterm 的 `attachCustomKeyEventHandler` 上，只在终端获得焦点且 xterm 自己
 * 处理按键时才可能生效；这里只处理**面板级**组合键，由面板容器统一拦截 —— 焦点
 * 不在终端上（例如停在 pane 边框 / tab 条）时也必须能响应。
 */

/**
 * 「这是面板自己的 UI 输入控件」的显式标记：搜索条输入框、tab 重命名输入框。
 *
 * 为什么不用通用的「target 可编辑」判据（`isContentEditable` / tagName ∈ INPUT
 * / TEXTAREA）：终端自己的输入面正是 xterm 的隐藏 `textarea.xterm-helper-textarea`
 * —— 用通用可编辑判定会把「终端获得焦点」这个**最该响应快捷键**的场景一并挡掉
 * （面板内任何一次终端点击后焦点都在那个 textarea 上）。所以只认这个显式标记，
 * 其余目标（含 xterm 的隐藏输入面）一律放行。
 */
export const TERMINAL_UI_INPUT_ATTR = 'data-terminal-ui-input';

/** 判定所需的按键信息子集（原生 `KeyboardEvent` 与 React 合成事件都结构上满足）。 */
export interface SplitShortcutEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** 长按自动重复：只响应第一下，否则按住不放会连拆。 */
  repeat?: boolean;
}

/**
 * Ctrl+Shift+5（macOS ⌘+Shift+5）—— 与 VS Code 的 `workbench.action.terminal.split`
 * 同键位：拆分当前激活 pane。
 *
 * 为什么 `code` 与 `key` 都要看：
 *  - `code === 'Digit5'` 是**物理键位**判定，不受键盘布局影响（德语 / AZERTY 布局下
 *    Shift+5 的 `key` 并不是 `'%'`，只看 `key` 会漏）；
 *  - 合成事件（jsdom、部分 IME / 远程输入路径）可能不带 `code`，此时退回 `key`
 *    （US 布局 Shift+5 → `'%'`，个别环境仍上报 `'5'`）。
 * 两者任一命中即算命中。带 `altKey` 的组合一律不接管，避免与系统 / 输入法冲突。
 */
export function isSplitPaneShortcut(event: SplitShortcutEventLike): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  if (!event.shiftKey || event.altKey) return false;
  if (event.repeat === true) return false;
  if (event.code === 'Digit5') return true;
  return event.key === '5' || event.key === '%';
}

/**
 * 「已达 pane 上限」的统一文案：`⊟` / ⋯ 的禁用 title（TerminalPane）与快捷键提示
 * （QuickTerminalPanel）共用，避免同一拒绝原因出现两种措辞。
 */
export function paneLimitMessage(maxPanes: number): string {
  return `分屏已达上限（${maxPanes} 个组）`;
}
