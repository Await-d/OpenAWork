// @vitest-environment jsdom
/**
 * 抽屉编排层：两行头部接线、页签真实切换内容、＋ 新建走 onReload、
 * ⋯ 菜单动作（清屏 / 关闭其他 / 关闭全部 / 重命名）与行内重命名；
 * T-10 追加：⊟ 拆分（POST + seed 落盘 / <768px 强制上下）、合并到分屏、
 * pane 焦点切换（非激活 pane 不卸载）。
 *
 * 终端视图与网关客户端都换成替身 —— 这里验证的是面板的接线与控制流。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { makePane, makeSplit } from './layout/test-fixtures.js';
import { enumeratePanes, findPane } from './layout/queries.js';
import type { TerminalLayout } from './layout/types.js';

const api = vi.hoisted(() => ({
  createSessionTerminal: vi.fn(),
  closeTerminal: vi.fn(),
  writeTerminalStdin: vi.fn(),
  killSessionTerminal: vi.fn(),
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

// 端口页（T-15）会经 web-client 发请求：这里只替换 ports 客户端，其余导出保持真实，
// 避免影响别的模块（如 terminals-api）在导入期读取 web-client 的其它工厂函数。
const portsClient = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createListeningPortsClient: () => ({ list: portsClient.list }),
  };
});

const { QuickTerminalPanel } = await import('./QuickTerminalPanel.js');
const { IMPLICIT_PANE_ID } = await import('./TerminalSplitView.js');

function makeTerminal(overrides: Partial<SessionTerminalView> = {}): SessionTerminalView {
  return {
    terminalId: 'terminal-1',
    sessionId: 'session-1',
    toolName: 'quick_terminal',
    kind: 'foreground',
    command: 'bash',
    cwd: '/workspace',
    status: 'running',
    startedAtMs: 1_700_000_000_000,
    lastActivityMs: 1_700_000_000_500,
    outputBytesTotal: 0,
    outputTail: '',
    ...overrides,
  };
}

const WORKSPACE = '/workspace';

function renderPanel(terminals: SessionTerminalView[], overrides: Record<string, unknown> = {}) {
  const onReload = vi.fn();
  const onRenameTerminal = vi.fn(async () => undefined);
  const onRequestClose = vi.fn();
  const view = render(
    <QuickTerminalPanel
      open
      onRequestClose={onRequestClose}
      workspacePath={WORKSPACE}
      gatewayUrl="https://gateway.test"
      token="token-1"
      sessionId="session-1"
      terminals={terminals}
      loading={false}
      onReload={onReload}
      onRenameTerminal={onRenameTerminal}
      onDismissTerminal={vi.fn()}
      {...overrides}
    />,
  );
  return { onReload, onRenameTerminal, onRequestClose, view };
}

function openMoreMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: '更多终端操作' }));
}

/** 与 QuickTerminalPanel 内部的窄视口判定保持一致。 */
const NARROW_VIEWPORT_QUERY = '(max-width: 767px)';
const originalMatchMedia: typeof window.matchMedia | undefined = window.matchMedia;

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

function restoreMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
}

/** 构造面板元素：用于 waitFor 之后的 rerender（上游同步新终端）。 */
function panelElement(terminals: SessionTerminalView[]) {
  return (
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
    />
  );
}

function renderedTerminalIds(): string[] {
  return screen
    .getAllByTestId('terminal-view')
    .map((element) => element.getAttribute('data-terminal-id') ?? '')
    .sort();
}

