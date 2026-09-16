import { useCallback, useEffect, useRef } from 'react';
import {
  SCROLL_TOUCH_INTENT_THRESHOLD_PX,
  resolveFollowInterrupted,
  resolveKeyboardIntent,
  resolveTouchIntent,
  resolveWheelIntent,
  type ScrollUserIntent,
} from './scroll-follow-state.js';

export interface ScrollIntentOptions {
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
  /** 关闭时完全不挂监听（默认开启）。 */
  enabled?: boolean;
  /**
   * 中断标志变化后回调（含显式回到底部触发的清除），
   * 让 manager 同步 `showScrollToBottom` / `hasPendingFollowContent`。
   */
  onIntentApplied?: (interrupted: boolean) => void;
  /**
   * 向下意图（`seek-latest`：wheel 向下 / 触屏朝更新内容 / ArrowDown / PageDown /
   * End / Space）回调。本 hook 始终 measurement-free，不读取任何位置：是否真的
   * 回到 latest 边缘由 manager 在 `handleSeekLatest` 里测量后决定。
   */
  onSeekLatest?: () => void;
}

export interface ScrollIntentReturn {
  userInterruptedRef: React.MutableRefObject<boolean>;
  /** 显式「回到最新」（回底按钮 / 强制跳转）时清除中断并通知。 */
  markUserReturned: () => void;
}

/**
 * 用户意图监听：在 document 上以 capture 阶段挂 wheel / touch / key 监听，
 * 再用 `scrollRegionRef.current.contains(event.target)` 过滤到滚动区域。
 *
 * 本 hook 只负责「输入事件 → 意图」这一半，**不读取任何位置裁决**：决策统一走
 * `resolveFollowInterrupted({ intent, interrupted })`（不带 position），因此
 * `leave-latest` 立即挂起。`seek-latest` 只回调 `onSeekLatest`（中断标志保持不变），
 * 由 `useScrollManager` 测量「是否回到 latest 边缘」后再决定是否恢复。另一半
 * 「外部（非程序化）位置 → 挂起 / 程序化落点或真正底部 → 恢复」由
 * `useScrollManager` 的 `reconcileFollowState` 负责（不变量见该文件头部注释）。
 *
 * 之所以挂 document 而不是滚动区域元素：滚动区域会在 ChatPage 的多个布局
 * 分支里挂载/卸载，元素级挂载会和 mount 顺序赛跑（需要重试循环）；document
 * + contains 过滤与挂载顺序无关。
 */
export function useScrollIntent(options: ScrollIntentOptions): ScrollIntentReturn {
  const { scrollRegionRef, enabled = true, onIntentApplied, onSeekLatest } = options;
  const userInterruptedRef = useRef(false);
  const touchStartYRef = useRef<number | null>(null);
  const onIntentAppliedRef = useRef(onIntentApplied);
  const onSeekLatestRef = useRef(onSeekLatest);

  useEffect(() => {
    onIntentAppliedRef.current = onIntentApplied;
  }, [onIntentApplied]);

  useEffect(() => {
    onSeekLatestRef.current = onSeekLatest;
  }, [onSeekLatest]);

  const markUserReturned = useCallback((): void => {
    if (!userInterruptedRef.current) return;
    userInterruptedRef.current = false;
    onIntentAppliedRef.current?.(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const isInsideRegion = (target: EventTarget | null): boolean => {
      const region = scrollRegionRef.current;
      if (!region) return false;
      return target instanceof Node && region.contains(target);
    };

    const hasNoElementFocus = (): boolean => {
      const active = document.activeElement;
      return active === null || active === document.body;
    };

    /**
     * 区域当前是否真的能纵向滚动。拿不到元素时返回 true（不阻断既有行为）。
     */
    const canScrollVertically = (): boolean => {
      const region = scrollRegionRef.current;
      if (!region) return true;
      return region.scrollHeight > region.clientHeight + 1;
    };

    // 键盘事件额外接受「当前没有任何元素获得焦点」的情况（target 是 body）；
    // 输入框聚焦时 activeElement 是 textarea，不会走到这里。
    const isKeydownInScope = (target: EventTarget | null): boolean =>
      isInsideRegion(target) || hasNoElementFocus();

    const applyIntent = (intent: ScrollUserIntent | null): void => {
      if (intent === null) return;
      // 区域不可滚动时「离开底部」没有意义——用户本来就在唯一的位置。
      // 这类手势（短会话上按 ArrowUp / 滚轮上滑 / 8px 触屏位移 / 事件被
      // 嵌套滚动块吞掉）不会产生 scroll 事件，一旦挂起就没有位置对账来清除它：
      // 随后流式内容长到超过视口时，陈旧落点恰好等于 scrollTop，程序化分支
      // 只会返回原值 → 永久停止自动贴底（即用户报的「不会自动滚动到底部」）。
      if (intent === 'leave-latest' && !canScrollVertically()) return;
      // 向下意图不携带位置裁决：交给 manager 的 `onSeekLatest` 用宽松边缘判定
      // 「是否已回到最近处」，本 hook 不测量任何位置。
      if (intent === 'seek-latest') {
        onSeekLatestRef.current?.();
        return;
      }
      // 意图路径不携带位置裁决：leave 立即挂起（抢占「意图已发出、scroll 事件
      // 尚未到达」的那一帧），seek 保持原值并交给位置路径裁决。
      const interrupted = resolveFollowInterrupted({
        intent,
        interrupted: userInterruptedRef.current,
      });
      if (interrupted === userInterruptedRef.current) return;
      userInterruptedRef.current = interrupted;
      onIntentAppliedRef.current?.(interrupted);
    };

    const handleWheel = (event: WheelEvent): void => {
      if (!isInsideRegion(event.target)) return;
      applyIntent(resolveWheelIntent({ deltaY: event.deltaY }));
    };

    const handleTouchStart = (event: TouchEvent): void => {
      if (!isInsideRegion(event.target)) return;
      // 只记录起点，不判定意图——避免把一次点击/长按当成离开。
      const touch = event.touches[0];
      touchStartYRef.current = touch ? touch.clientY : null;
    };

    const handleTouchMove = (event: TouchEvent): void => {
      if (!isInsideRegion(event.target)) return;
      const startY = touchStartYRef.current;
      const touch = event.touches[0];
      if (startY === null || !touch) return;
      applyIntent(
        resolveTouchIntent({
          startY,
          currentY: touch.clientY,
          thresholdPx: SCROLL_TOUCH_INTENT_THRESHOLD_PX,
        }),
      );
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isKeydownInScope(event.target)) return;
      applyIntent(resolveKeyboardIntent({ key: event.key, shiftKey: event.shiftKey }));
    };

    document.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true });
    document.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener('wheel', handleWheel, { capture: true });
      document.removeEventListener('touchstart', handleTouchStart, { capture: true });
      document.removeEventListener('touchmove', handleTouchMove, { capture: true });
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      touchStartYRef.current = null;
    };
  }, [enabled, scrollRegionRef]);

  return { userInterruptedRef, markUserReturned };
}
