export interface ConversationLayoutState {
  readonly centerContent: boolean;
  /**
   * `'fluid'` = 内容列铺满容器(停靠侧栏 / 分栏等场景,不再居中);
   * `'centered'` = 内容列按容器占比自适应并居中(行长可控)。
   */
  readonly contentMaxWidth: 'fluid' | 'centered';
}

export function resolveClassicConversationLayoutState(): ConversationLayoutState {
  return {
    centerContent: true,
    contentMaxWidth: 'centered',
  };
}

export interface FusionConversationLayoutStateInput {
  readonly showDockedReviewPanel: boolean;
}

export function resolveFusionConversationLayoutState({
  showDockedReviewPanel,
}: FusionConversationLayoutStateInput): ConversationLayoutState {
  return {
    centerContent: !showDockedReviewPanel,
    contentMaxWidth: showDockedReviewPanel ? 'fluid' : 'centered',
  };
}

/**
 * 内容列在「中等容器」下占可用宽度的比例(%),其余留作居中边距。
 * 取 72%:1K(1920)屏属中等容器,左侧栏(Rail + Panel ≈ 308px)加左右内边距
 * 要吃掉约 370px,裸 80% 下正文行长仍偏长、扫读跳行;收窄到约七成后接近主流
 * 对话产品的主体宽度(约 750–950px),视觉上更聚焦。
 */
const CONTENT_MAX_WIDTH_RATIO_PERCENT = 72;

/**
 * split 左右分列的容器占比。分列后每条消息只占内容列的一部分,需要更宽的可用宽度
 * 才能维持单条消息的可读行宽,因此这里放宽到 96%,尽量吃满容器。
 */
export const SPLIT_CONTENT_MAX_WIDTH_RATIO_PERCENT = 96;

/**
 * 内容列的最小宽度:容器被压得很窄(侧停靠面板、小窗)时,纯百分比会把正文和代码块
 * 挤到不可读,420px 是一行中文 + 一段diff 的下限。
 */
const CONTENT_MAX_WIDTH_FLOOR_PX = 420;

/**
 * 内容列的 `max-width`:占容器 `ratioPercent`%,并保底 `420px`。
 *
 * 只用「容器百分比 + 固定下限」,**不设上限**——内容列在超宽屏随容器一路放宽。
 * 此前那套「基准 × 放大倍数 / 1800px 硬顶」的上限模型已移除,基准宽度
 * (720 / 820 / 1024)不再参与任何计算。
 *
 * 用容器百分比(`%`)而不是 `vw` / `vh`:内容列的容器在分栏场景(停靠审查面板、
 * 分屏编辑器、侧停靠终端)下并不等于视口宽度,视口单位会在窄面板里失真,
 * 百分比始终基于真实可用宽度。
 */
export function resolveResponsiveContentMaxWidth(
  ratioPercent: number = CONTENT_MAX_WIDTH_RATIO_PERCENT,
): string {
  return `max(${ratioPercent}%, ${CONTENT_MAX_WIDTH_FLOOR_PX}px)`;
}