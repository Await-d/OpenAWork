// @vitest-environment jsdom
/**
 * Phase B：交互式终端 WebSocket 传输契约（WS 优先 + SSE 回退）。
 *
 * 覆盖：
 *  - WS 优先：挂载即 `openTerminalSocket`（带 gatewayUrl / accessToken / handlers），
 *    不再构造 EventSource；
 *  - 首帧前失败（握手前关闭 / 首帧前 error / 构造同步抛出）透明回退 SSE，
 *    且被放弃连接上的迟到帧不会重复写输出；
 *  - 输入：WS 路径直达 `socket.sendInput`（无 16ms 合并、无 `/stdin`）；
 *    未 open（连接中 / 退避窗口）时进入缓冲，首帧确认链路可用后按序补发；
 *    回退 SSE 时缓冲整体交给 stdin 队列；终端已退出则丢弃；
 *  - 令牌轮换（accessToken 变化）不重建终端：socket 保持、不重放 snapshot；
 *  - resize：首个 fit 在 socket open 时补发，后续拖拽仍按 160ms trailing
 *    合并，不发 `/resize`；
 *  - snapshot 仅首次生效、output 按 seq 去重（复用 `terminal-stream-replay`）；
 *  - 意外断开 → 有界指数退避重连（500ms 起步、封顶 5s），新连接换新 replay
 *    并重新应用 snapshot；重建时若焦点在终端内会自动归位；卸载关闭 socket 并清定时器。
 *
 * xterm 本体在 jsdom 里跑不起来（需要 canvas / matchMedia），替换成可观测替身；
 * `@openAwork/web-client` 只替换 `openTerminalSocket`，SSE / HTTP 保持真实实现
 * （配 fetch / EventSource 替身），以便验证回退链路。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type {
  TerminalSocketExit,
  TerminalSocketOutput,
  TerminalSocketSnapshot,
} from '@openAwork/web-client';
import type {
  SessionTerminalView,
  TerminalSocket,
  TerminalSocketHandlers,
} from '../../conversation-runtime/terminals/terminals-api.js';
import { TERMINAL_INPUT_MERGE_MS } from './terminal-input-queue.js';

interface SocketCallParams {
  gatewayUrl: string;
  accessToken: string;
  sessionId: string;
  terminalId: string;
  afterSeq?: number;
  handlers: TerminalSocketHandlers;
}

const wsMocks = vi.hoisted(() => ({
  sockets: [] as FakeTerminalSocket[],
  openTerminalSocket: vi.fn<(params: SocketCallParams) => TerminalSocket>(),
}));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return { ...actual, openTerminalSocket: wsMocks.openTerminalSocket };
});

interface FakeTerminalState {
  written: string[];
  resets: number;
  dataHandlers: Array<(data: string) => void>;
  disposeCount: number;
  refreshCalls: Array<[number, number]>;
  focusCount: number;
}

const xterm = vi.hoisted(() => ({
  terminals: [] as FakeTerminalState[],
  /** 供测试直接改写 cols/rows（jsdom 没有真实布局，fit() 是空操作）。 */
  instances: [] as Array<{ cols: number; rows: number; options: Record<string, unknown> }>,
  initialCols: 80,
  initialRows: 24,
}));

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols: number;
    rows: number;
    options: Record<string, unknown> = {};
    unicode = { activeVersion: '' };
    buffer = { active: { viewportY: 0, baseY: 0 } };
    private readonly state: FakeTerminalState = {
      written: [],
      resets: 0,
      dataHandlers: [],
      disposeCount: 0,
      refreshCalls: [],
      focusCount: 0,
    };

    constructor(options?: Record<string, unknown>) {
      this.cols = xterm.initialCols;
      this.rows = xterm.initialRows;
      this.options = { ...(options ?? {}) };
      xterm.terminals.push(this.state);
      xterm.instances.push(this);
    }

    loadAddon(): void {}
    open(): void {}
    focus(): void {
      this.state.focusCount += 1;
    }
    selectAll(): void {}
    scrollToBottom(): void {}
    refresh(start: number, end: number): void {
      this.state.refreshCalls.push([start, end]);
    }
    clear(): void {
      this.state.written.push('<clear>');
    }
    reset(): void {
      this.state.resets += 1;
      this.state.written.length = 0;
    }
    write(data: string | Uint8Array): void {
      this.state.written.push(typeof data === 'string' ? data : '<bytes>');
    }
    writeln(data: string): void {
      this.state.written.push(`${data}\n`);
    }
    getSelection(): string {
      return '';
    }
    dispose(): void {
      this.state.disposeCount += 1;
    }
    onData(handler: (data: string) => void) {
      this.state.dataHandlers.push(handler);
      return { dispose: (): void => undefined };
    }
    onScroll() {
      return { dispose: (): void => undefined };
    }
    onWriteParsed() {
      return { dispose: (): void => undefined };
    }
    onSelectionChange() {
      return { dispose: (): void => undefined };
    }
    attachCustomKeyEventHandler(): void {}
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss(): { dispose: () => void } {
      return { dispose: (): void => undefined };
    }
    dispose(): void {}
    clearTextureAtlas(): void {}
  },
}));

