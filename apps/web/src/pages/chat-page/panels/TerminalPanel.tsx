/**
 * TerminalPanel — 底部终端面板 shell。
 *
 * 功能：
 *  - 折叠/展开切换（使用 terminalPanelOpened）
 *  - 复用 QuickTerminalPanel 的运行视图（含 tab 栏、高度拖拽、终端渲染）
 *
 * 从 uiState store 读取 terminalPanelOpened 控制可见性。
 * Fusion 布局下使用 terminalPanelHeight，避免复用 classic 快捷终端的抽屉高度。
 *
 * 高度策略（用户未拖拽过 → 按视口给默认高；拖拽过 → 记住用户的值）：
 *  - 有效高度在**渲染期**按当前视口求解，结果不写回 store——resize 持续落盘既无意义
 *    也会污染用户偏好；视口变化时由 useViewportHeight 触发重渲染即可
 *  - 分屏时按 paneCount 派生下限抬升（见 resolveTerminalPanelHeightWithPaneFloor），
 *    取消拆分后自然恢复用户原高度
 *  - 最大化（瞬态）时整个避开像素高度：面板交给外壳布局撑满，持久化高度原样保留
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  clampTerminalPanelHeightToBounds,
  resolveEffectiveTerminalPanelPosition,
  resolveTerminalPanelHeightBounds,
  resolveTerminalPanelHeightWithPaneFloor,
  terminalPanelSessionKeyFor,
  useUIStateStore,
} from '../../../stores/ui/uiState.js';
import { useViewportHeight } from '../../../hooks/ui/useViewportHeight.js';
import { useMobileViewport } from '../layout/use-mobile-viewport.js';
import { QuickTerminalPanel } from '../../../components/chat/terminal/QuickTerminalPanel.js';
import { countPanes } from '../../../components/chat/terminal/layout/queries.js';
import type {
  SessionTerminalView,
  ShellProfileOption,
} from '../../../components/conversation-runtime/terminals/terminals-api.js';
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
  onKillTerminal?: (terminalId: string) => Promise<void>;
  shellProfiles?: readonly ShellProfileOption[];
}

export function TerminalPanel(props: TerminalPanelProps) {
  const opened = useUIStateStore((s) => s.terminalPanelOpened);
  const setTerminalPanelOpened = useUIStateStore((s) => s.setTerminalPanelOpened);
  const terminalPanelHeight = useUIStateStore((s) => s.terminalPanelHeight);
  const terminalPanelHeightCustomized = useUIStateStore((s) => s.terminalPanelHeightCustomized);
  const setTerminalPanelHeight = useUIStateStore((s) => s.setTerminalPanelHeight);
  const terminalPanelMaximized = useUIStateStore((s) => s.terminalPanelMaximized);
  const toggleTerminalPanelMaximized = useUIStateStore((s) => s.toggleTerminalPanelMaximized);
  const terminalPanelPosition = useUIStateStore((s) => s.terminalPanelPosition);
  const setTerminalPanelPosition = useUIStateStore((s) => s.setTerminalPanelPosition);
  const lastChatPath = useUIStateStore((s) => s.lastChatPath);
  const terminalLayoutBySession = useUIStateStore((s) => s.terminalLayoutBySession);
  const viewportHeight = useViewportHeight();
  // 窄视口降级只在这里做一次（与外壳共用 resolveEffectiveTerminalPanelPosition）：
  // 传给 QuickTerminalPanel 的是**有效位置**，面板内部对同一降级再算一次是幂等的。
  const isNarrowViewport = useMobileViewport();
  const effectivePosition = resolveEffectiveTerminalPanelPosition(
    terminalPanelPosition,
    isNarrowViewport,
  );
  const previousSessionIdRef = useRef<string | null>(props.sessionId);
  const previousActiveTerminalCountRef = useRef(0);
  // 「归零待确认」标记：第一次看到活跃终端数 >0 → 0 只记录，不收起；
  // 只有下一次采样仍为 0（即经过一次完整 sync）才确认归零。
  const zeroConfirmationPendingRef = useRef(false);

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

  // 自动收起规则（防抖加固，D-1 回归，见
  // `.agentdocs/runtime/260915-终端-vscode-能力对齐/results/fix-d1.md`）：
  // 旧实现把「活跃终端数 >0 → 0」的单次采样直接当成真值收起抽屉，但上游
  // `useSessionTerminals` 曾在 reload 时清空本地快照，制造出一次虚假的瞬时 0，
  // 于是建第 2 个终端时抽屉被误收起（D-1）。加固后归零必须被连续两次采样确认
  // （等价于经过一次完整 sync）才收起：第一次归零只写入待确认标记，任何一次
  // 采样回弹到 >0 都会取消标记，只有下一次采样仍为 0 才真正收起。`terminals`
  // 每次上游 sync / 事件都会产生新数组，因此纳入 deps 以采集确认样本。
  useEffect(() => {
    if (previousSessionIdRef.current !== props.sessionId) {
      previousSessionIdRef.current = props.sessionId;
      previousActiveTerminalCountRef.current = activeTerminalCount;
      zeroConfirmationPendingRef.current = false;
      return;
    }

    const previousCount = previousActiveTerminalCountRef.current;
    previousActiveTerminalCountRef.current = activeTerminalCount;

    if (activeTerminalCount > 0) {
      // 见上面注释：回弹到 >0 即撤销待确认，虚假瞬时 0 不会触发收起。
      zeroConfirmationPendingRef.current = false;
      return;
    }

    if (!opened) {
      // 抽屉已收起时不做收起判断、也不累积待确认，避免用户手动展开后被立刻收起。
      zeroConfirmationPendingRef.current = false;
      return;
    }

    if (previousCount > 0) {
      // 第一次观察到归零：可能是上游瞬时假象，只记录待确认。
      zeroConfirmationPendingRef.current = true;
      return;
    }

    if (zeroConfirmationPendingRef.current) {
      // 连续两次采样都为 0：归零被确认，正常收起。
      zeroConfirmationPendingRef.current = false;
      setTerminalPanelOpened(false);
    }
  }, [activeTerminalCount, opened, props.sessionId, props.terminals, setTerminalPanelOpened]);

  if (!opened) {
    return (
      <button
        type="button"
        aria-label="展开终端面板"
        title="展开终端面板"
        onClick={() => setTerminalPanelOpened(true)}
        className="terminal-panel-collapsed-rail"
        data-has-running={activeTerminalCount > 0 ? 'true' : 'false'}
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

  // 最大化 / 侧停靠时完全跳过像素高度求解（也不调用 bounds / pane-floor 帮手）：面板改由
  // FusionChatMainShell 的布局撑满（最大化）或由 CSS 的停靠列宽高决定（侧停靠），
  // store 里的高度偏好保持原样，还原即精确恢复。
  let effectiveHeight: number | undefined;
  if (!terminalPanelMaximized && effectivePosition === 'bottom') {
    const heightBounds = resolveTerminalPanelHeightBounds(viewportHeight);
    const preferredHeight = terminalPanelHeightCustomized
      ? clampTerminalPanelHeightToBounds(terminalPanelHeight, heightBounds)
      : heightBounds.default;
    const sessionLayout = terminalLayoutBySession[terminalPanelSessionKeyFor(lastChatPath)] ?? null;
    const paneCount = sessionLayout === null ? 1 : countPanes(sessionLayout);
    effectiveHeight = resolveTerminalPanelHeightWithPaneFloor(
      preferredHeight,
      paneCount,
      heightBounds,
    );
  }

  return (
    <QuickTerminalPanel
      open={true}
      onRequestClose={handleClose}
      presentation="inline"
      height={effectiveHeight}
      onHeightChange={setTerminalPanelHeight}
      maximized={terminalPanelMaximized}
      onToggleMaximized={toggleTerminalPanelMaximized}
      position={effectivePosition}
      onMovePosition={setTerminalPanelPosition}
      workspacePath={props.workspacePath}
      gatewayUrl={props.gatewayUrl}
      token={props.token}
      sessionId={props.sessionId}
      terminals={props.terminals}
      loading={props.loading}
      onReload={props.onReload}
      onRenameTerminal={props.onRenameTerminal}
      onDismissTerminal={props.onDismissTerminal}
      onKillTerminal={props.onKillTerminal}
      shellProfiles={props.shellProfiles}
    />
  );
}
