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
  /**
   * Bias factor for `align: 'center'`. Default 0.5 puts the anchor's
   * centre at the viewport's vertical centre (50% from top). Larger
   * values push the anchor further down — e.g. 0.7 keeps the latest
   * message ~30% above the bottom of the viewport, which feels closer
   * to the composer than the literal centre and reduces the empty
   * space below the most recent reply.
   */
  centerBias?: number;
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
  centerBias = 0.5,
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

  const clampedBias = Math.max(0, Math.min(1, centerBias));
  const anchorCenter = anchorTop + anchorHeight / 2;
  // bias=0.5 → anchor centre at viewport vertical middle (legacy)
  // bias=0.7 → anchor centre at 70% down viewport (closer to composer)
  return Math.max(0, Math.min(boundedMaxScrollTop, anchorCenter - clientHeight * clampedBias));
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
