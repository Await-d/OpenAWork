import type { CSSProperties, MutableRefObject, ReactNode, RefObject } from 'react';
import type { TerminalPanelPosition } from '../../../stores/ui/uiState.js';
import './FusionChatMainShell.css';

type SplitStyle = {
  readonly flex?: CSSProperties['flex'];
  readonly minWidth: CSSProperties['minWidth'];
  readonly width?: CSSProperties['width'];
  readonly '--split-pos': string;
};

export interface FusionChatMainShellProps {
  readonly children: ReactNode;
  /**
   * 审查/Context 面板停靠打开时，对话+编辑器分组占工作台总宽度的百分比。
   * 默认落在 30%-40% 区间（见 {@link FUSION_DOCK_SPLIT_BOUNDS}），可拖拽调整。
   * 仅在 `showDockedSidePanel` 为 true 时生效。
   */
  readonly dockSplitPos: number;
  readonly editorFullScreen: boolean;
  readonly editorMode: boolean;
  readonly editorPane: ReactNode;
  readonly hasSession: boolean;
  /**
   * 移动端底部 Tab 面板（< 768px）。
   * 仅在 mobile 视口 + 有活跃会话时由 ChatPage 传入，桌面端传 null/undefined。
   */
  readonly mobilePanel?: ReactNode;
  readonly showDockedSidePanel: boolean;
  readonly sidePanel: ReactNode;
  readonly splitContainerRef: RefObject<HTMLDivElement | null>;
  readonly splitDragging: MutableRefObject<boolean>;
  readonly splitPos: number;
  /**
   * 终端面板最大化（瞬态）：为 true 时折叠工作台行，把剩余高度全部让给终端。
   * 由 ChatPage 以「已最大化且面板可见」派生传入 —— 面板收起时不应折叠工作台。
   */
  readonly terminalMaximized: boolean;
  /**
   * 终端面板停靠位置（已按视口降级为有效值）：left / right 时根切换为横向分栏，
   * 终端行成为全高列。与 terminalMaximized 互斥（选择侧停靠会先清最大化标记）。
   */
  readonly terminalPosition: TerminalPanelPosition;
  readonly terminal: ReactNode;
}

export function FusionChatMainShell({
  children,
  dockSplitPos,
  editorFullScreen,
  editorMode,
  editorPane,
  hasSession,
  mobilePanel,
  showDockedSidePanel,
  sidePanel,
  splitContainerRef,
  splitDragging,
  splitPos,
  terminalMaximized,
  terminalPosition,
  terminal,
}: FusionChatMainShellProps) {
  const conversationHidden = editorMode && editorFullScreen;
  const splitStyle = {
    flex: showDockedSidePanel ? '0 0 auto' : undefined,
    minWidth: 0,
    width: showDockedSidePanel ? `${dockSplitPos}%` : undefined,
    '--split-pos': `${splitPos}%`,
  } satisfies SplitStyle;

  const conversationPaneStyle: CSSProperties = {
    opacity: conversationHidden ? 0 : 1,
    pointerEvents: conversationHidden ? 'none' : undefined,
    transition: splitDragging.current ? 'none' : 'width 240ms ease, opacity 180ms ease',
    width: conversationHidden ? 0 : editorMode ? 'calc(var(--split-pos) - 2.5px)' : undefined,
  };

  const rootClassName = [
    'fusion-chat-main-shell',
    'fusion-chat-main-shell--fusion',
    terminalMaximized ? 'fusion-chat-main-shell--terminal-maximized' : null,
    // 侧停靠修饰类按位置二选一；terminalPosition 恒为有效值（窄视口 / overlay 已降级），
    // 因此这里不需要再判一次可用性。
    terminalPosition === 'left' ? 'fusion-chat-main-shell--terminal-left' : null,
    terminalPosition === 'right' ? 'fusion-chat-main-shell--terminal-right' : null,
  ]
    .filter(Boolean)
    .join(' ');
  const splitClassName = [
    'fusion-chat-main-shell__split',
    'fusion-chat-main-shell__split--fusion',
    editorMode ? 'fusion-chat-main-shell__split--with-editor' : null,
  ]
    .filter(Boolean)
    .join(' ');
  const conversationPaneSizeClassName = editorMode
    ? 'fusion-chat-main-shell__conversation-pane--editor'
    : showDockedSidePanel
      ? 'fusion-chat-main-shell__conversation-pane--docked'
      : 'fusion-chat-main-shell__conversation-pane--fluid';
  const conversationPaneClassName = [
    'fusion-chat-main-shell__conversation-pane',
    'fusion-chat-main-shell__conversation-pane--fusion',
    conversationPaneSizeClassName,
  ].join(' ');
  const conversationFrameClassName = [
    'fusion-chat-main-shell__conversation-frame',
    'fusion-chat-main-shell__conversation-frame--fusion',
  ].join(' ');

  return (
    <div className={rootClassName} data-testid="fusion-chat-main-shell">
      <div className="fusion-chat-main-shell__workbench-row">
        <div
          ref={splitContainerRef}
          className={splitClassName}
          data-testid="fusion-chat-main-shell-split"
          style={splitStyle}
        >
          <div
            aria-hidden={conversationHidden}
            className={conversationPaneClassName}
            data-testid="fusion-chat-conversation-pane"
            style={conversationPaneStyle}
          >
            <div
              className={conversationFrameClassName}
              data-testid="fusion-chat-conversation-frame"
            >
              {children}
            </div>
          </div>
          {editorPane}
        </div>
        {showDockedSidePanel ? sidePanel : null}
      </div>

      {hasSession ? <div className="fusion-chat-main-shell__terminal">{terminal}</div> : null}
      {mobilePanel}
    </div>
  );
}
