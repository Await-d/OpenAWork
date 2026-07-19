import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  resolveConversationLayoutState,
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

    if (previousRunningCount === 0 && terminalRunningCount > 0 && !terminalPanelOpened) {
      autoOpenedTerminalPanelRef.current = true;
      setTerminalPanelOpened(true);
    }

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
      resolveConversationLayoutState({
        editorMode,
        isFusionLayout: enabled,
        showDockedReviewPanel: showDockedSidePanel,
      }),
    [editorMode, enabled, showDockedSidePanel],
  );

  const pageRootStyle = useMemo<CSSProperties | undefined>(
    () =>
      enabled
        ? {
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: 0,
            minHeight: 0,
            overflow: 'hidden',
          }
        : undefined,
    [enabled],
  );

  return {
    conversationLayoutState,
    pageRootClassName: enabled ? 'page-root page-root-fusion-col' : 'page-root page-root-row',
    pageRootStyle,
    rightPanelCommandDescription: '切换审查/文件/Context 侧栏',
    rightPanelCommandLabel: reviewPanelOpened ? '收起审查侧栏' : '展开审查侧栏',
    showDockedSidePanel,
    toggleReviewPanel,
  };
}
