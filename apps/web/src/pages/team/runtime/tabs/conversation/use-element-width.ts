import { useEffect, useState, type RefObject } from 'react';

/**
 * 元素尺寸测量：ResizeObserver 优先，缺失环境（jsdom / 老浏览器）回退 window.resize。
 *
 * 用途：
 *   - `useElementWidth`：按可视宽度自适应布局（泳道列宽、追踪瀑布连线画布）；
 *   - `useElementHeight`：按可用高度自适应布局（泳道高度铺满容器，避免下方大片空白）。
 */

function useObservedSize(
  ref: RefObject<HTMLElement | null>,
  pick: (element: HTMLElement) => number,
) {
  const [size, setSize] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    const update = () => setSize(pick(element));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pick, ref]);

  return size;
}

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  return useObservedSize(ref, readClientWidth);
}

export function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  return useObservedSize(ref, readClientHeight);
}

function readClientWidth(element: HTMLElement): number {
  return element.clientWidth;
}

function readClientHeight(element: HTMLElement): number {
  return element.clientHeight;
}
