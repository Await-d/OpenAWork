export type ChatLatestScrollAlign = 'center' | 'latest-edge';

export interface ChatLatestScrollMetrics {
  anchorHeight: number;
  anchorTop: number;
  clientHeight: number;
  maxScrollTop: number;
  scrollTop: number;
}

/**
 * Align mode for automatic follow-the-latest scrolling (stream tokens,
 * content-column resize from tool-card expansion, message commit).
 *
 * Always `latest-edge`: center-align pins the midpoint of the latest
 * message group, so when a tool card auto-expands and grows that group
 * downward the new content falls below the fold until a later edge scroll
 * (usually message commit when the tool finishes). Edge-align keeps the
 * growing bottom visible for the whole run.
 *
 * Explicit user actions (e.g. "scroll to bottom" with a chosen align) may
 * still request `center` via `scrollToBottom(..., 'center')`.
 */
export const CHAT_AUTO_FOLLOW_ALIGN: ChatLatestScrollAlign = 'latest-edge';

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

/**
 * 「程序化落点是否仍在 latest 边缘内？」——按**最后一条消息组**
 * （`data-chat-group-root="true"`，**任意角色**：user / assistant / tool 都算，
 * 不按 `data-role` 过滤）的**底边**判定，不按绝对 `maxScrollTop` 判定。
 * `maxScrollTop` 包含底部 spacer（`bottomRef` 自身，
 * `CHAT_SCROLL_BOTTOM_SPACER_HEIGHT`，80–160px）。用户把末条消息停在视口底部
 * （最自然的阅读位置）时，到 `maxScrollTop` 的距离恰好等于 spacer 高度，会比
 * 严格底部容差更远——所以这条**宽松**判定只允许用于程序化落点（`scrollTop` 仍
 * 等于本模块记录的落点 ⇒ 变化只来自内容 / 布局增长）。非程序化位置（用户 /
 * 外部滚动）不得使用它，必须改用真正底部判定
 * （`distanceToBottom <= CHAT_TRUE_BOTTOM_TOLERANCE_PX`），否则一个滚轮刻度
 * 上滑会被误判为「仍在 latest」而错误恢复跟随。
 *
 * 自动滚动的**目标**仍然是绝对 `maxScrollTop`；本函数只回答「程序化落点是否
 * 保持 / 恢复跟随」，两者刻意分离。锚点几何由调用方每次现测（不缓存：锚点上方
 * 内容的高度变化会让旧几何失效）。
 *
 * - `anchorBottom !== null`：`anchorBottom <= scrollTop + clientHeight + tolerancePx`
 * - `anchorBottom === null`：退回 `distanceToBottom <= tolerancePx`（没有 420px
 *   兜底——锚点缺失时用同一个 32px 小容差，宁可少跟随也不要误跟随）
 */
export function resolveAtLatestEdge(input: {
  /** 最后一条消息组底边在 scrollTop 空间中的位置；无锚点时传 null。 */
  anchorBottom: number | null;
  clientHeight: number;
  scrollTop: number;
  /** scrollTop 到绝对 maxScrollTop 的距离（scrollHeight - clientHeight - scrollTop）。 */
  distanceToBottom: number;
  tolerancePx: number;
}): boolean {
  const tolerance = Math.max(0, input.tolerancePx);
  if (input.anchorBottom !== null) {
    return input.anchorBottom <= input.scrollTop + input.clientHeight + tolerance;
  }
  return input.distanceToBottom <= tolerance;
}
