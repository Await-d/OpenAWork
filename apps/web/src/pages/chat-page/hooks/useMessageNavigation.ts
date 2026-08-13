/**
 * useMessageNavigation — 消息级键盘导航 hook（W4-02）
 *
 * 快捷键：
 *   Alt+↑  — 跳转到上一条用户消息
 *   Alt+↓  — 跳转到下一条用户消息
 *   End    — 回到底部（恢复自动滚动）
 *
 * 与 useChatKeyboardShortcuts 的 Cmd+↑/↓ 互补：
 *   Cmd+↑/↓ 已通过 useChatKeyboardShortcuts 注册，针对聊天页全局；
 *   Alt+↑/↓ 由本 hook 独立注册，专注消息时间线内部导航。
 *
 * 跳转逻辑：
 *   使用 scrollIntoView({ block: 'center', behavior: 'smooth' }) 将目标消息
 *   居中显示，跳转后不会影响自动滚动状态（由外层 scrollManager 管理）。
 *
 * 依赖：
 *   scrollRegionRef — 消息列表滚动容器 ref
 *   enabled        — 是否激活（页面不在前台时传 false）
 */

import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';

export interface UseMessageNavigationOptions {
  /** 消息列表滚动容器 ref */
  scrollRegionRef: RefObject<HTMLDivElement | null>;
  /** 是否激活，false 时不响应快捷键 */
  enabled?: boolean;
}

/** 在当前可见区域之前/之后找到下一条 [data-role="user"] 消息元素 */
function findUserMessageEl(
  container: HTMLDivElement,
  direction: 'prev' | 'next',
): HTMLElement | null {
  const els = Array.from(container.querySelectorAll<HTMLElement>('[data-role="user"]'));
  if (els.length === 0) return null;

  const containerRect = container.getBoundingClientRect();
  // 阈值：距顶 / 底60px 缓冲
  const THRESHOLD = 60;

  if (direction === 'next') {
    return (
      els.find((el) => el.getBoundingClientRect().top > containerRect.top + THRESHOLD) ?? null
    );
  } else {
    // 向上：从后往前找第一个 bottom 小于当前可见区域 top 的消息
    return (
      [...els]
        .reverse()
        .find((el) => el.getBoundingClientRect().bottom < containerRect.top + THRESHOLD) ?? null
    );
  }
}

export function useMessageNavigation({
  scrollRegionRef,
  enabled = true,
}: UseMessageNavigationOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;
      if (!scrollRegionRef.current) return;

      const isAlt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

      if (isAlt && event.key === 'ArrowDown') {
        event.preventDefault();
        const el = findUserMessageEl(scrollRegionRef.current, 'next');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      if (isAlt && event.key === 'ArrowUp') {
        event.preventDefault();
        const el = findUserMessageEl(scrollRegionRef.current, 'prev');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      // End 键 — 滚动到容器底部（触发 scrollManager 恢复自动跟随）
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'End') {
        const target = event.target as HTMLElement;
        const isInput =
          target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        if (isInput) return;

        event.preventDefault();
        const container = scrollRegionRef.current;
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
    },
    [enabled, scrollRegionRef],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleKeyDown]);
}
