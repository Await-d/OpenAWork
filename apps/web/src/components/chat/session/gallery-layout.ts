/**
 * 消息附件图集的布局解算（纯函数，无副作用、无 DOM 依赖）。
 *
 * 背景：附件缩略图原先是固定 `width: 180` 的 flex-wrap 平铺——1 张时显得孤零、
 * 6 张时挤成两行零散小图。本模块把「图片数量 → 布局」收敛成一张可测的规则表：
 *
 *   1 张      单栏大图            （CSS：16:10，contain 不裁切）
 *   2 张      等宽并排            （CSS：1:1，cover）
 *   3 张      1 大 2 小（首格跨两行）
 *   4 张      2 × 2
 *   5–9 张    3 列网格
 *   > 9 张    前 8 张 + 末格折叠为 `+N`
 *
 * 之所以先抽成纯函数：布局分支是本次改动里唯一有「多分支 + 边界」的部分，
 * 放在组件里只能靠渲染快照间接验证；抽出来后可对 0 / 1 / 2 / 3 / 4 / 9 / 10 / 30
 * 逐个断言，也便于后续（视频 / 文件卡片）复用同一张表。
 *
 * **职责边界**：本模块只解算**结构**（列数 / 显示格数 / 折叠数 / 首格跨行）。
 * 上表括号里的视觉部分（宽高比、裁切方式）由 `ChatPageSections.css` 按
 * `data-columns` / `data-count` / `data-lead-span` 自行决定，本模块不重复描述，
 * 以免出现「两处各写一份、改一处漏一处」。
 */

export interface GalleryLayout {
  /** 网格列数。 */
  readonly columns: number;
  /** 实际渲染的格子数（不含折叠遮罩）。 */
  readonly visibleCount: number;
  /** 被折叠的图片数量；> 0 时末格渲染 `+N` 遮罩。 */
  readonly overflowCount: number;
  /** 首格是否跨两行（3 张时的主图位）。 */
  readonly leadSpansRows: boolean;
}

/** 超过该数量即折叠（3 列 × 3 行 恰好占满不留空位）。 */
export const GALLERY_FULL_GRID_MAX = 9;

/** 折叠态下保留的可见格子数；末格让位给 `+N` 遮罩，故比满格少 1。 */
export const GALLERY_COLLAPSED_VISIBLE = 8;

function layout(partial: Partial<GalleryLayout> & Pick<GalleryLayout, 'columns'>): GalleryLayout {
  return {
    visibleCount: 0,
    overflowCount: 0,
    leadSpansRows: false,
    ...partial,
  };
}

/**
 * 按图片数量解算布局。
 *
 * 入参做了防御：非有限数、负数、小数一律归一到「0 张」（不抛错，调用方不必预校验），
 * 因为该值来自消息 part 数组长度，历史上出现过 `undefined` 直接参与运算的场景。
 */
export function resolveGalleryLayout(count: number): GalleryLayout {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

  if (safeCount === 0) {
    return layout({ columns: 1, visibleCount: 0 });
  }

  if (safeCount === 1) {
    return layout({ columns: 1, visibleCount: 1 });
  }

  if (safeCount === 2) {
    return layout({ columns: 2, visibleCount: 2 });
  }

  if (safeCount === 3) {
    return layout({ columns: 2, visibleCount: 3, leadSpansRows: true });
  }

  if (safeCount === 4) {
    return layout({ columns: 2, visibleCount: 4 });
  }

  if (safeCount <= GALLERY_FULL_GRID_MAX) {
    return layout({ columns: 3, visibleCount: safeCount });
  }

  return layout({
    columns: 3,
    visibleCount: GALLERY_COLLAPSED_VISIBLE,
    overflowCount: safeCount - GALLERY_COLLAPSED_VISIBLE,
  });
}
