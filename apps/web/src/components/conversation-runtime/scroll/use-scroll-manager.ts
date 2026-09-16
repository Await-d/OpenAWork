import { useCallback, useEffect, useRef } from 'react';
import { resolveAtLatestEdge, resolveLatestScrollTop } from './scroll-alignment.js';
import {
  CHAT_FOLLOW_SETTLE_MAX_FRAMES,
  CHAT_LATEST_EDGE_TOLERANCE_PX,
  CHAT_LATEST_FOCUS_THRESHOLD_PX,
  CHAT_LAYOUT_WAIT_MAX_FRAMES,
  CHAT_TRUE_BOTTOM_TOLERANCE_PX,
} from './scroll-constants.js';
import { isProgrammaticPosition, resolveFollowInterrupted } from './scroll-follow-state.js';
import { useScrollIntent } from './use-scroll-intent.js';

/**
 * 自动跟随的最终不变量（**never a time window**）：
 *
 *   suspend = explicit input intent OR a non-programmatic position leaving the
 *             true bottom;
 *   resume  = a programmatic landing still at the latest edge, OR a
 *             non-programmatic position reaching the true bottom, OR an
 *             explicit downward intent landing inside the latest edge.
 *
 * 展开说明：
 * - 「显式输入意图」= wheel / touch / key 指向更早内容（见 `useScrollIntent`）。
 *   决策与位置路径统一走 `resolveFollowInterrupted`，两条路径禁止各写一份判定。
 * - 「非程序化位置」= 不产生输入事件却改变 `scrollTop` 的位移：原生滚动条拖拽、
 *   轨道点击、`Cmd+↑/↓`、书签/搜索 `scrollIntoView`、缓存恢复 `scrollTo`。
 *   区分依据是 `programmaticScrollTopRef`：本模块每次主动滚动（或决定不滚动）
 *   都记录目标落点，`scrollTop === 落点` 的位移只可能来自我们自己。
 * - **位置是两态的**：程序化落点只用宽松的 `atLatestEdge`（内容 / 布局增长的
 *   保持区，含 80–160px 的 spacer 阅读位置）；非程序化位置必须回到真正底部
 *   （`distanceToBottom <= CHAT_TRUE_BOTTOM_TOLERANCE_PX`）才恢复。单一宽松判定
 *   会把用户的一个滚轮刻度（~100px，落在 spacer 区内）当成「已在 latest」并
 *   在下一帧撤销挂起。
 * - **显式向下意图是宽松边缘的唯一例外**：`seek-latest`（wheel 向下 / 触屏朝更新
 *   内容 / ArrowDown / PageDown / End / Space）意味着用户「在追最新内容」，
 *   此时若 `resolveAtLatestEdge` 成立即可恢复跟随（见 `handleSeekLatest`）。
 *   它安全，是因为「翻历史」的手势永远被分类为 `leave-latest`：宽松边缘只在
 *   显式向下意图下被咨询，绝不会被向上手势触发（否则一个上滑刻度会被误恢复）。
 * - 全程不使用「忽略 scroll 事件 N 毫秒」的锁，也没有任何时间窗口：那套锁在
 *   流式期间被逐帧重新武装，曾是吞掉用户手势的根因。
 */

