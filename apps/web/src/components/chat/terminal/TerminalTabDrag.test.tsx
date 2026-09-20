// @vitest-environment jsdom
/**
 * T-12 tab 拖拽（pointer-based）：
 *  - 四种落点各一条：`tab-strip`（组内重排 / 移入别组）、`pane-center`（合并）、
 *    `pane-edge`（拆分：左右 / 上下边）、`detach`（拖出面板内容区 → 成为 tab）；
 *  - `<768px`（preferredSplitDirection='column'）：`row` 边落点回退 `pane-center`，
 *    `column` 边落点照常产出 `pane-edge`；
 *  - 拒绝矩阵：只剩 pane 上限一类 —— pane 达上限时 pane-edge 拒绝，合并
 *    （pane-center）仍允许；「拖走某组最后一个终端」**已放开**（协调者裁定，对齐 VS Code）：
 *    允许 drop，源组由纯函数层的 removeTerminal → 兄弟上提自然折叠；
 *  - 落盘时机：`pointermove`（dragover 等价物）一次都不落盘，`drop` 恰好一次；
 *  - 键盘替代：Alt+←/→ 组内重排、Alt+Shift+←/→ 移到 DFS 相邻组；
 *  - 拖拽后的 click 被吞掉，不会顺带切换 active tab。
 *
 * 几何用 `getBoundingClientRect` 替身提供（jsdom 全部返回 0），命中判定本身由
 * T-08 的 `resolveDropTarget` 负责，这里只验证「接线正确」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { makePane, makeSplit } from './layout/test-fixtures.js';
import type { TerminalLayout, TerminalSplitDirection } from './layout/types.js';
import {
  TerminalLayoutContext,
  type TerminalLayoutContextValue,
  type TerminalPaneActions,
  type TerminalTabDragState,
} from './TerminalLayoutContext.js';
import { TerminalSplitView, IMPLICIT_PANE_ID } from './TerminalSplitView.js';

vi.mock('./InteractiveTerminalView.js', () => ({
  InteractiveTerminalView: (props: { terminal: SessionTerminalView }) => (
    <div data-testid={`terminal-view-${props.terminal.terminalId}`} />
  ),
}));

const pointerCapture = vi.hoisted(() => ({ setCapture: vi.fn(), releaseCapture: vi.fn() }));

function makeTerminal(overrides: Partial<SessionTerminalView> = {}): SessionTerminalView {
  return {
    terminalId: 't1',
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

function makeActions(): TerminalPaneActions {
  return {
    createTerminal: vi.fn(),
    killTerminal: vi.fn(),
    splitPane: vi.fn(),
    mergeOthersIntoPane: vi.fn(),
    selectTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    closeTerminals: vi.fn(),
    closeAllTerminals: vi.fn(),
    renameTerminal: vi.fn(),
    clearTerminal: vi.fn(),
    setRatio: vi.fn(),
    moveTerminalByDrop: vi.fn(),
  };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function stubRect(element: Element | null, rect: Box): void {
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

/** 两列标准几何：p1 = 左半，p2 = 右半；tab 条在各自顶部 28px。 */
const PANE_P1: Box = { x: 0, y: 0, width: 400, height: 300 };
const PANE_P2: Box = { x: 400, y: 0, width: 400, height: 300 };
const STRIP_P1: Box = { x: 0, y: 0, width: 400, height: 28 };
const STRIP_P2: Box = { x: 400, y: 0, width: 400, height: 28 };

interface HarnessOptions {
  layout: TerminalLayout;
  terminals: SessionTerminalView[];
  paneCount?: number;
  maxPanes?: number;
  preferredSplitDirection?: TerminalSplitDirection;
}

