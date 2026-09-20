// @vitest-environment jsdom
/**
 * 拆分接线的**字面契约**（T-10）：⊟ 必须「先 POST 新持久终端，再把它的 terminalId
 * 作为 `seedTerminalId` 交给 T-09 hook 的 `splitPane`」—— seed 是「禁止空 pane」
 * 不变量的关键，漏传会让单终端组根本拆不开。
 *
 * 与 `QuickTerminalPanel.test.tsx` 的分工：那边用真实 hook 断言**落盘结果**（端到端语义），
 * 这里 mock 掉 hook 断言**调用参数与调用顺序**（接线字面量）；网络层两边都 mock。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import type { TerminalLayout } from './layout/types.js';
import type { UseTerminalLayoutResult } from './layout/use-terminal-layout.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { makePane, makeSplit } from './layout/test-fixtures.js';

const api = vi.hoisted(() => ({
  createSessionTerminal: vi.fn(),
  closeTerminal: vi.fn(),
  writeTerminalStdin: vi.fn(),
  killSessionTerminal: vi.fn(),
}));

const hook = vi.hoisted(() => ({
  layout: null as TerminalLayout | null,
  splitPane: vi.fn(),
  insertTerminal: vi.fn(),
  moveTerminal: vi.fn(),
}));

vi.mock('../../conversation-runtime/terminals/terminals-api.js', () => ({
  createSessionTerminal: api.createSessionTerminal,
  closeTerminal: api.closeTerminal,
  writeTerminalStdin: api.writeTerminalStdin,
  killSessionTerminal: api.killSessionTerminal,
}));

vi.mock('./InteractiveTerminalView.js', () => ({
  InteractiveTerminalView: (props: { terminal: SessionTerminalView }) => (
    <div data-testid="terminal-view" data-terminal-id={props.terminal.terminalId} />
  ),
}));

vi.mock('./layout/use-terminal-layout.js', () => ({
  useTerminalLayout: (): UseTerminalLayoutResult => ({
    layout: hook.layout,
    sessionKey: '__default__',
    splitPane: hook.splitPane,
    removePane: vi.fn(),
    removeTerminal: vi.fn(),
    moveTerminal: hook.moveTerminal,
    insertTerminal: hook.insertTerminal,
    setActiveTerminal: vi.fn(),
    setRatio: vi.fn(),
    resetLayout: vi.fn(),
  }),
}));

const { QuickTerminalPanel } = await import('./QuickTerminalPanel.js');
const { IMPLICIT_PANE_ID } = await import('./TerminalSplitView.js');

const WORKSPACE = '/workspace';
const NARROW_VIEWPORT_QUERY = '(max-width: 767px)';
const originalMatchMedia = window.matchMedia;

function stubNarrowViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: true,
      media: NARROW_VIEWPORT_QUERY,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function makeTerminal(overrides: Partial<SessionTerminalView> = {}): SessionTerminalView {
  return {
    terminalId: 't1',
    sessionId: 'session-1',
    toolName: 'quick_terminal',
    kind: 'foreground',
    command: 'bash',
    cwd: WORKSPACE,
    status: 'running',
    startedAtMs: 1_700_000_000_000,
    lastActivityMs: 1_700_000_000_500,
    outputBytesTotal: 0,
    outputTail: '',
    ...overrides,
  };
}

function renderPanel(terminals: SessionTerminalView[]) {
  return render(
    <QuickTerminalPanel
      open
      onRequestClose={vi.fn()}
      workspacePath={WORKSPACE}
      gatewayUrl="https://gateway.test"
      token="token-1"
      sessionId="session-1"
      terminals={terminals}
      loading={false}
      onReload={vi.fn()}
      onRenameTerminal={vi.fn(async () => undefined)}
      onDismissTerminal={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hook.layout = null;
  api.createSessionTerminal.mockResolvedValue({ terminal: makeTerminal({ terminalId: 't-new' }) });
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  useUIStateStore.setState({
    lastChatPath: null,
    terminalLayoutBySession: {},
    quickTerminalActiveIdByWorkspace: {},
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  useUIStateStore.setState({
    lastChatPath: null,
    terminalLayoutBySession: {},
    quickTerminalActiveIdByWorkspace: {},
  });
});

describe('⊟ 拆分接线（hook 参数 + 顺序）', () => {
  it('已有分屏：先 POST 新终端，再带 seedTerminalId 调 hook.splitPane', async () => {
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    fireEvent.click(
      within(screen.getByTestId('terminal-pane-p2')).getByRole('button', { name: '拆分终端' }),
    );

    await waitFor(() => {
      expect(api.createSessionTerminal).toHaveBeenCalledWith({
        gatewayUrl: 'https://gateway.test',
        sessionId: 'session-1',
        token: 'token-1',
        cwd: WORKSPACE,
      });
      expect(hook.splitPane).toHaveBeenCalledWith('p2', 'row', 'pane-t-new', 't-new');
    });

    // 顺序契约：seed 必须来自 POST 的响应，因此 splitPane 一定在 POST 之后。
    const createOrder = api.createSessionTerminal.mock.invocationCallOrder[0] ?? 0;
    const splitOrder = hook.splitPane.mock.invocationCallOrder[0] ?? 0;
    expect(splitOrder).toBeGreaterThan(createOrder);
  });

  it('无分屏：隐式 pane 先物化单 pane 树再拆分（hook.splitPane 对不存在的 pane 是空转）', async () => {
    hook.layout = null;
    renderPanel([makeTerminal({ terminalId: 't1' })]);

    fireEvent.click(screen.getByRole('button', { name: '拆分终端' }));

    await waitFor(() => {
      expect(useUIStateStore.getState().terminalLayoutBySession['__default__']).toEqual(
        makeSplit('split-pane-t-new', 'row', [
          makePane(IMPLICIT_PANE_ID, ['t1']),
          makePane('pane-t-new', ['t-new']),
        ]),
      );
    });
    expect(hook.splitPane).not.toHaveBeenCalled();
  });
});

describe('TASK-0：⋯ 方向拆分（column 入口）', () => {
  it('⋯ → 向下拆分：把 column 作为方向传给 hook.splitPane', async () => {
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    const pane2 = screen.getByTestId('terminal-pane-p2');
    fireEvent.click(within(pane2).getByRole('button', { name: '更多终端操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '向下拆分' }));

    await waitFor(() => {
      expect(hook.splitPane).toHaveBeenCalledWith('p2', 'column', 'pane-t-new', 't-new');
    });
  });

  it('⋯ → 向右拆分：row 显式方向', async () => {
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    const pane1 = screen.getByTestId('terminal-pane-p1');
    fireEvent.click(within(pane1).getByRole('button', { name: '更多终端操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '向右拆分' }));

    await waitFor(() => {
      expect(hook.splitPane).toHaveBeenCalledWith('p1', 'row', 'pane-t-new', 't-new');
    });
  });

  it('<768px：菜单只保留「向下拆分」，点击即产出 column', async () => {
    stubNarrowViewport();
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    const pane1 = screen.getByTestId('terminal-pane-p1');
    fireEvent.click(within(pane1).getByRole('button', { name: '更多终端操作' }));

    expect(screen.getByRole('menuitem', { name: '向下拆分' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '向右拆分' })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: '向下拆分' }));
    await waitFor(() => {
      expect(hook.splitPane).toHaveBeenCalledWith('p1', 'column', 'pane-t-new', 't-new');
    });
  });
});

describe('T-12：drop 的落盘接线（panel 层 commit）', () => {
  function stubTwoPaneGeometry(container: HTMLElement): void {
    stubRect(container.querySelector('.terminal-pane[data-pane-id="p1"]'), {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    stubRect(container.querySelector('.terminal-pane[data-pane-id="p2"]'), {
      x: 400,
      y: 0,
      width: 400,
      height: 300,
    });
    stubRect(container.querySelector('[data-testid="terminal-tab-strip"][data-pane-id="p1"]'), {
      x: 0,
      y: 0,
      width: 400,
      height: 28,
    });
    stubRect(container.querySelector('[data-testid="terminal-tab-strip"][data-pane-id="p2"]'), {
      x: 400,
      y: 0,
      width: 400,
      height: 28,
    });
    stubRect(container.querySelector('[data-terminal-id="t1"]'), {
      x: 4,
      y: 3,
      width: 96,
      height: 22,
    });
    stubRect(container.querySelector('[data-terminal-id="t2"]'), {
      x: 104,
      y: 3,
      width: 96,
      height: 22,
    });
    // 两个终端的夹具里没有 t3，跳过即可。
    const t3 = container.querySelector('[data-terminal-id="t3"]');
    if (t3) stubRect(t3, { x: 404, y: 3, width: 96, height: 22 });
  }

  function stubRect(
    element: Element | null,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
    if (!element) throw new Error('stubRect 目标不存在');
    const domRect = {
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
    } as DOMRect;
    element.getBoundingClientRect = () => domRect;
  }

  function stubImplicitPaneGeometry(container: HTMLElement, tabIds: readonly string[]): void {
    stubRect(container.querySelector('.terminal-pane[data-pane-id="pane-implicit"]'), {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    stubRect(
      container.querySelector('[data-testid="terminal-tab-strip"][data-pane-id="pane-implicit"]'),
      { x: 0, y: 0, width: 400, height: 28 },
    );
    tabIds.forEach((terminalId, index) => {
      stubRect(container.querySelector(`[data-terminal-id="${terminalId}"]`), {
        x: 4 + index * 100,
        y: 3,
        width: 96,
        height: 22,
      });
    });
  }

  function dragTab(tabEl: Element, to: { x: number; y: number }): void {
    pressDrag(tabEl, to);
    releaseDrag(tabEl, to);
  }

  function pressDrag(tabEl: Element, to: { x: number; y: number }): void {
    fireEvent.pointerDown(tabEl, { button: 0, clientX: 50, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(tabEl, { clientX: (50 + to.x) / 2, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(tabEl, { clientX: to.x, clientY: to.y, pointerId: 1 });
  }

  function releaseDrag(tabEl: Element, to: { x: number; y: number }): void {
    fireEvent.pointerUp(tabEl, { clientX: to.x, clientY: to.y, pointerId: 1 });
  }

  it('tab-strip（跨组）：走 insertTerminal 且只在 drop 时落盘一次', () => {
    hook.layout = makeSplit('split-p2', 'row', [
      makePane('p1', ['t1', 't2']),
      makePane('p2', ['t3']),
    ]);
    const { container } = renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
      makeTerminal({ terminalId: 't3' }),
    ]);
    stubTwoPaneGeometry(container);

    const tabEl = container.querySelector('[data-terminal-id="t1"]');
    if (!tabEl) throw new Error('t1 tab 未渲染');
    dragTab(tabEl, { x: 650, y: 14 });

    expect(hook.insertTerminal).toHaveBeenCalledTimes(1);
    expect(hook.insertTerminal).toHaveBeenCalledWith('p2', 't1', 1);
    expect(hook.moveTerminal).not.toHaveBeenCalled();
  });

  it('pane-edge：走 hook.moveTerminal 且新 pane id 已去重', () => {
    hook.layout = makeSplit('split-p2', 'row', [
      makePane('p1', ['t1', 't2']),
      makePane('p2', ['t3']),
    ]);
    const { container } = renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
      makeTerminal({ terminalId: 't3' }),
    ]);
    stubTwoPaneGeometry(container);

    const tabEl = container.querySelector('[data-terminal-id="t1"]');
    if (!tabEl) throw new Error('t1 tab 未渲染');
    dragTab(tabEl, { x: 410, y: 150 });

    expect(hook.moveTerminal).toHaveBeenCalledTimes(1);
    expect(hook.moveTerminal).toHaveBeenCalledWith(
      't1',
      { kind: 'pane-edge', paneId: 'p2', edge: 'left' },
      'pane-t1',
    );
    expect(hook.insertTerminal).not.toHaveBeenCalled();
  });

  it('拖走某组最后一个终端：允许 drop，panel 层走 moveTerminal（源组折叠由纯函数层收敛）', () => {
    hook.layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    const { container } = renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
    ]);
    stubTwoPaneGeometry(container);

    const tabEl = container.querySelector('[data-terminal-id="t1"]');
    if (!tabEl) throw new Error('t1 tab 未渲染');
    dragTab(tabEl, { x: 600, y: 150 });

    expect(hook.moveTerminal).toHaveBeenCalledTimes(1);
    expect(hook.moveTerminal).toHaveBeenCalledWith(
      't1',
      { kind: 'pane-center', paneId: 'p2' },
      'pane-t1',
    );
    expect(hook.insertTerminal).not.toHaveBeenCalled();
  });

  it('隐式单组（layout === null）：组内重排物化单 pane 树并持久化新顺序', () => {
    hook.layout = null;
    const { container } = renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
      makeTerminal({ terminalId: 't3' }),
    ]);
    const implicitPane = container.querySelector('.terminal-pane[data-pane-id="pane-implicit"]');
    const strip = container.querySelector(
      '[data-testid="terminal-tab-strip"][data-pane-id="pane-implicit"]',
    );
    stubRect(implicitPane, { x: 0, y: 0, width: 400, height: 300 });
    stubRect(strip, { x: 0, y: 0, width: 400, height: 28 });
    stubRect(container.querySelector('[data-terminal-id="t1"]'), {
      x: 4,
      y: 3,
      width: 96,
      height: 22,
    });
    stubRect(container.querySelector('[data-terminal-id="t2"]'), {
      x: 104,
      y: 3,
      width: 96,
      height: 22,
    });
    stubRect(container.querySelector('[data-terminal-id="t3"]'), {
      x: 204,
      y: 3,
      width: 96,
      height: 22,
    });

    const tabEl = container.querySelector('[data-terminal-id="t1"]');
    if (!tabEl) throw new Error('t1 tab 未渲染');
    dragTab(tabEl, { x: 250, y: 14 });

    expect(useUIStateStore.getState().terminalLayoutBySession['__default__']).toEqual(
      makePane(IMPLICIT_PANE_ID, ['t2', 't1', 't3'], 't1'),
    );
    expect(hook.moveTerminal).not.toHaveBeenCalled();
    expect(hook.insertTerminal).not.toHaveBeenCalled();
  });

  it('隐式单组的 index 与已物化路径同口径：拖到末个 tab 右半 → 顺序与「移除后再插入」一致', () => {
    hook.layout = null;
    const { container } = renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
    ]);
    const implicitPane = container.querySelector('.terminal-pane[data-pane-id="pane-implicit"]');
    const strip = container.querySelector(
      '[data-testid="terminal-tab-strip"][data-pane-id="pane-implicit"]',
    );
    stubRect(implicitPane, { x: 0, y: 0, width: 400, height: 300 });
    stubRect(strip, { x: 0, y: 0, width: 400, height: 28 });
    stubRect(container.querySelector('[data-terminal-id="t1"]'), {
      x: 4,
      y: 3,
      width: 96,
      height: 22,
    });
    stubRect(container.querySelector('[data-terminal-id="t2"]'), {
      x: 104,
      y: 3,
      width: 96,
      height: 22,
    });

    const tabEl = container.querySelector('[data-terminal-id="t1"]');
    if (!tabEl) throw new Error('t1 tab 未渲染');
    // 指针落在 t2 中点（152）右侧 → refineTabIndex 按「移除 t1 后」的槽位算出 index=1。
    dragTab(tabEl, { x: 190, y: 14 });

    expect(useUIStateStore.getState().terminalLayoutBySession['__default__']).toEqual(
      makePane(IMPLICIT_PANE_ID, ['t2', 't1'], 't1'),
    );
  });

  it('隐式单组 + 左边落点：物化首个 row 拆分，被拖终端进新 pane，其余终端留在原组', () => {
    hook.layout = null;
    const { container } = renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
    ]);
    stubImplicitPaneGeometry(container, ['t1', 't2']);

    const tabEl = container.querySelector('[data-terminal-id="t2"]');
    if (!tabEl) throw new Error('t2 tab 未渲染');
    // 左边带宽度 = 0.25 * min(400, 300) = 75：x=10 命中 left。
    dragTab(tabEl, { x: 10, y: 150 });

    expect(useUIStateStore.getState().terminalLayoutBySession['__default__']).toEqual(
      makeSplit('split-pane-t2', 'row', [
        makePane('pane-t2', ['t2']),
        makePane(IMPLICIT_PANE_ID, ['t1']),
      ]),
    );
    expect(hook.moveTerminal).not.toHaveBeenCalled();
    expect(hook.insertTerminal).not.toHaveBeenCalled();
  });

  it('隐式单组 + 下边落点：物化首个 column 拆分，被拖终端在新 pane 保持 active', () => {
    hook.layout = null;
    const { container } = renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
    ]);
    stubImplicitPaneGeometry(container, ['t1', 't2']);

    const tabEl = container.querySelector('[data-terminal-id="t1"]');
    if (!tabEl) throw new Error('t1 tab 未渲染');
    // 下边带起点 = 300 - 75 = 225：y=280 命中 bottom；拖走的是原组 active(t1)，
    // 源组 active 于是回落到剩余首个终端 t2。
    dragTab(tabEl, { x: 200, y: 280 });

    expect(useUIStateStore.getState().terminalLayoutBySession['__default__']).toEqual(
      makeSplit('split-pane-t1', 'column', [
        makePane(IMPLICIT_PANE_ID, ['t2']),
        makePane('pane-t1', ['t1']),
      ]),
    );
  });

  it('隐式单组 + 仅一个终端：边落点仍被拒绝，不物化任何布局', () => {
    hook.layout = null;
    const { container } = renderPanel([makeTerminal({ terminalId: 't1' })]);
    stubImplicitPaneGeometry(container, ['t1']);

    const tabEl = container.querySelector('[data-terminal-id="t1"]');
    if (!tabEl) throw new Error('t1 tab 未渲染');
    pressDrag(tabEl, { x: 10, y: 150 });

    expect(document.body.style.cursor).toBe('not-allowed');
    expect(useUIStateStore.getState().terminalLayoutBySession['__default__']).toBeUndefined();

    releaseDrag(tabEl, { x: 10, y: 150 });
    expect(useUIStateStore.getState().terminalLayoutBySession['__default__']).toBeUndefined();
    expect(hook.moveTerminal).not.toHaveBeenCalled();
  });

  it('隐式单组 + pane-center：保持拒绝（同组合并是 no-op，不伪装成成功移动）', () => {
    hook.layout = null;
    const { container } = renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
    ]);
    stubImplicitPaneGeometry(container, ['t1', 't2']);

    const tabEl = container.querySelector('[data-terminal-id="t1"]');
    if (!tabEl) throw new Error('t1 tab 未渲染');
    pressDrag(tabEl, { x: 200, y: 150 });

    expect(document.body.style.cursor).toBe('not-allowed');
    expect(useUIStateStore.getState().terminalLayoutBySession['__default__']).toBeUndefined();

    releaseDrag(tabEl, { x: 200, y: 150 });
    expect(hook.moveTerminal).not.toHaveBeenCalled();
  });
});