export interface ScrollManagerRefs {
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  pendingScrollFrameRef: React.MutableRefObject<number | null>;
  contentColumnRef: React.RefObject<HTMLDivElement | null>;
  editorPaneRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export interface ScrollManagerSetters {
  setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>;
  setHasPendingFollowContent: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface ScrollManagerEffects {
  /** 会话标识；变化（含 null → 非 null）时整体重置跟随 / 中断状态。 */
  sessionKey: string | null;
  messagesLength: number;
  visibleStreaming: boolean;
  visibleStreamBufferLength: number;
  editorMode: boolean;
}

export interface ScrollManagerOptions {
  /** 滚动到顶部附近时触发加载更早消息（距离顶部 <= 阈值 px）。 */
  onNearTop?: () => void;
  /** 触发加载的阈值（距顶部 px），默认 120。 */
  nearTopThreshold?: number;
  /** 防抖间隔 ms，避免连续触发，默认 800。 */
  nearTopDebounceMs?: number;
}

export interface ScrollManagerReturn {
  isFollowingRef: React.MutableRefObject<boolean>;
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  scrollToBottom: (behavior?: ScrollBehavior, align?: 'center' | 'latest-edge') => void;
  forceFollowToLatest: (behavior?: ScrollBehavior) => () => void;
  isFollowEngaged: () => boolean;
  /**
   * 恢复到一个历史滚动位置（缓存恢复用）。与自动跟随无关：恢复在历史中部 ⇒
   * 视为「用户不在最新」并挂起跟随；恢复在真正底部 ⇒ 继续跟随。
   */
  restoreScrollTop: (top: number) => void;
}

const SETTLE_DISTANCE_EPSILON_PX = 1;

interface ScrollAnchorGeometry {
  anchorBottom: number | null;
  anchorHeight: number;
  anchorTop: number;
}

interface ScrollMeasurement {
  anchor: ScrollAnchorGeometry;
  clientHeight: number;
  distanceToBottom: number;
  maxScrollTop: number;
  scrollTop: number;
}

const NO_ANCHOR_GEOMETRY: ScrollAnchorGeometry = {
  anchorBottom: null,
  anchorHeight: 0,
  anchorTop: 0,
};

/**
 * 锚点几何测量（强制布局，成本最高的一步；每次现测，不做缓存——锚点上方
 * 内容的高度变化会让旧几何失效）。
 *
 * 锚点 = 滚动区域内**最后一条消息组**（`[data-chat-group-root="true"]`，
 * **任意角色**：user / assistant / tool 都带这个属性）。不能按
 * `[data-role="assistant"]` 过滤：会话以 user / tool 消息结尾时，旧实现会退回到
 * 更早的 assistant 组，导致「已到 latest」误判（回底按钮提前隐藏、resume 在
 * 真实底部上方数百 px 触发）。
 *
 * `bottomRef.previousElementSibling` 兜底只在它**自身**也是消息组时才接受；
 * 虚拟化容器 / 权限快捷条等兄弟节点不是锚点，误用会让严格小容差失效。
 */
/** 回落路径：区域里最后一个消息组根（无则 null）。 */
function lastGroupRoot(scrollRegion: HTMLDivElement): HTMLElement | null {
  const groups = scrollRegion.querySelectorAll<HTMLElement>('[data-chat-group-root="true"]');
  return groups[groups.length - 1] ?? null;
}

function measureAnchorGeometry(
  scrollRegion: HTMLDivElement,
  scrollTop: number,
  bottomElement: HTMLDivElement | null,
): ScrollAnchorGeometry {
  const regionRect = scrollRegion.getBoundingClientRect();
  if (regionRect.height === 0) return NO_ANCHOR_GEOMETRY;

  // 廉价路径优先：spacer（bottomRef）紧跟在最后一条消息组之后，它的
  // `previousElementSibling` 就是锚点，省掉每帧一次 O(n) 的 querySelectorAll。
  // 只有当它不匹配时才回落到查询（虚拟化容器 / bottomRef 不是 spacer /
  // 无消息组 / trailingContent 改变了兄弟顺序）。
  const fallbackSibling = bottomElement?.previousElementSibling ?? null;
  const siblingGroup =
    fallbackSibling instanceof HTMLElement &&
    fallbackSibling.matches('[data-chat-group-root="true"]')
      ? fallbackSibling
      : null;
  const anchor = siblingGroup ?? lastGroupRoot(scrollRegion);
  if (anchor === null) return NO_ANCHOR_GEOMETRY;

  const anchorRect = anchor.getBoundingClientRect();
  if (anchorRect.height === 0) return NO_ANCHOR_GEOMETRY;

  const anchorTop = scrollTop + (anchorRect.top - regionRect.top);
  return {
    anchorBottom: anchorTop + anchorRect.height,
    anchorHeight: anchorRect.height,
    anchorTop,
  };
}

export function useScrollManager(
  refs: ScrollManagerRefs,
  setters: ScrollManagerSetters,
  effects: ScrollManagerEffects,
  options?: ScrollManagerOptions,
): ScrollManagerReturn {
  const {
    scrollRegionRef,
    bottomRef,
    pendingScrollFrameRef,
    contentColumnRef,
    editorPaneRef,
    textareaRef,
  } = refs;
  const { setShowScrollToBottom, setHasPendingFollowContent } = setters;
  const { sessionKey, messagesLength, visibleStreaming, visibleStreamBufferLength, editorMode } =
    effects;
  const isFollowingRef = useRef(true);
  const lastNearTopTriggeredRef = useRef(0);
  const isNearTopTriggeredRef = useRef(false);
  /**
   * 本模块最近一次主动滚动的目标 `top`（含「已在目标上、决定不滚」的情况）。
   * reconcile 用它区分「我们滚的」与「外部滚动」：跟随之后内容继续增高时
   * `scrollTop` 仍等于该值，不会被误判为用户离开。
   */
  const programmaticScrollTopRef = useRef<number | null>(null);
  const previousSessionKeyRef = useRef(sessionKey);
  /** `reconcileFollowState` 的有界布局重试帧与其帧计数（成功测量后归零）。 */
  const reconcileRetryFrameRef = useRef<number | null>(null);
  const reconcileRetryCountRef = useRef(0);

  const syncFollowFlags = useCallback(
    (interrupted: boolean): void => {
      setShowScrollToBottom((prev) => (prev === interrupted ? prev : interrupted));
      if (!interrupted) setHasPendingFollowContent((prev) => (prev ? false : prev));
    },
    [setHasPendingFollowContent, setShowScrollToBottom],
  );

  const applyFollowState = useCallback(
    (interrupted: boolean): void => {
      // 挂起时丢弃记录的程序化落点：否则内容增长后，一个落在「陈旧落点」
      // 0.5px 以内的位置会被 `isProgrammaticPosition` 判为程序化落点，
      // 从而用宽松的 `atLatestEdge` 误恢复跟随（用户其实离真正底部还有一段）。
      if (interrupted) programmaticScrollTopRef.current = null;
      isFollowingRef.current = !interrupted;
      syncFollowFlags(interrupted);
    },
    [isFollowingRef, programmaticScrollTopRef, syncFollowFlags],
  );

  const { userInterruptedRef, markUserReturned } = useScrollIntent({
    scrollRegionRef,
    onIntentApplied: applyFollowState,
    onSeekLatest: handleSeekLatest,
  });

  const measureScroll = useCallback(
    (scrollRegion: HTMLDivElement): ScrollMeasurement => {
      const clientHeight = scrollRegion.clientHeight;
      const scrollTop = scrollRegion.scrollTop;
      return {
        anchor: measureAnchorGeometry(scrollRegion, scrollTop, bottomRef.current),
        clientHeight,
        distanceToBottom: scrollRegion.scrollHeight - scrollTop - clientHeight,
        maxScrollTop: Math.max(0, scrollRegion.scrollHeight - clientHeight),
        scrollTop,
      };
    },
    [bottomRef],
  );

  /**
   * 位置对账（唯一的位置入口）：把「当前位置」翻译成跟随状态。
   *
   * 位置是两态的，按落点来源分开裁决（见 `resolveFollowInterrupted`）：
   * - 位置 == 本模块记录的程序化落点 ⇒ 只有内容 / 布局在动 ⇒ 宽松的
   *   `atLatestEdge` 保持 / 恢复跟随；
   * - 位置 != 落点（用户手势 / 滚动条拖拽 / 键盘跳转 / `scrollIntoView` /
   *   缓存恢复）⇒ 只有回到**真正底部**（`atTrueBottom`）才恢复，否则挂起。
   *
   * 它也是「幽灵挂起」的自愈路径：一次零位移的 wheel/ArrowUp 会让
   * `userInterruptedRef = true`，但下一个 reconcile 测到「位置仍是程序化落点
   * 且仍在 latest 边缘内」就会清除它——不需要任何计时器。
   */
  const reconcileFollowState = useCallback(
    (scrollRegion: HTMLDivElement): void => {
      // 容器尚未完成布局（CSS containment / 路由过渡）时 clientHeight 为 0。
      // 直接放弃会让布局窗口内增长的内容永远得不到对账（流式结束后再没有任何
      // 事件来结算），因此在帧预算内重排；计数在成功测量后归零。
      if (scrollRegion.clientHeight === 0) {
        if (reconcileRetryFrameRef.current !== null) return;
        const scheduleRetry = (): void => {
          if (reconcileRetryCountRef.current >= CHAT_LAYOUT_WAIT_MAX_FRAMES) return;
          reconcileRetryCountRef.current += 1;
          reconcileRetryFrameRef.current = requestAnimationFrame(() => {
            reconcileRetryFrameRef.current = null;
            const region = scrollRegionRef.current;
            if (!region) return;
            if (region.clientHeight === 0) {
              scheduleRetry();
              return;
            }
            reconcileFollowState(region);
          });
        };
        scheduleRetry();
        return;
      }
      reconcileRetryCountRef.current = 0;

      const measurement = measureScroll(scrollRegion);
      const atLatestEdge = resolveAtLatestEdge({
        anchorBottom: measurement.anchor.anchorBottom,
        clientHeight: measurement.clientHeight,
        distanceToBottom: measurement.distanceToBottom,
        scrollTop: measurement.scrollTop,
        tolerancePx: CHAT_LATEST_EDGE_TOLERANCE_PX,
      });
      const programmatic = isProgrammaticPosition({
        programmaticScrollTop: programmaticScrollTopRef.current,
        scrollTop: measurement.scrollTop,
      });
      const atTrueBottom = measurement.distanceToBottom <= CHAT_TRUE_BOTTOM_TOLERANCE_PX;
      const interrupted = resolveFollowInterrupted({
        intent: null,
        interrupted: userInterruptedRef.current,
        position: { atLatestEdge, atTrueBottom, programmatic },
      });
      userInterruptedRef.current = interrupted;
      applyFollowState(interrupted);
    },
    [
      applyFollowState,
      measureScroll,
      programmaticScrollTopRef,
      scrollRegionRef,
      userInterruptedRef,
    ],
  );

  const autoFollowLatest = useCallback((): void => {
    // 用户已明确离开 → 任何自动跟随路径都必须立即让路。
    if (userInterruptedRef.current) return;
    if (pendingScrollFrameRef.current !== null) cancelAnimationFrame(pendingScrollFrameRef.current);
    let framesUsed = 0;
    const attempt = (): void => {
      pendingScrollFrameRef.current = null;
      // 帧内再次确认：wheel/touch 可能在调度与执行之间到达。
      if (userInterruptedRef.current) return;
      const sr = scrollRegionRef.current;
      if (!sr) {
        bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
        return;
      }
      // 容器尚未完成布局（CSS containment / 路由过渡）时 clientHeight 为 0，
      // 此时 scrollTo(0) 会把视口钉在顶部。直接 return 会让布局窗口内增长的
      // 内容永远贴不到底，因此在帧预算内重排；用户手势随时可以中止重试。
      if (sr.clientHeight === 0) {
        framesUsed += 1;
        if (framesUsed < CHAT_LAYOUT_WAIT_MAX_FRAMES) {
          pendingScrollFrameRef.current = requestAnimationFrame(attempt);
        }
        return;
      }
      const maxTop = Math.max(0, sr.scrollHeight - sr.clientHeight);
      // 先记录落点再滚动（以及「已在落点上」的分支同样记录）：这是 reconcile
      // 判定「程序化位置」的唯一依据。
      programmaticScrollTopRef.current = maxTop;
      if (Math.abs(sr.scrollTop - maxTop) > 0.5) {
        sr.scrollTo({ top: maxTop, behavior: 'auto' });
      }
    };
    pendingScrollFrameRef.current = requestAnimationFrame(attempt);
  }, [
    bottomRef,
    pendingScrollFrameRef,
    programmaticScrollTopRef,
    scrollRegionRef,
    userInterruptedRef,
  ]);

  /**
   * 显式向下意图（`seek-latest`）的落点裁决：只有视口已回到 latest 边缘才恢复跟随。
   *
   * 位置路径要求非程序化位置回到**真正底部**（严格 32px）才恢复，但用户自然的
   * 阅读位置是「末条消息贴视口底」，距绝对底部恰好一个 spacer（80–160px）——单靠
   * 位置路径永远无法恢复，表现为「碰过滚轮后就不自动跟随了」。向下的显式意图表明
   * 用户是在追最新内容，此时允许用宽松的 `resolveAtLatestEdge` 恢复；「翻历史」的
   * `leave-latest` 不会走这里，所以单一上滑刻度被误恢复的历史回归不会复活。
   *
   * 声明为函数声明（提升）而非 useCallback：它依赖 `autoFollowLatest`，而后者又依赖
   * `useScrollIntent` 返回的 `userInterruptedRef`，按使用顺序书写会形成声明环。
   */
  function handleSeekLatest(): void {
    const sr = scrollRegionRef.current;
    if (!sr || sr.clientHeight === 0) return;
    const measurement = measureScroll(sr);
    const atLatestEdge = resolveAtLatestEdge({
      anchorBottom: measurement.anchor.anchorBottom,
      clientHeight: measurement.clientHeight,
      distanceToBottom: measurement.distanceToBottom,
      scrollTop: measurement.scrollTop,
      tolerancePx: CHAT_LATEST_EDGE_TOLERANCE_PX,
    });
    if (!atLatestEdge) return;
    // 向下意图 + 视口已回到最新边缘 ⇒ 用户是在追最新内容，不是翻历史
    markUserReturned();
    autoFollowLatest();
  }

  /**
   * 显式「回到最新」（回底按钮 / 强制跳转）：清除中断并立即贴底。
   *
   * **协议层只做即时滚动**：`behavior` 参数仅为调用方签名兼容而保留，任何传入值
   * （包括真实调用方传的 `'smooth'`）都会被忽略，实际滚动一律 `behavior: 'auto'`。
   * smooth 动画会派发一连串「不等于记录落点」的中间位置，与外部 / 用户滚动无法
   * 区分，会被 `reconcileFollowState` 误读为离开 latest 而错误挂起跟随。
   */
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto', align: 'center' | 'latest-edge' = 'latest-edge') => {
      markUserReturned();
      applyFollowState(false);
      if (pendingScrollFrameRef.current !== null)
        cancelAnimationFrame(pendingScrollFrameRef.current);
      pendingScrollFrameRef.current = requestAnimationFrame(() => {
        pendingScrollFrameRef.current = null;
        const sr = scrollRegionRef.current;
        if (!sr) {
          bottomRef.current?.scrollIntoView({
            behavior: 'auto',
            block: align === 'center' ? 'center' : 'end',
          });
          return;
        }
        if (sr.clientHeight === 0) return;
        const measurement = measureScroll(sr);
        const nextTop =
          align === 'center' && measurement.anchor.anchorBottom !== null
            ? resolveLatestScrollTop({
                align,
                anchorHeight: measurement.anchor.anchorHeight,
                anchorTop: measurement.anchor.anchorTop,
                centerMarginPx: CHAT_LATEST_FOCUS_THRESHOLD_PX,
                clientHeight: measurement.clientHeight,
                maxScrollTop: measurement.maxScrollTop,
              })
            : measurement.maxScrollTop;
        const scrollDelta = Math.abs(sr.scrollTop - nextTop);
        const shouldScrollForAlign =
          align === 'latest-edge'
            ? scrollDelta > 0.5
            : scrollDelta > CHAT_LATEST_FOCUS_THRESHOLD_PX;
        // 无论是否真的发出 scrollTo，都记录目标落点：内容随后增长时它仍是
        // 「我们自己的位置」，不会被 reconcile 当作外部滚动。
        programmaticScrollTopRef.current = nextTop;
        if (shouldScrollForAlign) sr.scrollTo({ top: nextTop, behavior: 'auto' });
      });
    },
    [
      bottomRef,
      markUserReturned,
      measureScroll,
      pendingScrollFrameRef,
      applyFollowState,
      programmaticScrollTopRef,
      scrollRegionRef,
    ],
  );

