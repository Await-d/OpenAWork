export interface ClassicConversationLayoutStateInput {
  readonly editorMode: boolean;
}

export interface FusionConversationLayoutStateInput {
  readonly showDockedReviewPanel: boolean;
}

export interface ConversationLayoutState {
  readonly centerContent: boolean;
  readonly contentMaxWidth: number | 'fluid';
}

export function resolveClassicConversationLayoutState({
  editorMode,
}: ClassicConversationLayoutStateInput): ConversationLayoutState {
  return {
    centerContent: true,
    contentMaxWidth: editorMode ? 720 : 1024,
  };
}

export function resolveFusionConversationLayoutState({
  showDockedReviewPanel,
}: FusionConversationLayoutStateInput): ConversationLayoutState {
  return {
    centerContent: !showDockedReviewPanel,
    contentMaxWidth: showDockedReviewPanel ? 'fluid' : 820,
  };
}

/** 内容列随可用宽度自适应时占容器的比例（%），其余留作居中边距。 */
const CONTENT_MAX_WIDTH_RATIO_PERCENT = 88;

/** 内容列相对基准宽度的最大放大倍数——超宽屏到顶后不再继续加宽，避免行宽失控。 */
const CONTENT_MAX_WIDTH_GROWTH_FACTOR = 1.5;

/**
 * 把固定 px 基准宽度换算成「随可用宽度自适应」的 `max-width`：
 * `clamp(基准, 容器宽度 × 88%, 基准 × 1.5)`。
 *
 * 用容器百分比（`%`）而不是 `vw` / `vh`：内容列的容器在分栏场景（停靠审查面板、
 * 分屏编辑器、侧停靠终端）下并不等于视口宽度，视口单位会在窄面板里失真；
 * 百分比始终基于真实可用宽度。下限保持基准值，保证任何窗口下都不会比原固定上限更窄，
 * 因此窄容器（窗口 / 面板）行为与收窄前完全一致，只在真正有余量时按比例加宽。
 */
export function resolveResponsiveContentMaxWidth(baselinePx: number): string {
  return `clamp(${baselinePx}px, ${CONTENT_MAX_WIDTH_RATIO_PERCENT}%, ${Math.round(
    baselinePx * CONTENT_MAX_WIDTH_GROWTH_FACTOR,
  )}px)`;
}