function renderHarness(options: HarnessOptions) {
  const {
    layout,
    terminals,
    paneCount = 2,
    maxPanes = 4,
    preferredSplitDirection = 'row',
  } = options;
  const actions = makeActions();

  function Harness() {
    const [tabDrag, setTabDrag] = useState<TerminalTabDragState | null>(null);
    const context: TerminalLayoutContextValue = {
      activePaneId: 'p1',
      setActivePaneId: vi.fn(),
      layout,
      paneCount,
      maxPanes,
      preferredSplitDirection,
      shellProfiles: [],
      totalTerminalCount: terminals.length,
      busyPaneId: null,
      tabDrag,
      setTabDrag,
      renameRequest: null,
      requestRename: vi.fn(),
      clearRenameRequest: vi.fn(),
      view: {
        gatewayUrl: 'https://gateway.test',
        token: 'token-1',
        sessionId: 'session-1',
        inputEnabled: () => true,
        onWriteError: vi.fn(),
      },
      actions,
    };
    return (
      <div className="terminal-panel__body">
        <TerminalLayoutContext value={context}>
          <TerminalSplitView
            layout={layout}
            terminals={terminals}
            implicitActiveTerminalId={null}
          />
        </TerminalLayoutContext>
      </div>
    );
  }

  const view = render(<Harness />);
  const pane = (paneId: string): HTMLElement => {
    const element = view.container.querySelector<HTMLElement>(
      `.terminal-pane[data-pane-id="${paneId}"]`,
    );
    if (!element) throw new Error(`pane ${paneId} 未渲染`);
    return element;
  };
  const strip = (paneId: string): HTMLElement => {
    const element = view.container.querySelector<HTMLElement>(
      `[data-testid="terminal-tab-strip"][data-pane-id="${paneId}"]`,
    );
    if (!element) throw new Error(`strip ${paneId} 未渲染`);
    return element;
  };
  const tab = (terminalId: string): HTMLElement => {
    const element = view.container.querySelector<HTMLElement>(`[data-terminal-id="${terminalId}"]`);
    if (!element) throw new Error(`tab ${terminalId} 未渲染`);
    return element;
  };

  return { view, actions, pane, strip, tab };
}

/** 标准几何：p1=[t1,t2]，p2=[t3]，两个 tab 条各有真实 tab 位置。 */
function stubStandardGeometry(
  h: ReturnType<typeof renderHarness>,
  secondPaneTabIds: string[],
): void {
  stubRect(h.pane('p1'), PANE_P1);
  stubRect(h.pane('p2'), PANE_P2);
  stubRect(h.strip('p1'), STRIP_P1);
  stubRect(h.strip('p2'), STRIP_P2);
  stubRect(h.tab('t1'), { x: 4, y: 3, width: 96, height: 22 });
  stubRect(h.tab('t2'), { x: 104, y: 3, width: 96, height: 22 });
  secondPaneTabIds.forEach((terminalId, index) => {
    stubRect(h.tab(terminalId), { x: 404 + index * 100, y: 3, width: 96, height: 22 });
  });
}

function drag(
  element: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  fireEvent.pointerDown(element, { button: 0, clientX: from.x, clientY: from.y, pointerId: 1 });
  // 中间帧：证明「拖拽中只更新预览」，与最终落点无关。
  fireEvent.pointerMove(element, { clientX: (from.x + to.x) / 2, clientY: from.y, pointerId: 1 });
  fireEvent.pointerMove(element, { clientX: to.x, clientY: to.y, pointerId: 1 });
}

beforeEach(() => {
  pointerCapture.setCapture.mockReset();
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    writable: true,
    value: pointerCapture.setCapture,
  });
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    writable: true,
    value: pointerCapture.releaseCapture,
  });
});

afterEach(() => {
  cleanup();
  document.body.style.cursor = '';
});

const TWO_PANE_LAYOUT = makeSplit('split-p2', 'row', [
  makePane('p1', ['t1', 't2']),
  makePane('p2', ['t3']),
]);

const THREE_TERMINALS = [
  makeTerminal({ terminalId: 't1' }),
  makeTerminal({ terminalId: 't2' }),
  makeTerminal({ terminalId: 't3' }),
];