const { InteractiveTerminalView } = await import('./InteractiveTerminalView.js');

/** 可观测的 WS 替身：测试直接驱动服务端方向的帧与生命周期。 */
class FakeTerminalSocket implements TerminalSocket {
  state: TerminalSocket['state'] = 'connecting';
  readonly inputs: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  closeCalls = 0;
  private readonly handlers: TerminalSocketHandlers;

  constructor(handlers: TerminalSocketHandlers) {
    this.handlers = handlers;
  }

  sendInput(data: string): void {
    this.inputs.push(data);
  }

  sendResize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  close(): void {
    this.closeCalls += 1;
    this.state = 'closed';
  }

  serverOpen(): void {
    this.state = 'open';
    this.handlers.onOpen?.();
  }

  serverSnapshot(payload: TerminalSocketSnapshot): void {
    this.handlers.onSnapshot(payload);
  }

  serverOutput(payload: TerminalSocketOutput): void {
    this.handlers.onOutput(payload);
  }

  serverExit(payload: TerminalSocketExit): void {
    this.handlers.onExit?.(payload);
  }

  serverError(error: Error): void {
    this.handlers.onError?.(error);
  }

  /** 模拟连接被服务端 / 网络意外关闭。 */
  serverClose(): void {
    this.state = 'closed';
    this.handlers.onClose?.({ code: 1006, reason: '' });
  }
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  /** 与原生 `EventSource` 常量对齐（openTerminalStream 会读取它们）。 */
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState: number = MockEventSource.OPEN;
  readonly listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: Event) => void): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  emit(type: string, payload: unknown): void {
    const event = { data: JSON.stringify(payload) } as MessageEvent;
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }

  /** 模拟 HTTP 层失败（401 / 502…）导致的永久关闭：readyState=CLOSED + error 事件。 */
  serverClose(): void {
    this.readyState = MockEventSource.CLOSED;
    for (const handler of this.listeners.get('error') ?? []) {
      handler(new Event('error'));
    }
  }
}

class MockResizeObserver {
  static callbacks: Array<() => void> = [];

  constructor(callback: () => void) {
    MockResizeObserver.callbacks.push(callback);
  }

  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}

  static fire(): void {
    for (const callback of MockResizeObserver.callbacks) callback();
  }
}

function makeTerminalView(overrides: Partial<SessionTerminalView> = {}): SessionTerminalView {
  return {
    terminalId: 'term_1',
    sessionId: 'session-1',
    toolName: 'quick_terminal',
    kind: 'foreground',
    command: 'bash',
    cwd: '/tmp',
    status: 'running',
    startedAtMs: 1_700_000_000_000,
    lastActivityMs: 1_700_000_000_500,
    outputBytesTotal: 0,
    outputTail: '',
    ...overrides,
  };
}

function snapshot(seq: number, data: string, outputBytesTotal: number): TerminalSocketSnapshot {
  return { terminalId: 'term_1', seq, data, outputBytesTotal, status: 'running' };
}

function output(seq: number, data: string, outputBytesTotal: number): TerminalSocketOutput {
  return { terminalId: 'term_1', seq, data, outputBytesTotal };
}

