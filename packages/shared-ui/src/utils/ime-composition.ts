/**
 * 判断键盘事件是否发生在输入法（IME）组合过程中。
 *
 * 中文、日文、韩文输入法在候选词上按 Enter 是「确认选词」而不是「提交」，
 * 但该按键依然会冒泡到 textarea 的 keydown。两个标记必须**同时**判定：
 *
 * - `keyCode === 229`：Chromium 系（Chrome / Edge）给「已被输入法处理」的按键
 *   打的 legacy 标记，此时 `key` 常是 'Process' 或 'Enter'；
 * - `isComposing`：Safari / Firefox 在部分组合阶段只设置该标志（`key` 仍是 'Enter'）。
 *
 * 只靠 `isComposing` 并不安全：WebKit bug 165004 下 `compositionend` 会在
 * 「确认选词的 Enter keydown」之前派发，等到 keydown 时 `isComposing` 已经是
 * false，于是中文用户按回车确认候选词会被误判成「提交」，把半成品消息发出去。
 *
 * 调用方契约：本函数返回 true 时必须直接 return，且**不要**调用
 * `preventDefault()`——这次按键属于输入法候选窗口，必须原样交还浏览器/输入法，
 * 否则会把候选词确认 / 取消一并吞掉。
 *
 * 两个入口共用同一判定口径：React 合成事件走 `isImeComposingKeyboardEvent`，
 * `window` / `document` 上的原生监听走 `isImeComposingNativeEvent`。
 */
export function isImeComposingNativeEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/** React 合成事件版本的 IME 组合态判定，语义见 {@link isImeComposingNativeEvent}。 */
export function isImeComposingKeyboardEvent(event: {
  readonly nativeEvent: KeyboardEvent;
}): boolean {
  return isImeComposingNativeEvent(event.nativeEvent);
}