describe('四种落点', () => {
  it('tab-strip：拖到另一组的 tab 条 → 按 tab 中点细化后的 index 落盘一次', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 650, y: 14 });

    // dragover（pointermove）期间：只更新预览，一次都不落盘。
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
    expect(h.tab('t1').getAttribute('data-dragging')).toBe('true');
    expect(h.strip('p2').getAttribute('data-drop-strip')).toBe('true');
    expect(h.strip('p1').getAttribute('data-drop-strip')).toBeNull();

    fireEvent.pointerUp(tabEl, { clientX: 650, clientY: 14, pointerId: 1 });

    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledTimes(1);
    // p2 只有 t3（中点 452），指针 650 在其右侧 → 插入位 1。
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'tab-strip', index: 1 },
      'p2',
    );
    expect(h.strip('p2').getAttribute('data-drop-strip')).toBeNull();
  });

  it('pane-center：拖到另一组中心 → 合并高亮 + 落盘 pane-center', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 600, y: 150 });

    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
    expect(h.pane('p2').getAttribute('data-drop-center')).toBe('true');
    expect(h.pane('p1').getAttribute('data-drop-center')).toBeNull();
    expect(h.view.container.querySelector('.terminal-pane__drop-edge')).toBeNull();

    fireEvent.pointerUp(tabEl, { clientX: 600, clientY: 150, pointerId: 1 });

    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledTimes(1);
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'pane-center', paneId: 'p2' },
      undefined,
    );
    expect(h.pane('p2').getAttribute('data-drop-center')).toBeNull();
  });

  it('pane-edge：靠近右组左边缘 → 左半边插入预览 + 落盘 pane-edge(left)', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 410, y: 150 });

    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
    const preview = h.pane('p2').querySelector('.terminal-pane__drop-edge');
    expect(preview?.getAttribute('data-edge')).toBe('left');
    expect(h.pane('p2').getAttribute('data-drop-center')).toBeNull();

    fireEvent.pointerUp(tabEl, { clientX: 410, clientY: 150, pointerId: 1 });

    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'pane-edge', paneId: 'p2', edge: 'left' },
      undefined,
    );
  });

  it('detach：拖出面板内容区（所有 pane 之外）→ 落盘 detach', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 900, y: 500 });

    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
    expect(h.view.container.querySelector('.terminal-pane__drop-edge')).toBeNull();
    expect(h.pane('p1').getAttribute('data-drop-center')).toBeNull();

    fireEvent.pointerUp(tabEl, { clientX: 900, clientY: 500, pointerId: 1 });

    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith('t1', { kind: 'detach' }, undefined);
  });
});

describe('<768px（只允许上下拆分）', () => {
  it('row 边落点被 isDirectionAllowed 拒绝 → 回退 pane-center（不出现左右插入条）', () => {
    const h = renderHarness({
      layout: TWO_PANE_LAYOUT,
      terminals: THREE_TERMINALS,
      preferredSplitDirection: 'column',
    });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 410, y: 150 });

    expect(h.view.container.querySelector('.terminal-pane__drop-edge')).toBeNull();
    expect(h.pane('p2').getAttribute('data-drop-center')).toBe('true');

    fireEvent.pointerUp(tabEl, { clientX: 410, clientY: 150, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'pane-center', paneId: 'p2' },
      undefined,
    );
  });

  it('column 边落点照常产出 pane-edge(top)', () => {
    const h = renderHarness({
      layout: TWO_PANE_LAYOUT,
      terminals: THREE_TERMINALS,
      preferredSplitDirection: 'column',
    });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    // y=40 在 tab 条（高 28）之下、p2 上边带之内 → column 的 top 边落点。
    drag(tabEl, { x: 50, y: 14 }, { x: 600, y: 40 });

    const preview = h.pane('p2').querySelector('.terminal-pane__drop-edge');
    expect(preview?.getAttribute('data-edge')).toBe('top');

    fireEvent.pointerUp(tabEl, { clientX: 600, clientY: 40, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'pane-edge', paneId: 'p2', edge: 'top' },
      undefined,
    );
  });
});