function lastTerminal(): FakeTerminalState {
  const state = xterm.terminals.at(-1);
  if (!state) throw new Error('Terminal 未构造');
  return state;
}

function lastTerminalInstance(): { cols: number; rows: number; options: Record<string, unknown> } {
  const instance = xterm.instances.at(-1);
  if (!instance) throw new Error('Terminal 未构造');
  return instance;
}

function lastSocket(): FakeTerminalSocket {
  const socket = wsMocks.sockets.at(-1);
  if (!socket) throw new Error('openTerminalSocket 未被调用');
  return socket;
}

function lastSocketCall(): SocketCallParams {
  const call = wsMocks.openTerminalSocket.mock.calls.at(-1);
  if (!call) throw new Error('openTerminalSocket 未被调用');
  return call[0];
}

describe('InteractiveTerminalView · WebSocket 传输（Phase B）', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    xterm.terminals.length = 0;
    xterm.instances.length = 0;
    xterm.initialCols = 80;
    xterm.initialRows = 24;
    MockEventSource.instances = [];
    MockResizeObserver.callbacks = [];
    wsMocks.sockets.length = 0;
    wsMocks.openTerminalSocket.mockReset();
    wsMocks.openTerminalSocket.mockImplementation((params) => {
      const socket = new FakeTerminalSocket(params.handlers);
      wsMocks.sockets.push(socket);
      return socket;
    });
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal('navigator', { clipboard: undefined, userAgent: 'vitest' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function renderView(
    props: { token?: string; terminal?: SessionTerminalView } = {},
  ): ReturnType<typeof render> {
    return render(
      <InteractiveTerminalView
        gatewayUrl="https://gateway.test"
        token={props.token ?? 'token-1'}
        sessionId="session-1"
        terminal={props.terminal ?? makeTerminalView()}
        inputEnabled
      />,
    );
  }

  function stdinCalls() {
    return fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/stdin'));
  }

  function resizeCalls() {
    return fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/resize'));
  }

  it('挂载即优先建立 WS（带 gatewayUrl / token / 会话信息），不构造 EventSource', () => {
    renderView();

    expect(wsMocks.openTerminalSocket).toHaveBeenCalledTimes(1);
    const params = lastSocketCall();
    expect(params.gatewayUrl).toBe('https://gateway.test');
    expect(params.accessToken).toBe('token-1');
    expect(params.sessionId).toBe('session-1');
    expect(params.terminalId).toBe('term_1');
    // 重连靠全新 snapshot，不传增量游标。
    expect(params.afterSeq).toBeUndefined();
    expect(typeof params.handlers.onSnapshot).toBe('function');
    expect(typeof params.handlers.onOutput).toBe('function');
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('握手完成前连接关闭 → 回退 SSE，被放弃连接的迟到帧不会重复写输出', () => {
    renderView();
    const socket = lastSocket();

    act(() => {
      socket.serverClose();
    });

    expect(MockEventSource.instances).toHaveLength(1);
    const source = MockEventSource.instances[0];
    if (!source) throw new Error('EventSource 未构造');

    act(() => {
      source.emit('snapshot', { seq: 3, data: 'history', outputBytesTotal: 7, status: 'running' });
    });
    const state = lastTerminal();
    expect(state.resets).toBe(1);
    expect(state.written).toEqual(['history']);

    // 已作废的连接上的迟到 snapshot 必须被忽略（generation 已失效）。
    act(() => {
      socket.serverSnapshot(snapshot(3, 'duplicate', 7));
    });
    expect(state.written).toEqual(['history']);
  });

  it('首帧前 error → 回退 SSE（不在没有 snapshot 的情况下空转重连）', () => {
    renderView();
    const socket = lastSocket();

    act(() => {
      socket.serverOpen();
    });
    act(() => {
      socket.serverError(new Error('handshake lost'));
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(wsMocks.sockets).toHaveLength(1);
  });

  it('构造 WebSocket 同步抛出（运行时不支持）也能回退 SSE', () => {
    wsMocks.openTerminalSocket.mockImplementation(() => {
      throw new Error('WebSocket is not a constructor');
    });

    renderView();

    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('输入直达 socket：无 16ms 合并、不发 /stdin', () => {
    renderView();
    const socket = lastSocket();
    act(() => {
      socket.serverOpen();
    });
    const state = lastTerminal();

    act(() => {
      for (const handler of state.dataHandlers) handler('l');
      for (const handler of state.dataHandlers) handler('s');
      for (const handler of state.dataHandlers) handler('\r');
    });

    expect(socket.inputs).toEqual(['l', 's', '\r']);
    expect(stdinCalls()).toHaveLength(0);
  });

  it('socket 未 open 时按键先缓冲，首帧（链路确认可用）后按序补发', async () => {
    vi.useFakeTimers();
    renderView();
    const socket = lastSocket();
    const state = lastTerminal();

    await act(async () => {
      for (const handler of state.dataHandlers) handler('l');
      for (const handler of state.dataHandlers) handler('s');
      for (const handler of state.dataHandlers) handler('\r');
      await vi.advanceTimersByTimeAsync(100);
    });

    // 链路未确认：一个字符都不发（也不走 HTTP），但也不丢。
    expect(socket.inputs).toEqual([]);
    expect(stdinCalls()).toHaveLength(0);

    act(() => {
      socket.serverOpen();
    });
    // open 还不够：必须等首帧（snapshot）证明这条连接真的可用。
    expect(socket.inputs).toEqual([]);

    act(() => {
      socket.serverSnapshot(snapshot(4, 'boot', 4));
    });
    expect(socket.inputs).toEqual(['ls\r']);

    // 补发后回到直达路径，且不会重复补发。
    act(() => {
      for (const handler of state.dataHandlers) handler('x');
    });
    expect(socket.inputs).toEqual(['ls\r', 'x']);
  });

  it('首帧到达但 socket 仍不可写时，缓冲保留而不是被取出丢弃', () => {
    renderView();
    const socket = lastSocket();
    const state = lastTerminal();

    act(() => {
      for (const handler of state.dataHandlers) handler('x');
    });

    // 异常时序：snapshot 早于 open 到达（socket 仍是 connecting）。
    act(() => {
      socket.serverSnapshot(snapshot(1, 'boot', 4));
    });
    expect(socket.inputs).toEqual([]);

    // 连接可用后的下一帧必须能把之前缓冲的按键补发出去（证明没被丢掉）。
    act(() => {
      socket.serverOpen();
    });
    act(() => {
      socket.serverOutput(output(2, 'y', 5));
    });
    expect(socket.inputs).toEqual(['x']);
  });

  it('握手失败回退 SSE 时，WS 窗口缓冲的按键交给 stdin 队列（不丢字）', async () => {
    vi.useFakeTimers();
    renderView();
    const socket = lastSocket();
    const state = lastTerminal();

    await act(async () => {
      for (const handler of state.dataHandlers) handler('e');
      for (const handler of state.dataHandlers) handler('\r');
    });
    expect(socket.inputs).toEqual([]);

    act(() => {
      socket.serverClose();
    });
    expect(MockEventSource.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS);
    });

    const calls = stdinCalls();
    expect(calls).toHaveLength(1);
    const body = (calls[0]?.[1] as RequestInit).body;
    expect(JSON.parse(String(body))).toEqual({ data: 'e\r' });
  });

  it('SSE 流永久关闭（HTTP 失败）后按退避用最新令牌重建，不会永久断开', async () => {
    vi.useFakeTimers();
    // 让 WS 构造同步失败：走 SSE 回退路径。
    wsMocks.openTerminalSocket.mockImplementation(() => {
      throw new Error('WebSocket 不可用');
    });
    const view = renderView();
    expect(MockEventSource.instances).toHaveLength(1);
    const first = MockEventSource.instances[0];
    if (!first) throw new Error('EventSource 未构造');
    expect(first.url).toContain('token=token-1');

    // 令牌轮换（不应重建 EventSource），随后发生 HTTP 失败。
    view.rerender(
      <InteractiveTerminalView
        gatewayUrl="https://gateway.test"
        token="token-2"
        sessionId="session-1"
        terminal={makeTerminalView()}
        inputEnabled
      />,
    );
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      first.serverClose();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // 重建后的流必须带最新令牌（否则过期令牌会再次 401，形成永久断开）。
    expect(MockEventSource.instances).toHaveLength(2);
    const second = MockEventSource.instances[1];
    if (!second) throw new Error('EventSource 未重建');
    expect(second.url).toContain('token=token-2');

    // 新流的 snapshot 必须重新应用（reset + 全量回放），否则断流期间的输出会缺失。
    const state = lastTerminal();
    const resetsBefore = state.resets;
    act(() => {
      second.emit('snapshot', { seq: 7, data: 'replay', outputBytesTotal: 7, status: 'running' });
    });
    expect(state.resets).toBe(resetsBefore + 1);
    expect(state.written).toEqual(['replay']);
  });

  it('resize 走 socket：首个 fit 在 open 时补发，后续拖拽仍按 160ms 防抖合并', async () => {
    vi.useFakeTimers();
    renderView();
    const socket = lastSocket();

    // 挂载时 socket 还没 open：首个 fit 先挂起，不能丢（丢首屏会按 80x24 落格）。
    expect(socket.resizes).toEqual([]);

    act(() => {
      socket.serverOpen();
    });
    expect(socket.resizes).toEqual([{ cols: 80, rows: 24 }]);
    expect(resizeCalls()).toHaveLength(0);

    const instance = lastTerminalInstance();
    await act(async () => {
      instance.cols = 100;
      instance.rows = 30;
      MockResizeObserver.fire();
      // trailing：拖拽期间不发，只有停顿后的一次。
      expect(socket.resizes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(160);
    });

    expect(socket.resizes).toEqual([
      { cols: 80, rows: 24 },
      { cols: 100, rows: 30 },
    ]);
    expect(resizeCalls()).toHaveLength(0);
  });

  it('snapshot 仅首次生效、output 按 seq 去重（复用回放状态机）', () => {
    renderView();
    const socket = lastSocket();
    const state = lastTerminal();
    act(() => {
      socket.serverOpen();
    });

    act(() => {
      socket.serverSnapshot(snapshot(3, 'history', 7));
      socket.serverSnapshot(snapshot(3, 'history', 7));
    });
    act(() => {
      socket.serverOutput(output(4, 'b', 8));
      socket.serverOutput(output(4, 'b', 8));
      socket.serverOutput(output(5, 'c', 9));
    });

    expect(state.resets).toBe(1);
    expect(state.written).toEqual(['history', 'b', 'c']);
  });

  it('意外断开 → 退避重连换新 replay 并重新应用 snapshot；窗口内按键缓冲后补发', async () => {
    vi.useFakeTimers();
    renderView();
    const state = lastTerminal();
    const first = lastSocket();

    act(() => {
      first.serverOpen();
    });
    act(() => {
      first.serverSnapshot(snapshot(3, 'one', 3));
    });
    expect(state.resets).toBe(1);
    expect(state.written).toEqual(['one']);

    act(() => {
      first.serverClose();
    });

    await act(async () => {
      // 退避窗口内不新建连接；此期间的按键进入缓冲（不丢）。
      for (const handler of state.dataHandlers) handler('x');
      expect(wsMocks.sockets).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(wsMocks.sockets).toHaveLength(2);
    expect(first.inputs).toEqual([]);
    expect(stdinCalls()).toHaveLength(0);

    const second = lastSocket();
    expect(second).not.toBe(first);
    act(() => {
      second.serverOpen();
    });
    // 首帧到达前仍不补发：此时还不能确认这条链路可用。
    expect(second.inputs).toEqual([]);
    act(() => {
      second.serverSnapshot(snapshot(9, 'two', 3));
    });

    // 新连接换新 replay：snapshot 重新 reset 并按新序号继续去重。
    expect(state.resets).toBe(2);
    expect(state.written).toEqual(['two']);
    // 断线窗口的按键按序补发到新连接。
    expect(second.inputs).toEqual(['x']);

    act(() => {
      for (const handler of state.dataHandlers) handler('y');
    });
    expect(second.inputs).toEqual(['x', 'y']);
    expect(first.inputs).toEqual([]);
  });

  it('重连后首帧是 exit 时，断线缓冲被丢弃（不发给已退出的终端）', async () => {
    vi.useFakeTimers();
    renderView();
    const state = lastTerminal();
    const first = lastSocket();
    act(() => {
      first.serverOpen();
    });
    act(() => {
      first.serverSnapshot(snapshot(3, 'one', 3));
    });
    act(() => {
      first.serverClose();
    });

    await act(async () => {
      for (const handler of state.dataHandlers) handler('r');
      await vi.advanceTimersByTimeAsync(500);
    });

    const second = lastSocket();
    act(() => {
      second.serverOpen();
      second.serverExit({ status: 'exited', exitCode: 0 });
    });

    expect(second.inputs).toEqual([]);
    expect(stdinCalls()).toHaveLength(0);
  });

  it('令牌轮换不重建终端：socket 保持、xterm 不销毁、输入仍直达原 socket', () => {
    const view = renderView();
    const socket = lastSocket();
    act(() => {
      socket.serverOpen();
      socket.serverSnapshot(snapshot(1, 'boot', 4));
    });
    const state = lastTerminal();
    const terminalCount = xterm.terminals.length;

    view.rerender(
      <InteractiveTerminalView
        gatewayUrl="https://gateway.test"
        token="token-2"
        sessionId="session-1"
        terminal={makeTerminalView()}
        inputEnabled
      />,
    );

    expect(wsMocks.sockets).toHaveLength(1);
    expect(socket.closeCalls).toBe(0);
    expect(xterm.terminals).toHaveLength(terminalCount);
    expect(state.disposeCount).toBe(0);
    expect(lastTerminal()).toBe(state);

    act(() => {
      for (const handler of state.dataHandlers) handler('a');
    });
    expect(socket.inputs).toEqual(['a']);
  });

  it('interactive 能力标记后到时会同步 convertEol（未知兜底 true → PTY 后 false）', () => {
    const view = renderView();
    expect(lastTerminalInstance().options['convertEol']).toBe(true);

    view.rerender(
      <InteractiveTerminalView
        gatewayUrl="https://gateway.test"
        token="token-1"
        sessionId="session-1"
        terminal={makeTerminalView({ interactive: true })}
        inputEnabled
      />,
    );

    expect(lastTerminalInstance().options['convertEol']).toBe(false);
    // 能力标记更新不该重建实例（否则又是一次焦点/回滚丢失）。
    expect(xterm.terminals).toHaveLength(1);
  });

  it('终端重建时若焦点在终端内，新实例自动归位焦点', () => {
    const view = renderView();
    act(() => {
      lastSocket().serverOpen();
    });
    const surface = screen.getByTestId('terminal-surface');
    surface.focus();
    expect(document.activeElement).toBe(surface);

    view.rerender(
      <InteractiveTerminalView
        gatewayUrl="https://gateway.test"
        token="token-1"
        sessionId="session-1"
        terminal={makeTerminalView({ terminalId: 'term_2' })}
        inputEnabled
      />,
    );

    expect(xterm.terminals).toHaveLength(2);
    expect(xterm.terminals[0]?.focusCount).toBe(0);
    expect(xterm.terminals[1]?.focusCount).toBe(1);
  });

  it('重连退避有界：500ms 起步、逐次翻倍、封顶 5s', async () => {
    vi.useFakeTimers();
    renderView();
    const delays = [500, 1000, 2000, 4000, 5000, 5000];
    let socket = lastSocket();
    act(() => {
      socket.serverOpen();
    });

    for (const delay of delays) {
      act(() => {
        socket.serverClose();
      });
      const before = wsMocks.sockets.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay - 1);
      });
      expect(wsMocks.sockets).toHaveLength(before);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(wsMocks.sockets).toHaveLength(before + 1);

      socket = lastSocket();
      act(() => {
        socket.serverOpen();
      });
    }
  });

  it('卸载时关闭 socket 并清理定时器', async () => {
    vi.useFakeTimers();
    renderView();
    const socket = lastSocket();
    act(() => {
      socket.serverOpen();
    });

    cleanup();

    expect(socket.closeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(wsMocks.sockets).toHaveLength(1);
  });
});