function persistedLayout(): TerminalLayout {
  // 缺桶与「显式 null」在读取端语义一致，统一成 null 便于断言。
  return useUIStateStore.getState().terminalLayoutBySession['__default__'] ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.createSessionTerminal.mockResolvedValue({ terminal: makeTerminal({ terminalId: 't-new' }) });
  api.closeTerminal.mockResolvedValue({ ok: true });
  api.writeTerminalStdin.mockResolvedValue({ ok: true });
  // 端口页替身：空快照（不支持端口枚举），页签切换测试只关心渲染了哪个面板。
  portsClient.list.mockResolvedValue({
    ports: [],
    strategy: null,
    reason: '测试替身：当前环境不支持端口枚举。',
    collectedAtMs: 1_700_000_000_000,
  });
  // jsdom 不实现 pointer capture；tab 拖拽手势在 pointerdown 处无条件调用它。
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
    quickTerminalHeight: 280,
    quickTerminalActiveIdByWorkspace: {},
    lastChatPath: null,
    terminalLayoutBySession: {},
    terminalPanelMaximized: false,
  });
});

afterEach(() => {
  cleanup();
  restoreMatchMedia();
  useUIStateStore.setState({
    quickTerminalHeight: 280,
    quickTerminalActiveIdByWorkspace: {},
    lastChatPath: null,
    terminalLayoutBySession: {},
    terminalPanelMaximized: false,
  });
});

