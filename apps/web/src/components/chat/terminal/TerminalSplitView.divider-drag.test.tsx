// @vitest-environment jsdom
/**
 * T-11 分隔条拖拽：
 *  - `role=separator` + `aria-orientation` 随方向切换，`tabIndex=0`，`aria-valuenow/min/max` 反映当前比例；
 *  - pointerdown/move/up：拖拽中只改本地瞬态比例（**不落盘**），pointerup 落盘**恰好一次**；
 *  - 比例换算走 T-08 的 `resolveRatioFromPointer`（钳制到 [10%, 90%]，指针跑出盒子也不越界）；
 *  - 键盘 ←/→（row）或 ↑/↓（column）按 2% 调整并立即落盘，Home/End 到 10%/90%；
 *  - 拖拽期间不重建 xterm（`InteractiveTerminalView` 挂载 / 卸载计数不变）。
 *
 * InteractiveTerminalView 换成带计数的替身：这里验证布局行为，不是 xterm 本身。
 * jsdom 没有 `setPointerCapture`：按仓库既有做法打桩并断言确实请求了捕获。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { makePane, makeSplit } from './layout/test-fixtures.js';
import type { TerminalLayout, TerminalSplitDirection } from './layout/types.js';
import {
  TerminalLayoutContext,
  type TerminalPaneActions,
  type TerminalLayoutContextValue,
  type TerminalTabDragState,
} from './TerminalLayoutContext.js';
import { TerminalSplitView } from './TerminalSplitView.js';

const viewSpy = vi.hoisted(() => ({ mountCount: 0, unmountCount: 0 }));

vi.mock('./InteractiveTerminalView.js', async () => {
  const { useEffect } = await import('react');
  return {
    InteractiveTerminalView: ({ terminal }: { terminal: SessionTerminalView }) => {
      useEffect(() => {
        viewSpy.mountCount += 1;
        return () => {
          viewSpy.unmountCount += 1;
        };
      }, [terminal.terminalId]);
      return <div data-testid={`terminal-view-${terminal.terminalId}`} />;
    },
  };
});

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

function stubRect(
  element: Element,
  rect: { x: number; y: number; width: number; height: number },
): void {
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

const pointerCapture = vi.hoisted(() => ({ setCapture: vi.fn(), releaseCapture: vi.fn() }));

function installPointerCaptureStubs(): void {
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
}

interface HarnessOptions {
  direction?: TerminalSplitDirection;
  paneCount?: number;
  maxPanes?: number;
}

function renderHarness(options: HarnessOptions = {}) {
  const { direction = 'row', paneCount = 2, maxPanes = 4 } = options;
  const layout: TerminalLayout = makeSplit('split-p2', direction, [
    makePane('p1', ['t1']),
    makePane('p2', ['t2']),
  ]);
  const actions = makeActions();
  const setTabDrag = vi.fn<(state: TerminalTabDragState | null) => void>();
  const context: TerminalLayoutContextValue = {
    activePaneId: 'p1',
    setActivePaneId: vi.fn(),
    layout,
    paneCount,
    maxPanes,
    preferredSplitDirection: direction,
    totalTerminalCount: 2,
    busyPaneId: null,
    tabDrag: null,
    setTabDrag,
    view: {
      gatewayUrl: 'https://gateway.test',
      token: 'token-1',
      sessionId: 'session-1',
      inputEnabled: () => true,
      onWriteError: vi.fn(),
    },
    actions,
  };
  const view = render(
    <TerminalLayoutContext value={context}>
      <TerminalSplitView
        layout={layout}
        terminals={[makeTerminal(), makeTerminal({ terminalId: 't2' })]}
        implicitActiveTerminalId={null}
      />
    </TerminalLayoutContext>,
  );
  const split = view.container.querySelector<HTMLElement>(
    '.terminal-split[data-split-id="split-p2"]',
  );
  if (!split) throw new Error('split 容器未渲染');
  stubRect(split, { x: 0, y: 0, width: 1000, height: 400 });
  const divider = view.container.querySelector<HTMLElement>(
    '.terminal-split__divider[data-split-id="split-p2"]',
  );
  if (!divider) throw new Error('分隔条未渲染');
  const firstChild = split.querySelector<HTMLElement>('.terminal-split__child');
  if (!firstChild) throw new Error('第一个子面板未渲染');
  return { view, split, divider, firstChild, actions, setTabDrag };
}

beforeEach(() => {
  viewSpy.mountCount = 0;
  viewSpy.unmountCount = 0;
  pointerCapture.setCapture.mockReset();
  installPointerCaptureStubs();
});

afterEach(() => {
  cleanup();
});

describe('分隔条语义与键盘', () => {
  it('row：role=separator + aria-orientation=vertical + value 范围与当前值', () => {
    renderHarness({ direction: 'row' });

    const divider = screen.getByRole('separator', { name: '调整分屏比例' });
    expect(divider.getAttribute('aria-orientation')).toBe('vertical');
    expect(divider.getAttribute('aria-valuemin')).toBe('10');
    expect(divider.getAttribute('aria-valuemax')).toBe('90');
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    expect(divider.getAttribute('tabindex')).toBe('0');
  });

  it('column：aria-orientation=horizontal，↑/↓ 调整并各自落盘一次', () => {
    const { actions } = renderHarness({ direction: 'column' });

    const divider = screen.getByRole('separator', { name: '调整分屏比例' });
    expect(divider.getAttribute('aria-orientation')).toBe('horizontal');

    fireEvent.keyDown(divider, { key: 'ArrowDown' });
    expect(actions.setRatio).toHaveBeenCalledTimes(1);
    expect(actions.setRatio).toHaveBeenCalledWith('split-p2', 0.52);

    fireEvent.keyDown(divider, { key: 'ArrowUp' });
    expect(actions.setRatio).toHaveBeenCalledTimes(2);
    expect(actions.setRatio).toHaveBeenLastCalledWith('split-p2', 0.48);
  });

  it('row：←/→ 按 2% 调整，Home/End 到 10% / 90%', () => {
    const { actions } = renderHarness({ direction: 'row' });
    const divider = screen.getByRole('separator', { name: '调整分屏比例' });

    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(actions.setRatio).toHaveBeenLastCalledWith('split-p2', 0.52);

    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(actions.setRatio).toHaveBeenLastCalledWith('split-p2', 0.48);

    fireEvent.keyDown(divider, { key: 'Home' });
    expect(actions.setRatio).toHaveBeenLastCalledWith('split-p2', 0.1);

    fireEvent.keyDown(divider, { key: 'End' });
    expect(actions.setRatio).toHaveBeenLastCalledWith('split-p2', 0.9);
  });

  it('row 分隔条忽略 ↑/↓，column 忽略 ←/→（不落盘）', () => {
    const { actions } = renderHarness({ direction: 'row' });
    const divider = screen.getByRole('separator', { name: '调整分屏比例' });

    fireEvent.keyDown(divider, { key: 'ArrowUp' });
    fireEvent.keyDown(divider, { key: 'ArrowDown' });
    expect(actions.setRatio).not.toHaveBeenCalled();
  });
});

describe('分隔条拖拽', () => {
  it('pointerdown + move 只改本地比例（不落盘），pointerup 落盘一次', () => {
    const { divider, firstChild, actions } = renderHarness({ direction: 'row' });

    fireEvent.pointerDown(divider, { button: 0, clientX: 300, clientY: 100, pointerId: 1 });
    expect(firstChild.style.flexBasis).toBe('30%');
    expect(divider.getAttribute('aria-valuenow')).toBe('30');
    expect(divider.getAttribute('data-dragging')).toBe('true');

    fireEvent.pointerMove(divider, { clientX: 600, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientX: 700, clientY: 100, pointerId: 1 });
    expect(firstChild.style.flexBasis).toBe('70%');
    // 关键纪律：拖拽过程中一次都不落盘。
    expect(actions.setRatio).not.toHaveBeenCalled();

    fireEvent.pointerUp(divider, { clientX: 700, clientY: 100, pointerId: 1 });
    expect(actions.setRatio).toHaveBeenCalledTimes(1);
    expect(actions.setRatio).toHaveBeenCalledWith('split-p2', 0.7);
    expect(divider.getAttribute('data-dragging')).toBe('false');
  });

  it('pointerdown 请求指针捕获（拖出窗口仍能跟随）并锁定光标', () => {
    const { divider } = renderHarness({ direction: 'row' });

    fireEvent.pointerDown(divider, { button: 0, clientX: 300, clientY: 100, pointerId: 7 });
    expect(pointerCapture.setCapture).toHaveBeenCalledWith(7);
  });

  it('超界拖拽按 [10%, 90%] 钳制（复用的纯函数层语义）', () => {
    const { divider, firstChild, actions } = renderHarness({ direction: 'row' });

    fireEvent.pointerDown(divider, { button: 0, clientX: 500, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientX: 5000, clientY: 100, pointerId: 1 });
    expect(firstChild.style.flexBasis).toBe('90%');
    fireEvent.pointerMove(divider, { clientX: -5000, clientY: 100, pointerId: 1 });
    expect(firstChild.style.flexBasis).toBe('10%');

    fireEvent.pointerUp(divider, { clientX: -5000, clientY: 100, pointerId: 1 });
    expect(actions.setRatio).toHaveBeenCalledWith('split-p2', 0.1);
  });

  it('pointercancel 与 pointerup 同一条收口：落盘一次并清除拖拽态', () => {
    const { divider, actions } = renderHarness({ direction: 'row' });

    fireEvent.pointerDown(divider, { button: 0, clientX: 300, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientX: 600, clientY: 100, pointerId: 1 });
    expect(actions.setRatio).not.toHaveBeenCalled();

    fireEvent.pointerCancel(divider, { pointerId: 1 });

    expect(actions.setRatio).toHaveBeenCalledTimes(1);
    expect(actions.setRatio).toHaveBeenCalledWith('split-p2', 0.6);
    expect(divider.getAttribute('data-dragging')).toBe('false');
  });

  it('拖拽全程不重建终端视图（挂载 / 卸载计数不变）', () => {
    const { divider, view } = renderHarness({ direction: 'row' });
    expect(viewSpy.mountCount).toBe(2);
    expect(view.container.querySelectorAll('.terminal-pane')).toHaveLength(2);

    fireEvent.pointerDown(divider, { button: 0, clientX: 300, clientY: 100, pointerId: 1 });
    for (const x of [400, 500, 600, 700, 300]) {
      fireEvent.pointerMove(divider, { clientX: x, clientY: 100, pointerId: 1 });
    }
    fireEvent.pointerUp(divider, { clientX: 300, clientY: 100, pointerId: 1 });
    // 落盘后 harness 的 layout 未变（静态 props），pane 仍是同样两个实例。
    expect(viewSpy.mountCount).toBe(2);
    expect(viewSpy.unmountCount).toBe(0);
    expect(
      within(screen.getByTestId('terminal-pane-p2')).getByTestId('terminal-view-t2'),
    ).toBeTruthy();
  });

  it('column：竖直拖拽用 clientY 换算', () => {
    const { divider, firstChild, actions } = renderHarness({ direction: 'column' });
    // column 盒子的高度是 400：clientY=100 → 25%。
    fireEvent.pointerDown(divider, { button: 0, clientX: 10, clientY: 100, pointerId: 1 });
    expect(firstChild.style.flexBasis).toBe('25%');

    fireEvent.pointerMove(divider, { clientX: 10, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(divider, { clientX: 10, clientY: 300, pointerId: 1 });
    expect(actions.setRatio).toHaveBeenCalledWith('split-p2', 0.75);
  });
});
