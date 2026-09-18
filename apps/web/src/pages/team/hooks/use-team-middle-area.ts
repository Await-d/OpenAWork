/**
 * TeamPageV2 中间区（内容列）装配逻辑。
 *
 * 只产出「数据 + 可见性 + 回调」，不产出 JSX（本文件是 .ts）；
 * 具体节点组装见 views/TeamPageMiddleArea.tsx。
 *
 * 边界：
 *   - 负责中间区渲染所需的派生值：classic 运营条数据、对话流尾部卡片可见性、
 *     共享会话覆盖条件、layer-todo 侧栏开关、失败任务数 / 重试、classic 聚焦滚动。
 *   - 会话级 view state（middleTab / 焦点模式等）由页面从 useTeamSessionViewState
 *     传入，本 hook 不读写 localStorage，也不复制这些状态。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { TeamClient } from '@openAwork/web-client';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import { resolveSupersededClarificationIds } from '../../../stores/team/clarification-identity.js';
import type {
  ClarificationItem,
  HandoffEntry,
  LayerNode,
} from '../../../stores/team/team-events.js';
import {
  filterActiveAuditEntries,
  useRollbackVoidWindows,
} from '../../../stores/team/rollback-tombstones.js';
import type {
  AgentTeamsSidebarTeam,
  AgentTeamsWorkspaceGroup,
} from '../runtime/data/team-runtime-types.js';
import type { TeamRuntimeReferenceViewData } from '../runtime/data/team-runtime-reference-types.js';
import type { TeamPageMode } from '../runtime/hooks/use-team-page-state.js';
import type { SuggestionContext } from '../runtime/shell/controls/SmartInputGuide.js';
import type { MiddleTabKey } from '../runtime/tabs/MiddleTabRouter.js';

export interface UseTeamMiddleAreaParams {
  readonly accessToken: string | null;
  readonly clarificationItems: readonly ClarificationItem[];
  readonly data: TeamRuntimeReferenceViewData;
  readonly effectiveFocusMode: boolean;
  readonly effectiveMode: TeamPageMode;
  readonly effectiveWorkspaceGroups: readonly AgentTeamsWorkspaceGroup[];
  readonly isClassicWorkbench: boolean;
  readonly isMobile: boolean;
  readonly isSelectedSharedSession: boolean;
  readonly layerNodesMap: ReadonlyMap<string, LayerNode>;
  readonly middleTab: MiddleTabKey;
  readonly pauseResumeBusy: boolean;
  readonly refreshWorkspaceSnapshot: () => void;
  readonly scopedHandoffs: readonly HandoffEntry[];
  readonly selectedRuntimeSessionScope: ReadonlySet<string> | null;
  readonly selectedTeam: AgentTeamsSidebarTeam | null;
  readonly selectedTeamId: string;
  readonly setFocusMode: Dispatch<SetStateAction<boolean>>;
  readonly teamClient: TeamClient | null;
}

export interface TeamMiddleAreaState {
  readonly classicConversationChromeActive: boolean;
  readonly classicConversationSurface: boolean;
  readonly classicFailedHandoffs: HandoffEntry[];
  readonly classicLayerNodes: LayerNode[];
  readonly classicPendingClarifications: ClarificationItem[];
  readonly classicRunningHandoffs: HandoffEntry[];
  readonly conversationReceptionSessionId: string | null;
  readonly failedTaskCount: number;
  readonly handleClassicFocusFail: () => void;
  readonly handleClassicFocusWorkbench: () => void;
  readonly handleRetryFailed: () => Promise<void>;
  readonly isSelectedSharedSession: boolean;
  readonly retryingFailed: boolean;
  readonly setSuggestionDismissed: Dispatch<SetStateAction<boolean>>;
  readonly showErrorDiagnostics: boolean;
  readonly showSmartSuggestion: boolean;
  readonly showWorkbenchSidePanel: boolean;
  readonly suggestionContext: SuggestionContext;
}

export function useTeamMiddleArea({
  accessToken,
  clarificationItems,
  data,
  effectiveFocusMode,
  effectiveMode,
  effectiveWorkspaceGroups,
  isClassicWorkbench,
  isMobile,
  isSelectedSharedSession,
  layerNodesMap,
  middleTab,
  pauseResumeBusy,
  refreshWorkspaceSnapshot,
  scopedHandoffs,
  selectedRuntimeSessionScope,
  selectedTeam,
  selectedTeamId,
  setFocusMode,
  teamClient,
}: UseTeamMiddleAreaParams): TeamMiddleAreaState {
  // 派生当前选中会话的失败任务数（用于标签页红点 + 错误面板）
  const rollbackVoidWindows = useRollbackVoidWindows();
  const failedTaskCount = useMemo(() => {
    const activeFailedHandoffCount = filterActiveAuditEntries(
      scopedHandoffs,
      rollbackVoidWindows,
    ).filter((handoff) => handoff.state === 'failed').length;
    return selectedTeam?.taskFailed ?? activeFailedHandoffCount;
  }, [rollbackVoidWindows, scopedHandoffs, selectedTeam?.taskFailed]);

  // 当前输入建议上下文
  const suggestionContext = useMemo<SuggestionContext>(() => {
    if (failedTaskCount > 0) return 'failure';
    if (effectiveMode === 'idle') return 'idle';
    if (effectiveMode === 'paused') return 'clarifying';
    if (effectiveMode === 'running') return 'running';
    return 'default';
  }, [effectiveMode, failedTaskCount]);

  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  // 失败任务数变化时重置 dismiss 状态
  useEffect(() => {
    if (failedTaskCount > 0) {
      setSuggestionDismissed(false);
    }
  }, [failedTaskCount]);

  const [retryingFailed, setRetryingFailed] = useState(false);

  const handleRetryFailed = useCallback(async () => {
    if (
      !accessToken ||
      !teamClient ||
      !selectedTeamId ||
      isSelectedSharedSession ||
      pauseResumeBusy
    ) {
      return;
    }
    setRetryingFailed(true);
    try {
      await teamClient.resumeAllRuntimeSessions(accessToken, selectedTeamId);
      refreshWorkspaceSnapshot();
      toast('已提交失败任务重试请求，正在断点续传…', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '重试失败任务时发生错误';
      toast(`重试失败：${message}`, 'error');
    } finally {
      setRetryingFailed(false);
    }
  }, [
    accessToken,
    isSelectedSharedSession,
    pauseResumeBusy,
    refreshWorkspaceSnapshot,
    selectedTeamId,
    teamClient,
  ]);

  const conversationReceptionSessionId = useMemo(() => {
    if (!data.defaultReceptionSessionId) {
      return null;
    }
    const receptionSession = effectiveWorkspaceGroups
      .flatMap((group) => group.sessions)
      .find((session) => session.id === data.defaultReceptionSessionId);
    return receptionSession?.isSharedSession ? null : data.defaultReceptionSessionId;
  }, [data.defaultReceptionSessionId, effectiveWorkspaceGroups]);

  const classicFailedHandoffs = useMemo(
    () => scopedHandoffs.filter((h) => h.state === 'failed'),
    [scopedHandoffs],
  );
  const classicRunningHandoffs = useMemo(
    () => scopedHandoffs.filter((h) => h.state === 'running' || h.state === 'claimed'),
    [scopedHandoffs],
  );
  const supersededClarificationIds = useMemo(
    () => resolveSupersededClarificationIds(clarificationItems),
    [clarificationItems],
  );
  const classicPendingClarifications = useMemo(() => {
    const pending = clarificationItems.filter(
      (item) => item.status === 'pending' && !supersededClarificationIds.has(item.id),
    );
    if (!selectedRuntimeSessionScope) {
      // 未选中本地运行树会话时，不跨会话展示澄清，避免脏状态
      return selectedTeamId
        ? pending.filter(
            (item) => item.sessionId === selectedTeamId || item.fromSessionId === selectedTeamId,
          )
        : [];
    }
    return pending.filter(
      (item) =>
        selectedRuntimeSessionScope.has(item.sessionId) ||
        selectedRuntimeSessionScope.has(item.fromSessionId),
    );
  }, [clarificationItems, selectedRuntimeSessionScope, selectedTeamId, supersededClarificationIds]);

  const handleClassicFocusFail = useCallback(() => {
    // 优先滚到对话内联失败/澄清卡，否则滚到运营条 attention 锚点
    const inline = document.querySelector(
      '[data-team-classic-inline-cards] [data-team-attention-anchor="true"]',
    );
    const target =
      inline ??
      document.querySelector('[data-team-classic-ops-chrome] [data-team-attention-anchor="true"]');
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const handleClassicFocusWorkbench = useCallback(() => {
    if (effectiveFocusMode) {
      setFocusMode(false);
    }
    // 澄清只在「任务 → 待澄清」面板回答：退出专注模式后把该面板滚进视野。
    if (typeof document === 'undefined') return;
    const scrollToClarificationPanel = () => {
      const panel = document.querySelector<HTMLElement>('[data-team-clarification-anchor="true"]');
      panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    scrollToClarificationPanel();
    requestAnimationFrame(scrollToClarificationPanel);
  }, [effectiveFocusMode, setFocusMode]);

  // classic-only：右侧 layer/todo 工作台；fusion 保持无侧栏（内容仍走中间主 tab）
  const classicLayerNodes = useMemo(() => Array.from(layerNodesMap.values()), [layerNodesMap]);
  // 右侧 layer/todo 工作台只挂在「对话」相关中间区；其它主 tab 必须回到中间内容切换
  const classicConversationSurface = middleTab === 'conversation' || middleTab === 'office';
  const classicConversationChromeActive =
    isClassicWorkbench && Boolean(selectedTeamId) && !isSelectedSharedSession;
  const showErrorDiagnostics =
    !isClassicWorkbench && !isSelectedSharedSession && failedTaskCount > 0;
  const showSmartSuggestion =
    !isClassicWorkbench &&
    Boolean(selectedTeamId) &&
    (suggestionContext === 'failure' || suggestionContext === 'idle') &&
    !suggestionDismissed &&
    !isMobile;
  const showWorkbenchSidePanel =
    isClassicWorkbench && classicConversationSurface && !effectiveFocusMode && !isMobile;

  return {
    classicConversationChromeActive,
    classicConversationSurface,
    classicFailedHandoffs,
    classicLayerNodes,
    classicPendingClarifications,
    classicRunningHandoffs,
    conversationReceptionSessionId,
    failedTaskCount,
    handleClassicFocusFail,
    handleClassicFocusWorkbench,
    handleRetryFailed,
    isSelectedSharedSession,
    retryingFailed,
    setSuggestionDismissed,
    showErrorDiagnostics,
    showSmartSuggestion,
    showWorkbenchSidePanel,
    suggestionContext,
  };
}
