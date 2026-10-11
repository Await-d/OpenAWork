/**
 * 头部插入历史消息（prepend load）的滚动锚点 —— chat / team 通用。
 *
 * 在旧消息插入列表顶部之前调用 `captureScrollAnchor` 记录恢复目标；
 * 列表长高之后调用 `restoreScrollAnchor`，把视口恢复回加载前的阅读位置，
 * 避免「加载旧消息后视口跳到最新加载的一批旧消息顶部」。
 *
 * 恢复采用两级优先级：
 * - 锚点元素（加载前视口内最靠上的一条消息）存在时，恢复到它加载前的
 *   绝对位置（`scrollTop + 元素相对滚动区顶部的偏移`）；
 * - 元素不存在（虚拟视口未挂载 / DOM 被替换）时，回退「距底部距离不变」。
 *
 * 恢复调度用双层 rAF：第一帧等新内容 commit，第二帧等虚拟化估算高度
 * 被首测修正后再落位，避免中间帧出现可见跳动。
 */

export interface ScrollAnchorSnapshot {
  /** 捕获锚点时的滚动内容总高度（距底部回退用）。 */
  scrollHeight: number;
  /** 捕获锚点时的 scrollTop。 */
  scrollTop: number;
  /** 锚点元素相对滚动内容顶部的绝对偏移；捕获时锚点不存在则为 null。 */
  anchorTop: number | null;
}

export function captureScrollAnchor(
  scrollRegion: HTMLDivElement | null,
  anchorElement: Element | null,
): ScrollAnchorSnapshot {
  const snapshot: ScrollAnchorSnapshot = {
    scrollHeight: 0,
    scrollTop: 0,
    anchorTop: null,
  };
  if (scrollRegion === null) return snapshot;

  snapshot.scrollHeight = scrollRegion.scrollHeight;
  snapshot.scrollTop = scrollRegion.scrollTop;

  if (anchorElement !== null) {
    const regionRect = scrollRegion.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();
    if (Number.isFinite(anchorRect.top) && anchorRect.height > 0) {
      snapshot.anchorTop = scrollRegion.scrollTop + (anchorRect.top - regionRect.top);
    }
  }

  return snapshot;
}

/**
 * 在新内容落地后恢复视口。`resolveAnchorElement` 在恢复时重新查询锚点节点
 * （同一条消息在重新渲染后可能换了 DOM 节点，但 `data-message-id` 不变）。
 *
 * 虚拟视口场景下，若锚点节点当前不在挂载窗口内（返回 null），说明用户
 * 停留在最顶部、正在逐批加载更早的消息——此时保持「贴顶」（scrollTop = 0）
 * 即可；其余情况才走「距底部距离不变」回退。
 *
 * 返回取消函数，供会话切换 / 组件卸载时清理悬挂的 rAF。
 */
export function restoreScrollAnchor(
  scrollRegion: HTMLDivElement | null,
  snapshot: ScrollAnchorSnapshot,
  resolveAnchorElement: () => Element | null,
): () => void {
  let cancelled = false;
  let frameId = 0;

  const apply = (): void => {
    if (cancelled || scrollRegion === null || scrollRegion.isConnected === false) return;

    const regionRect = scrollRegion.getBoundingClientRect();
    if (regionRect.height === 0) return;

    let targetTop: number | null = null;

    if (snapshot.anchorTop !== null) {
      const anchor = resolveAnchorElement();
      if (anchor === null) {
        // 锚点节点不在挂载窗口内（如虚拟视口未渲染）：保持「距底部距离」不变。
        targetTop = Math.max(
          0,
          scrollRegion.scrollHeight - (snapshot.scrollHeight - snapshot.scrollTop),
        );
      } else {
        const anchorRect = anchor.getBoundingClientRect();
        if (Number.isFinite(anchorRect.top) && anchorRect.height > 0) {
          // 目标：恢复后锚点相对视口顶部的偏移 = 捕获时的偏移。
          // 加载前偏移 = anchorTop − scrollTop(加载前)，加载后偏移 = 当前视口内偏移。
          const relBefore = snapshot.anchorTop - snapshot.scrollTop;
          const relAfter = anchorRect.top - regionRect.top;
          targetTop = scrollRegion.scrollTop + (relAfter - relBefore);
        }
      }
    }

    if (targetTop === null) {
      // 无锚点信息：保持「距底部距离」不变。
      targetTop = Math.max(
        0,
        scrollRegion.scrollHeight - (snapshot.scrollHeight - snapshot.scrollTop),
      );
    }

    const maxTop = Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight);
    scrollRegion.scrollTop = Math.max(0, Math.min(targetTop, maxTop));
  };

  frameId = requestAnimationFrame(() => {
    frameId = requestAnimationFrame(apply);
  });

  return (): void => {
    cancelled = true;
    if (frameId !== 0) {
      cancelAnimationFrame(frameId);
    }
  };
}
