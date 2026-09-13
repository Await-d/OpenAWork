import { useEffect, type RefObject } from 'react';

/**
 * 当激活会话变化时，把它滚动进容器可视区。
 *
 * 仅在目标行不在可视范围内时滚动（`block: 'nearest'`），
 * 避免打断用户已有的滚动位置。
 */
export function useScrollActiveSessionIntoView(
  containerRef: RefObject<HTMLElement | null>,
  activeSessionId: string | null,
): void {
  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const target = container.querySelector<HTMLElement>(
      `[data-session-id="${escapeAttributeValue(activeSessionId)}"]`,
    );
    if (!target) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const fullyVisible =
      targetRect.top >= containerRect.top && targetRect.bottom <= containerRect.bottom;
    if (fullyVisible) {
      return;
    }

    target.scrollIntoView?.({ block: 'nearest' });
  }, [activeSessionId, containerRef]);
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
