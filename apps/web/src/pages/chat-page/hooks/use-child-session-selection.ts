/**
 * 子代理选择编排（ChatPage 域）。
 *
 * 右侧「代理」面板的预览目标有两个来源：
 * 1. **显式选择**：用户点击消息流 task 卡片 / 子代理通知行 / 运行列表 / 面板内
 *    切换器，或按 Alt+↑/↓ 循环 —— 意图明确，必须生效。
 * 2. **自动选择**：运行列表变化时的兜底（优先 running/pending，其次第一项），
 *    让面板在用户没有指定目标时也有内容可看。
 *
 * 历史缺陷：两种来源共用一个 `selectedChildSessionId`，自动选择逻辑会立即
 * 覆盖/清空刚点击的目标 —— 当被点击的子代理不在 `subAgentRunItems` 中
 * （历史子会话、刚结束尚未同步、已清理、任务卡片来自更早的会话快照）时，
 * 点击后预览被回填成别的子代理或直接清空，表现为「点击没反应」。
 *
 * 本 hook 用 `explicitSelectionRef` 记录显式来源：自动选择只在**没有显式选择**
 * 时兜底；显式选择即使不在运行列表中也不被覆盖，直到会话切换或用户改选其他目标。
 */

import { useCallback, useEffect, useRef } from 'react';
import type { SidePanelActiveTab } from '../../../stores/ui/uiState.js';
import type { RightPanelTabId } from '../panels/right-panel-tabs.js';
import type { SubAgentRunItem } from '../panels/sub-agent-run-list.js';

export interface UseChildSessionSelectionOptions {
  /** 当前会话 id；切换会话时清除显式选择保护。 */
  readonly currentSessionId: string | null;
  readonly isFusionLayout: boolean;
  readonly isMobileViewport: boolean;
  readonly rightTab: RightPanelTabId;
  readonly selectedChildSessionId: string | null;
  readonly setReviewPanelOpened: (open: boolean) => void;
  readonly setRightOpen: (value: boolean) => void;
  readonly setRightTab: (
    value: RightPanelTabId | ((prev: RightPanelTabId) => RightPanelTabId),
  ) => void;
  readonly setSelectedChildSessionId: (value: string | null) => void;
  readonly setSidePanelActiveTab: (tab: SidePanelActiveTab) => void;
  readonly subAgentRunItems: readonly SubAgentRunItem[];
  /**
   * 该父会话上次查看的子会话（从 `uiState.activeChildSessionIdBySession` 读出）。
   * 仅作为自动选择的**首选候选**：仍必须在 `subAgentRunItems` 里存在，否则说明
   * 子会话已被清理，按原规则回落到运行中 / 第一项。
   */
  readonly rememberedChildSessionId?: string | null;
  /**
   * 用户**显式**选中某个子会话时回调（点击卡片 / 通知行 / 列表 / 面板切换器 /
   * Alt+↑↓）。用于把「这个会话上次看的是谁」持久化。
   *
   * 为什么不放在消费端监听 `selectedChildSessionId` 变化：自动回填也会改它，
   * 而切会话时父会话与选中态的更新不在同一提交里，监听变化会把上一个会话的
   * 子会话 id 误写到新会话的桶里。只在显式意图处落库，归属天然正确。
   */
  readonly onExplicitChildSessionSelected?: (sessionId: string) => void;
}

export interface ChildSessionSelectionController {
  /**
   * 显式选中某个子代理并确保右侧面板在「代理」tab 上打开；
   * 桌面 Fusion 布局同步展开停靠侧栏。
   */
  readonly openChildSessionInspector: (sessionId: string) => void;
  /** 显式选中某个子代理（不改变右侧面板开合，供面板内切换器复用）。 */
  readonly selectChildSession: (sessionId: string) => void;
}

