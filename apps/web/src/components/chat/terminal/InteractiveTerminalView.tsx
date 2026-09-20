/**
 * InteractiveTerminalView — 把一个 `xterm.js` 实例绑到单个后端终端，
 * 并挂上交互浮层（搜索条 / 右键菜单 / 滚动到底 / 粘贴确认 / 提示条）。
 *
 * 编排层职责：状态由 `useTerminalSession` 提供（SSE 增量回放、输入合并、
 * 尺寸同步、快捷键、剪贴板），这里只负责把状态渲染成可访问的 UI。
 *
 * 交互能力（T-01 ~ T-04）：
 *  - 搜索：Ctrl/⌘+F，SearchAddon 增量查找 + 「无结果」反馈；
 *  - 剪贴板：Ctrl/⌘+Shift+C / +Shift+V，走输入队列而非 `term.paste()`；
 *  - 清屏：Ctrl/⌘+K 清本地缓冲，Ctrl/⌘+L 发 `\x0c` 交给 shell；
 *  - 右键菜单：面板命令段（新建 / 拆分 / 终止 / 重命名 / 关闭）+ 复制 / 粘贴 / 全选 / 清屏 / 搜索 / 选中即复制；
 *  - 焦点环：容器 `:focus-within` 显示 accent 描边。
 */

import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { TerminalContextMenu, type TerminalContextMenuItem } from './TerminalContextMenu.js';
import { TerminalPasteConfirm } from './TerminalPasteConfirm.js';
import { TerminalScrollToBottomButton } from './TerminalScrollToBottomButton.js';
import { TerminalSearchBar } from './TerminalSearchBar.js';
import { useTerminalSession } from './use-terminal-session.js';
import './terminal-overlay.css';

interface InteractiveTerminalViewProps {
  gatewayUrl: string;
  token: string | null;
  sessionId: string | null;
  terminal: SessionTerminalView;
  /** Whether the user can type into this terminal (persistent terminals only). */
  inputEnabled: boolean;
  /** 写失败 / 剪贴板失败的上报通道，接到宿主面板已有的 error 条。 */
  onWriteError?: (message: string) => void;
  /**
   * 内容区右键菜单的**面板命令段**（新建 / 拆分 / 终止 / 重命名 / 关闭）。
   * 由 pane 提供：本组件只负责把它与剪贴板项拼在一起（见 useTerminalSession）。
   */
  menuItems?: TerminalContextMenuItem[];
}

export function InteractiveTerminalView({
  gatewayUrl,
  token,
  sessionId,
  terminal,
  inputEnabled,
  onWriteError,
  menuItems,
}: InteractiveTerminalViewProps) {
  const session = useTerminalSession({
    gatewayUrl,
    token,
    sessionId,
    terminal,
    inputEnabled,
    onWriteError,
    menuItems,
  });

  const streamHint =
    session.streamStatus === 'reconnecting'
      ? '输出流中断 · 正在重连'
      : session.streamStatus === 'closed'
        ? '输出流已断开'
        : null;

  return (
    <div className="terminal-root" data-testid={`terminal-view-${terminal.terminalId}`}>
      <div
        ref={session.containerRef}
        className="terminal-surface"
        data-testid="terminal-surface"
        tabIndex={0}
        role="group"
        aria-label="终端输入区"
        onClick={session.focusTerminal}
      />
      {/* 非交互后端（未启用 PTY）：输入在 hook 层被拦截，这里给出一条常驻说明。
          浮层不进文档流，`.terminal-surface` 的 fit 测量口径不受影响。 */}
      {session.interactive ? null : (
        <div
          className="terminal-notice terminal-input-disabled-banner"
          role="status"
          data-testid="terminal-input-disabled-banner"
        >
          当前网关运行时不支持交互式终端（未启用 PTY），输入已禁用
        </div>
      )}
      {/* 搜索条在 375px 下会占满顶部，重连提示这时让位，避免两块浮层相撞。 */}
      {streamHint && !session.searchOpen ? (
        <span className="terminal-stream-chip" role="status" data-testid="terminal-stream-chip">
          <span className="terminal-stream-chip__dot" aria-hidden="true" />
          {streamHint}
        </span>
      ) : null}
      <TerminalSearchBar
        open={session.searchOpen}
        onClose={session.closeSearch}
        onFindNext={session.findNext}
        onFindPrevious={session.findPrevious}
      />
      {session.atBottom ? null : <TerminalScrollToBottomButton onClick={session.scrollToBottom} />}
      {session.contextMenu ? (
        <TerminalContextMenu
          x={session.contextMenu.x}
          y={session.contextMenu.y}
          items={session.contextMenuItems}
          onClose={session.closeContextMenu}
        />
      ) : null}
      {session.pastePrompt ? (
        <TerminalPasteConfirm
          summary={session.pastePrompt}
          onConfirm={session.confirmPaste}
          onCancel={session.cancelPaste}
        />
      ) : null}
      {session.notice && !session.pastePrompt ? (
        <div className="terminal-notice" role="status" data-testid="terminal-notice">
          <span>{session.notice}</span>
          <button
            type="button"
            className="terminal-notice__dismiss"
            onClick={session.dismissNotice}
            aria-label="关闭提示"
          >
            关闭
          </button>
        </div>
      ) : null}
    </div>
  );
}
