import { QuickTerminalToggle } from '../../../components/chat/terminal/QuickTerminalToggle.js';

export interface ChatTerminalToggleProps {
  readonly isFusionLayout: boolean;
  readonly terminalPanelOpened: boolean;
  readonly quickTerminalOpen: boolean;
  readonly onToggleTerminalPanelOpened: () => void;
  readonly onSetQuickTerminalOpen: (open: boolean) => void;
}

export function ChatTerminalToggle(props: ChatTerminalToggleProps) {
  const open = props.isFusionLayout ? props.terminalPanelOpened : props.quickTerminalOpen;

  return (
    <QuickTerminalToggle
      open={open}
      onToggle={() => {
        if (props.isFusionLayout) {
          props.onToggleTerminalPanelOpened();
          return;
        }
        props.onSetQuickTerminalOpen(!props.quickTerminalOpen);
      }}
    />
  );
}
