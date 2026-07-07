/**
 * TerminalPanel — 底部终端面板 shell。
 *
 * 功能：
 *  - 折叠/展开切换（使用 terminalPanelOpened）
 *  - 复用 QuickTerminalPanel 的运行视图（含 tab 栏、高度拖拽、终端渲染）
 *
 * 从 uiState store 读取 terminalPanelOpened 控制可见性。
 * Fusion 布局下使用 terminalPanelHeight，避免复用 classic 快捷终端的抽屉高度。
 */

import { useCallback } from 'react';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { QuickTerminalPanel } from '../../../components/chat/terminal/QuickTerminalPanel.js';
import type { SessionTerminalView } from '../../../components/conversation-runtime/terminals/terminals-api.js';
import './TerminalPanel.css';

const ACTIVE_TERMINAL_STATUSES = new Set(['running', 'idle', 'tmux-spawned']);

function formatGatewayHost(gatewayUrl: string): string {
  const trimmed = gatewayUrl.trim();
  if (!trimmed) return 'Gateway';

  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').split('/')[0] ?? trimmed;
  }
}

export interface TerminalPanelProps {
  workspacePath: string | null;
  gatewayUrl: string;
  token: string | null;
  sessionId: string | null;
  terminals: SessionTerminalView[];
  loading: boolean;
  onReload: () => void;
  onRenameTerminal?: (terminalId: string, name: string | null) => Promise<void>;
  onDismissTerminal?: (terminalId: string) => void;
}

export function TerminalPanel(props: TerminalPanelProps) {
  const opened = useUIStateStore((s) => s.terminalPanelOpened);
  const setTerminalPanelOpened = useUIStateStore((s) => s.setTerminalPanelOpened);
  const terminalPanelHeight = useUIStateStore((s) => s.terminalPanelHeight);
  const setTerminalPanelHeight = useUIStateStore((s) => s.setTerminalPanelHeight);

  const handleClose = useCallback(() => {
    setTerminalPanelOpened(false);
  }, [setTerminalPanelOpened]);

  const activeTerminalCount = props.terminals.filter((terminal) =>
    ACTIVE_TERMINAL_STATUSES.has(terminal.status),
  ).length;
  const gatewayStatus = `Gateway ready · ${formatGatewayHost(props.gatewayUrl)}`;
  const collapsedStatus =
    activeTerminalCount > 0
      ? `${activeTerminalCount} 个运行中 · ${gatewayStatus}`
      : props.loading
        ? '正在同步终端'
        : gatewayStatus;

  if (!opened) {
    return (
      <button
        type="button"
        aria-label="展开终端面板"
        title="展开终端面板"
        onClick={() => setTerminalPanelOpened(true)}
        className="terminal-panel-collapsed-rail"
      >
        <span className="terminal-panel-collapsed-rail__label">
          <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span>终端</span>
        </span>
        <span className="terminal-panel-collapsed-rail__status">{collapsedStatus}</span>
      </button>
    );
  }

  return (
    <QuickTerminalPanel
      open={true}
      onRequestClose={handleClose}
      presentation="inline"
      height={terminalPanelHeight}
      onHeightChange={setTerminalPanelHeight}
      workspacePath={props.workspacePath}
      gatewayUrl={props.gatewayUrl}
      token={props.token}
      sessionId={props.sessionId}
      terminals={props.terminals}
      loading={props.loading}
      onReload={props.onReload}
      onRenameTerminal={props.onRenameTerminal}
      onDismissTerminal={props.onDismissTerminal}
    />
  );
}