describe('QuickTerminalPanel', () => {
  it('默认渲染「终端」页：两行头部 + 终端视图 + 收起回调', () => {
    const { onRequestClose } = renderPanel([makeTerminal()]);

    expect(screen.getByRole('tab', { name: '终端' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('terminal-tab-strip')).toBeTruthy();
    expect(screen.getByTestId('terminal-view').getAttribute('data-terminal-id')).toBe('terminal-1');
    expect(screen.queryByTestId('terminal-ports-panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '收起终端面板' }));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('页签真实切换内容：端口页只渲染端口面板（不误渲染终端）', async () => {
    renderPanel([makeTerminal()]);

    fireEvent.click(screen.getByRole('tab', { name: '端口' }));

    expect(screen.getByTestId('terminal-ports-panel')).toBeTruthy();
    expect(screen.queryByTestId('terminal-tab-strip')).toBeNull();
    expect(screen.queryByTestId('terminal-view')).toBeNull();
    // 面板挂载即请求一次监听端口（走 T-14 客户端）。
    await waitFor(() => {
      expect(portsClient.list).toHaveBeenCalledWith(
        'token-1',
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    fireEvent.click(screen.getByRole('tab', { name: '终端' }));

    expect(screen.getByTestId('terminal-tab-strip')).toBeTruthy();
    expect(screen.queryByTestId('terminal-ports-panel')).toBeNull();
  });

  it('＋ 新建终端：调用创建接口后走 onReload，新 tab 成为激活 tab', async () => {
    const { onReload, view } = renderPanel([makeTerminal()]);

    fireEvent.click(screen.getByRole('button', { name: '新建终端' }));

    await waitFor(() => {
      expect(api.createSessionTerminal).toHaveBeenCalledWith({
        gatewayUrl: 'https://gateway.test',
        sessionId: 'session-1',
        token: 'token-1',
        cwd: WORKSPACE,
      });
      expect(onReload).toHaveBeenCalledTimes(1);
    });

    // 上游 reload 后新终端进入列表 → 面板自动切到新 tab。
    view.rerender(
      <QuickTerminalPanel
        open
        onRequestClose={vi.fn()}
        workspacePath={WORKSPACE}
        gatewayUrl="https://gateway.test"
        token="token-1"
        sessionId="session-1"
        terminals={[makeTerminal(), makeTerminal({ terminalId: 't-new' })]}
        loading={false}
        onReload={onReload}
        onRenameTerminal={vi.fn(async () => undefined)}
        onDismissTerminal={vi.fn()}
      />,
    );

    expect(screen.getByTestId('terminal-tab-t-new').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('terminal-view').getAttribute('data-terminal-id')).toBe('t-new');
  });

  it('⋯ → 清屏：向当前终端写入 Ctrl+L（\\x0c）', async () => {
    renderPanel([makeTerminal()]);
    openMoreMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: /清屏/ }));

    await waitFor(() => {
      expect(api.writeTerminalStdin).toHaveBeenCalledWith({
        gatewayUrl: 'https://gateway.test',
        sessionId: 'session-1',
        terminalId: 'terminal-1',
        token: 'token-1',
        data: '\u000c',
      });
    });
  });

  it('⋯ → 关闭其他终端：只关闭非激活终端并 reload', async () => {
    const { onReload } = renderPanel([
      makeTerminal(),
      makeTerminal({ terminalId: 'terminal-2' }),
      makeTerminal({ terminalId: 'terminal-3' }),
    ]);
    openMoreMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: /关闭其他终端/ }));

    await waitFor(() => {
      expect(api.closeTerminal).toHaveBeenCalledTimes(2);
      expect(onReload).toHaveBeenCalledTimes(1);
    });
    const closedIds = api.closeTerminal.mock.calls.map(
      (call) => (call[0] as { terminalId: string }).terminalId,
    );
    expect(closedIds).toEqual(['terminal-2', 'terminal-3']);
    // 激活终端保持选中，且持久化的激活 id 未被清空。
    expect(useUIStateStore.getState().quickTerminalActiveIdByWorkspace[WORKSPACE]).toBe(
      'terminal-1',
    );
  });

  it('⋯ → 关闭全部终端：关闭所有 tab、清空持久化激活 id 并 reload', async () => {
    const { onReload, view } = renderPanel([
      makeTerminal(),
      makeTerminal({ terminalId: 'terminal-2' }),
    ]);
    openMoreMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: '关闭全部终端' }));

    await waitFor(() => {
      expect(api.closeTerminal).toHaveBeenCalledTimes(2);
      expect(onReload).toHaveBeenCalledTimes(1);
    });

    // reload 后列表清空 → 面板把持久化的激活 id 收敛为「无」。
    view.rerender(
      <QuickTerminalPanel
        open
        onRequestClose={vi.fn()}
        workspacePath={WORKSPACE}
        gatewayUrl="https://gateway.test"
        token="token-1"
        sessionId="session-1"
        terminals={[]}
        loading={false}
        onReload={onReload}
        onRenameTerminal={vi.fn(async () => undefined)}
        onDismissTerminal={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        useUIStateStore.getState().quickTerminalActiveIdByWorkspace[WORKSPACE] ?? null,
      ).toBeNull();
    });
    expect(screen.getByText(/没有运行中的终端/)).toBeTruthy();
  });

  it('⋯ → 重命名：预填当前标签，Enter 提交给 onRenameTerminal', async () => {
    const { onRenameTerminal } = renderPanel([makeTerminal()]);
    openMoreMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));

    const input = screen.getByRole('textbox', { name: '重命名终端' }) as HTMLInputElement;
    expect(input.value).toBe('终端 1');

    fireEvent.change(input, { target: { value: 'dev server' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameTerminal).toHaveBeenCalledWith('terminal-1', 'dev server');
  });

  it('行内双击重命名后 Escape 取消，不提交改名', () => {
    const { onRenameTerminal } = renderPanel([makeTerminal()]);

    fireEvent.doubleClick(screen.getByRole('button', { name: '终端 1' }));
    const input = screen.getByRole('textbox', { name: '重命名终端' }) as HTMLInputElement;

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: '重命名终端' })).toBeNull();
    expect(onRenameTerminal).not.toHaveBeenCalled();
  });
});

