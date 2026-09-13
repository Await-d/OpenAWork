/**
 * 判断键盘事件是否发生在输入法（IME）组合过程中。
 *
 * 中文、日文、韩文输入法在候选词上按 Enter 是「确认选词」而不是「提交」，
 * 但该按键依然会冒泡到 textarea 的 onKeyDown。不同浏览器的标记方式不一致：
 * - Chromium 系（Chrome / Edge）用 legacy `keyCode === 229` 标记处理中的按键；
 * - Safari / Firefox 在部分组合阶段只设置 `isComposing`，此时 `key` 仍是 'Enter'。
 *
 * 两者必须同时判定，否则中文用户按回车确认候选词时会误触发发送消息。
 * 命中时调用方应当直接 return，且不要 preventDefault——把按键交还浏览器/输入法。
 */
export function isImeComposingKeyboardEvent(event: {
  readonly nativeEvent: KeyboardEvent;
}): boolean {
  const nativeEvent = event.nativeEvent;
  return nativeEvent.isComposing || nativeEvent.keyCode === 229;
}
