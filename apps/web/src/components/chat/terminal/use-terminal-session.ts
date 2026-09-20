/**
 * `InteractiveTerminalView` 的状态域：xterm 实例装配、输出增量回放、
 * 尺寸同步、输入合并、剪贴板、右键菜单、粘贴保护、滚动状态。
 *
 * 视图层（`InteractiveTerminalView.tsx`）只做编排与渲染，这样可以保证
 * 两个文件都停在可审查的体量内，并且副作用的生命周期集中在一处。
 *
 * 传输（Phase B）：优先单连接 WebSocket（输入 / 输出 / resize）。socket
 * 在握手完成前失败、或首帧前报错时，按终端粒度回退到原有的
 * SSE + `POST /stdin` + `POST /resize` 路径；回退后不再尝试 WS。
 *
 * 回放语义（契约 §3.2，WS / SSE 共用同一套）：
 *  - snapshot 只应用**首次**，重连重发的 snapshot 丢弃，避免清掉用户
 *    正在输入的半行命令；WS 重连例外 —— 那里会换一副全新 replay，
 *    让新连接的 snapshot 重新落地（旧连接的去重状态对新流无意义）；
 *  - output 带 `seq` 时按单调序号去重（`seq <= lastSeq` 丢弃）；
 *    `data` 缺省则回退旧的「累积 tail + 总字节」diff 路径兼容旧后端。
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import {
  openTerminalSocketFor,
  openTerminalStream,
  resizeTerminal,
  writeTerminalStdin,
  type TerminalSocketLike,
  type TerminalStreamOutputPayload,
  type TerminalStreamSnapshotPayload,
  type TerminalStreamStatus,
} from '../../conversation-runtime/terminals/terminals-api.js';
import { createInteractiveTerminal, refreshTerminal } from './terminal-xterm-options.js';
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
  /**
   * 终端是否可交互（`terminal.interactive !== false`）。`false` 时视图应展示
   * 禁用横幅，且 hook 已拦截输入（`onData` / 粘贴 / Ctrl+L 都不会送达 shell）。
   */
  interactive: boolean;
}

interface TerminalSessionActions {
  requestPaste: () => void;
}

/**
 * `resizeTerminal` POST 的 trailing debounce 窗口（D7）：拖拽分隔条 / 窗口
 * 缩放会高频触发 ResizeObserver，`fit()` 本地每帧照跑，请求合并成一次。
 * WS 路径同样走这个防抖，只是把 POST 换成 socket 帧。
 */
const TERMINAL_RESIZE_DEBOUNCE_MS = 160;

/**
 * Phase B 传输开关：交互式终端优先走单连接 WebSocket（输入 / 输出 / resize）。
 * 置 `false` 时全量回到 SSE + HTTP 路径（灰度回退只需改这一个常量）。
 */
export const TERMINAL_WS_TRANSPORT_ENABLED = true;

/**
 * 意外断开后的重连退避：500ms 起步、逐次翻倍、封顶 5s
 * （attempt 0→500ms、1→1s、2→2s、3→4s，其后保持 5s）。
 */
