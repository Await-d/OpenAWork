import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { SidePanelActiveTab } from '../../../stores/ui/uiState.js';
import {
  resolveFusionConversationLayoutState,
  type ConversationLayoutState,
} from './conversation-layout-state.js';

export interface UseFusionChatLayoutOptions {
  readonly canDockSidePanel: boolean;
  readonly currentSessionId: string | null;
  readonly editorFullScreen: boolean;
  readonly editorMode: boolean;
  readonly enabled: boolean;
  readonly isNarrowViewport: boolean;
  readonly reviewPanelOpened: boolean;
  readonly setEditorFullScreen: (value: boolean) => void;
  readonly setEditorMode: (value: boolean) => void;
  readonly setReviewPanelOpened: (open: boolean) => void;
  readonly setSidePanelActiveTab: (tab: SidePanelActiveTab) => void;
  readonly setTerminalPanelOpened: (open: boolean) => void;
  readonly sidePanelActiveTab: SidePanelActiveTab;
  readonly terminalPanelOpened: boolean;
  readonly terminalRunningCount: number;
}

export interface FusionChatLayoutState {
  readonly conversationLayoutState: ConversationLayoutState;
  readonly pageRootClassName: string;
  readonly pageRootStyle: CSSProperties | undefined;
  readonly rightPanelCommandDescription: string;
  readonly rightPanelCommandLabel: string;
  readonly showDockedSidePanel: boolean;
  readonly toggleReviewPanel: () => void;
}

export function useFusionChatLayout({
  canDockSidePanel,
  currentSessionId,
  editorFullScreen,
  editorMode,
  enabled,
  isNarrowViewport,
  reviewPanelOpened,
  setEditorFullScreen,
  setEditorMode,
  setReviewPanelOpened,
  setSidePanelActiveTab,
  setTerminalPanelOpened,
  sidePanelActiveTab,
  terminalPanelOpened,
  terminalRunningCount,
}: UseFusionChatLayoutOptions): FusionChatLayoutState {
  const autoOpenedTerminalPanelRef = useRef(false);
  const previousTerminalRunningCountRef = useRef(0);

  useEffect(() => {
    const previousRunningCount = previousTerminalRunningCountRef.current;

    if (!enabled || !currentSessionId) {
      autoOpenedTerminalPanelRef.current = false;
      previousTerminalRunningCountRef.current = terminalRunningCount;
      return;
    }

    // 移除自动打开逻辑，避免界面跳动
    // 用户可以通过折叠栏的状态提示或手动点击来打开终端面板

    // 保留自动关闭逻辑：当所有终端都结束且面板是自动打开的，则自动关闭
    if (terminalRunningCount === 0 && autoOpenedTerminalPanelRef.current && terminalPanelOpened) {
      autoOpenedTerminalPanelRef.current = false;
      setTerminalPanelOpened(false);
    }

    if (terminalRunningCount === 0) {
      autoOpenedTerminalPanelRef.current = false;
    }

    previousTerminalRunningCountRef.current = terminalRunningCount;
  }, [
    currentSessionId,
    enabled,
    setTerminalPanelOpened,
    terminalPanelOpened,
    terminalRunningCount,
  ]);

  const toggleReviewPanel = useCallback(() => {
    // 放大态（editorMode + editorFullScreen）下面板被隐藏：顶栏「审查」按钮的
    // 语义是「收起到面板并回到审查」——退出全屏、收起主区分屏并把面板切回审查，
    // 避免出现点了没反应的死按钮。
    if (editorMode && editorFullScreen) {
      setEditorFullScreen(false);
      setEditorMode(false);
      setSidePanelActiveTab('review');
      setReviewPanelOpened(true);
      return;
    }

    // 收起判据只看 reviewPanelOpened：顶栏按钮的 title / 高亮态都由它决定，
    // 因此「面板已展开」时任意一次点击都必须直接收起——即便用户此刻停在
    // 代码 / 预览 / Context 等其他 tab（否则会先被切回审查，形成要点两次才关的错觉）。
    if (reviewPanelOpened) {
      setReviewPanelOpened(false);
      return;
    }

    setSidePanelActiveTab('review');
    setReviewPanelOpened(true);
  }, [
    editorFullScreen,
    editorMode,
    reviewPanelOpened,
    setEditorFullScreen,
    setEditorMode,
    setReviewPanelOpened,
    setSidePanelActiveTab,
  ]);

  const showDockedSidePanel =
    enabled &&
    reviewPanelOpened &&
    canDockSidePanel &&
    !isNarrowViewport &&
    !(editorMode && editorFullScreen) &&
    currentSessionId !== null;

  const conversationLayoutState = useMemo(
    () =>
      resolveFusionConversationLayoutState({
        showDockedReviewPanel: showDockedSidePanel,
      }),
    [showDockedSidePanel],
  );

  const pageRootStyle = useMemo<CSSProperties>(
    () => ({
      display: 'flex',
      flex: 1,
      flexDirection: 'column',
      gap: 0,
      minHeight: 0,
      overflow: 'hidden',
    }),
    [],
  );

  return {
    conversationLayoutState,
    pageRootClassName: 'page-root page-root-fusion-col',
    pageRootStyle,
    rightPanelCommandDescription: '代码 / 预览 / 审查 / 子代理 / 会话概览 停靠侧栏',
    rightPanelCommandLabel: reviewPanelOpened ? '收起会话面板' : '展开会话面板',
    showDockedSidePanel,
    toggleReviewPanel,
  };
}
