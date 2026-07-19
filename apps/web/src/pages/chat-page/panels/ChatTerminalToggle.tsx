import { QuickTerminalToggle } from '../../../components/chat/terminal/QuickTerminalToggle.js';

export interface ChatTerminalToggleProps {
  readonly terminalPanelOpened: boolean;
  readonly onToggleTerminalPanel: () => void;
}

export function ChatTerminalToggle({
  onToggleTerminalPanel,
  terminalPanelOpened,
}: ChatTerminalToggleProps) {
  return <QuickTerminalToggle open={terminalPanelOpened} onToggle={onToggleTerminalPanel} />;
}
