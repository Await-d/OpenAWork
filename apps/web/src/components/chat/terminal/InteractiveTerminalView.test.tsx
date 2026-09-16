// @vitest-environment jsdom
/**
 * 组件级契约验证（契约 §3.2 / §3.3）：
 *  - snapshot 只应用首次，重连重发被丢弃；
 *  - output 按 `seq` 去重并按增量写入，缺省字段回退旧 tail-diff；
 *  - `onData` 经 16ms 合并成一次 `/stdin` POST 且保序；
 *  - 快捷键接进搜索条 / 剪贴板的判定；
 *  - 写入失败有可见反馈。
 *
 * xterm 本体在 jsdom 里跑不起来（需要 canvas / matchMedia），所以把
 * `@xterm/*` 全部换成可观测的替身 —— 我们要验证的是**接线语义**，
 * 而不是 xterm 的渲染。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';

interface FakeTerminalState {
  written: string[];
  resets: number;
  dataHandlers: Array<(data: string) => void>;
  scrollHandlers: Array<() => void>;
  selectionHandlers: Array<() => void>;
  selection: string;
  keyHandler: ((event: KeyboardEvent) => boolean) | null;
  disposeCount: number;
}

const hoisted = vi.hoisted(() => ({
  terminals: [] as FakeTerminalState[],
  /** 供测试直接改写 cols/rows（jsdom 没有真实布局，fit() 是 try/catch 空操作）。 */
  instances: [] as Array<{ cols: number; rows: number }>,
  initialCols: 80,
  initialRows: 24,
  searchAddon: {
    findNext: (): boolean => true,
    findPrevious: (): boolean => true,
    clearDecorations: (): void => undefined,
  },
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
      scrollHandlers: [],
      selectionHandlers: [],
      selection: '',
      keyHandler: null,
      disposeCount: 0,
    };

    constructor() {
      this.cols = hoisted.initialCols;
      this.rows = hoisted.initialRows;
      hoisted.terminals.push(this.state);
      hoisted.instances.push(this);
    }

    loadAddon(): void {}
    open(): void {}
    focus(): void {}
    selectAll(): void {
      this.state.selection = 'all';
    }
    scrollToBottom(): void {}
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
      return this.state.selection;
    }
    dispose(): void {
      this.state.disposeCount += 1;
    }
    onData(handler: (data: string) => void) {
      this.state.dataHandlers.push(handler);
      return { dispose: (): void => undefined };
    }
    onScroll(handler: () => void) {
      this.state.scrollHandlers.push(handler);
      return { dispose: (): void => undefined };
    }
    onWriteParsed() {
      return { dispose: (): void => undefined };
    }
    onSelectionChange(handler: () => void) {
      this.state.selectionHandlers.push(handler);
      return { dispose: (): void => undefined };
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
      this.state.keyHandler = handler;
    }
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

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: Event) => void): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(handler);
    this.listeners.set(type, bucket);
  }

  close(): void {}

  emit(type: string, payload: unknown): void {
    const event = { data: JSON.stringify(payload) } as MessageEvent;
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
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

  /** 手动触发所有已注册回调，模拟容器尺寸变化。 */
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

function lastTerminal(): FakeTerminalState {
  const state = hoisted.terminals.at(-1);
  if (!state) throw new Error('Terminal 未构造');
  return state;
}

function lastTerminalInstance(): { cols: number; rows: number } {
  const instance = hoisted.instances.at(-1);
  if (!instance) throw new Error('Terminal 未构造');
  return instance;
}

function lastSource(): MockEventSource {
  const source = MockEventSource.instances.at(-1);
  if (!source) throw new Error('EventSource 未构造');
  return source;
}

describe('InteractiveTerminalView', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hoisted.terminals.length = 0;
    hoisted.instances.length = 0;
    hoisted.initialCols = 80;
    hoisted.initialRows = 24;
    MockEventSource.instances = [];
    MockResizeObserver.callbacks = [];
    fetchMock = vi.fn(async () =>
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

  function renderView(terminal: SessionTerminalView = makeTerminalView()) {
    render(
      <InteractiveTerminalView
        gatewayUrl="https://gateway.test"
        token="token-1"
        sessionId="session-1"
        terminal={terminal}
        inputEnabled
      />,
    );
  }

  function resizeCalls() {
    return fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/resize'));
  }

  it('snapshot 只应用首次，重连重发不会清空用户输入', async () => {
    renderView();
    const state = lastTerminal();
    const source = lastSource();

    act(() => {
      source.emit('snapshot', { seq: 3, data: 'history', outputBytesTotal: 7, status: 'running' });
    });
    act(() => {
      source.emit('snapshot', { seq: 3, data: 'history', outputBytesTotal: 7, status: 'running' });
    });

    expect(state.resets).toBe(1);
    expect(state.written).toContain('history');
  });

  it('output 按 seq 去重并使用增量 data', async () => {
    renderView();
    const state = lastTerminal();
    const source = lastSource();

    act(() => {
      source.emit('snapshot', { seq: 1, data: 'a', outputBytesTotal: 1, status: 'running' });
    });
    act(() => {
      source.emit('output', { seq: 2, data: 'b', outputTail: 'ab', outputBytesTotal: 2 });
    });
    act(() => {
      source.emit('output', { seq: 2, data: 'b', outputTail: 'ab', outputBytesTotal: 2 });
    });
    act(() => {
      source.emit('output', { seq: 3, data: 'c', outputTail: 'abc', outputBytesTotal: 3 });
    });

    expect(state.written).toEqual(['a', 'b', 'c']);
  });

  it('旧后端（只有累积 tail）仍按字节差回放', async () => {
    renderView();
    const state = lastTerminal();
    const source = lastSource();

    act(() => {
      source.emit('snapshot', { outputTail: 'hello', outputBytesTotal: 5, status: 'running' });
    });
    act(() => {
      source.emit('output', { outputTail: 'hello world', outputBytesTotal: 11 });
    });

    expect(state.written).toEqual(['hello', ' world']);
  });

  it('连续按键合并成一次 stdin 写入且保序', async () => {
    vi.useFakeTimers();
    renderView();
    const state = lastTerminal();

    await act(async () => {
      for (const chunk of ['l', 's', '\r']) {
        for (const handler of state.dataHandlers) handler(chunk);
      }
      await vi.advanceTimersByTimeAsync(20);
    });

    const stdinCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).endsWith('/stdin'),
    );
    expect(stdinCalls.length).toBe(1);
    expect(JSON.parse(String((stdinCalls[0]?.[1] as RequestInit).body))).toEqual({ data: 'ls\r' });
  });

  it('快捷键：Ctrl+F 打开搜索条，Ctrl+Shift+C 无选中时不劫持', async () => {
    renderView();
    const state = lastTerminal();

    expect(state.keyHandler).not.toBeNull();
    const copyEvent = new KeyboardEvent('keydown', {
      key: 'C',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    expect(state.keyHandler?.(copyEvent)).toBe(true);

    state.selection = 'selected text';
    expect(state.keyHandler?.(copyEvent)).toBe(false);

    const searchEvent = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true });
    await act(async () => {
      state.keyHandler?.(searchEvent);
    });
    expect(screen.getByTestId('terminal-search-bar')).toBeTruthy();
  });

  it('写入失败时给出可见反馈', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: false, error: 'terminal_not_persistent' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    renderView();
    const state = lastTerminal();

    await act(async () => {
      for (const handler of state.dataHandlers) handler('x');
      // 真实计时器：等合并窗口 + 网络往返落地（waitFor 与 fake timers 不兼容）。
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(screen.getByTestId('terminal-notice').textContent).toContain('输入写入失败');
  });

  it('supportsResize=false（pipe 后端）时不发 /resize 请求', async () => {
    vi.useFakeTimers();
    renderView(makeTerminalView({ backend: 'pipe', supportsResize: false }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(resizeCalls()).toHaveLength(0);
  });

  it('零尺寸（cols<2 或 rows<1）跳过 /resize', async () => {
    vi.useFakeTimers();

    hoisted.initialCols = 1;
    hoisted.initialRows = 24;
    renderView();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(resizeCalls()).toHaveLength(0);

    cleanup();
    MockResizeObserver.callbacks = [];
    hoisted.initialCols = 80;
    hoisted.initialRows = 0;
    renderView();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(resizeCalls()).toHaveLength(0);
  });

  it('连续 fit 合并成一次 trailing /resize POST（160ms）', async () => {
    vi.useFakeTimers();
    renderView();
    const instance = lastTerminalInstance();

    await act(async () => {
      // 挂载时的首次 fit 已排期但未到窗口，不应该立刻发请求。
      expect(resizeCalls()).toHaveLength(0);
      for (const [cols, rows] of [
        [100, 30],
        [120, 40],
        [140, 45],
      ] as const) {
        instance.cols = cols;
        instance.rows = rows;
        MockResizeObserver.fire();
      }
      // trailing：拖拽期间不发，只有停顿后的一次。
      expect(resizeCalls()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(160);
    });

    const calls = resizeCalls();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String((calls[0]?.[1] as RequestInit).body))).toEqual({
      cols: 140,
      rows: 45,
    });
  });

  it('unmount 清理 pending resize 定时器，之后不再发 POST', async () => {
    vi.useFakeTimers();
    renderView();
    const instance = lastTerminalInstance();

    await act(async () => {
      instance.cols = 100;
      MockResizeObserver.fire();
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    cleanup();

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(resizeCalls()).toHaveLength(0);
  });
});
