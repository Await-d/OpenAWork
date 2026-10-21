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
  readonly setEditorFullScreen: (value: boolean) => void;
  readonly setEditorMode: (value: boolean) => void;
  readonly setReviewPanelOpened: (open: boolean) => void;
  readonly setTerminalPanelOpened: (open: boolean) => void;
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
  setTerminalPanelOpened,
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
    // 放大态（editorMode + editorFullScreen）下面板被隐藏：顶栏按钮的语义是
    // 「收起到会话面板」——退出全屏、收起主区分屏并展开面板。一级 tab 保持
    // 会话记忆值，不要把用户刚选好的代码 / 预览强行换成审查。
    if (editorMode && editorFullScreen) {
      setEditorFullScreen(false);
      setEditorMode(false);
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

    // 展开时保留该会话记忆的一级 tab：按钮文案是「展开会话面板」而非「打开审查」，
    // 需要直达审查的入口（文件变更通知 / openFileChangesPanel）会自己把 tab 切过去。
    setReviewPanelOpened(true);
  }, [
    editorFullScreen,
    editorMode,
    reviewPanelOpened,
    setEditorFullScreen,
    setEditorMode,
    setReviewPanelOpened,
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
