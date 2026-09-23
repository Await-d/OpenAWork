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
    },
    [setSelectedChildSessionId],
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

    const runningCandidate =
      subAgentRunItems.find((item) => item.status === 'running' || item.status === 'pending') ??
      subAgentRunItems[0];
    const nextId = runningCandidate?.sessionId ?? null;
    if (nextId !== selectedChildSessionId) {
      setSelectedChildSessionId(nextId);
    }
  }, [rightTab, selectedChildSessionId, setRightTab, setSelectedChildSessionId, subAgentRunItems]);

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