export function useChildSessionSelection(
  options: UseChildSessionSelectionOptions,
): ChildSessionSelectionController {
  const {
    currentSessionId,
    isFusionLayout,
    isMobileViewport,
    rightTab,
    selectedChildSessionId,
    setReviewPanelOpened,
    setRightOpen,
    setRightTab,
    setSelectedChildSessionId,
    setSidePanelActiveTab,
    subAgentRunItems,
    rememberedChildSessionId = null,
    onExplicitChildSessionSelected,
  } = options;

  const explicitSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    // 会话切换后旧的显式选择不再有意义（选中态本身也由会话切换流程清空），
    // 同步清保护标记，避免悬空 id 继续拦截新会话的自动选择。
    explicitSelectionRef.current = null;
  }, [currentSessionId]);

  const selectChildSession = useCallback(
    (sessionId: string) => {
      explicitSelectionRef.current = sessionId;
      setSelectedChildSessionId(sessionId);
      // 显式意图处落库：此刻 `currentSessionId` 就是用户正在看的会话，
      // 归属天然正确，不受切会话时序影响。
      onExplicitChildSessionSelected?.(sessionId);
    },
    [onExplicitChildSessionSelected, setSelectedChildSessionId],
  );

  const openChildSessionInspector = useCallback(
    (sessionId: string) => {
      selectChildSession(sessionId);
      setRightOpen(true);
      setRightTab('agent');
      // 桌面 Fusion 停靠面板仅在 reviewPanelOpened 时渲染：只切 tab 不会展开面板。
      if (isFusionLayout && !isMobileViewport) {
        setSidePanelActiveTab('agent');
        setReviewPanelOpened(true);
      }
    },
    [
      isFusionLayout,
      isMobileViewport,
      selectChildSession,
      setReviewPanelOpened,
      setRightOpen,
      setRightTab,
      setSidePanelActiveTab,
    ],
  );

  useEffect(() => {
    const isExplicitSelection =
      selectedChildSessionId !== null && explicitSelectionRef.current === selectedChildSessionId;

    if (subAgentRunItems.length === 0) {
      // 显式打开的子代理可能不在运行列表（历史 / 已清理）：保留预览与 agent tab。
      if (isExplicitSelection) {
        return;
      }
      if (selectedChildSessionId !== null) {
        setSelectedChildSessionId(null);
      }
      if (rightTab === 'agent') {
        setRightTab('overview');
      }
      return;
    }

    if (
      selectedChildSessionId &&
      (isExplicitSelection ||
        subAgentRunItems.some((item) => item.sessionId === selectedChildSessionId))
    ) {
      return;
    }

    // 自动选择优先级：该会话上次查看的子会话（仍是有效候选时）> 运行中 / 待处理 >
    // 第一项。记住的是「用户的阅读现场」，重新进入会话时不该被运行态抢走焦点。
    const rememberedCandidate =
      rememberedChildSessionId !== null &&
      subAgentRunItems.some((item) => item.sessionId === rememberedChildSessionId)
        ? rememberedChildSessionId
        : null;
    const runningCandidate =
      subAgentRunItems.find((item) => item.status === 'running' || item.status === 'pending') ??
      subAgentRunItems[0];
    const nextId = rememberedCandidate ?? runningCandidate?.sessionId ?? null;
    if (nextId !== selectedChildSessionId) {
      setSelectedChildSessionId(nextId);
    }
  }, [
    rememberedChildSessionId,
    rightTab,
    selectedChildSessionId,
    setRightTab,
    setSelectedChildSessionId,
    subAgentRunItems,
  ]);

  useEffect(() => {
    if (subAgentRunItems.length < 2) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
        return;
      }

      event.preventDefault();
      const currentIndex = subAgentRunItems.findIndex(
        (item) => item.sessionId === selectedChildSessionId,
      );
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex =
        event.key === 'ArrowDown'
          ? (safeIndex + 1) % subAgentRunItems.length
          : (safeIndex - 1 + subAgentRunItems.length) % subAgentRunItems.length;
      const nextItem = subAgentRunItems[nextIndex];
      if (!nextItem) {
        return;
      }

      openChildSessionInspector(nextItem.sessionId);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openChildSessionInspector, selectedChildSessionId, subAgentRunItems]);

  return { openChildSessionInspector, selectChildSession };
}
