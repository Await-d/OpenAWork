/**
 * `InteractiveTerminalView` 的状态域：xterm 实例装配、SSE 增量回放、
 * 尺寸同步、输入合并、剪贴板、右键菜单、粘贴保护、滚动状态。
 *
 * 视图层（`InteractiveTerminalView.tsx`）只做编排与渲染，这样可以保证
 * 两个文件都停在可审查的体量内，并且副作用的生命周期集中在一处。
 *
 * SSE 语义（契约 §3.2）：
 *  - snapshot 只应用**首次**，重连重发的 snapshot 丢弃，避免清掉用户
 *    正在输入的半行命令；
 *  - output 带 `seq` 时按单调序号去重（`seq <= lastSeq` 丢弃）；
 *    `data` 缺省则回退旧的「累积 tail + 总字节」diff 路径兼容旧后端。
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import {
  openTerminalStream,
  resizeTerminal,
  writeTerminalStdin,
  type TerminalStreamStatus,
} from '../../conversation-runtime/terminals/terminals-api.js';
import { createInteractiveTerminal } from './terminal-xterm-options.js';
import {
  createTerminalCustomKeyHandler,
  readClipboardText,
  writeClipboardText,
} from './terminal-key-handlers.js';
import { TerminalInputQueue } from './terminal-input-queue.js';
import { evaluatePasteGuard, type PasteGuardSummary } from './terminal-paste-guard.js';
import { createTerminalStreamReplay } from './terminal-stream-replay.js';
import { readTerminalPreference, writeTerminalPreference } from './terminal-preferences.js';
import type { TerminalContextMenuItem } from './TerminalContextMenu.js';

export interface UseTerminalSessionParams {
  gatewayUrl: string;
  token: string | null;
  sessionId: string | null;
  terminal: SessionTerminalView;
  /** 是否允许向该终端写入（非持久终端为 false）。 */
  inputEnabled: boolean;
  /** 写失败等异常的上报通道（父面板已有 error 条）。 */
  onWriteError?: (message: string) => void;
  /**
   * 面板命令段（新建 / 拆分 / 终止 / 重命名 / 关闭），由 pane 构建后透传。
   * 面板语义不进本 hook：这里只负责把它拼在剪贴板项之前。
   */
  menuItems?: TerminalContextMenuItem[];
}

export interface TerminalSessionState {
  containerRef: RefObject<HTMLDivElement | null>;
  focusTerminal: () => void;
  streamStatus: TerminalStreamStatus;
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  findNext: (term: string, caseSensitive: boolean) => boolean;
  findPrevious: (term: string, caseSensitive: boolean) => boolean;
  atBottom: boolean;
  scrollToBottom: () => void;
  contextMenu: { x: number; y: number } | null;
  contextMenuItems: TerminalContextMenuItem[];
  closeContextMenu: () => void;
  pastePrompt: PasteGuardSummary | null;
  confirmPaste: (dontAskAgain: boolean) => void;
  cancelPaste: () => void;
  notice: string | null;
  dismissNotice: () => void;
  inputEnabled: boolean;
  /** 后端是否支持 resize；`false` 时 hook 会跳过 `/resize` 请求（pipe 后端 no-op）。 */
  resizeSupported: boolean;
}

interface TerminalSessionActions {
  requestPaste: () => void;
}

/**
 * `resizeTerminal` POST 的 trailing debounce 窗口（D7）：拖拽分隔条 / 窗口
 * 缩放会高频触发 ResizeObserver，`fit()` 本地每帧照跑，POST 合并成一次。
 */