describe('隐式单组（layout === null）的首个拆分', () => {
  function renderImplicit(terminals: SessionTerminalView[]) {
    const h = renderHarness({ layout: null, terminals, paneCount: 1 });
    stubRect(h.pane(IMPLICIT_PANE_ID), { x: 0, y: 0, width: 400, height: 300 });
    stubRect(h.strip(IMPLICIT_PANE_ID), { x: 0, y: 0, width: 400, height: 28 });
    terminals.forEach((terminal, index) => {
      stubRect(h.tab(terminal.terminalId), { x: 4 + index * 100, y: 3, width: 96, height: 22 });
    });
    return h;
  }

  it('pane-edge(left)：两个终端时接受 → 左插入条预览 + drop 落盘 pane-edge', () => {
    const h = renderImplicit([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
    ]);
    const tabEl = h.tab('t2');
    drag(tabEl, { x: 50, y: 14 }, { x: 10, y: 150 });

    const preview = h.pane(IMPLICIT_PANE_ID).querySelector('.terminal-pane__drop-edge');
    expect(preview?.getAttribute('data-edge')).toBe('left');
    expect(document.body.style.cursor).toBe('grabbing');
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();

    fireEvent.pointerUp(tabEl, { clientX: 10, clientY: 150, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't2',
      { kind: 'pane-edge', paneId: IMPLICIT_PANE_ID, edge: 'left' },
      undefined,
    );
  });

  it('pane-edge(top)：上下边（column）同样接受并预览', () => {
    const h = renderImplicit([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
    ]);
    const tabEl = h.tab('t2');
    drag(tabEl, { x: 50, y: 14 }, { x: 200, y: 40 });

    const preview = h.pane(IMPLICIT_PANE_ID).querySelector('.terminal-pane__drop-edge');
    expect(preview?.getAttribute('data-edge')).toBe('top');

    fireEvent.pointerUp(tabEl, { clientX: 200, clientY: 40, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't2',
      { kind: 'pane-edge', paneId: IMPLICIT_PANE_ID, edge: 'top' },
      undefined,
    );
  });

  it('仅一个终端：边落点拒绝（拆出去会让源组变空），不预览、不落盘', () => {
    const h = renderImplicit([makeTerminal({ terminalId: 't1' })]);
    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 10, y: 150 });

    expect(h.view.container.querySelector('.terminal-pane__drop-edge')).toBeNull();
    expect(document.body.style.cursor).toBe('not-allowed');

    fireEvent.pointerUp(tabEl, { clientX: 10, clientY: 150, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
  });

  it('pane-center：同组合并是 no-op，保持拒绝语义', () => {
    const h = renderImplicit([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
    ]);
    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 200, y: 150 });

    expect(h.pane(IMPLICIT_PANE_ID).getAttribute('data-drop-center')).toBeNull();
    expect(document.body.style.cursor).toBe('not-allowed');

    fireEvent.pointerUp(tabEl, { clientX: 200, clientY: 150, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
  });

  it('tab-strip：组内重排仍然接受（首个拆分不改变这条语义）', () => {
    const h = renderImplicit([
      makeTerminal({ terminalId: 't1' }),
      makeTerminal({ terminalId: 't2' }),
    ]);
    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 190, y: 14 });

    expect(h.strip(IMPLICIT_PANE_ID).getAttribute('data-drop-strip')).toBe('true');

    fireEvent.pointerUp(tabEl, { clientX: 190, clientY: 14, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'tab-strip', index: 1 },
      IMPLICIT_PANE_ID,
    );
  });
});

