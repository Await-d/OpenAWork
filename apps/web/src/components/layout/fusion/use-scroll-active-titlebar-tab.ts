/**
 * useScrollActiveTitlebarTab —— 让当前激活的会话标签自动进入顶栏可视区。
 *
 * 顶栏标签栏（`.titlebar-tab-strip__tab-list`）是单行横向滚动容器，标签一多就只能靠
 * 手动滚动才能看到后面的会话。切换会话（点标签 / 侧栏会话 / 快捷键 / 关闭后自动接替）
 * 只改变激活态，容器不会自己移动，用户就看不到「我现在在哪个会话上」。
 *
 * 这里刻意不调用 `scrollIntoView`：它会把**所有**可滚动祖先一起滚动（页面、外层容器
 * 都可能被带走），而这里只该横向移动标签栏自身。改为按「容器可视区」与「激活标签」
 * 的横向矩形差直接修正 `scrollLeft`，作用面只有这一个容器。
 *
 * 已经完整可见时保持原样——用户手动滚过的位置不该被无条件重置。
 */
import { useEffect, type RefObject } from 'react';

/** 激活标签贴边时预留的呼吸间距：滚动后留一点余量，避免文字刚好卡在裁切边缘。 */
export const ACTIVE_TAB_SCROLL_MARGIN_PX = 8;

/** 计算激活标签入视所需的横向滚动量。 */
export interface TitlebarTabScrollMetrics {
  /** 容器可视区左边界（`getBoundingClientRect().left`）。 */
  readonly containerLeft: number;
  /** 容器可视区右边界（`getBoundingClientRect().right`）。 */
  readonly containerRight: number;
  /** 激活标签左边界。 */
  readonly tabLeft: number;
  /** 激活标签右边界。 */
  readonly tabRight: number;
  /** 容器当前横向滚动量。 */
  readonly currentScrollLeft: number;
}

/**
 * 返回把激活标签滚入可视区后的 `scrollLeft`；返回 `null` 表示不需要滚动。
 *
 * 只处理横向：标签栏不存在纵向滚动，`scrollTop` 必须保持不变。
 */
export function computeTitlebarTabScrollLeft(metrics: TitlebarTabScrollMetrics): number | null {
  const { containerLeft, containerRight, tabLeft, tabRight, currentScrollLeft } = metrics;
  const containerWidth = containerRight - containerLeft;
  const tabWidth = tabRight - tabLeft;

  // 容器尚未布局（隐藏 / 首次测量前）时没有任何可滚动空间，直接放行，
  // 否则 0 宽度会被误判成「标签超宽」而乱滚。
  if (containerWidth <= 0) {
    return null;
  }

  const overflowRight = tabRight - containerRight;
  const overflowLeft = containerLeft - tabLeft;

  // 完全可见：保留用户当前的滚动位置。
  if (overflowRight <= 0 && overflowLeft <= 0) {
    return null;
  }

  // 标签自身比可视区还宽时，右对齐会把图标与标题开头永久推出视野，优先贴左；
  // 但左边界本来就可见时说明用户正看着标题开头，不要再动。
  if (tabWidth >= containerWidth) {
    if (overflowLeft <= 0) {
      return null;
    }

    return Math.max(0, currentScrollLeft - overflowLeft - ACTIVE_TAB_SCROLL_MARGIN_PX);
  }

  // `scrollLeft` 没有负值：回退到最左侧时直接贴 0，避免把非法值写回容器。
  return overflowRight > 0
    ? currentScrollLeft + overflowRight + ACTIVE_TAB_SCROLL_MARGIN_PX
    : Math.max(0, currentScrollLeft - overflowLeft - ACTIVE_TAB_SCROLL_MARGIN_PX);
}

/**
 * 把滚动量写回容器。
 *
 * 刻意放在模块级：React Compiler 会把「在 hook 体内写 hook 参数成员的属性」判成
 * `Mutating component props or hook arguments`，进而让整个 hook 脱靶；
 * 包装成普通函数后语义不变，编译器也能正常优化。
 */
function applyScrollLeft(container: HTMLElement, nextScrollLeft: number): void {
  container.scrollLeft = nextScrollLeft;
}

/**
 * 激活标签变化时把它滚进标签栏可视区。
 *
 * @param containerRef 标签栏滚动容器（`overflow-x: auto`）。
 * @param activeTabId 当前激活标签 id；为 `null`（无标签 / 非 Chat 路由）时不处理。
 */
export function useScrollActiveTitlebarTab(
  containerRef: RefObject<HTMLElement | null>,
  activeTabId: string | null,
): void {
  useEffect(() => {
    if (!activeTabId) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    // 激活标签由 `TitlebarTab` 的 `data-active` 标记，容器内唯一，
    // 不必把 id 拼进选择器（也就免了属性值转义）。
    const activeTab = container.querySelector<HTMLElement>('[role="tab"][data-active="true"]');
    if (!activeTab) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    const nextScrollLeft = computeTitlebarTabScrollLeft({
      containerLeft: containerRect.left,
      containerRight: containerRect.right,
      tabLeft: tabRect.left,
      tabRight: tabRect.right,
      currentScrollLeft: container.scrollLeft,
    });

    if (nextScrollLeft === null) {
      return;
    }

    applyScrollLeft(container, nextScrollLeft);
  }, [activeTabId, containerRef]);
}