  /**
   * 强制回到最新并在 `CHAT_FOLLOW_SETTLE_MAX_FRAMES` 帧内复检，返回取消函数。
   *
   * 与 `scrollToBottom` 一样，**协议层只做即时滚动**：`behavior` 参数仅为调用方
   * 签名兼容而保留，任何传入值（包括真实调用方传的 `'smooth'`）都会被忽略，实际
   * 滚动一律 `behavior: 'auto'`——smooth 动画的中间位置会被
   * `reconcileFollowState` 误读为外部 / 用户滚动而挂起跟随。
   */
  const forceFollowToLatest = useCallback(
    (behavior: ScrollBehavior = 'auto'): (() => void) => {
      markUserReturned();
      applyFollowState(false);

      let cancelled = false;
      let framesUsed = 0;
      let frameId: number | null = null;

      const settle = (): void => {
        frameId = null;
        // 用户在 settle 期间抓住滚动 → 立即停手，不再拉回。
        if (cancelled || userInterruptedRef.current) return;
        const sr = scrollRegionRef.current;
        if (!sr) {
          bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
          return;
        }
        if (sr.clientHeight === 0) {
          // 容器还没完成布局：不能直接 return，否则整个 settle 在第一帧就死掉。
          // 在帧预算内继续重排，等 clientHeight 恢复。
          framesUsed += 1;
          if (framesUsed < CHAT_FOLLOW_SETTLE_MAX_FRAMES) {
            frameId = requestAnimationFrame(settle);
          }
          return;
        }
        const maxTop = Math.max(0, sr.scrollHeight - sr.clientHeight);
        programmaticScrollTopRef.current = maxTop;
        if (maxTop - sr.scrollTop > SETTLE_DISTANCE_EPSILON_PX) {
          sr.scrollTo({ top: maxTop, behavior: 'auto' });
        }
        framesUsed += 1;
        if (
          framesUsed < CHAT_FOLLOW_SETTLE_MAX_FRAMES &&
          maxTop - sr.scrollTop > SETTLE_DISTANCE_EPSILON_PX
        ) {
          frameId = requestAnimationFrame(settle);
        }
      };

      frameId = requestAnimationFrame(settle);

      return () => {
        cancelled = true;
        if (frameId !== null) cancelAnimationFrame(frameId);
      };
    },
    [
      applyFollowState,
      bottomRef,
      markUserReturned,
      programmaticScrollTopRef,
      scrollRegionRef,
      userInterruptedRef,
    ],
  );

