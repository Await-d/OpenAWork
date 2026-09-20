/**
 * 终端作用域标记与判定。
 *
 * 终端面板（QuickTerminalPanel）根元素带 `data-terminal-scope`，全局快捷键处理器
 * 据此判断事件目标是否落在终端面板内：是则直接放行，让按键抵达 xterm 自身的按键
 * 矩阵（见 `terminal-key-handlers.ts`，例如 Ctrl/⌘+K = clear-buffer），避免全局绑定
 * 把终端文档化的键位劫持走。
 */

/** 终端面板根元素的显式标记。 */
export const TERMINAL_SCOPE_ATTR = 'data-terminal-scope';

/**
 * 事件目标是否位于终端面板作用域内（含面板内任意后代，如 xterm 的隐藏输入面）。
 * 非 Element 目标（null / window / document）一律视为不在作用域内。
 */
export function isWithinTerminalScope(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${TERMINAL_SCOPE_ATTR}]`) !== null;
}

/**
 * 事件目标是否为可编辑控件（INPUT / TEXTAREA / contentEditable）。
 * 与 `useChatKeyboardShortcuts` 既有判定语义保持一致，供需要「用户在正常输入」
 * 语义的调用方复用。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable === true) {
    return true;
  }
  // 部分 DOM 实现（jsdom）未提供 isContentEditable，退回 contenteditable 属性判定。
  const contentEditable = target.getAttribute('contenteditable');
  return contentEditable === '' || contentEditable === 'true';
}
