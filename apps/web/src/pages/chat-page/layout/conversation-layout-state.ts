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

/**
 * 内容列在「中等容器」下占可用宽度的比例（%），其余留作居中边距。
 * 取 80%：容器只有 700–1300px 时内容仍横跨整屏，行长过长、扫读跳行，
 * 收窄到八成后接近主流对话产品的主体宽度（约 750–950px），视觉上更聚焦。
 */
const CONTENT_MAX_WIDTH_RATIO_PERCENT = 80;

/**
 * split 左右分列的容器占比。分列后每条消息只占内容列的一部分（见
 * `SPLIT_CONTENT_COLUMN_WIDTH_FACTOR`），需要更宽的可用宽度才能维持单条消息的
 * 可读行宽，因此这里放宽到 96%，尽量吃满容器。
 */
export const SPLIT_CONTENT_MAX_WIDTH_RATIO_PERCENT = 96;

/**
 * 内容列的最小宽度：容器被压得很窄（侧停靠面板、小窗）时，纯百分比会把正文和代码块
 * 挤到不可读，420px 是一行中文 + 一段diff 的下限。
 */
const CONTENT_MAX_WIDTH_FLOOR_PX = 420;

/** 内容列相对基准宽度的最大放大倍数——超宽屏据此吃满余量，不至于内容缩在中间。 */
const CONTENT_MAX_WIDTH_GROWTH_FACTOR = 1.6;

/**
 * 内容列的绝对上限。防止基准被抬高（split 布局 ×1.5）后叠加放大倍数顶到过宽的行长，
 * 同时给 4K / 超宽屏一个「最多宽到哪」的终点。
 */
const CONTENT_MAX_WIDTH_HARD_CAP_PX = 1800;

/**
 * 把固定 px 基准宽度换算成「随可用宽度自适应」的 `max-width`：
 * `min(min(基准 × 1.6, 1800px), max(容器宽度 × 占比, 420px))`。
 *
 * 为什么用 `min` 而不是 `clamp(基准, …)`：`clamp` 的下限是基准 px，基准一旦大于容器
 * 宽度就完全不生效，于是所有窄/ 中屏窗口的内容列都是「满宽到底」——这正是小屏上
 * 内容过宽的根因。改成 `min(上限, max(占比%, 下限))` 后：
 * - 窄 / 中屏按占比收窄并居中，行长可控；
 * - 超宽屏一路放宽到上限（或硬顶），不会在大屏上缩成一条窄带。
 *
 * 用容器百分比（`%`）而不是 `vw` / `vh`：内容列的容器在分栏场景（停靠审查面板、
 * 分屏编辑器、侧停靠终端）下并不等于视口宽度，视口单位会在窄面板里失真，
 * 百分比始终基于真实可用宽度。
 *
 * 实际落点（基准 → max-width，占比默认 80%）：
 * - 720px（编辑器模式）→ `min(1152px, max(80%, 420px))`
 * - 820px（Fusion）→ `min(1312px, max(80%, 420px))`
 * - 1024px（Classic）→ `min(1638px, max(80%, 420px))`：1920 屏约 1536px，2560 屏封顶 1638px。
 * - 1536px（split 抬高后，占比 96%）→ `min(1800px, max(96%, 420px))`
 */
export function resolveResponsiveContentMaxWidth(
  baselinePx: number,
  ratioPercent: number = CONTENT_MAX_WIDTH_RATIO_PERCENT,
): string {
  const capPx = Math.min(
    Math.round(baselinePx * CONTENT_MAX_WIDTH_GROWTH_FACTOR),
    CONTENT_MAX_WIDTH_HARD_CAP_PX,
  );
  return `min(${capPx}px, max(${ratioPercent}%, ${CONTENT_MAX_WIDTH_FLOOR_PX}px))`;
}