  /**
   * 恢复到一个历史滚动位置（缓存恢复用）。与自动跟随无关：恢复在历史中部 ⇒
   * 视为「用户不在最新」并挂起跟随；恢复在真正底部 ⇒ 继续跟随（并把当前位置
   * 记为程序化落点，让后续内容增长沿用宽松边缘的保持逻辑）。
   */
  const restoreScrollTop = useCallback(
    (top: number): void => {
      const sr = scrollRegionRef.current;
      if (!sr) return;
      // 恢复**不是**程序化落点（它可能落在历史中部）：清掉落点，让位置裁决走
      // non-programmatic 分支 —— 只有恢复到真正底部才继续跟随。
      programmaticScrollTopRef.current = null;
      if (pendingScrollFrameRef.current !== null)
        cancelAnimationFrame(pendingScrollFrameRef.current);
      pendingScrollFrameRef.current = requestAnimationFrame(() => {
        pendingScrollFrameRef.current = null;
        const region = scrollRegionRef.current;
        // 元素已卸载 / 被替换：恢复落点已无意义，直接放弃。
        if (!region || region !== sr || !region.isConnected) return;
        region.scrollTo({ top, behavior: 'auto' });
        // 复用同一裁决入口（含 clientHeight === 0 的有界重试），不再内联一份判定。
        reconcileFollowState(region);
        // 恢复确实落在真正底部（裁决结果为「未中断」）时，把当前位置记为程序化
        // 落点，让后续内容增长沿用「程序化落点 + 宽松边缘」的保持逻辑，避免
        // 一次 >32px 的增长把跟随误挂起。
        if (!userInterruptedRef.current) {
          programmaticScrollTopRef.current = region.scrollTop;
        }
      });
    },
    [
      applyFollowState,
      measureScroll,
      pendingScrollFrameRef,
      programmaticScrollTopRef,
      scrollRegionRef,
      userInterruptedRef,
    ],
  );

