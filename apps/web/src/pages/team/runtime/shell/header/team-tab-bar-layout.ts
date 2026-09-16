/**
 * 260915-team-page · TeamTabBar 布局判定（纯函数）
 *
 * 宽屏下子 tab 从独立行并入主 tab 行（nav 行），把第二级导航的纵向空间
 * 还给内容区；空间不足时保持独立子 tab 行，避免两级导航互相挤压。
 *
 * 判定：主 tab 组自然宽 + 子 tab 组自然宽 + 右侧操作区 + 分隔/间隙余量
 * 全部能放进 nav 行宽度时合并。
 */

/** 合并判定预留余量（px）：分隔符 1px + 组间间隙 ~12px + 安全余量。 */
export const NAV_MERGE_RESERVED_WIDTH = 40;

export interface NavMergeInput {
  /** nav 行可用宽度（px）。未布局（≤0）时视为不可合并。 */
  navWidth: number;
  /** 全部主 tab 的自然宽度之和（含 pill 间距）。 */
  mainWidth: number;
  /** 全部子 tab 的自然宽度之和（含 pill 间距）。 */
  subWidth: number;
  /** 右侧操作区（运行状态 pill + 3D 入口）自然宽度。 */
  actionsWidth: number;
}

/** 是否可以把子 tab 并入主 tab 行。 */
export function shouldMergeSubTabs(input: NavMergeInput): boolean {
  if (input.navWidth <= 0) return false;
  const need = input.mainWidth + input.subWidth + input.actionsWidth + NAV_MERGE_RESERVED_WIDTH;
  return input.navWidth >= need;
}