describe('QuickTerminalPanel 分屏（T-10）', () => {
  it('无分屏时 ⊟ 拆分：POST 新终端后把隐式 pane 物化并为 seed 开新组（左右）', async () => {
    const { view } = renderPanel([makeTerminal({ terminalId: 't1' })]);

    fireEvent.click(screen.getByRole('button', { name: '拆分终端' }));

    await waitFor(() => {
      expect(api.createSessionTerminal).toHaveBeenCalledWith({
        gatewayUrl: 'https://gateway.test',
        sessionId: 'session-1',
        token: 'token-1',
        cwd: WORKSPACE,
      });
    });

    // 落盘树 = 隐式 pane（保有 t1）+ 由 seedTerminalId 开出的新 pane。
    // 若没把 seed 传进 splitPane，单终端组会被「禁止空 pane」挡住而根本不产生分屏。
    await waitFor(() => {
      expect(persistedLayout()).toEqual(
        makeSplit('split-pane-t-new', 'row', [
          makePane(IMPLICIT_PANE_ID, ['t1']),
          makePane('pane-t-new', ['t-new']),
        ]),
      );
    });

    // 上游同步新终端后：两个 pane 各自一条 tab 条、各自渲染一个终端 → 两条流。
    view.rerender(
      panelElement([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't-new' })]),
    );

    expect(view.container.querySelectorAll('.terminal-pane')).toHaveLength(2);
    expect(screen.getAllByTestId('terminal-tab-strip')).toHaveLength(2);
    expect(renderedTerminalIds()).toEqual(['t-new', 't1']);
    expect(view.container.querySelector('.terminal-split')?.getAttribute('data-direction')).toBe(
      'row',
    );
  });

  it('<768px：拆分的 row 入口被强制为上下（column）', async () => {
    stubNarrowViewport();
    const { view } = renderPanel([makeTerminal({ terminalId: 't1' })]);

    fireEvent.click(screen.getByRole('button', { name: '拆分终端' }));

    await waitFor(() => {
      expect(persistedLayout()).toEqual(
        makeSplit('split-pane-t-new', 'column', [
          makePane(IMPLICIT_PANE_ID, ['t1']),
          makePane('pane-t-new', ['t-new']),
        ]),
      );
    });

    view.rerender(
      panelElement([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't-new' })]),
    );
    expect(view.container.querySelector('.terminal-split')?.getAttribute('data-direction')).toBe(
      'column',
    );
  });

  it('已有分屏时 ⊟ 走 hook 的 splitPane：种子终端进入新 pane（3 组）', async () => {
    useUIStateStore.setState({
      terminalLayoutBySession: {
        __default__: makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]),
      },
    });
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    const pane2 = screen.getByTestId('terminal-pane-p2');
    fireEvent.click(within(pane2).getByRole('button', { name: '拆分终端' }));

    await waitFor(() => {
      const persisted = persistedLayout();
      expect(persisted === null ? 0 : enumeratePanes(persisted).length).toBe(3);
      expect(persisted === null ? null : findPane(persisted, 'pane-t-new')).toEqual(
        makePane('pane-t-new', ['t-new']),
      );
    });
  });

  it('⋯ → 合并到分屏：把其他 tab 并入当前组（空组自动上提，最终单组）', async () => {
    useUIStateStore.setState({
      terminalLayoutBySession: {
        __default__: makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]),
      },
    });
    renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
      makeTerminal({ terminalId: 't3' }),
    ]);

    const pane2 = screen.getByTestId('terminal-pane-p2');
    fireEvent.click(within(pane2).getByRole('button', { name: '更多终端操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /合并到分屏/ }));

    await waitFor(() => {
      const persisted = persistedLayout();
      expect(persisted === null ? 0 : enumeratePanes(persisted).length).toBe(1);
      // t1 从 p1 迁移过来，t3 作为游离 tab 一并并入；active 是最后并入的那个。
      expect(persisted === null ? null : findPane(persisted, 'p2')).toEqual(
        makePane('p2', ['t2', 't1', 't3'], 't3'),
      );
    });
  });

  it('组内点击非 active tab：只切 active，不重排 tab', async () => {
    useUIStateStore.setState({
      terminalLayoutBySession: {
        __default__: makePane('p1', ['t1', 't2', 't3'], 't1'),
      },
    });
    renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
      makeTerminal({ terminalId: 't3' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: '终端 2' }));

    await waitFor(() => {
      expect(findPane(persistedLayout(), 'p1')).toEqual(makePane('p1', ['t1', 't2', 't3'], 't2'));
    });
  });

  it('pane 达到上限（4）时所有 ⊟ disabled 且 title 说明上限', () => {
    useUIStateStore.setState({
      terminalLayoutBySession: {
        __default__: makeSplit('s1', 'row', [
          makeSplit('s2', 'column', [makePane('p1', ['t1']), makePane('p2', ['t2'])]),
          makeSplit('s3', 'column', [makePane('p3', ['t3']), makePane('p4', ['t4'])]),
        ]),
      },
    });
    const { view } = renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
      makeTerminal({ terminalId: 't3' }),
      makeTerminal({ terminalId: 't4' }),
    ]);

    expect(view.container.querySelectorAll('.terminal-pane')).toHaveLength(4);
    const splitButtons = view.container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="terminal-tab-actions-split"]',
    );
    expect(splitButtons).toHaveLength(4);
    for (const button of splitButtons) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('上限');
    }
  });

  it('点击非激活 pane 切换焦点态，两个 pane 的终端视图都保持挂载', () => {
    useUIStateStore.setState({
      terminalLayoutBySession: {
        __default__: makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]),
      },
    });
    renderPanel([makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })]);

    const pane1 = screen.getByTestId('terminal-pane-p1');
    const pane2 = screen.getByTestId('terminal-pane-p2');
    expect(pane1.getAttribute('data-active')).toBe('true');
    expect(pane2.getAttribute('data-active')).toBe('false');

    fireEvent.mouseDown(pane2);

    expect(pane1.getAttribute('data-active')).toBe('false');
    expect(pane2.getAttribute('data-active')).toBe('true');
    // 失焦只换边框：两个 pane 的终端流都还在（D5）。
    expect(renderedTerminalIds()).toEqual(['t1', 't2']);
  });
});

