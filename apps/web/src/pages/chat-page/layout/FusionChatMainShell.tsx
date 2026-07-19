import type { CSSProperties, MutableRefObject, ReactNode, RefObject } from 'react';
import './FusionChatMainShell.css';

type SplitStyle = {
  readonly minWidth: CSSProperties['minWidth'];
  readonly '--split-pos': string;
};

export interface FusionChatMainShellProps {
  readonly children: ReactNode;
  readonly editorFullScreen: boolean;
  readonly editorMode: boolean;
  readonly editorPane: ReactNode;
  readonly hasSession: boolean;
  readonly showDockedSidePanel: boolean;
  readonly sidePanel: ReactNode;
  readonly splitContainerRef: RefObject<HTMLDivElement | null>;
  readonly splitDragging: MutableRefObject<boolean>;
  readonly splitPos: number;
  readonly terminal: ReactNode;
}

export function FusionChatMainShell({
  children,
  editorFullScreen,
  editorMode,
  editorPane,
  hasSession,
  showDockedSidePanel,
  sidePanel,
  splitContainerRef,
  splitDragging,
  splitPos,
  terminal,
}: FusionChatMainShellProps) {
  const conversationHidden = editorMode && editorFullScreen;
  const splitStyle = {
    minWidth: 0,
    '--split-pos': `${splitPos}%`,
  } satisfies SplitStyle;

  const conversationPaneStyle: CSSProperties = {
    opacity: conversationHidden ? 0 : 1,
    pointerEvents: conversationHidden ? 'none' : undefined,
    transition: splitDragging.current ? 'none' : 'width 240ms ease, opacity 180ms ease',
    width: conversationHidden ? 0 : editorMode ? 'calc(var(--split-pos) - 2.5px)' : undefined,
  };

  const rootClassName = 'fusion-chat-main-shell fusion-chat-main-shell--fusion';
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
    </div>
  );
}
