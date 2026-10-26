/** 与视口顶部保持的最小间距（px）：命中判定不能把「已经贴在顶边」的消息算作下一跳。 */
const USER_MESSAGE_SCROLL_MARGIN_PX = 60;

/**
 * 跳到视口下方最近的一条用户消息（⌘↓ / 快捷键）。
 *
 * `region` 是消息滚动容器；为空时静默返回，与原先的内联实现一致。
 */
export function scrollToNextUserMessage(region: HTMLElement | null): void {
  if (!region) return;
  const userMessages = region.querySelectorAll<HTMLElement>('[data-role="user"]');
  const regionRect = region.getBoundingClientRect();
  for (const el of Array.from(userMessages)) {
    const rect = el.getBoundingClientRect();
    if (rect.top > regionRect.top + USER_MESSAGE_SCROLL_MARGIN_PX) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
  }
}

/** 跳到视口上方最近的一条用户消息（⌘↑ / 快捷键）。 */
export function scrollToPrevUserMessage(region: HTMLElement | null): void {
  if (!region) return;
  const userMessages = region.querySelectorAll<HTMLElement>('[data-role="user"]');
  const regionRect = region.getBoundingClientRect();
  const arr = Array.from(userMessages).reverse();
  for (const el of arr) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom < regionRect.top + USER_MESSAGE_SCROLL_MARGIN_PX) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
  }
}
