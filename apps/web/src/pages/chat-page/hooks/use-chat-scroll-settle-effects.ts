import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

type ForceFollowToLatest = (behavior: 'auto' | 'smooth') => void | (() => void);

type UseChatScrollSettleEffectsDeps = {
  readonly forceFollowToLatest: ForceFollowToLatest;
  readonly isFollowEngaged: () => boolean;
  readonly isPageActive: boolean;
  readonly isSessionSnapshotReady: boolean;
  readonly messagesLength: number;
  /** 消费「本次是从缓存恢复」标记，由父组件回调写入。 */
  readonly markSessionCacheRestoreConsumed: () => void;
  readonly sessionRestoredFromCacheRef: MutableRefObject<boolean>;
};

/**
 * 「首次快照就绪」与「页面重新激活」两个贴底时机，以及它们依赖的 ref 镜像。
 *
 * Effect A：会话切换后首次拿到快照 → 贴底（`prevSnapshotReadyRef` 防止每次
 * messages.length 变化都重跑）。用 layout effect：`forceFollowToLatest` 的同步首帧
 * 在本帧绘制前贴底；放到 passive effect 时，长历史会话打开后第一帧会画在旧位置。
 *
 * Effect B：页面从 `display: none` 恢复 → 若用户仍处于跟随态则贴底；正在翻历史
 * 的用户保持原位。
 *
 * 两个 effect 都只依赖稳定回调与「是否就绪/激活」，`messages.length` 走 ref，
 * 避免流式更新导致 cleanup 取消进行中的平滑滚动。
 */
export function useChatScrollSettleEffects(deps: UseChatScrollSettleEffectsDeps) {
  const {
    forceFollowToLatest,
    isFollowEngaged,
    isPageActive,
    isSessionSnapshotReady,
    markSessionCacheRestoreConsumed,
    messagesLength,
    sessionRestoredFromCacheRef,
  } = deps;

  const prevSnapshotReadyRef = useRef(false);
  const prevPageActiveRef = useRef(isPageActive);
  // When true, the next scroll-to-latest trigger (Effect A or B) should be
  // suppressed because the cache-restore path already set scrollTop.
  const suppressNextScrollRef = useRef(false);

  // Refs mirroring reactive state for use inside effects that must NOT
  // re-run when these values change (to avoid canceling an in-progress
  // settleObserver via cleanup).
  // 镜像写下沉到 **layout** effect：渲染期写 ref 会让 React Compiler 放弃优化调用方；
  // 而 Effect A / Effect B 同为 layout effect，layout effect 按声明顺序执行，
  // 本 effect 声明在它们之前，因此它们读到的仍是本次提交的最新值。
  const isSessionSnapshotReadyRef = useRef(isSessionSnapshotReady);
  const messagesLengthRef = useRef(messagesLength);
  useLayoutEffect(() => {
    isSessionSnapshotReadyRef.current = isSessionSnapshotReady;
    messagesLengthRef.current = messagesLength;
  });

  useLayoutEffect(() => {
    if (!prevSnapshotReadyRef.current && isSessionSnapshotReady && messagesLengthRef.current > 0) {
      // When restored from cache, scroll was already set — skip the forced scroll-to-bottom
      if (sessionRestoredFromCacheRef.current) {
        markSessionCacheRestoreConsumed();
        suppressNextScrollRef.current = true;
        prevSnapshotReadyRef.current = isSessionSnapshotReady;
        return;
      }
      suppressNextScrollRef.current = false;
      const cleanup = forceFollowToLatest('auto');
      prevSnapshotReadyRef.current = isSessionSnapshotReady;
      return cleanup;
    }
    prevSnapshotReadyRef.current = isSessionSnapshotReady;
  }, [forceFollowToLatest, isSessionSnapshotReady, sessionRestoredFromCacheRef]);

  useEffect(() => {
    if (!isSessionSnapshotReady) {
      prevSnapshotReadyRef.current = false;
    }
  }, [isSessionSnapshotReady]);

  useLayoutEffect(() => {
    const wasActive = prevPageActiveRef.current;
    prevPageActiveRef.current = isPageActive;
    if (
      !wasActive &&
      isPageActive &&
      isSessionSnapshotReadyRef.current &&
      messagesLengthRef.current > 0 &&
      isFollowEngaged()
    ) {
      // If Effect A just ran a cache-restore skip, don't override the
      // restored scrollTop with a forced scroll-to-bottom.
      if (suppressNextScrollRef.current) {
        suppressNextScrollRef.current = false;
        return;
      }
      const cleanup = forceFollowToLatest('auto');
      return cleanup;
    }
  }, [isPageActive, forceFollowToLatest, isFollowEngaged]);
}
