/**
 * `InteractiveTerminalView` 的 xterm 实例装配层：Terminal 选项 + 插件 + renderer。
 *
 * 拆出来的原因：构造细节（插件顺序、WebGL 回退、proposed API）与组件的
 * 交互逻辑（SSE / 输入队列 / 菜单）是两件事，混在一个文件里会同时长胖。
 */

import { Terminal, type IDisposable, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
// 必需：xterm 的尺寸/行高规则都在此，缺了它 open() 后行高塌陷、终端有数据但显示不出来。
import '@xterm/xterm/css/xterm.css';
import {
  createDocumentThemeVarReader,
  readTerminalTheme,
  subscribeToTerminalTheme,
} from './terminal-theme.js';

/**
 * 回滚缓冲行数。
 *
 * 依据：后端 ring buffer 只保留 512KB（`TERMINAL_OUTPUT_RING_BYTES`），
 * 重连后能恢复的内容上限就是这些；本地留 5000 行足够覆盖「整段构建日志
 * 往上翻一屏」的常见诉求，同时把每条终端的内存开销压在几百 KB 量级。
 * 在没有实测到「5000 行不够用」的证据前不上调 —— 会话里可能同时挂着
 * 多个终端，无脑翻倍是纯内存成本。
 */
export const TERMINAL_SCROLLBACK_LINES = 5000;

export const TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export interface TerminalRuntime {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  /** 卸载时回收 renderer 与主题订阅（terminal 本身由调用方 dispose）。 */
  disposeExtras: () => void;
}

export interface TerminalOptionsInput {
  /**
   * 是否把裸 `\n` 改写成 `\r\n`。
   *
   * 交互式 PTY（raw-mode TUI）必须传 `false`：改写会破坏全屏程序的
   * 光标定位，表现为「输入的文字和光标/渲染位置对不上」。缺省 `true`
   * 保留 pipe 后端的历史行为。
   */
  convertEol?: boolean;
}

export function createTerminalOptions(opts: TerminalOptionsInput = {}): ITerminalOptions {
  return {
    cursorBlink: true,
    fontSize: 12,
    fontFamily: TERMINAL_FONT_FAMILY,
    // Unicode11Addon 的 activeVersion 属于 proposed API，必须显式放行。
    allowProposedApi: true,
    convertEol: opts.convertEol ?? true,
    scrollback: TERMINAL_SCROLLBACK_LINES,
    // 右键选中单词（VS Code 同款手感）；我们仍会用自己的菜单接管右键弹层。
    rightClickSelectsWord: true,
    theme: readTerminalTheme(createDocumentThemeVarReader()),
  };
}

/**
 * `fit()` 只改网格尺寸，WebGL renderer 不会自己重绘画布 —— 不刷新的话
 * 画布会停在旧尺寸，文字/光标与真实网格错位。零/负行（隐藏容器）跳过。
 */
export function refreshTerminal(terminal: Terminal): void {
  if (terminal.rows <= 0) return;
  terminal.refresh(0, terminal.rows - 1);
}

/** 兜底路径上的回收：addon 可能刚构造出来就失败，`dispose` 未必可用。 */
function disposeQuietly(addon: WebglAddon | null): void {
  try {
    addon?.dispose();
  } catch {
    /* 已经不可回收，忽略 */
  }
}

/**
 * 优先 WebGL renderer，失败回退 xterm 默认的 DOM renderer。
 * 不装 canvas addon：DOM 兜底已经够用，多一个 addon 就多一份包体与维护面。
 * @returns 卸载函数（回收 addon 与 context loss 订阅）
 */
export function attachWebglRenderer(terminal: Terminal): () => void {
  let addon: WebglAddon | null = null;
  let contextLossSubscription: IDisposable | null = null;
  try {
    addon = new WebglAddon();
    contextLossSubscription = addon.onContextLoss(() => {
      // 系统休眠 / GPU OOM / 驱动重置会丢上下文，继续用 webgl 会渲染出一块
      // 黑屏；这里卸载 addon 让 xterm 自动回退到 DOM renderer。
      addon?.dispose();
      addon = null;
    });
    terminal.loadAddon(addon);
  } catch {
    /* 环境不支持 WebGL2：保持默认 DOM renderer，终端功能不受影响 */
    contextLossSubscription?.dispose();
    disposeQuietly(addon);
    return () => undefined;
  }
  return () => {
    contextLossSubscription?.dispose();
    disposeQuietly(addon);
    addon = null;
  };
}

/** 构造并装配完整终端（fit + search + web-links + unicode11 + webgl）。 */
export function createInteractiveTerminal(
  container: HTMLElement,
  opts: TerminalOptionsInput = {},
): TerminalRuntime {
  const terminal = new Terminal(createTerminalOptions(opts));
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(new WebLinksAddon());
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';

  // open() 必须在 addon 装配之后：webgl addon 依赖已挂载的 DOM 容器。
  terminal.open(container);
  const disposeWebgl = attachWebglRenderer(terminal);
  const disposeThemeSubscription = subscribeToTerminalTheme((theme) => {
    terminal.options.theme = theme;
  });

  return {
    terminal,
    fitAddon,
    searchAddon,
    disposeExtras: () => {
      disposeThemeSubscription();
      disposeWebgl();
    },
  };
}
