export type ChatLatestScrollAlign = 'center' | 'latest-edge';

export interface ChatLatestScrollMetrics {
  anchorHeight: number;
  anchorTop: number;
  clientHeight: number;
  maxScrollTop: number;
  scrollTop: number;
}

interface ResolveLatestScrollTopOptions {
  align?: ChatLatestScrollAlign;
  anchorHeight: number;
  anchorTop: number;
  centerMarginPx: number;
  clientHeight: number;
  maxScrollTop: number;
}

interface IsScrollTopNearLatestOptions extends ResolveLatestScrollTopOptions {
  scrollTop: number;
  tolerancePx: number;
}

export function resolveLatestScrollTop({
  align = 'center',
  anchorHeight,
  anchorTop,
  centerMarginPx,
  clientHeight,
  maxScrollTop,
}: ResolveLatestScrollTopOptions): number {
  const boundedMaxScrollTop = Math.max(0, maxScrollTop);
  if (align === 'latest-edge') {
    return boundedMaxScrollTop;
  }

  if (clientHeight <= 0 || anchorHeight <= 0) {
    return boundedMaxScrollTop;
  }

  const safeCenterMargin = Math.max(0, centerMarginPx);
  const centerViewportHeight = Math.max(0, clientHeight - safeCenterMargin * 2);
  if (centerViewportHeight <= 0 || anchorHeight > centerViewportHeight) {
    return boundedMaxScrollTop;
  }

  const anchorCenter = anchorTop + anchorHeight / 2;
  return Math.max(0, Math.min(boundedMaxScrollTop, anchorCenter - clientHeight / 2));
}

export function isScrollTopNearLatest({
  align = 'center',
  anchorHeight,
  anchorTop,
  centerMarginPx,
  clientHeight,
  maxScrollTop,
  scrollTop,
  tolerancePx,
}: IsScrollTopNearLatestOptions): boolean {
  const targetScrollTop = resolveLatestScrollTop({
    align,
    anchorHeight,
    anchorTop,
    centerMarginPx,
    clientHeight,
    maxScrollTop,
  });

  return Math.abs(scrollTop - targetScrollTop) <= Math.max(0, tolerancePx);
}
