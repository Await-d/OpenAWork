import { useEffect, useState, type RefObject } from 'react';

const DEFAULT_THRESHOLD_PX = 1080;

function readWidth(containerRef?: RefObject<HTMLElement | null>): number | null {
  const width = containerRef?.current?.getBoundingClientRect().width ?? 0;
  return width > 0 ? width : null;
}

function readIsNarrow(thresholdPx: number, containerRef?: RefObject<HTMLElement | null>): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const measuredWidth = readWidth(containerRef);
  return (measuredWidth ?? window.innerWidth) < thresholdPx;
}

export function useNarrowConversationLayout(
  containerRef?: RefObject<HTMLElement | null>,
  thresholdPx = DEFAULT_THRESHOLD_PX,
): boolean {
  // 首帧容器尚未挂载，`containerRef.current` 必然是 null，读不到宽度，
  // 原实现此时也会退化成 `window.innerWidth`。所以这里直接用窗口宽度做首帧估计，
  // 不再走 ref —— 渲染期读 ref 会被 React Compiler 判定为
  // "Cannot access refs during render" 并放弃优化本 hook。
  // 挂载后由下方 effect 补测容器真实宽度，行为与原写法等价。
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.innerWidth < thresholdPx;
  });

  useEffect(() => {
    const update = () => setIsNarrow(readIsNarrow(thresholdPx, containerRef));
    update();

    const container = containerRef?.current;
    let resizeObserver: ResizeObserver | null = null;
    if (container && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => update());
      resizeObserver.observe(container);
    }

    window.addEventListener('resize', update);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [containerRef, thresholdPx]);

  return isNarrow;
}
