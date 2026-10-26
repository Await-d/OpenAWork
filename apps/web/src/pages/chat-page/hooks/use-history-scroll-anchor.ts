import { useCallback, useEffect, useLayoutEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';

import {
  captureScrollAnchor,
  restoreScrollAnchor,
  type ScrollAnchorSnapshot,
} from '../../../components/conversation-runtime/scroll/scroll-anchor.js';
import { writeRefCurrent } from '../../../utils/ref/ref-current.js';

const LOAD_MORE_MESSAGE_INCREMENT = 20;

type LoadSessionSnapshot = (
  sessionId: string,
  options?: { messageLimit?: number; replaceMessages?: boolean },
) => Promise<unknown>;

type UseHistoryScrollAnchorDeps = {
  readonly armHistoryAnchor: () => void;
  readonly armHistoryAnchorImplRef: MutableRefObject<(() => void) | null>;
  readonly currentSessionId: string | null;
  readonly firstVisibleMessageId: string | null;
  readonly firstVisibleMessageIdRef: MutableRefObject<string | null>;
  readonly historyAnchorRestoreCancelRef: MutableRefObject<(() => void) | null>;
  readonly lastAnchorMessageIdRef: MutableRefObject<string | null>;
  /** 写入「锚点时刻的可见消息 id」；由父组件回调完成写入，避免改 hook 参数。 */
  readonly setLastAnchorMessageId: (id: string | null) => void;
  readonly loadCurrentSessionSnapshot: LoadSessionSnapshot;
  readonly pendingHistoryAnchor: ScrollAnchorSnapshot | null;
  readonly sanitizedHistoricalMessagesLength: number;
  readonly scrollRegionRef: RefObject<HTMLDivElement | null>;
  readonly setPendingHistoryAnchor: (value: ScrollAnchorSnapshot | null) => void;
  readonly setPendingMessageScroll: (value: null) => void;
  readonly setServerTotalTurnCount: (value: number | null) => void;
  readonly setVisibleMessageCount: Dispatch<SetStateAction<number>>;
  readonly visibleMessageCount: number | undefined;
};

/**
 * 头部插入历史消息时的滚动锚定：加载旧消息会往渲染列表头部插入内容，
 * 视口若不加锚定会被推离阅读位置。这里在插入前捕获「视口内最靠上的可见消息」，
 * 插入后在下一帧恢复。
 */
export function useHistoryScrollAnchor(deps: UseHistoryScrollAnchorDeps) {
  const {
    armHistoryAnchor,
    armHistoryAnchorImplRef,
    currentSessionId,
    firstVisibleMessageId,
    firstVisibleMessageIdRef,
    historyAnchorRestoreCancelRef,
    lastAnchorMessageIdRef,
    setLastAnchorMessageId,
    loadCurrentSessionSnapshot,
    pendingHistoryAnchor,
    sanitizedHistoricalMessagesLength,
    scrollRegionRef,
    setPendingHistoryAnchor,
    setPendingMessageScroll,
    setServerTotalTurnCount,
    setVisibleMessageCount,
    visibleMessageCount,
  } = deps;

  /** 捕获当前滚动锚点：视口内最靠上的一条可见消息 + 滚动区几何。 */
  const captureHistoryScrollAnchor = useCallback((): ScrollAnchorSnapshot => {
    const region = scrollRegionRef.current;
    const messageId = firstVisibleMessageIdRef.current;
    const anchorElement =
      messageId !== null && region !== null
        ? region.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
        : null;
    return captureScrollAnchor(region, anchorElement);
  }, [firstVisibleMessageIdRef, scrollRegionRef]);

  /**
   * 武装头部插入锚点：记录加载前的阅读位置快照。同时挂到
   * `armHistoryAnchorImplRef`，让更早定义的 `ensureMessageVisible` 也能通过
   * `armHistoryAnchor` 稳定引用（ref 转发，无 TDZ 问题）。
   */
  const armHistoryAnchorImpl = useCallback((): void => {
    // 目前只有「加载更早」两条路径调用（按钮 / onNearTop）。历史跳转与搜索走
    // `pendingMessageScroll` 粗滚动，不再武装锚点，否则会互相覆盖。
    setLastAnchorMessageId(firstVisibleMessageIdRef.current);
    setPendingHistoryAnchor(captureHistoryScrollAnchor());
  }, [
    captureHistoryScrollAnchor,
    firstVisibleMessageIdRef,
    lastAnchorMessageIdRef,
    setLastAnchorMessageId,
    setPendingHistoryAnchor,
  ]);

  useEffect(() => {
    // `armHistoryAnchorImplRef` 由父组件创建并传入（属参数），直接赋值会被 React
    // Compiler 判为 "Mutating component props or hook arguments"，让整个 hook
    // 静默退出优化。写入收进模块函数，时机与语义不变。
    writeRefCurrent(armHistoryAnchorImplRef, armHistoryAnchorImpl);
  }, [armHistoryAnchorImpl, armHistoryAnchorImplRef]);

  /**
   * 加载更多历史消息（手动「加载更早」按钮与上滑 onNearTop 共用）：
   * 本地窗口还有隐藏消息时直接扩窗口，否则拉一次服务端快照。
   * 两条路径都会往渲染列表头部插入旧消息，因此先武装滚动锚点。
   */
  const handleLoadEarlierMessages = useCallback((): void => {
    const localHidden =
      sanitizedHistoricalMessagesLength -
      (visibleMessageCount ?? sanitizedHistoricalMessagesLength);
    if (localHidden > 0) {
      armHistoryAnchor();
      setVisibleMessageCount((prev) => prev + LOAD_MORE_MESSAGE_INCREMENT);
      return;
    }
    if (!currentSessionId) return;
    armHistoryAnchor();
    void loadCurrentSessionSnapshot(currentSessionId, {
      replaceMessages: true,
    })
      .then(() => {
        setServerTotalTurnCount(null);
        setVisibleMessageCount((prev) => prev + LOAD_MORE_MESSAGE_INCREMENT);
      })
      .catch(() => undefined);
  }, [
    armHistoryAnchor,
    currentSessionId,
    loadCurrentSessionSnapshot,
    sanitizedHistoricalMessagesLength,
    setServerTotalTurnCount,
    setVisibleMessageCount,
    visibleMessageCount,
  ]);

  useEffect(() => {
    // 会话切换：旧会话的待恢复锚点必须丢弃，不能落到新会话的滚动区上。
    // `historyAnchorRestoreCancelRef` 由父组件创建并传入（属参数），直接写会被
    // React Compiler 判为 "Mutating component props or hook arguments"。
    historyAnchorRestoreCancelRef.current?.();
    writeRefCurrent(historyAnchorRestoreCancelRef, null);
    setPendingHistoryAnchor(null);
    setPendingMessageScroll(null);
    setLastAnchorMessageId(null);
  }, [
    currentSessionId,
    historyAnchorRestoreCancelRef,
    lastAnchorMessageIdRef,
    setLastAnchorMessageId,
    setPendingHistoryAnchor,
    setPendingMessageScroll,
  ]);

  // 卸载时清理悬挂的恢复 rAF。
  useEffect(() => {
    return () => {
      historyAnchorRestoreCancelRef.current?.();
      writeRefCurrent(historyAnchorRestoreCancelRef, null);
    };
  }, [historyAnchorRestoreCancelRef]);

  // 「恢复视口」：旧消息落入窗口后（`firstVisibleMessageId` 相对锚点时刻变化），
  // 在下一帧把视口恢复到加载前的阅读位置。layout effect 保证恢复先于绘制落地。
  useLayoutEffect(() => {
    if (pendingHistoryAnchor === null) return;
    if (firstVisibleMessageId === lastAnchorMessageIdRef.current) return;

    const anchorSnapshot = pendingHistoryAnchor;
    // 先取消上一次仍未落地的恢复，再排新的；**不能**把 cancel 作为 effect 的
    // 返回值——setState 会触发重渲染，cleanup 会在 rAF 落地前把它取消掉。
    historyAnchorRestoreCancelRef.current?.();
    writeRefCurrent(
      historyAnchorRestoreCancelRef,
      restoreScrollAnchor(scrollRegionRef.current, anchorSnapshot, (): Element | null => {
        const messageRegion = scrollRegionRef.current;
        if (messageRegion === null || lastAnchorMessageIdRef.current === null) return null;
        return messageRegion.querySelector<HTMLElement>(
          `[data-message-id="${lastAnchorMessageIdRef.current}"]`,
        );
      }),
    );
    setPendingHistoryAnchor(null);
  }, [
    firstVisibleMessageId,
    historyAnchorRestoreCancelRef,
    lastAnchorMessageIdRef,
    setLastAnchorMessageId,
    pendingHistoryAnchor,
    scrollRegionRef,
    setPendingHistoryAnchor,
  ]);

  return { handleLoadEarlierMessages };
}
