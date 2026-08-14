import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
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
  readonly setReviewPanelOpened: (open: boolean) => void;
  readonly setSidePanelActiveTab: (tab: 'review' | 'files' | 'context') => void;
  readonly setTerminalPanelOpened: (open: boolean) => void;
  readonly sidePanelActiveTab: 'review' | 'files' | 'context';
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
    if (!reviewPanelOpened || sidePanelActiveTab !== 'review') {
      setSidePanelActiveTab('review');
      setReviewPanelOpened(true);
      return;
    }

    setReviewPanelOpened(false);
  }, [reviewPanelOpened, setReviewPanelOpened, setSidePanelActiveTab, sidePanelActiveTab]);

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
    rightPanelCommandDescription: '切换审查/文件/Context 侧栏',
    rightPanelCommandLabel: reviewPanelOpened ? '收起审查侧栏' : '展开审查侧栏',
    showDockedSidePanel,
    toggleReviewPanel,
  };
}
