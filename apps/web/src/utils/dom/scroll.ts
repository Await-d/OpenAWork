/**
 * DOM 滚动位置的写入收敛点。
 *
 * ## 为什么需要它
 *
 * 滚动容器的元素引用通常来自 props、hook 参数或另一个 hook 的返回值
 * （`scrollRegionRef` / `ref` / `useHorizontalWheelScroll().ref`）。一旦用这些来源
 * 取出元素再直接写 `el.scrollTop` / `el.scrollLeft`，React Compiler 会判定为
 * 「Mutating component props or hook arguments」或
 * 「Mutating a value returned from a function whose return value should not be mutated」，
 * 让调用方（组件或 hook）**整体退出优化**——静默发生，不报错、不中断构建。
 *
 * 写入收进本模块的普通函数后，编译器只看到一次不透明调用，滚动行为逐字不变。
 * 同源惯用法见 `utils/ref/ref-current.ts` 的说明与
 * `pages/chat-page/conversation/render/use-chat-render-data.ts` 的模块级写入函数。
 */

/** 设置元素的纵向滚动位置（调用方负责 clamp）。 */
export function setElementScrollTop(element: HTMLElement, top: number): void {
  element.scrollTop = top;
}

/** 贴到内容底部（聊天 / 日志类容器的「跟随最新」）。 */
export function scrollElementToBottom(element: HTMLElement): void {
  element.scrollTop = element.scrollHeight;
}

/** 按增量横向滚动（拖到边缘自动滚动、滚轮搬运 deltaY 等）。 */
export function nudgeElementScrollLeft(element: HTMLElement, delta: number): void {
  element.scrollLeft += delta;
}