describe('拒绝矩阵', () => {
  /** 两 pane 各一个终端：用于「拖走某组最后一个终端」的语义回归。 */
  function renderSingleTerminalPanes(limits: { paneCount?: number; maxPanes?: number } = {}) {
    const singleLayout = makeSplit('split-p2', 'row', [
      makePane('p1', ['t1']),
      makePane('p2', ['t2']),
    ]);
    const h = renderHarness({
      layout: singleLayout,
      terminals: [makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })],
      ...limits,
    });
    stubRect(h.pane('p1'), PANE_P1);
    stubRect(h.pane('p2'), PANE_P2);
    stubRect(h.strip('p1'), STRIP_P1);
    stubRect(h.strip('p2'), STRIP_P2);
    stubRect(h.tab('t1'), { x: 4, y: 3, width: 96, height: 22 });
    stubRect(h.tab('t2'), { x: 404, y: 3, width: 96, height: 22 });
    return h;
  }

  it('拖走某组最后一个终端 → 允许：落点正常预览 + drop 落一次盘（源组折叠在纯函数层）', () => {
    const h = renderSingleTerminalPanes();

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 600, y: 150 });

    // 允许的落点：渲染合并高亮 + 抓取光标（只有被拒绝的落点才是 not-allowed）。
    expect(h.pane('p2').getAttribute('data-drop-center')).toBe('true');
    expect(document.body.style.cursor).toBe('grabbing');
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();

    fireEvent.pointerUp(tabEl, { clientX: 600, clientY: 150, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledTimes(1);
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'pane-center', paneId: 'p2' },
      undefined,
    );
    expect(document.body.style.cursor).toBe('');
  });

  it('最后一个终端落回本组 tab 条（组内重排）仍然合法', () => {
    const h = renderSingleTerminalPanes();

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 200, y: 14 });
    expect(h.strip('p1').getAttribute('data-drop-strip')).toBe('true');

    fireEvent.pointerUp(tabEl, { clientX: 200, clientY: 14, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'tab-strip', index: 0 },
      'p1',
    );
  });

  it('pane 上限：源组仅剩该终端也仍拒绝 pane-edge（不因源组会折叠而放开新建组）', () => {
    const h = renderSingleTerminalPanes({ paneCount: 4, maxPanes: 4 });

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 410, y: 150 });

    expect(h.view.container.querySelector('.terminal-pane__drop-edge')).toBeNull();
    expect(document.body.style.cursor).toBe('not-allowed');
    fireEvent.pointerUp(tabEl, { clientX: 410, clientY: 150, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
  });

  it('pane 达上限：pane-edge 拒绝，但合并（pane-center）仍允许', () => {
    const h = renderHarness({
      layout: TWO_PANE_LAYOUT,
      terminals: THREE_TERMINALS,
      paneCount: 4,
      maxPanes: 4,
    });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 410, y: 150 });
    expect(h.view.container.querySelector('.terminal-pane__drop-edge')).toBeNull();
    fireEvent.pointerUp(tabEl, { clientX: 410, clientY: 150, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();

    drag(tabEl, { x: 50, y: 14 }, { x: 600, y: 150 });
    expect(h.pane('p2').getAttribute('data-drop-center')).toBe('true');
    fireEvent.pointerUp(tabEl, { clientX: 600, clientY: 150, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledTimes(1);
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'pane-center', paneId: 'p2' },
      undefined,
    );
  });

  it('pane 达上限时拖出面板（detach）仍然允许（不产生新组）', () => {
    const h = renderHarness({
      layout: TWO_PANE_LAYOUT,
      terminals: THREE_TERMINALS,
      paneCount: 4,
      maxPanes: 4,
    });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 900, y: 500 });
    fireEvent.pointerUp(tabEl, { clientX: 900, clientY: 500, pointerId: 1 });

    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith('t1', { kind: 'detach' }, undefined);
  });
});

