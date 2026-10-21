/**
 * 指针输入的「按帧合并」缓冲。
 *
 * 为什么需要：鼠标移动在真实设备上轻松到 100+ Hz，触控板滚轮（带惯性）同样高频。
 * 每个事件都直接上行会让网关侧的 CDP 输入队列堆积（交互延迟被拉长），而且远端页面
 * 每次移动都会产生 damage → 又产出一帧全量 JPEG，等于把输入洪泛放大成帧洪泛。
 *
 * 合并规则：
 * - `move`：同一帧内只发最后一次坐标；与上次下发的坐标**距离小于阈值**时不发
 *   （设备像素级抖动对远端毫无意义，却每次都让页面重新产一帧）；
 * - `move` 另有最小上行间隔（默认一帧），把上行频率钉在显示刷新率的量级，而不是
 *   指针设备的事件率；
 * - `wheel`：同一帧内的增量累加后合成一条，总滚动距离不丢（滚轮不参与间隔节流：
 *   它的每一分增量都对应实际位移，节流会让滚动距离丢失）；
 * - 两者共用同一个调度句柄，因此一个间隔内最多产生两条上行消息。
 *
 * 调度器可注入，便于测试离线驱动（不依赖 jsdom 的 rAF）。
 */

import type { BrowserLiveClientMessage } from '@openAwork/shared';

export interface PointerFrameScheduler {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
}

/**
 * 生产环境用的默认调度器：一个动画帧一次机会。
 *
 * 缺 `requestAnimationFrame` 的环境（部分内嵌 webview / 测试环境）退化成「下一个
 * 宏任务」，合并粒度略粗但输入不会失效——指针输入坏了比合并粒度粗严重得多。
 */
const RAF_SCHEDULER: PointerFrameScheduler =
  typeof requestAnimationFrame === 'function'
    ? {
        request: (callback) => requestAnimationFrame(callback),
        cancel: (handle) => cancelAnimationFrame(handle),
      }
    : {
        request: (callback) => setTimeout(callback, 16) as unknown as number,
        cancel: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
      };

export interface PointerPoint {
  x: number;
  y: number;
}

/**
 * 判定「这次移动值不值得上行」的最小位移（设备像素）。
 *
 * 1px 是刻意选的：真正的位移必然跨过它，而亚像素抖动 / 同一像素内的抖动对远端页面
 * 没有意义——但每发一次 `mouseMoved`，远端都会重新命中测试并产出一帧全量 JPEG。
 */
export const POINTER_MOVE_MIN_DISTANCE_PX = 1;

export interface PointerInputBatch {
  /** 上报一次移动；同一帧内多次调用只发最后一次，坐标未变则不发。 */
  move: (point: PointerPoint) => void;
  /**
   * 上报一次移动；拖动 burst 的首个点**立即**上行，后续点按动画帧合并（拖动 / 长按滑动期间用）。
   *
   * 首点不等待合并，后续最多增加一个动画帧（0–16ms）延迟，避免硬件高频 mousemove
   * 把远端 CDP 输入与全量 screencast 一起洪泛。
   *
   * 仍然过位移阈值：同一像素内的抖动对远端毫无意义，却会白白产出一帧全量 JPEG。
   */
  moveImmediate: (point: PointerPoint) => void;
  /** 上报一次滚轮；同一帧内的增量累加后合成一条下发。 */
  wheel: (point: PointerPoint, delta: { x: number; y: number }) => void;
  /** 丢弃未冲刷的输入并取消挂起的帧（卸载 / 会话关闭）。 */
  dispose: () => void;
}

export function createPointerInputBatch(
  send: (message: BrowserLiveClientMessage) => void,
  scheduler: PointerFrameScheduler = RAF_SCHEDULER,
  minDistancePx: number = POINTER_MOVE_MIN_DISTANCE_PX,
): PointerInputBatch {
  let handle: number | null = null;
  let pendingMove: PointerPoint | null = null;
  let pendingWheel: { point: PointerPoint; deltaX: number; deltaY: number } | null = null;
  /** 是否仍处于同一段拖动 burst；普通悬停移动会重新武装下一次首点立即发送。 */
  let immediateBurstActive = false;
  /** 上一次真正下发过的坐标：重复的 `mouseMoved` 对远端是纯噪声。 */
  let sentPoint: PointerPoint | null = null;
  const threshold =
    Number.isFinite(minDistancePx) && minDistancePx > 0
      ? minDistancePx
      : POINTER_MOVE_MIN_DISTANCE_PX;

  /** 位移是否值得上行：没有历史坐标时必然值得，否则要跨过阈值。 */
  const isMeaningfulMove = (point: PointerPoint): boolean => {
    if (sentPoint === null) return true;
    const dx = point.x - sentPoint.x;
    const dy = point.y - sentPoint.y;
    return dx * dx + dy * dy >= threshold * threshold;
  };

  const flush = (): void => {
    handle = null;

    const point = pendingMove;
    pendingMove = null;
    if (point !== null && isMeaningfulMove(point)) {
      sentPoint = point;
      send({ ch: 'input', kind: 'mouse', type: 'mouseMoved', x: point.x, y: point.y });
    }

    const wheel = pendingWheel;
    pendingWheel = null;
    if (wheel !== null && (wheel.deltaX !== 0 || wheel.deltaY !== 0)) {
      send({
        ch: 'input',
        kind: 'wheel',
        x: wheel.point.x,
        y: wheel.point.y,
        deltaX: wheel.deltaX,
        deltaY: wheel.deltaY,
      });
    }
  };

  const schedule = (): void => {
    if (handle !== null) return;
    handle = scheduler.request(flush);
  };

  return {
    move(point) {
      immediateBurstActive = false;
      pendingMove = point;
      schedule();
    },
    moveImmediate(point) {
      // 已经排队的普通移动作废：拖动的最新坐标优先。
      if (handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
      pendingMove = null;
      if (!isMeaningfulMove(point)) return;

      // 拖动期间不要把硬件 120–240Hz 的 mousemove 原样洪泛到 CDP：每条移动都会触发
      // 远端 hit-test、页面 damage 与一张 JPEG。首个点立即发送保证按下后跟手，后续点
      // 只保留最新值并在下一帧发送，最多引入一帧（通常 0–16ms）延迟，却能把输入与
      // screencast 产帧稳定在显示刷新率量级。
      if (!immediateBurstActive) {
        immediateBurstActive = true;
        sentPoint = point;
        send({ ch: 'input', kind: 'mouse', type: 'mouseMoved', x: point.x, y: point.y });
        return;
      }
      pendingMove = point;
      schedule();
    },
    wheel(point, delta) {
      pendingWheel = {
        point,
        deltaX: (pendingWheel?.deltaX ?? 0) + delta.x,
        deltaY: (pendingWheel?.deltaY ?? 0) + delta.y,
      };
      schedule();
    },
    dispose() {
      pendingMove = null;
      pendingWheel = null;
      immediateBurstActive = false;
      if (handle === null) return;
      scheduler.cancel(handle);
      handle = null;
    },
  };
}
