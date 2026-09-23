/**
 * 终端快捷键与剪贴板（T-02）。
 *
 * 拆成两层：
 *  - `resolveTerminalShortcut` 是**纯判定**函数（可直接用对象字面量测），
 *    回答「这个按键该由终端接管吗」；
 *  - `createTerminalCustomKeyHandler` 负责把判定结果接到副作用上，
 *    并 `preventDefault()` 掉浏览器默认行为（否则 Ctrl+F 会弹出浏览器查找栏）。
 *
 * `Ctrl/⌘+L` 的选择理由：发送 `\x0c` 给后端而不是 `term.clear()`。
 * shell（bash/zsh/fish）自身把 Ctrl+L 绑成「保留当前输入行重绘屏幕」，
 * 走控制字符能让本地显示与后端的 ring buffer 保持一致；若只用
 * `term.clear()` 清本地缓冲，后端仍保留旧输出，重连时 snapshot 会把
 * 已清掉的日志重新灌回来，用户会看到「清了又回来」的鬼影。
 */

export type TerminalShortcut =
  'copy' | 'paste' | 'search' | 'clear-buffer' | 'clear-shell' | 'kill-line';

/** 判定所需的按键信息子集（`KeyboardEvent` 结构上满足）。 */
export interface TerminalKeyEventLike {
  type: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** 判定所需的终端能力子集（`Terminal` 结构上满足）。 */
export interface TerminalSelectionSource {
  getSelection(): string;
}

/**
 * 判定矩阵（其余按键一律返回 `null` = 放行给 xterm）：
 *
 * | 按键 | 结果 | 说明 |
 * | --- | --- | --- |
 * | Ctrl/⌘+Shift+C | `copy` | 无选中时返回 `null`，不劫持浏览器默认复制 |
 * | Ctrl/⌘+Shift+V | `paste` | 走输入队列注入，不用 `term.paste()` 的透明通道 |
 * | ⌘+Backspace | `kill-line` | 删到行首（readline 的 Ctrl+U / `0x15`），参考实现同款 |
 * | Ctrl/⌘+V | `null` | 保持浏览器默认，交由 xterm `onData` 处理 |
 * | Ctrl/⌘+F | `search` | 打开/聚焦搜索条 |
 * | Ctrl/⌘+K | `clear-buffer` | `term.clear()` |
 * | Ctrl/⌘+L | `clear-shell` | 发 `\x0c`，保留 shell 清屏语义 |
 * | Ctrl+C / Ctrl+D / Ctrl+Z … | `null` | 中断、EOF、挂起必须放行 |
 */
export function resolveTerminalShortcut(
  event: TerminalKeyEventLike,
  context: { hasSelection: boolean },
): TerminalShortcut | null {
  if (event.type !== 'keydown') {
    return null;
  }
  if (event.altKey) {
    return null;
  }
  if (!event.ctrlKey && !event.metaKey) {
    return null;
  }
  // Ctrl+Shift+C 在浏览器里 `key` 是大写 'C'，统一小写后再比对。
  const key = event.key.toLowerCase();

  // macOS：⌘+Backspace = 删到行首（readline 的 Ctrl+U）。只认 meta，避免抢
  // Ctrl+Backspace（各 shell / 终端对它的语义不一致）。
  if (key === 'backspace' && event.metaKey && !event.ctrlKey && !event.shiftKey) {
    return 'kill-line';
  }
  if (key === 'c' && event.shiftKey) {
    return context.hasSelection ? 'copy' : null;
  }
  if (key === 'v' && event.shiftKey) {
    return 'paste';
  }
  if (key === 'f') {
    return 'search';
  }
  if (key === 'k' && !event.shiftKey) {
    return 'clear-buffer';
  }
  if (key === 'l' && !event.shiftKey) {
    return 'clear-shell';
  }
  return null;
}

export interface TerminalKeyHandlerDeps {
  terminal: TerminalSelectionSource;
  /** 已选中的文本 → 剪贴板。 */
  copySelection: (text: string) => void;
  /** 读剪贴板 → 输入队列（含粘贴保护）。 */
  requestPaste: () => void;
  openSearch: () => void;
  clearBuffer: () => void;
  /** 向后端发送 `\x0c`。 */
  sendShellClear: () => void;
  /** 向后端发送 `\x15`（删到行首）；仅在真实 PTY 上有效。 */
  sendKillLine: () => void;
}

/**
 * 生成可交给 `term.attachCustomKeyEventHandler` 的处理器。
 * 返回 `false` 表示已接管（xterm 不再向 pty 发送按键）。
 */
export function createTerminalCustomKeyHandler(
  deps: TerminalKeyHandlerDeps,
): (event: KeyboardEvent) => boolean {
  return (event) => {
    const selection = deps.terminal.getSelection();
    const shortcut = resolveTerminalShortcut(event, { hasSelection: selection.length > 0 });
    if (!shortcut) {
      return true;
    }
    // 拦住浏览器默认行为，否则 Ctrl+F / Ctrl+L 会被宿主页面吃掉。
    event.preventDefault();
    switch (shortcut) {
      case 'copy':
        deps.copySelection(selection);
        return false;
      case 'paste':
        deps.requestPaste();
        return false;
      case 'search':
        deps.openSearch();
        return false;
      case 'clear-buffer':
        deps.clearBuffer();
        return false;
      case 'clear-shell':
        deps.sendShellClear();
        return false;
      case 'kill-line':
        deps.sendKillLine();
        return false;
    }
  };
}

export async function readClipboardText(): Promise<string> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.readText) {
    throw new Error('当前环境不支持读取剪贴板');
  }
  return clipboard.readText();
}

export async function writeClipboardText(text: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) {
    throw new Error('当前环境不支持写入剪贴板');
  }
  await clipboard.writeText(text);
}