  const isFollowEngaged = useCallback(
    (): boolean => !userInterruptedRef.current,
    [userInterruptedRef],
  );

  const handleScrollFramePendingRef = useRef(false);
  const handleScrollFrameIdRef = useRef<number | null>(null);
  const lastScrollTargetRef = useRef<HTMLDivElement | null>(null);

  function runNearTopCheck(el: HTMLDivElement): void {
    if (!options?.onNearTop) return;
    const threshold = options.nearTopThreshold ?? 120;
    const debounceMs = options.nearTopDebounceMs ?? 800;
    const now = performance.now();
    if (el.scrollTop <= threshold) {
      if (!isNearTopTriggeredRef.current && now - lastNearTopTriggeredRef.current > debounceMs) {
        isNearTopTriggeredRef.current = true;
        lastNearTopTriggeredRef.current = now;
        // 记录当前滚动位置，加载后恢复视口锚点
        options.onNearTop();
      }
    } else if (el.scrollTop > threshold + 40) {
      // 离开顶部区域后重置，允许下次再次触发
      isNearTopTriggeredRef.current = false;
    }
  }

  function handleScroll(e: React.UIEvent<HTMLDivElement>): void {
    const el = e.currentTarget;
    // 把同一帧内的多次 scroll 合并为一次测量：读数会触发强制布局，
    // 浏览器派发 scroll 的频率高于 rAF（流式期间尤其明显）。
    lastScrollTargetRef.current = el;
    if (handleScrollFramePendingRef.current) return;
    handleScrollFramePendingRef.current = true;
    handleScrollFrameIdRef.current = requestAnimationFrame(() => {
      handleScrollFramePendingRef.current = false;
      handleScrollFrameIdRef.current = null;
      const target = lastScrollTargetRef.current;
      if (!target) return;
      reconcileFollowState(target);
      runNearTopCheck(target);
    });
  }

