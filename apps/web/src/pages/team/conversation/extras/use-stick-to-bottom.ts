/**
 * use-stick-to-bottom · 滚动容器「贴底跟随」hook
 *
 * 背景：team 右侧面板从「单条合并时间线」改为「角色窗口墙」后，一屏内会同时存在
 * 多个独立滚动的消息窗。每个窗都需要同一套行为：
 *   1. 新内容到达时自动贴底 —— 流式输出必须跟着走；
 *   2. 用户一旦手动上滚就立刻停止抢滚动 —— 正在读历史时被拽回底部是最烦的交互；
 *   3. 用户自己滚回底部附近后，自动跟随重新生效。
 *
 * 这套逻辑原先内联在 TeamMultiLayerFeed 里（只服务单一滚动容器）。多窗之后必须收敛成
 * 一份实现，否则会被复制 N 份，且各窗行为迟早不一致。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** 距底部多少像素以内视为「用户仍在底部」。 */
const DEFAULT_BOTTOM_THRESHOLD_PX = 48;

export interface StickToBottomResult {
  /** 当前是否处于自动跟随状态。false 表示用户已手动上滚，跟随暂停。 */
  pinned: boolean;
  /** 强制贴底并恢复自动跟随。 */
  pinToBottom: () => void;
}

/**
 * @param ref       滚动容器
 * @param signature 内容签名 —— 变化即视为有新内容产出，触发贴底跟随
 * @param enabled   false 时完全关闭自动跟随
 */
export function useStickToBottom<T extends HTMLElement>(
  ref: RefObject<T | null>,
  signature: string,
  enabled = true,
): StickToBottomResult {
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  const pinToBottom = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
  }, [ref]);

  // 用户滚动：重新判定是否仍贴底。只在状态真正翻转时才 setState，避免滚动期间高频重渲染。
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleScroll = () => {
      const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      const nearBottom = distanceToBottom <= DEFAULT_BOTTOM_THRESHOLD_PX;
      if (nearBottom === pinnedRef.current) return;
      pinnedRef.current = nearBottom;
      setPinned(nearBottom);
    };

    element.addEventListener('scroll', handleScroll, { passive: true });
    return () => element.removeEventListener('scroll', handleScroll);
  }, [ref]);

  // 内容变化：仅在跟随状态下贴底。
  useEffect(() => {
    if (!enabled || !pinnedRef.current) return;
    const element = ref.current;
    if (!element) return;

    let cancelled = false;
    const frames: number[] = [];
    const scrollToBottom = () => {
      if (!cancelled) element.scrollTop = element.scrollHeight;
    };
    // 两段 rAF：等本轮 DOM 提交完成后再量高度，避免追不上异步渲染的 markdown。
    frames.push(
      requestAnimationFrame(() => {
        scrollToBottom();
        frames.push(requestAnimationFrame(scrollToBottom));
      }),
    );

    return () => {
      cancelled = true;
      frames.forEach((frame) => cancelAnimationFrame(frame));
    };
  }, [enabled, ref, signature]);

  return { pinned, pinToBottom };
}
