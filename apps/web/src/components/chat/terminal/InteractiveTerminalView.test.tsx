// @vitest-environment jsdom
/**
 * 组件级契约验证（契约 §3.2 / §3.3）：
 *  - snapshot 只应用首次，重连重发被丢弃；
 *  - output 按 `seq` 去重并按增量写入，缺省字段回退旧 tail-diff；
 *  - `onData` 经 16ms 合并成一次 `/stdin` POST 且保序；
 *  - 快捷键接进搜索条 / 剪贴板的判定；
 *  - 写入失败有可见反馈；
 *  - `interactive` 驱动 convertEol（真 PTY 关、管道开）；不再拦截输入、不再有禁用横幅。
 *
 * xterm 本体在 jsdom 里跑不起来（需要 canvas / matchMedia），所以把
 * `@xterm/*` 全部换成可观测的替身 —— 我们要验证的是**接线语义**，
 * 而不是 xterm 的渲染。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import type { TerminalContextMenuItem } from './TerminalContextMenu.js';
import { buildTerminalCommandItems } from './terminal-pane-menu.js';

interface FakeTerminalState {
  written: string[];
  resets: number;
  dataHandlers: Array<(data: string) => void>;
  scrollHandlers: Array<() => void>;
  selectionHandlers: Array<() => void>;
  titleHandlers: Array<(title: string) => void>;
  selection: string;
  keyHandler: ((event: KeyboardEvent) => boolean) | null;
  disposeCount: number;
  /** `refreshTerminal()` 的调用记录（fit 之后必须重绘新网格）。 */
  refreshCalls: Array<[number, number]>;
}