  useEffect(() => {
    if (previousSessionKeyRef.current === sessionKey) return;
    previousSessionKeyRef.current = sessionKey;
    // 会话切换：整体重置。旧会话的「用户离开」不能在会话 A→B 不经过空列表时
    // 泄漏到新会话（否则新会话永不跟随）；旧会话的程序化落点也必须清除。
    userInterruptedRef.current = false;
    programmaticScrollTopRef.current = null;
    applyFollowState(false);
  }, [applyFollowState, programmaticScrollTopRef, sessionKey, userInterruptedRef]);

  useEffect(() => {
    if (messagesLength === 0 && !visibleStreaming && visibleStreamBufferLength === 0) {
      // 瞬时清空（重连 / refetch / 会话切换的中间态）只收起两个 UI 标志；
      // **不**触碰 userInterruptedRef —— 否则用户的「我滚上去了」
      // 保持会被丢掉，下一批内容把视口拽回底部。
      setShowScrollToBottom((prev) => (prev ? false : prev));
      setHasPendingFollowContent((prev) => (prev ? false : prev));
    }
  }, [
    messagesLength,
    visibleStreamBufferLength,
    visibleStreaming,
    setHasPendingFollowContent,
    setShowScrollToBottom,
  ]);

  useEffect(() => {
    if (visibleStreaming) autoFollowLatest();
  }, [autoFollowLatest, visibleStreaming]);

