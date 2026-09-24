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
   * 窗口标题上报（xterm `onTitleChange`，源是 pty 的 OSC 0/1/2 转义）。
   * 父面板按 terminalId 缓存后供 tab 标签使用；空串表示应用主动清空标题。
   */
  onTitleChange?: (title: string | null) => void;
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

/**
 * WS 未 open（连接中 / 退避重连窗口）期间的按键缓冲上限（字符数）。
 *
 * 为什么不再「直接丢弃」：SSH 类终端在传输短暂中断时不会吞掉用户已经敲下的
 * 字符；丢掉的若是那次回车，用户只会看到命令没执行、再按一次才生效 —— 观感
 * 就是「回车要按两下」。缓冲在首帧确认链路可用后按序补发；若链路判定不可用
 * （回退 SSE），缓冲整体交给输入队列；若终端已退出，则丢弃。上限用于防止网关
 * 长时间不可用时的无界堆积。
 */
const TERMINAL_WS_INPUT_BUFFER_LIMIT_CHARS = 8 * 1024;

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
  onTitleChange,
  menuItems,
}: UseTerminalSessionParams): TerminalSessionState {
  const terminalId = terminal.terminalId;
  const terminalSessionId = terminal.sessionId;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const actionsRef = useRef<TerminalSessionActions | null>(null);
  const inputEnabledRef = useRef(inputEnabled);
  inputEnabledRef.current = inputEnabled;
  const copyOnSelectRef = useRef(readTerminalPreference('copyOnSelect'));
  const pasteResolveRef = useRef<((approved: boolean) => void) | null>(null);
  const onWriteErrorRef = useRef(onWriteError);
  onWriteErrorRef.current = onWriteError;
  // 标题上报同样走 ref：内联箭头每次渲染都换身份，进 effect 依赖会让 xterm 重建。
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;

  /**
   * 令牌走 ref，不进 effect 依赖：JWT 到期前会自动轮换 `accessToken`，若让
   * 轮换触发 effect 重建，xterm 会被销毁、WS 断开重连、焦点丢失，用户正在跑的
   * TUI 也会被 snapshot 回放重置（实测生产构建每 ~13 分钟复现一次）。连接与
   * 请求在调用时读取最新令牌即可；只有「有没有令牌」变化才需要重挂终端。
   */
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const hasToken = token !== null;
  /** WS 断线窗口的按键缓冲；跨 effect 重建保留，由新实例在首帧后补发。 */
  const pendingInputRef = useRef<{ terminalId: string; data: string }>({
    terminalId,
    data: '',
  });
  /** 重建前焦点是否在终端内；重建后归位（否则用户得再点一次才能继续输入）。 */
  const wasFocusedRef = useRef(false);

  // 能力未知（旧后端、或 `terminal_started` 事件本地构造的行）按「能 resize」
  // 处理，避免在真正支持 PTY 的运行时上静默退化；只有显式 false 才跳过请求。
  const resizeSupported = terminal.supportsResize !== false;
  const resizeSupportedRef = useRef(resizeSupported);
  resizeSupportedRef.current = resizeSupported;
  /**
   * 是否为真实 PTY（显式 true 才算）。决定 `\x15`（删到行首）这类控制字符是否
   * 值得下发：管道后端没有行编辑，控制字符会混进命令行文本。
   */
  const interactiveRef = useRef(terminal.interactive === true);
  interactiveRef.current = terminal.interactive === true;

  const [searchOpen, setSearchOpen] = useState(false);
  const [streamStatus, setStreamStatus] = useState<TerminalStreamStatus>('connecting');
  const [atBottom, setAtBottom] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [pastePrompt, setPastePrompt] = useState<PasteGuardSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyOnSelect, setCopyOnSelect] = useState(() => readTerminalPreference('copyOnSelect'));

  useEffect(() => {
    const container = containerRef.current;
    const activeToken = tokenRef.current;
    if (!container || !sessionId || activeToken === null) return;
    // 切换会话时父组件会短暂地用旧 terminal 渲染，此期间不要连 SSE。
    if (terminalSessionId !== sessionId) return;
    // 令牌可能在 effect 存续期间被轮换；发请求时始终读最新值，避免用到过期令牌。
    const liveToken = (): string => tokenRef.current ?? activeToken;
    // 同一 hook 实例被复用到另一个终端时，丢弃上一终端遗留的未发送输入。
    if (pendingInputRef.current.terminalId !== terminalId) {
      pendingInputRef.current = { terminalId, data: '' };
    }

    // 交互式 PTY 是 raw-mode：convertEol 会把裸 `\n` 改写成 `\r\n`，破坏
    // TUI 的绝对定位，直接表现为输入与渲染位置错位；显式 `true` 才关掉，
    // 缺省（旧后端 / 能力未知）保留历史行为。
    const runtime = createInteractiveTerminal(container, {
      convertEol: terminal.interactive !== true,
    });
    const { terminal: term, fitAddon, searchAddon } = runtime;
    termRef.current = term;
    searchRef.current = searchAddon;
    /**
     * 窗口标题（pty 的 OSC 0/1/2）：xterm 解析到就上报，宿主按 terminalId 缓存给
     * tab 标签用。快照回放里带的重放序列同样会触发它 —— 切 tab / 重挂载后标题自愈。
     */
    const titleDisposable = term.onTitleChange((title) => {
      onTitleChangeRef.current?.(title.length > 0 ? title : null);
    });
    // 终端重建（令牌轮换 / 传输重挂 / 分屏物化）：把焦点还给终端。
    if (wasFocusedRef.current) {
      wasFocusedRef.current = false;
      term.focus();
    }

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
      // 终端已退出：断线期间缓冲的输入不再有意义，丢弃（否则下次重建会补发到别的进程）。
      pendingInputRef.current.data = '';
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
          token: liveToken(),
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

    /** 取出缓冲（清空）；调用方负责发出。 */
    const takePendingInput = (): string => {
      const buffered = pendingInputRef.current.data;
      pendingInputRef.current.data = '';
      return buffered;
    };

    /** 追加到缓冲；超过上限时从头部丢弃最旧的字符（尾部才是用户最新意图）。 */
    const appendPendingInput = (data: string): void => {
      const combined = pendingInputRef.current.data + data;
      pendingInputRef.current.data =
        combined.length > TERMINAL_WS_INPUT_BUFFER_LIMIT_CHARS
          ? combined.slice(combined.length - TERMINAL_WS_INPUT_BUFFER_LIMIT_CHARS)
          : combined;
    };

    /**
     * 按序补发缓冲到指定 WS（链路已被首帧确认可用）。
     *
     * 先确认目标可写、再取走缓冲：若目标不可写（刚被替换 / 已关闭），缓冲必须留在
     * 原地等下一次机会，不能「取出来再丢」。
     */
    const flushPendingInputToSocket = (target: TerminalSocketLike | null): void => {
      const buffered = pendingInputRef.current.data;
      if (buffered.length === 0 || target?.state !== 'open') return;
      pendingInputRef.current.data = '';
      target.sendInput(buffered);
    };

    /**
     * 输入路由：WS 打开时直接走 socket（没有 16ms 合并窗口，先补发断线缓冲）；
     * socket 未 open（连接中 / 重连退避窗口）先缓冲，首帧确认链路可用后按序补发
     * （见 `TERMINAL_WS_INPUT_BUFFER_LIMIT_CHARS` 注释：丢掉的通常是那次回车）。
     * 只有 'sse' 传输才进 `TerminalInputQueue`——切换时把 WS 缓冲整体交接过去。
     */
    const sendInput = (data: string): void => {
      if (data.length === 0 || !inputEnabledRef.current || exited) return;
      if (transport === 'ws') {
        const current = socket;
        if (current?.state === 'open') {
          flushPendingInputToSocket(current);
          current.sendInput(data);
          return;
        }
        appendPendingInput(data);
        return;
      }
      queue.push(takePendingInput() + data);
    };

    const requestPasteConfirmation = (summary: PasteGuardSummary): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        pasteResolveRef.current = resolve;
        setPastePrompt(summary);
      });

    const injectAfterPasteGuard = async (data: string): Promise<void> => {
      if (data.length === 0) return;
      // 非交互后端不接受 stdin：在入口统一拦截，避免走到粘贴确认再被拒绝。
      if (!inputEnabledRef.current) return;
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
        // macOS ⌘+Backspace = 删到行首（readline 的 Ctrl+U）。只在真实 PTY 上下发：
        // 管道后端没有行编辑，控制字符会混进命令行文本。
        sendKillLine: () => {
          if (interactiveRef.current) sendInput('\x15');
        },
      }),
    );

    const dataDisposable = term.onData((data) => {
      if (!inputEnabledRef.current) return;
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
        token: liveToken(),
        onStatus: (status) => setStreamStatus(status),
        onSnapshot: (payload) => {
          // snapshot = 这条流真的通了：复位退避（与 WS 的 markFrameReceived 同义）。
          reconnectAttempt = 0;
          writeSnapshot(payload);
        },
        onOutput: writeOutput,
        onExited: handleExit,
        onError: (error) => {
          reportStreamError(error);
          // EventSource 只在网络级错误上自动重连；HTTP 失败（401 / 502…）会让它永久
          // CLOSED，且自动重连沿用旧 URL（令牌轮换后必然 401）。这里按与 WS 相同的
          // 退避、用最新令牌重建这条流，而不是永久停在断开状态（终端已退出则不再重建，
          // 与 WS 的 onClose 分支同语义）。
          if (!exited && source?.readyState === EventSource.CLOSED) {
            scheduleSseRestart();
          }
        },
      });
    };

    /**
     * 由 SSE 段落调用：在 WS 退避段落的赋值处定义（需要 `startSseStream`，两者
     * 互相引用，用可变引用打破声明顺序）。未赋值前是 no-op。
     */
    let scheduleSseRestart: () => void = () => undefined;

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
      void resizeTerminal({
        gatewayUrl,
        sessionId,
        terminalId,
        token: liveToken(),
        cols,
        rows,
      }).catch(() => undefined);
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
      // WS 阶段缓冲的按键整体交给输入队列，保持先后顺序且不丢字。
      if (pendingInputRef.current.data.length > 0) {
        queue.push(takePendingInput());
      }
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
     * SSE 流永久关闭后的重建（与 WS 共用同一套退避计时器 —— 两种传输互斥，不会
     * 同时使用）。关闭旧流后立刻用最新令牌建一条新流；期间到期的回调由 `disposed`
     * 与 `transport` 守卫挡住。
     */
    scheduleSseRestart = (): void => {
      if (disposed || exited || transport !== 'sse' || reconnectTimer !== null) return;
      const attempt = reconnectAttempt;
      reconnectAttempt += 1;
      const delay = Math.min(
        TERMINAL_WS_RECONNECT_BASE_MS * 2 ** attempt,
        TERMINAL_WS_RECONNECT_MAX_MS,
      );
      setStreamStatus('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (disposed || exited || transport !== 'sse') return;
        const current = source;
        source = null;
        if (current) {
          try {
            current.close();
          } catch {
            /* 流已经关闭 */
          }
        }
        // 与 WS 重连同语义：换一副新 replay，让新流的 snapshot 重新 reset + 全量
        // 回放（否则「snapshot 只应用首次」会把新 snapshot 丢掉，断流期间的输出
        // 就永远缺失）。
        replay = createTerminalStreamReplay();
        startSseStream();
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
          token: liveToken(),
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
              // 首帧 = 链路确认可用：补发断线期间缓冲的按键（SSE 语义同款，不静默吞输入）。
              flushPendingInputToSocket(socket);
              writeSnapshot(payload);
            },
            onOutput: (payload) => {
              if (generation !== socketGeneration || disposed) return;
              markFrameReceived();
              flushPendingInputToSocket(socket);
              writeOutput(payload);
            },
            onExit: (payload) => {
              if (generation !== socketGeneration || disposed) return;
              markFrameReceived();
              // 终端退出：handleExit 会清空断线缓冲，不再补发。
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
      // 记录重建前焦点是否在终端内（此刻 DOM 仍挂载）；新实例挂载后归位，
      // 避免令牌轮换等重建动作吞掉用户的下一次击键。
      wasFocusedRef.current = container.contains(document.activeElement);
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
      titleDisposable.dispose();
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
    // 依赖里用 `hasToken` 而不是 `token`：令牌轮换不应触发终端重建（见 tokenRef 注释）。
  }, [gatewayUrl, hasToken, sessionId, terminalId, terminalSessionId]);

  /**
   * `terminal.interactive` 可能在挂载后才从「未知」变为已知：由 `terminal_started`
   * 事件本地构造的行不带该字段，紧随其后的服务端同步才会补上。`convertEol` 只在
   * 创建时读一次的话，未知兜底的 `true` 会永久留在实例上，破坏 TUI 的绝对定位
   * （表现为输出错位）。xterm 支持运行时改该选项（`InputHandler` 每处理 `\n` 时
   * 都读 `rawOptions.convertEol`），这里把变化同步进已挂载的实例。
   */
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const convertEol = terminal.interactive !== true;
    if (term.options.convertEol !== convertEol) {
      term.options.convertEol = convertEol;
    }
  }, [terminal.interactive]);

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