const TERMINAL_WS_RECONNECT_BASE_MS = 500;
const TERMINAL_WS_RECONNECT_MAX_MS = 5000;

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
  // 能力未知（旧后端、或 `terminal_started` 事件本地构造的行）按可交互处理，
  // 与升级前行为一致；只有显式 `interactive === false` 才拦截输入。
  const interactive = terminal.interactive !== false;
  const inputAllowed = inputEnabled && interactive;
  const inputAllowedRef = useRef(inputAllowed);
  inputAllowedRef.current = inputAllowed;
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

    // 交互式 PTY 是 raw-mode：convertEol 会把裸 `\n` 改写成 `\r\n`，破坏
    // TUI 的绝对定位，直接表现为输入与渲染位置错位；显式 `true` 才关掉，
    // 缺省（旧后端 / 能力未知）保留历史行为。
    const runtime = createInteractiveTerminal(container, {
      convertEol: terminal.interactive !== true,
    });
    const { terminal: term, fitAddon, searchAddon } = runtime;
    termRef.current = term;
    searchRef.current = searchAddon;

    const reportNotice = (message: string) => {
      setNotice(message);
      onWriteErrorRef.current?.(message);
    };

    // 传输状态：'ws' 为首选通道；首帧前失败即永久回退到 'sse'（按终端粒度），
    // 回退后不再切回 WS，避免同一终端在两个传输之间来回抖动。
    let transport: 'ws' | 'sse' = TERMINAL_WS_TRANSPORT_ENABLED ? 'ws' : 'sse';
    let replay = createTerminalStreamReplay();
    let socket: TerminalSocketLike | null = null;
    let source: EventSource | null = null;
    // 每次建连自增：旧连接（以及已被 fallback 放弃的连接）的延迟回调据此全部失效。
    let socketGeneration = 0;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let pendingResize: { cols: number; rows: number } | null = null;
    let disposed = false;
    let exited = false;

    const writeSnapshot = (payload: TerminalStreamSnapshotPayload): void => {
      const applied = replay.applySnapshot(payload);
      if (!applied) return;
      if (applied.reset) term.reset();
      if (applied.text.length > 0) term.write(applied.text);
    };

    // WS 与 SSE 共用同一条回放状态机与写入路径：seq 去重 / snapshot-once 语义不变。
    const writeOutput = (payload: TerminalStreamOutputPayload): void => {
      const text = replay.applyOutput(payload);
      if (text.length > 0) term.write(text);
    };

    const reportStreamError = (error: Error): void => {
      if (!exited) {
        reportNotice(`终端输出流中断：${error.message}`);
      }
    };

    // `exitCode` 同时兼容 SSE（`number | undefined`）与 WS（`number | null`）的载荷。
    const handleExit = ({
      status,
      exitCode,
    }: {
      status: string;
      exitCode?: number | null;
    }): void => {
      if (exited) return;
      exited = true;
      term.writeln('');
      term.writeln(
        `\u001b[2m[终端已结束 · 状态 ${status}${
          typeof exitCode === 'number' ? ` · exit ${exitCode}` : ''
        }]\u001b[0m`,
      );
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
      },
    });

    /**
     * 输入路由：WS 打开时直接走 socket（没有 16ms 合并窗口）；socket 未 open
     * （连接中 / 重连退避窗口）直接丢弃 —— 盲目缓冲会在新连接上乱序重放。
     * 只有 'sse' 传输才进 `TerminalInputQueue`。
     */
    const sendInput = (data: string): void => {
      if (data.length === 0 || !inputAllowedRef.current) return;
      if (transport === 'ws') {
        const current = socket;
        if (current?.state === 'open') {
          current.sendInput(data);
        }
        return;
      }
      queue.push(data);
    };

    const requestPasteConfirmation = (summary: PasteGuardSummary): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        pasteResolveRef.current = resolve;
        setPastePrompt(summary);
      });

    const injectAfterPasteGuard = async (data: string): Promise<void> => {
      if (data.length === 0) return;
      // 非交互后端不接受 stdin：在入口统一拦截，避免走到粘贴确认再被拒绝。
      if (!inputAllowedRef.current) return;
      const decision = evaluatePasteGuard(data);
      if (decision.needsConfirm && !readTerminalPreference('pasteGuardDisabled')) {
        const approved = await requestPasteConfirmation(decision.summary);
        if (!approved) return;
      }
      sendInput(data);
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
        sendShellClear: () => {
          sendInput('\x0c');
        },
      }),
    );

    const dataDisposable = term.onData((data) => {
      if (!inputAllowedRef.current) return;
      void injectAfterPasteGuard(data);
    });

    const selectionDisposable = term.onSelectionChange(() => {
      if (!copyOnSelectRef.current) return;
      const selection = term.getSelection();
      if (selection.length === 0) return;
      // 选中即复制是纯增益功能，失败静默 —— 每次拖选都弹错误反而打扰。
      void writeClipboardText(selection).catch(() => undefined);
    });

    /** 回退路径：原有 SSE + `POST /stdin` + `POST /resize`，行为与升级前一致。 */
    const startSseStream = (): void => {
      source = openTerminalStream({
        gatewayUrl,
        sessionId,
        terminalId,
        token,
        onStatus: (status) => setStreamStatus(status),
        onSnapshot: writeSnapshot,
        onOutput: writeOutput,
        onExited: handleExit,
        onError: reportStreamError,
      });
    };

    let lastCols = 0;
    let lastRows = 0;
    let resizeTimer: number | null = null;
    let firstResizeSent = false;

    const postResize = (cols: number, rows: number): void => {
      if (transport === 'ws') {
        const current = socket;
        if (current?.state === 'open') {
          current.sendResize(cols, rows);
          return;
        }
        // socket 尚未 open（含重连窗口）：先挂起，onOpen 时补发，否则首屏会
        // 按默认 80x24 落格。
        pendingResize = { cols, rows };
        return;
      }
      void resizeTerminal({ gatewayUrl, sessionId, terminalId, token, cols, rows }).catch(
        () => undefined,
      );
    };

    const flushPendingResize = (): void => {
      const pending = pendingResize;
      if (!pending) return;
      pendingResize = null;
      postResize(pending.cols, pending.rows);
    };

    const applyFit = () => {
      try {
        fitAddon.fit();
      } catch {
        /* 容器尚未完成布局，下一次 ResizeObserver 回调会再试 */
      }
      // fit() 只改网格；WebGL 画布不会自己重绘（见 refreshTerminal 注释）。
      refreshTerminal(term);
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
      // 首次同步必须立即发出：挂载时 shell 已经按默认 80x24 打印了首个提示符，
      // 再等 160ms 防抖的话首屏会以错误宽度落格（拖拽 / 窗口缩放的既有时序不变）。
      if (!firstResizeSent) {
        firstResizeSent = true;
        postResize(cols, rows);
        return;
      }
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        postResize(cols, rows);
      }, TERMINAL_RESIZE_DEBOUNCE_MS);
    };
    const observer = new ResizeObserver(applyFit);
    observer.observe(container);
    applyFit();

    const closeSocket = (): void => {
      const current = socket;
      socket = null;
      if (!current) return;
      try {
        current.close();
      } catch {
        /* 连接可能已经自行关闭 */
      }
    };

    /**
     * WS 不可用（握手失败 / 首帧前报错 / 首帧前被关闭）时按终端粒度回退。
     * 旧 socket 的延迟回调由 `socketGeneration` 作废；SSE 会重新收到 snapshot，
     * 因此不会出现两条链路各写一半的重复输出。
     */
    const fallbackToSse = (): void => {
      if (disposed || transport === 'sse') return;
      transport = 'sse';
      socketGeneration += 1;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      closeSocket();
      startSseStream();
      // 首个 fit 若发生在 socket 未 open 期间，需要在这里补一次 HTTP resize。
      flushPendingResize();
    };

    const scheduleReconnect = (): void => {
      if (disposed || reconnectTimer !== null) return;
      const attempt = reconnectAttempt;
      reconnectAttempt += 1;
      const delay = Math.min(
        TERMINAL_WS_RECONNECT_BASE_MS * 2 ** attempt,
        TERMINAL_WS_RECONNECT_MAX_MS,
      );
      setStreamStatus('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        openSocket();
      }, delay);
    };

    /**
     * 打开（或重连）WS。每次连接都换一副全新 replay：重连后后端会重发
     * snapshot，必须重新 reset + 全量写入；旧连接的去重状态对新流无意义
     * （`terminal-stream-replay` 的 snapshot-once 语义本身不变）。
     */
    const openSocket = (): void => {
      if (disposed) return;
      replay = createTerminalStreamReplay();
      const generation = socketGeneration + 1;
      socketGeneration = generation;
      let opened = false;
      let receivedFrame = false;
      /**
       * 收到首帧才算「这条连接真的可用」：在这里才重置退避。
       * 若在 open 时就重置，「能握手、立刻断」的服务端会让重连永远压在
       * 500ms —— 恰好是退避要防的场景。
       */
      const markFrameReceived = (): void => {
        receivedFrame = true;
        reconnectAttempt = 0;
      };
      setStreamStatus('connecting');
      let next: TerminalSocketLike;
      try {
        next = openTerminalSocketFor({
          gatewayUrl,
          sessionId,
          terminalId,
          token,
          handlers: {
            onOpen: () => {
              if (generation !== socketGeneration || disposed) return;
              opened = true;
              setStreamStatus('open');
              flushPendingResize();
            },
            onSnapshot: (payload) => {
              if (generation !== socketGeneration || disposed) return;
              markFrameReceived();
              writeSnapshot(payload);
            },
            onOutput: (payload) => {
              if (generation !== socketGeneration || disposed) return;
              markFrameReceived();
              writeOutput(payload);
            },
            onExit: (payload) => {
              if (generation !== socketGeneration || disposed) return;
              markFrameReceived();
              handleExit(payload);
              setStreamStatus('closed');
            },
            onError: (error) => {
              if (generation !== socketGeneration || disposed) return;
              // 首帧前任何错误都视为「这条链路不可用」：回退 SSE，而不是在
              // 拿不到 snapshot 的情况下空转重连。
              if (!receivedFrame) {
                fallbackToSse();
                return;
              }
              reportStreamError(error instanceof Error ? error : new Error(String(error)));
            },
            onClose: () => {
              if (generation !== socketGeneration || disposed) return;
              socket = null;
              // 握手完成前断开：这条链路不可用，直接回退 SSE 而不是重连 WS。
              if (!opened && !receivedFrame) {
                fallbackToSse();
                return;
              }
              if (exited) {
                setStreamStatus('closed');
                return;
              }
              scheduleReconnect();
            },
          },
        });
      } catch {
        // 同步构造失败（运行时不支持 WebSocket / 网关地址非法）：直接走 SSE。
        fallbackToSse();
        return;
      }
      // openTerminalSocket 可能在回调里同步失败并已切到 SSE，此时丢弃返回句柄。
      if (generation !== socketGeneration || disposed) {
        try {
          next.close();
        } catch {
          /* 已经关闭 */
        }
        return;
      }
      socket = next;
    };

    if (transport === 'ws') {
      openSocket();
    } else {
      startSseStream();
    }

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
      disposed = true;
      // 作废所有在途连接回调（close / error 的延迟投递）。
      socketGeneration += 1;
      observer.disconnect();
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
        resizeTimer = null;
      }
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      container.removeEventListener('contextmenu', handleContextMenu);
      dataDisposable.dispose();
      selectionDisposable.dispose();
      scrollDisposable.dispose();
      writeParsedDisposable.dispose();
      closeSocket();
      if (source) {
        try {
          source.close();
        } catch {
          /* EventSource 已经关闭 */
        }
        source = null;
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
      disabled: !inputAllowed,
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
    interactive,
  };
}
