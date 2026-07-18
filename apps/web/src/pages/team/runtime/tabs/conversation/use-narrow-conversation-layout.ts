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
  const [isNarrow, setIsNarrow] = useState(() => readIsNarrow(thresholdPx, containerRef));

  useEffect(() => {
    const update = () => setIsNarrow(readIsNarrow(thresholdPx, containerRef));
    update();

    const container = containerRef?.current;
    const resizeObserver =
      container && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => update())
        : null;
    resizeObserver?.observe(container);

    window.addEventListener('resize', update);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [containerRef, thresholdPx]);

  return isNarrow;
}
