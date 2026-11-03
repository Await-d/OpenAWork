/**
 * Pointer Capture 的渐进式封装。
 *
 * 两个媒体播放器的进度条在按住拖拽时都需要把指针捕获到进度条元素上，否则指针移出
 * 元素后会丢失 `pointermove`，拖拽会半途断掉。`setPointerCapture` 属较新 API 且 jsdom
 * 不实现，因此需要能力检测。
 *
 * ⚠️ 这里刻意**不用 try/catch 兜底**：仓库明令禁止空 catch（`AGENTS.md`「禁止空 catch
 * 块——必须记录日志或重新抛出」），而捕获失败在真实场景下只可能是 pointerId 已失效
 *（事件派发与处理之间指针被取消）。与其吞掉它，不如不做兜底：调用方把捕获动作排在
 *「置拖拽标志之前」，即使真的抛错也不会进入半途的拖拽态，异常照常冒泡可见。
 */

/** 把指针捕获到元素上；环境不支持该 API 时跳过（拖拽仍由调用方的标志位维持）。 */
export function capturePointer(element: HTMLElement, pointerId: number): void {
  if (typeof element.setPointerCapture !== 'function') return;
  element.setPointerCapture(pointerId);
}

/** 释放捕获；未持有捕获或环境不支持该 API 时跳过。 */
export function releasePointer(element: HTMLElement, pointerId: number): void {
  if (typeof element.hasPointerCapture !== 'function') return;
  if (!element.hasPointerCapture(pointerId)) return;
  if (typeof element.releasePointerCapture !== 'function') return;
  element.releasePointerCapture(pointerId);
}