const TERMINAL_RESIZE_DEBOUNCE_MS = 160;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useTerminalSession({
  gatewayUrl,
  token,
  sessionId,
  terminal,
  inputEnabled,
  onWriteError,
  menuItems,
}: UseTerminalSessionParams): TerminalSessionState {
  const terminalId = terminal.terminalId;
  const terminalSessionId = terminal.sessionId;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const actionsRef = useRef<TerminalSessionActions | null>(null);
  const enabledRef = useRef(inputEnabled);
  enabledRef.current = inputEnabled;
  const copyOnSelectRef = useRef(readTerminalPreference('copyOnSelect'));
  const pasteResolveRef = useRef<((approved: boolean) => void) | null>(null);
  const onWriteErrorRef = useRef(onWriteError);
  onWriteErrorRef.current = onWriteError;

  // 能力未知（旧后端、或 `terminal_started` 事件本地构造的行）按「能 resize」
  // 处理，避免在真正支持 PTY 的运行时上静默退化；只有显式 false 才跳过请求。
  const resizeSupported = terminal.supportsResize !== false;
  const resizeSupportedRef = useRef(resizeSupported);
  resizeSupportedRef.current = resizeSupported;

  const [searchOpen, setSearchOpen] = useState(false);
  const [streamStatus, setStreamStatus] = useState<TerminalStreamStatus>('connecting');
  const [atBottom, setAtBottom] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [pastePrompt, setPastePrompt] = useState<PasteGuardSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyOnSelect, setCopyOnSelect] = useState(() => readTerminalPreference('copyOnSelect'));

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionId || !token) return;
    // 切换会话时父组件会短暂地用旧 terminal 渲染，此期间不要连 SSE。
    if (terminalSessionId !== sessionId) return;

    const runtime = createInteractiveTerminal(container);
    const { terminal: term, fitAddon, searchAddon } = runtime;
    termRef.current = term;
    searchRef.current = searchAddon;

    const reportNotice = (message: string) => {
      setNotice(message);
      onWriteErrorRef.current?.(message);
    };

    const queue = new TerminalInputQueue({
      write: async (data) => {
        const result = await writeTerminalStdin({
          gatewayUrl,
          sessionId,
          terminalId,
          token,
          data,
        });
        if (!result.ok) {
          throw new Error(result.error ?? '终端拒绝了本次输入');
        }
      },
      onError: (error, data) => {
        reportNotice(`输入写入失败（${data.length} 字符未送达）：${error.message}`);
        // 灰色提示行直接写在终端里，用户不必切到面板错误条也能看到。
        term.write(`\r\n\u001b[2m[终端] 输入未送达，请重试：${error.message}\u001b[0m\r\n`);
      },
    });

    const requestPasteConfirmation = (summary: PasteGuardSummary): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        pasteResolveRef.current = resolve;
        setPastePrompt(summary);
      });

    const injectAfterPasteGuard = async (data: string): Promise<void> => {
      if (data.length === 0) return;
      const decision = evaluatePasteGuard(data);
      if (decision.needsConfirm && !readTerminalPreference('pasteGuardDisabled')) {
        const approved = await requestPasteConfirmation(decision.summary);
        if (!approved) return;
      }
      queue.push(data);
    };

    const pasteFromClipboard = async (): Promise<void> => {
      try {
        const text = await readClipboardText();
        await injectAfterPasteGuard(text);
      } catch (error) {
        reportNotice(`读取剪贴板失败：${errorMessage(error)}`);
      }
    };

    actionsRef.current = { requestPaste: () => void pasteFromClipboard() };

    term.attachCustomKeyEventHandler(
      createTerminalCustomKeyHandler({
        terminal: term,
        copySelection: (text) => {
          void writeClipboardText(text).catch((error: unknown) => {
            reportNotice(`复制失败：${errorMessage(error)}`);
          });
        },
        requestPaste: () => void pasteFromClipboard(),
        openSearch: () => setSearchOpen(true),
        clearBuffer: () => term.clear(),
        // 保留 shell 自身的清屏语义（详见 terminal-key-handlers.ts 注释）。
        sendShellClear: () => queue.push('\x0c'),
      }),
    );

    const dataDisposable = term.onData((data) => {
      if (!enabledRef.current) return;
      void injectAfterPasteGuard(data);
    });

    const selectionDisposable = term.onSelectionChange(() => {
      if (!copyOnSelectRef.current) return;
      const selection = term.getSelection();
      if (selection.length === 0) return;
      // 选中即复制是纯增益功能，失败静默 —— 每次拖选都弹错误反而打扰。
      void writeClipboardText(selection).catch(() => undefined);
    });

    const replay = createTerminalStreamReplay();
    let exited = false;

    const source = openTerminalStream({
      gatewayUrl,
      sessionId,
      terminalId,
      token,
      onStatus: (status) => setStreamStatus(status),
      onSnapshot: (payload) => {
        const applied = replay.applySnapshot(payload);
        if (!applied) return;
        if (applied.reset) term.reset();
        if (applied.text.length > 0) term.write(applied.text);
      },
      onOutput: (payload) => {
        const text = replay.applyOutput(payload);
        if (text.length > 0) term.write(text);
      },
      onExited: ({ status, exitCode }) => {
        exited = true;
        term.writeln('');
        term.writeln(
          `\u001b[2m[终端已结束 · 状态 ${status}${
            exitCode !== undefined ? ` · exit ${exitCode}` : ''
          }]\u001b[0m`,
        );
      },
      onError: (error) => {
        if (!exited) {
          reportNotice(`终端输出流中断：${error.message}`);
        }
      },
    });

    let lastCols = 0;
    let lastRows = 0;
    let resizeTimer: number | null = null;

    const applyFit = () => {
      try {
        fitAddon.fit();
      } catch {
        /* 容器尚未完成布局，下一次 ResizeObserver 回调会再试 */
      }
      const { cols, rows } = term;
      // 隐藏 / 零尺寸 pane（抽屉动画、切 tab）会算出 cols=0；后端还会把 0
      // 钳成默认值，发出去纯属无效往返，直接跳过。
      if (cols < 2 || rows < 1) return;
      // pipe 后端 resize 是 no-op：显式 false 时省掉无意义往返（T-06）。
      if (!resizeSupportedRef.current) return;
      if (cols === lastCols && rows === lastRows) return;
      // lastCols/lastRows 在排期时更新：尺寸没变不会重复排期，连续拖拽则只
      // 保留最后一次 trailing POST（160ms），避免每帧一次请求。
      lastCols = cols;
      lastRows = rows;
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        void resizeTerminal({ gatewayUrl, sessionId, terminalId, token, cols, rows }).catch(
          () => undefined,
        );
      }, TERMINAL_RESIZE_DEBOUNCE_MS);
    };
    const observer = new ResizeObserver(applyFit);
    observer.observe(container);
    applyFit();

    const updateAtBottom = () => {
      setAtBottom(term.buffer.active.viewportY >= term.buffer.active.baseY);
    };
    const scrollDisposable = term.onScroll(updateAtBottom);
    const writeParsedDisposable = term.onWriteParsed(updateAtBottom);
    updateAtBottom();

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      term.focus();
      setContextMenu({ x: event.clientX, y: event.clientY });
    };
    container.addEventListener('contextmenu', handleContextMenu);

    return () => {
      observer.disconnect();
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
        resizeTimer = null;
      }
      container.removeEventListener('contextmenu', handleContextMenu);
      dataDisposable.dispose();
      selectionDisposable.dispose();
      scrollDisposable.dispose();
      writeParsedDisposable.dispose();
      try {
        source.close();
      } catch {
        /* EventSource 已经关闭 */
      }
      queue.dispose();
      runtime.disposeExtras();
      try {
        term.dispose();
      } catch {
        /* 已经卸载 */
      }
      termRef.current = null;
      searchRef.current = null;
      actionsRef.current = null;
      // 未决的粘贴确认按「取消」处理，避免 promise 悬挂。
      pasteResolveRef.current?.(false);
      pasteResolveRef.current = null;
      setPastePrompt(null);
      setSearchOpen(false);
      setContextMenu(null);
    };
  }, [gatewayUrl, token, sessionId, terminalId, terminalSessionId]);

  const closeSearch = () => {
    setSearchOpen(false);
    searchRef.current?.clearDecorations();
    // 关闭搜索后把焦点还给终端，否则用户要继续打字得再点一次终端。
    termRef.current?.focus();
  };

  const confirmPaste = (dontAskAgain: boolean) => {
    if (dontAskAgain) {
      writeTerminalPreference('pasteGuardDisabled', true);
    }
    const resolve = pasteResolveRef.current;
    pasteResolveRef.current = null;
    setPastePrompt(null);
    resolve?.(true);
  };

  const cancelPaste = () => {
    const resolve = pasteResolveRef.current;
    pasteResolveRef.current = null;
    setPastePrompt(null);
    resolve?.(false);
  };

  const toggleCopyOnSelect = () => {
    const next = !copyOnSelectRef.current;
    copyOnSelectRef.current = next;
    writeTerminalPreference('copyOnSelect', next);
    setCopyOnSelect(next);
  };

  const selection = termRef.current?.getSelection() ?? '';
  const clipboardItems: TerminalContextMenuItem[] = [
    {
      id: 'copy',
      label: '复制',
      hint: 'Ctrl+Shift+C',
      disabled: selection.length === 0,
      onSelect: () => {
        void writeClipboardText(selection).catch((error: unknown) => {
          const message = `复制失败：${errorMessage(error)}`;
          setNotice(message);
          onWriteErrorRef.current?.(message);
        });
      },
    },
    {
      id: 'paste',
      label: '粘贴',
      hint: 'Ctrl+Shift+V',
      disabled: !inputEnabled,
      onSelect: () => actionsRef.current?.requestPaste(),
    },
    {
      id: 'select-all',
      label: '全选',
      onSelect: () => termRef.current?.selectAll(),
    },
    {
      id: 'clear',
      label: '清屏',
      hint: 'Ctrl+K',
      separatorBefore: true,
      onSelect: () => termRef.current?.clear(),
    },
    {
      id: 'search',
      label: '搜索',
      hint: 'Ctrl+F',
      onSelect: () => setSearchOpen(true),
    },
    {
      id: 'copy-on-select',
      label: '选中即复制',
      checked: copyOnSelect,
      separatorBefore: true,
      onSelect: toggleCopyOnSelect,
    },
  ];

  const hasCommandItems = (menuItems?.length ?? 0) > 0;
  // 面板命令段置顶，copy 是剪贴板段的首项：只在命令段非空时给它加分隔线，
  // 否则（无命令段，如未接线的宿主）菜单字面量与升级前保持一致。
  const contextMenuItems: TerminalContextMenuItem[] = contextMenu
    ? [
        ...(menuItems ?? []),
        ...clipboardItems.map((item, index) =>
          hasCommandItems && index === 0 ? { ...item, separatorBefore: true } : item,
        ),
      ]
    : [];

  return {
    containerRef,
    focusTerminal: () => termRef.current?.focus(),
    streamStatus,
    searchOpen,
    openSearch: () => setSearchOpen(true),
    closeSearch,
    findNext: (term, caseSensitive) =>
      searchRef.current?.findNext(term, { caseSensitive, incremental: true }) ?? false,
    findPrevious: (term, caseSensitive) =>
      searchRef.current?.findPrevious(term, { caseSensitive }) ?? false,
    atBottom,
    scrollToBottom: () => termRef.current?.scrollToBottom(),
    contextMenu,
    contextMenuItems,
    closeContextMenu: () => setContextMenu(null),
    pastePrompt,
    confirmPaste,
    cancelPaste,
    notice,
    dismissNotice: () => setNotice(null),
    inputEnabled,
    resizeSupported,
  };
}
