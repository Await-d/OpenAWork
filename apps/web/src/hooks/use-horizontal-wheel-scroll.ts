/**
 * useHorizontalWheelScroll —— 把鼠标滚轮的纵向增量（`deltaY`）翻译为容器的横向滚动。
 *
 * 顶部会话标签栏、编辑器标签栏这类「单行横向排布」的容器溢出后只会出现横向滚动条，
 * 但普通鼠标滚轮只产生 `deltaY`，用户滚不动横向内容。这里在容器上挂一个非 passive 的
 * `wheel` 监听，把纵向增量加到 `scrollLeft` 上。
 *
 * 三种情况放行原生行为，避免抢走滚动：
 * - 容器没有横向溢出（`scrollWidth <= clientWidth`）：没有可搬运的横向空间。
 * - 触控板横向滑动（`|deltaX| >= |deltaY|`）：浏览器已原生支持，不该二次搬运。
 * - `deltaY` 为 0：无纵向增量。
 *
 * 返回的 `attachRef` 是 callback ref 而不是 `useEffect + useRef`，因为容器会随路由 /
 * 空态条件卸载重挂。callback ref 在每次挂载 / 卸载时都精确地挂上、摘掉监听，不必把
 * 「元素是否还在」编码进依赖数组。`ref` 同时指回同一个元素，供调用方读取 `scrollLeft`、
 * `clientWidth` 等度量。
 */
import { useCallback, useRef, type RefObject } from 'react';

export interface HorizontalWheelScrollRefs<T extends HTMLElement> {
  /** 指向被接管的滚动容器，供调用方读取滚动度量。 */
  readonly ref: RefObject<T | null>;
  /** 挂到容器 `ref` 上；由它负责监听器的生命周期。 */
  readonly attachRef: (node: T | null) => void;
}

export function useHorizontalWheelScroll<T extends HTMLElement>(): HorizontalWheelScrollRefs<T> {
  const elementRef = useRef<T | null>(null);
  const handlerRef = useRef<((event: WheelEvent) => void) | null>(null);

  const attachRef = useCallback((node: T | null) => {
    const handler = handlerRef.current;
    if (handler) {
      elementRef.current?.removeEventListener('wheel', handler);
    }

    elementRef.current = node;

    if (!node) {
      return;
    }

    let activeHandler = handlerRef.current;
    if (!activeHandler) {
      activeHandler = (event: WheelEvent) => {
        const element = elementRef.current;
        if (!element) {
          return;
        }

        if (element.scrollWidth <= element.clientWidth) {
          return;
        }

        if (event.deltaY === 0 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
          return;
        }

        event.preventDefault();
        element.scrollLeft += event.deltaY;
      };
      handlerRef.current = activeHandler;
    }

    node.addEventListener('wheel', activeHandler, { passive: false });
  }, []);

  return { ref: elementRef, attachRef };
}