describe('手势收口', () => {
  it('pointercancel：清预览、不落盘', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    drag(tabEl, { x: 50, y: 14 }, { x: 600, y: 150 });
    expect(h.pane('p2').getAttribute('data-drop-center')).toBe('true');

    fireEvent.pointerCancel(tabEl, { pointerId: 1 });
    expect(h.pane('p2').getAttribute('data-drop-center')).toBeNull();
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
  });

  it('抖动小于阈值的按下不算拖拽（也不吞掉随后的 click）', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    const label = tabEl.querySelector<HTMLElement>('.terminal-tab__label');
    if (!label) throw new Error('tab label 未渲染');
    fireEvent.pointerDown(tabEl, { button: 0, clientX: 50, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(tabEl, { clientX: 52, clientY: 15, pointerId: 1 });
    fireEvent.pointerUp(tabEl, { clientX: 52, clientY: 15, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();

    fireEvent.click(label);
    expect(h.actions.selectTerminal).toHaveBeenCalledTimes(1);
  });

  it('拖拽结束后的 click 被吞掉（不切换 active tab）', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    const label = tabEl.querySelector<HTMLElement>('.terminal-tab__label');
    if (!label) throw new Error('tab label 未渲染');
    drag(tabEl, { x: 50, y: 14 }, { x: 600, y: 150 });
    fireEvent.pointerUp(tabEl, { clientX: 600, clientY: 150, pointerId: 1 });
    fireEvent.click(label);

    expect(h.actions.selectTerminal).not.toHaveBeenCalled();

    // 下一次真实点击恢复正常。
    fireEvent.click(label);
    expect(h.actions.selectTerminal).toHaveBeenCalledTimes(1);
  });
});

describe('引擎无关的手势（document 级监听）', () => {
  it('pointerdown 必须 preventDefault（阻断 WebView2 原生拖拽抢占指针流）', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(down, { button: 0, clientX: 50, clientY: 14, pointerId: 1 });
    const notCancelled = tabEl.dispatchEvent(down);

    expect(notCancelled).toBe(false);
  });

  it('不得调用 setPointerCapture（capture 在 WebView2 上会因重排静默丢事件）', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);
    pointerCapture.setCapture.mockClear();

    fireEvent.pointerDown(h.tab('t1'), { button: 0, clientX: 50, clientY: 14, pointerId: 1 });

    expect(pointerCapture.setCapture).not.toHaveBeenCalled();
  });

  it('pointer capture 抛错时拖拽仍生效（跟手 + 落一次盘）', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);
    Object.defineProperty(Element.prototype, 'setPointerCapture', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('capture unsupported');
      },
    });

    const tabEl = h.tab('t1');
    fireEvent.pointerDown(tabEl, { button: 0, clientX: 50, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(document.body, { clientX: 600, clientY: 150, pointerId: 1 });

    expect(h.pane('p2').getAttribute('data-drop-center')).toBe('true');
    fireEvent.pointerUp(document.body, { clientX: 600, clientY: 150, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'pane-center', paneId: 'p2' },
      undefined,
    );
  });

  it('指针离开 tab 条（事件落在 document.body）后仍持续跟随并落盘', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    const tabEl = h.tab('t1');
    fireEvent.pointerDown(tabEl, { button: 0, clientX: 50, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(document.body, { clientX: 90, clientY: 14, pointerId: 1 });
    expect(h.tab('t1').getAttribute('data-dragging')).toBe('true');

    fireEvent.pointerMove(document.body, { clientX: 410, clientY: 150, pointerId: 1 });
    const preview = h.pane('p2').querySelector('.terminal-pane__drop-edge');
    expect(preview?.getAttribute('data-edge')).toBe('left');

    fireEvent.pointerUp(document.body, { clientX: 410, clientY: 150, pointerId: 1 });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'pane-edge', paneId: 'p2', edge: 'left' },
      undefined,
    );
  });
});

describe('键盘替代', () => {
  it('Alt+←/→ 组内重排（index 语义 = 移除被拖 tab 后的槽位）', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    fireEvent.keyDown(h.tab('t1'), { key: 'ArrowRight', altKey: true });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith(
      't1',
      { kind: 'tab-strip', index: 1 },
      'p1',
    );

    fireEvent.keyDown(h.tab('t2'), { key: 'ArrowLeft', altKey: true });
    expect(h.actions.moveTerminalByDrop).toHaveBeenLastCalledWith(
      't2',
      { kind: 'tab-strip', index: 0 },
      'p1',
    );

    // 边界：最左的 tab 再左移 = 无操作。
    vi.mocked(h.actions.moveTerminalByDrop).mockClear();
    fireEvent.keyDown(h.tab('t1'), { key: 'ArrowLeft', altKey: true });
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
  });

  it('Alt+Shift+←/→ 移到 DFS 相邻组；无相邻组时不动作', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    fireEvent.keyDown(h.tab('t1'), { key: 'ArrowRight', altKey: true, shiftKey: true });
    expect(h.actions.moveTerminalByDrop).toHaveBeenCalledWith('t1', {
      kind: 'pane-center',
      paneId: 'p2',
    });

    vi.mocked(h.actions.moveTerminalByDrop).mockClear();
    // p2 是 DFS 最后一个 pane → 右移没有相邻组。
    fireEvent.keyDown(h.tab('t3'), { key: 'ArrowRight', altKey: true, shiftKey: true });
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
  });

  it('未按 Alt 的方向键不触发移动', () => {
    const h = renderHarness({ layout: TWO_PANE_LAYOUT, terminals: THREE_TERMINALS });
    stubStandardGeometry(h, ['t3']);

    fireEvent.keyDown(h.tab('t1'), { key: 'ArrowRight' });
    expect(h.actions.moveTerminalByDrop).not.toHaveBeenCalled();
  });
});