  useEffect(() => {
    if (visibleStreaming && visibleStreamBufferLength > 0) autoFollowLatest();
  }, [autoFollowLatest, visibleStreamBufferLength, visibleStreaming]);

  useEffect(() => {
    if (editorMode) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && editorPaneRef.current?.contains(activeElement)) {
      textareaRef.current?.focus();
    }
  }, [editorMode, editorPaneRef, textareaRef]);

  useEffect(() => {
    if (messagesLength > 0) autoFollowLatest();
  }, [autoFollowLatest, messagesLength]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const contentColumn = contentColumnRef.current;
    if (!contentColumn) return;
    // ResizeObserver 是工具卡片高度增长（不改变 visibleStreamBufferLength）
    // 之后重新贴底的主路径。先 reconcile 再跟随：
    // - 绝不因 userInterruptedRef 提前 return —— 那会把「位置已回到 latest」的
    //   自愈路径永久切断；
    // - 空会话（瞬时清空）不参与测量，避免空容器的 distanceToBottom = 0 伪造成
    //   「已回 latest」而丢掉用户的滚动保持。
    const observer = new ResizeObserver(() => {
      const scrollRegion = scrollRegionRef.current;
      if (!scrollRegion) return;
      if (messagesLength === 0 && !visibleStreaming) return;
      reconcileFollowState(scrollRegion);
      autoFollowLatest();
    });
    observer.observe(contentColumn);
    return () => observer.disconnect();
  }, [
    autoFollowLatest,
    contentColumnRef,
    messagesLength,
    reconcileFollowState,
    scrollRegionRef,
    visibleStreaming,
  ]);

  useEffect(() => {
    return () => {
      if (handleScrollFrameIdRef.current !== null)
        cancelAnimationFrame(handleScrollFrameIdRef.current);
      if (pendingScrollFrameRef.current !== null)
        cancelAnimationFrame(pendingScrollFrameRef.current);
      if (reconcileRetryFrameRef.current !== null)
        cancelAnimationFrame(reconcileRetryFrameRef.current);
    };
  }, [pendingScrollFrameRef, reconcileRetryFrameRef]);

  return {
    isFollowingRef,
    handleScroll,
    scrollToBottom,
    forceFollowToLatest,
    isFollowEngaged,
    restoreScrollTop,
  };
}