describe('T-12 拖拽语义修订：源组折叠（2026-09-16 协调者裁定，对齐 VS Code）', () => {
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

  function stubTwoPaneGeometry(container: HTMLElement, terminalIds: readonly string[]): void {
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
    terminalIds.forEach((terminalId, index) => {
      stubRect(container.querySelector(`[data-terminal-id="${terminalId}"]`), {
        x: index === 0 ? 4 : 404,
        y: 3,
        width: 96,
        height: 22,
      });
    });
  }

  function dragTab(tabEl: Element, to: { x: number; y: number }): void {
    fireEvent.pointerDown(tabEl, { button: 0, clientX: 50, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(tabEl, { clientX: (50 + to.x) / 2, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(tabEl, { clientX: to.x, clientY: to.y, pointerId: 1 });
    fireEvent.pointerUp(tabEl, { clientX: to.x, clientY: to.y, pointerId: 1 });
  }

  it('拖走某组最后一个终端 → 源组折叠：pane 数 -1、落盘树无空 pane、渲染无空组', async () => {
    useUIStateStore.setState({
      terminalLayoutBySession: {
        __default__: makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]),
      },
    });
    const { view } = renderPanel([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
    ]);
    stubTwoPaneGeometry(view.container, ['t1', 't2']);

    const tabEl = view.container.querySelector('[data-terminal-id="t1"]');
    if (!tabEl) throw new Error('t1 tab 未渲染');

    // 拖到 p2 中心 = 合并；源组 p1 只剩 t1，旧规则会拒绝，新语义允许并折叠源组。
    dragTab(tabEl, { x: 600, y: 150 });

    await waitFor(() => {
      const persisted = persistedLayout();
      const panes = persisted === null ? [] : enumeratePanes(persisted);
      expect(panes).toHaveLength(1);
      expect(panes.every((pane) => pane.terminalIds.length > 0)).toBe(true);
      expect(findPane(persisted, 'p2')).toEqual(makePane('p2', ['t2', 't1'], 't1'));
    });

    // 渲染侧同步收敛：只剩一个 pane，且没有「没有运行中的终端」空组提示。
    await waitFor(() => {
      expect(view.container.querySelectorAll('.terminal-pane')).toHaveLength(1);
      expect(view.container.querySelector('.terminal-panel__empty')).toBeNull();
    });
  });
});

describe('面板高度拖拽（手柄）', () => {
  beforeEach(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  it('拖拽期间接管 body cursor / user-select，松手后还原', () => {
    const onHeightChange = vi.fn();
    renderPanel([makeTerminal()], { height: 300, onHeightChange });

    const handle = screen.getByRole('button', { name: '拖动调整高度' });
    fireEvent.mouseDown(handle, { clientY: 500 });

    expect(document.body.style.cursor).toBe('row-resize');
    expect(document.body.style.userSelect).toBe('none');

    fireEvent.mouseUp(window);

    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    expect(onHeightChange).not.toHaveBeenCalled();
  });

  it('向上拖拽按 startHeight + delta 回调受控 setter', () => {
    const onHeightChange = vi.fn();
    renderPanel([makeTerminal()], { height: 300, onHeightChange });

    fireEvent.mouseDown(screen.getByRole('button', { name: '拖动调整高度' }), { clientY: 500 });
    fireEvent.mouseMove(window, { clientY: 420 });

    expect(onHeightChange).toHaveBeenCalledWith(380);
  });
});

describe('面板最大化（瞬态）', () => {
  it('maximized：根节点带 data-maximized、不写内联高度、拖拽手柄不渲染', () => {
    const { view } = renderPanel([makeTerminal()], { height: 300, maximized: true });
    const panel = view.container.querySelector<HTMLElement>('.terminal-panel');

    expect(panel?.getAttribute('data-maximized')).toBe('true');
    expect(panel?.style.height).toBe('');
    expect(panel?.style.minHeight).toBe('');
    expect(screen.queryByRole('button', { name: '拖动调整高度' })).toBeNull();
    expect(screen.getByRole('button', { name: '还原终端面板' })).toBeTruthy();
  });

  it('非 maximized：保留受控内联高度、手柄与最大化按钮', () => {
    const { view } = renderPanel([makeTerminal()], { height: 300 });
    const panel = view.container.querySelector<HTMLElement>('.terminal-panel');

    expect(panel?.getAttribute('data-maximized')).toBeNull();
    expect(panel?.style.height).toBe('300px');
    expect(screen.getByRole('button', { name: '拖动调整高度' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '最大化终端面板' })).toBeTruthy();
  });

  it('显式 props 优先：点击最大化按钮触发回调，不触碰 store', () => {
    const onToggleMaximized = vi.fn();
    renderPanel([makeTerminal()], { maximized: false, onToggleMaximized });

    fireEvent.click(screen.getByRole('button', { name: '最大化终端面板' }));

    expect(onToggleMaximized).toHaveBeenCalledTimes(1);
    expect(useUIStateStore.getState().terminalPanelMaximized).toBe(false);
  });

  it('未传 props 时回落 store 开关：点击后进入最大化并切换为还原按钮', () => {
    renderPanel([makeTerminal()]);

    fireEvent.click(screen.getByRole('button', { name: '最大化终端面板' }));

    expect(useUIStateStore.getState().terminalPanelMaximized).toBe(true);
    expect(screen.getByRole('button', { name: '还原终端面板' })).toBeTruthy();
  });
});

describe('终端面板停靠（left / right）', () => {
  function panelElement(): HTMLElement {
    const panel = screen.getByRole('region', { name: '快捷终端面板' });
    return panel;
  }

  it('inline 侧停靠：data-docked、无内联高度、不渲染拖拽手柄', () => {
    renderPanel([makeTerminal()], { position: 'left', presentation: 'inline' });

    const panel = panelElement();
    expect(panel.getAttribute('data-docked')).toBe('left');
    expect(panel.style.height).toBe('');
    expect(panel.style.minHeight).toBe('');
    expect(screen.queryByRole('button', { name: '拖动调整高度' })).toBeNull();
  });

  it('右侧停靠：data-docked=right，最大化按钮禁用并说明原因', () => {
    renderPanel([makeTerminal()], { position: 'right', presentation: 'inline' });

    expect(panelElement().getAttribute('data-docked')).toBe('right');
    const maximizeButton = screen.getByRole('button', {
      name: '最大化终端面板',
    }) as HTMLButtonElement;
    expect(maximizeButton.disabled).toBe(true);
    expect(maximizeButton.getAttribute('title')).toContain('侧停靠');
  });

  it('overlay 形态回落底部：侧停靠偏好被忽略，停靠项禁用并说明是 overlay', () => {
    useUIStateStore.setState({ terminalPanelPosition: 'left' });
    renderPanel([makeTerminal()]);

    const panel = panelElement();
    expect(panel.getAttribute('data-docked')).toBeNull();
    expect(panel.style.height).toBe('280px');

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 8,
      clientY: 8,
    });
    const moveLeft = screen.getByRole('menuitem', { name: '移动面板到左侧' }) as HTMLButtonElement;
    expect(moveLeft.disabled).toBe(true);
    expect(moveLeft.getAttribute('title')).toContain('overlay');
  });

  it('窄视口：持久化的侧停靠降级为底部渲染，停靠项禁用', () => {
    stubNarrowViewport();
    useUIStateStore.setState({ terminalPanelPosition: 'left' });
    renderPanel([makeTerminal()], { presentation: 'inline' });

    const panel = panelElement();
    expect(panel.getAttribute('data-docked')).toBeNull();
    expect(panel.style.height).toBe('280px');

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 8,
      clientY: 8,
    });
    const moveRight = screen.getByRole('menuitem', { name: '移动面板到右侧' }) as HTMLButtonElement;
    expect(moveRight.disabled).toBe(true);
    expect(moveRight.getAttribute('title')).toContain('768px');
  });

  it('store 回落：侧停靠清最大化并收同侧侧栏；改回底部不自动展开', () => {
    useUIStateStore.setState({
      leftSidebarOpen: true,
      reviewPanelOpened: true,
      terminalPanelMaximized: true,
      terminalPanelPosition: 'bottom',
    });
    renderPanel([makeTerminal()], { presentation: 'inline' });

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 8,
      clientY: 8,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '移动面板到左侧' }));

    expect(useUIStateStore.getState()).toMatchObject({
      leftSidebarOpen: false,
      reviewPanelOpened: true,
      terminalPanelMaximized: false,
      terminalPanelPosition: 'left',
    });

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 8,
      clientY: 8,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '移动面板到底部' }));

    // 单向礼节：改回底部不自动展开被停靠收起的左侧栏。
    expect(useUIStateStore.getState()).toMatchObject({
      leftSidebarOpen: false,
      terminalPanelPosition: 'bottom',
    });

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 8,
      clientY: 8,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '移动面板到右侧' }));

    expect(useUIStateStore.getState()).toMatchObject({
      reviewPanelOpened: false,
      terminalPanelPosition: 'right',
    });
  });

  it('显式 onMovePosition 覆盖 store 写入，但最大化清理与侧栏联动仍在面板层', () => {
    const onMovePosition = vi.fn();
    useUIStateStore.setState({
      reviewPanelOpened: true,
      terminalPanelMaximized: true,
      terminalPanelPosition: 'bottom',
    });
    renderPanel([makeTerminal()], { position: 'bottom', onMovePosition, presentation: 'inline' });

    fireEvent.contextMenu(screen.getByTestId('terminal-panel-tab-rail'), {
      clientX: 8,
      clientY: 8,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: '移动面板到右侧' }));

    expect(onMovePosition).toHaveBeenCalledWith('right');
    expect(useUIStateStore.getState().terminalPanelPosition).toBe('bottom');
    expect(useUIStateStore.getState().terminalPanelMaximized).toBe(false);
    expect(useUIStateStore.getState().reviewPanelOpened).toBe(false);
  });
});