const hoisted = vi.hoisted(() => ({
  terminals: [] as FakeTerminalState[],
  /** 供测试直接改写 cols/rows（jsdom 没有真实布局，fit() 是 try/catch 空操作）。 */
  instances: [] as Array<{ cols: number; rows: number }>,
  /** `new Terminal(options)` 的构造参数，用于断言 convertEol 映射。 */
  terminalOptions: [] as Array<Record<string, unknown>>,
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
      titleHandlers: [],
      selection: '',
      keyHandler: null,
      disposeCount: 0,
      refreshCalls: [],
    };

    constructor(options: Record<string, unknown> = {}) {
      this.cols = hoisted.initialCols;
      this.rows = hoisted.initialRows;
      hoisted.terminalOptions.push(options);
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
    onTitleChange(handler: (title: string) => void) {
      this.state.titleHandlers.push(handler);
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

/**
 * Phase B：本文件覆盖的是 SSE + HTTP 路径。挂载时 hook 会先尝试 WS，这里用
 * 「构造即抛出」的 WebSocket 替身模拟运行时不可用，让它同步回退到 SSE 分支
 * （回退链路本身也被这些用例顺带覆盖）。WS 优先 / 重连等用例在
 * `InteractiveTerminalView.ws-transport.test.tsx`。
 */
class UnavailableWebSocket {
  constructor() {
    throw new Error('WebSocket unavailable in this test env');
  }
}

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
    hoisted.terminalOptions.length = 0;
    hoisted.initialCols = 80;
    hoisted.initialRows = 24;
    MockEventSource.instances = [];
    MockResizeObserver.callbacks = [];
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
    vi.stubGlobal('WebSocket', UnavailableWebSocket);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function renderView(
    terminal: SessionTerminalView = makeTerminalView(),
    menuItems?: TerminalContextMenuItem[],
    onTitleChange?: (title: string | null) => void,
  ) {
    render(
      <InteractiveTerminalView
        gatewayUrl="https://gateway.test"
        token="token-1"
        sessionId="session-1"
        terminal={terminal}
        inputEnabled
        menuItems={menuItems}
        onTitleChange={onTitleChange}
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

  it('xterm 窗口标题（OSC 0/1/2）上报宿主；空标题按 null 上报', () => {
    const onTitleChange = vi.fn();
    renderView(makeTerminalView(), undefined, onTitleChange);
    const state = lastTerminal();

    act(() => {
      for (const handler of state.titleHandlers) handler('vim README.md');
    });
    expect(onTitleChange).toHaveBeenLastCalledWith('vim README.md');

    act(() => {
      for (const handler of state.titleHandlers) handler('');
    });
    expect(onTitleChange).toHaveBeenLastCalledWith(null);
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

    const stdinCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/stdin'));
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

  it('⌘+Backspace：真实 PTY 下发 \\x15（删到行首），管道后端不下发', async () => {
    const pressKillLine = async (state: ReturnType<typeof lastTerminal>): Promise<void> => {
      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        metaKey: true,
        cancelable: true,
      });
      await act(async () => {
        expect(state.keyHandler?.(event)).toBe(false);
      });
    };
    const stdinBodies = (): unknown[] =>
      fetchMock.mock.calls
        .filter((call) => String(call[0]).endsWith('/stdin'))
        .map((call) => JSON.parse(String((call[1] as RequestInit).body)));

    renderView(makeTerminalView({ interactive: true }));
    await pressKillLine(lastTerminal());
    // 用 waitFor 等合并窗口 + 网络往返落地，避免并行负载下固定 sleep 的时序抖动。
    await waitFor(() => {
      expect(stdinBodies()).toEqual([{ data: '\x15' }]);
    });
    cleanup();
    fetchMock.mockClear();

    renderView(makeTerminalView({ interactive: false }));
    await pressKillLine(lastTerminal());
    // 负向断言：留出一个合并窗口 + 余量，确认确实没有请求发出。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(stdinBodies()).toEqual([]);
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

  it('首次尺寸同步立即发出（不等防抖），后续连续 fit 合并成一次 trailing POST', async () => {
    vi.useFakeTimers();
    renderView();

    // 首次同步是立即的：未推进任何定时器就应该已经发出真实尺寸，
    // 否则 shell 的首个提示符会按默认 80x24 落格。
    const first = resizeCalls();
    expect(first).toHaveLength(1);
    expect(JSON.parse(String((first[0]?.[1] as RequestInit).body))).toEqual({
      cols: 80,
      rows: 24,
    });
    // 没有顺带排一个 trailing 防抖：推进整个窗口也不会出现第二次同尺寸请求。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
    });
    expect(resizeCalls()).toHaveLength(1);

    const instance = lastTerminalInstance();
    await act(async () => {
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
      expect(resizeCalls()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(160);
    });

    const calls = resizeCalls();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String((calls[1]?.[1] as RequestInit).body))).toEqual({
      cols: 140,
      rows: 45,
    });
  });

  it('unmount 清理 pending resize 定时器，之后不再发 POST', async () => {
    vi.useFakeTimers();
    renderView();
    const instance = lastTerminalInstance();
    // 首次同步立即发出、不在 pending 定时器里；这里只观察后续 trailing POST。
    const settledCalls = resizeCalls().length;

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
    expect(resizeCalls()).toHaveLength(settledCalls);
  });

  it('fit() 之后刷新整个网格（WebGL 画布不会自己感知新尺寸）', () => {
    renderView();

    expect(lastTerminal().refreshCalls).toContainEqual([0, 23]);
  });

  it('interactive 缺省（旧后端 / 本地构造行）时 convertEol=true 且无禁用横幅', () => {
    renderView();

    expect(hoisted.terminalOptions.at(-1)?.convertEol).toBe(true);
    expect(screen.queryByTestId('terminal-input-disabled-banner')).toBeNull();
  });

  it('interactive=true（真实 PTY）时 convertEol=false，且无禁用横幅', () => {
    renderView(makeTerminalView({ interactive: true }));

    expect(hoisted.terminalOptions.at(-1)?.convertEol).toBe(false);
    expect(screen.queryByTestId('terminal-input-disabled-banner')).toBeNull();
  });

  it('interactive=false（管道后端）仍向 shell 转发输入，且不渲染禁用横幅', async () => {
    vi.useFakeTimers();
    renderView(makeTerminalView({ interactive: false }));

    expect(screen.queryByTestId('terminal-input-disabled-banner')).toBeNull();
    // 非交互后端仍保留 convertEol=true（原有 pipe 行为）。
    expect(hoisted.terminalOptions.at(-1)?.convertEol).toBe(true);

    const state = lastTerminal();
    await act(async () => {
      for (const handler of state.dataHandlers) handler('l');
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/stdin')).length,
    ).toBeGreaterThan(0);
  });

  it('interactive=false（管道后端）渲染降级提示；PTY / 能力未知不渲染', () => {
    renderView(makeTerminalView({ interactive: false }));
    const chip = screen.getByTestId('terminal-degraded-chip');
    expect(chip.textContent).toContain('降级终端');
    expect(chip.getAttribute('title')).toContain('没有真实 PTY');
    cleanup();

    renderView(makeTerminalView({ interactive: true }));
    expect(screen.queryByTestId('terminal-degraded-chip')).toBeNull();
    cleanup();

    // 能力未知（旧后端）不误报。
    renderView();
    expect(screen.queryByTestId('terminal-degraded-chip')).toBeNull();
  });

  describe('内容区右键菜单的面板命令段', () => {
    function renderWithCommandMenu() {
      const commands = {
        onRequestCreate: vi.fn(),
        onRequestSplit: vi.fn(),
        onRequestKill: vi.fn(),
        onRequestRename: vi.fn(),
        onRequestCloseOthers: vi.fn(),
        onRequestCloseAll: vi.fn(),
      };
      renderView(
        makeTerminalView(),
        buildTerminalCommandItems({
          terminalCount: 1,
          totalTerminalCount: 2,
          sessionReady: true,
          creating: false,
          splitDirections: ['row', 'column'],
          ...commands,
        }),
      );
      openMenu();
      return commands;
    }

    /** 每次点击菜单项都会关闭菜单，因此连续点击前都要重新打开。 */
    function openMenu(): void {
      fireEvent.contextMenu(screen.getByTestId('terminal-surface'), { clientX: 40, clientY: 60 });
    }

    it('命令段置顶、剪贴板段随后，copy 因此带上与命令段的分隔线', () => {
      renderWithCommandMenu();

      const menu = screen.getByTestId('terminal-context-menu');
      const ids = [
        ...menu.querySelectorAll<HTMLElement>('[data-testid^="terminal-context-menu-"]'),
      ].map((element) => element.dataset.testid);
      expect(ids).toEqual([
        'terminal-context-menu-terminal-new',
        'terminal-context-menu-terminal-split-row',
        'terminal-context-menu-terminal-split-column',
        'terminal-context-menu-terminal-kill',
        'terminal-context-menu-terminal-rename',
        'terminal-context-menu-terminal-close-others',
        'terminal-context-menu-terminal-close-all',
        'terminal-context-menu-copy',
        'terminal-context-menu-paste',
        'terminal-context-menu-select-all',
        'terminal-context-menu-clear',
        'terminal-context-menu-search',
        'terminal-context-menu-copy-on-select',
      ]);

      const copy = screen.getByTestId('terminal-context-menu-copy');
      expect(copy.parentElement?.querySelector('[role="separator"]')).not.toBeNull();
    });

    it('未传命令段时剪贴板菜单保持原样（copy 前无分隔线）', () => {
      renderView();
      openMenu();

      const copy = screen.getByTestId('terminal-context-menu-copy');
      expect(copy.parentElement?.querySelector('[role="separator"]')).toBeNull();
    });

    it('选择 新建终端 / 终止终端 / 重命名 分别触发对应回调', () => {
      const commands = renderWithCommandMenu();

      fireEvent.click(screen.getByTestId('terminal-context-menu-terminal-new'));
      expect(commands.onRequestCreate).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('terminal-context-menu')).toBeNull();

      openMenu();
      fireEvent.click(screen.getByTestId('terminal-context-menu-terminal-kill'));
      expect(commands.onRequestKill).toHaveBeenCalledTimes(1);

      openMenu();
      fireEvent.click(screen.getByTestId('terminal-context-menu-terminal-rename'));
      expect(commands.onRequestRename).toHaveBeenCalledTimes(1);

      expect(commands.onRequestSplit).not.toHaveBeenCalled();
      expect(commands.onRequestCloseOthers).not.toHaveBeenCalled();
      expect(commands.onRequestCloseAll).not.toHaveBeenCalled();
    });
  });
});
