// @vitest-environment jsdom
/**
 * 分屏递归渲染器（T-10）：
 *  - `layout === null` → 单个隐式 pane（视觉与升级前一致）；
 *  - `row` / `column` 递归渲染 2 层以上嵌套，每 pane 自带一条 tab 条；
 *  - 每个 pane 只渲染自己的 active 终端（= 每 pane 一条 SSE 的结构前提）；
 *  - 游离终端（不在树里的存活终端）作为 tab 托管给 DFS 首个 pane；
 *  - pane 上限时 ⊟ disabled + title 说明；
 *  - 焦点：点击 pane 切换 activePaneId，**非激活 pane 不卸载**（挂载 / 卸载计数）。
 *
 * InteractiveTerminalView 换成带挂载计数的替身：这里验证的是布局树的结构与生命周期，
 * 不是 xterm 本身（那部分由 InteractiveTerminalView / use-terminal-session 的测试覆盖）。
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
} from './TerminalLayoutContext.js';
import { IMPLICIT_PANE_ID, TerminalSplitView } from './TerminalSplitView.js';

const viewSpy = vi.hoisted(() => ({ mountCount: 0, unmountCount: 0, mountedIds: [] as string[] }));

vi.mock('./InteractiveTerminalView.js', async () => {
  const { useEffect } = await import('react');
  return {
    InteractiveTerminalView: ({ terminal }: { terminal: SessionTerminalView }) => {
      useEffect(() => {
        viewSpy.mountCount += 1;
        viewSpy.mountedIds.push(terminal.terminalId);
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

interface HarnessProps {
  layout: TerminalLayout;
  terminals: SessionTerminalView[];
  implicitActiveTerminalId?: string | null;
  activePaneId?: string;
  paneCount?: number;
  maxPanes?: number;
  preferredSplitDirection?: TerminalSplitDirection;
}

function renderSplit(props: HarnessProps) {
  const {
    layout,
    terminals,
    implicitActiveTerminalId = null,
    activePaneId = IMPLICIT_PANE_ID,
    paneCount = 1,
    maxPanes = 4,
    preferredSplitDirection = 'row',
  } = props;
  const actions = makeActions();
  const setActivePaneId = vi.fn();

  const build = (active: string) => (
    <TerminalLayoutContext
      value={
        {
          activePaneId: active,
          setActivePaneId,
          layout,
          paneCount,
          maxPanes,
          preferredSplitDirection,
          shellProfiles: [],
          totalTerminalCount: terminals.length,
          busyPaneId: null,
          tabDrag: null,
          setTabDrag: vi.fn(),
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
        } satisfies TerminalLayoutContextValue
      }
    >
      <TerminalSplitView
        layout={layout}
        terminals={terminals}
        implicitActiveTerminalId={implicitActiveTerminalId}
      />
    </TerminalLayoutContext>
  );

  const view = render(build(activePaneId));
  return {
    actions,
    setActivePaneId,
    view,
    rerenderWithActivePane: (paneId: string) => view.rerender(build(paneId)),
  };
}

beforeEach(() => {
  viewSpy.mountCount = 0;
  viewSpy.unmountCount = 0;
  viewSpy.mountedIds = [];
});

afterEach(() => {
  cleanup();
});

describe('无分屏（隐式 pane）', () => {
  it('layout === null 渲染单个隐式 pane：一条 tab 条 + 只渲染 active 终端', () => {
    const { view } = renderSplit({
      layout: null,
      terminals: [makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })],
      implicitActiveTerminalId: 't2',
    });

    const pane = screen.getByTestId(`terminal-pane-${IMPLICIT_PANE_ID}`);
    expect(pane.getAttribute('data-pane-id')).toBe(IMPLICIT_PANE_ID);
    expect(pane.getAttribute('data-active')).toBe('true');
    expect(view.container.querySelectorAll('[data-testid="terminal-tab-strip"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('.terminal-pane')).toHaveLength(1);

    // active 终端渲染视图；同组的其他终端只是 tab（不建流）。
    expect(screen.getByTestId('terminal-view-t2')).toBeTruthy();
    expect(screen.queryByTestId('terminal-view-t1')).toBeNull();
    expect(screen.getByTestId('terminal-tab-t1')).toBeTruthy();
  });
});

describe('递归渲染', () => {
  it('row 拆分：两个 pane 各自一条 tab 条 + 各自的 active 终端视图', () => {
    const layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    const { view } = renderSplit({
      layout,
      terminals: [makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })],
      activePaneId: 'p1',
    });

    const split = view.container.querySelector('.terminal-split[data-split-id="split-p2"]');
    expect(split?.getAttribute('data-direction')).toBe('row');
    // 分隔条带 data-split-id / data-direction，T-11 直接接管拖拽。
    const divider = view.container.querySelector('[data-split-id="split-p2"][role="separator"]');
    expect(divider?.getAttribute('data-direction')).toBe('row');

    const panes = view.container.querySelectorAll('.terminal-pane');
    expect(panes).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-testid="terminal-tab-strip"]')).toHaveLength(2);

    expect(
      within(screen.getByTestId('terminal-pane-p1')).getByTestId('terminal-tab-t1'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('terminal-pane-p2')).getByTestId('terminal-tab-t2'),
    ).toBeTruthy();

    // 两个 pane 各自挂载一条终端流（= 两条 SSE）。
    expect(screen.getByTestId('terminal-view-t1')).toBeTruthy();
    expect(screen.getByTestId('terminal-view-t2')).toBeTruthy();
    expect(viewSpy.mountCount).toBe(2);
  });

  it('row 中嵌 column（2 层以上）：3 个 pane，方向与包含关系正确', () => {
    const layout = makeSplit('split-outer', 'row', [
      makeSplit('split-inner', 'column', [makePane('p1', ['t1']), makePane('p2', ['t2'])]),
      makePane('p3', ['t3']),
    ]);
    const { view } = renderSplit({
      layout,
      terminals: [
        makeTerminal({ terminalId: 't1' }),
        makeTerminal({ terminalId: 't2' }),
        makeTerminal({ terminalId: 't3' }),
      ],
      activePaneId: 'p1',
    });

    const outer = view.container.querySelector('[data-split-id="split-outer"]');
    const inner = view.container.querySelector('[data-split-id="split-inner"]');
    expect(outer?.getAttribute('data-direction')).toBe('row');
    expect(inner?.getAttribute('data-direction')).toBe('column');
    expect(outer?.contains(inner ?? null)).toBe(true);

    expect(view.container.querySelectorAll('.terminal-pane')).toHaveLength(3);
    expect(view.container.querySelectorAll('[data-testid="terminal-tab-strip"]')).toHaveLength(3);
    expect(viewSpy.mountCount).toBe(3);
  });

  it('每个 pane 只渲染自己的 active 终端；非 active 只是 tab', () => {
    const layout = makeSplit('split-p2', 'row', [
      makePane('p1', ['t1', 't2'], 't2'),
      makePane('p2', ['t3']),
    ]);
    const { view } = renderSplit({
      layout,
      terminals: [
        makeTerminal({ terminalId: 't1' }),
        makeTerminal({ terminalId: 't2' }),
        makeTerminal({ terminalId: 't3' }),
      ],
      activePaneId: 'p1',
    });

    expect(screen.getByTestId('terminal-view-t2')).toBeTruthy();
    expect(screen.queryByTestId('terminal-view-t1')).toBeNull();
    expect(screen.getByTestId('terminal-tab-t1')).toBeTruthy();
    expect(viewSpy.mountedIds.sort()).toEqual(['t2', 't3']);
  });

  it('游离终端（树里没有的存活终端）托管给 DFS 首个 pane 的 tab 条', () => {
    const layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    const { view } = renderSplit({
      layout,
      terminals: [
        makeTerminal({ terminalId: 't1' }),
        makeTerminal({ terminalId: 't2' }),
        makeTerminal({ terminalId: 't9' }),
      ],
      activePaneId: 'p1',
    });

    expect(
      within(screen.getByTestId('terminal-pane-p1')).getByTestId('terminal-tab-t9'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('terminal-pane-p2')).queryByTestId('terminal-tab-t9'),
    ).toBeNull();
    // 游离终端不是 active → 不建流。
    expect(screen.queryByTestId('terminal-view-t9')).toBeNull();
    expect(view.container.querySelectorAll('[data-testid="terminal-tab-strip"]')).toHaveLength(2);
  });
});

describe('pane 上限', () => {
  it('达到上限时 ⊟ disabled 且 title 说明原因', () => {
    const layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    const { view } = renderSplit({
      layout,
      terminals: [makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })],
      paneCount: 4,
      maxPanes: 4,
    });

    const splitButtons = view.container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="terminal-tab-actions-split"]',
    );
    expect(splitButtons).toHaveLength(2);
    for (const button of splitButtons) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('上限');
    }
  });

  it('未达上限时 ⊟ 可用且 title 说明方向（窄视口为上下）', () => {
    const layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    const { view, actions } = renderSplit({
      layout,
      terminals: [makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })],
      paneCount: 2,
      maxPanes: 4,
      preferredSplitDirection: 'column',
    });

    const button = within(screen.getByTestId('terminal-pane-p1')).getByRole('button', {
      name: '拆分终端',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('title')).toContain('上下拆分');

    fireEvent.click(button);
    expect(actions.splitPane).toHaveBeenCalledWith('p1');
  });
});

describe('焦点', () => {
  it('点击 pane 切换 activePaneId，且两个 pane 的终端视图都不卸载', () => {
    const layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    const { setActivePaneId, rerenderWithActivePane } = renderSplit({
      layout,
      terminals: [makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })],
      activePaneId: 'p1',
    });

    const pane1 = screen.getByTestId('terminal-pane-p1');
    const pane2 = screen.getByTestId('terminal-pane-p2');
    expect(pane1.getAttribute('data-active')).toBe('true');
    expect(pane2.getAttribute('data-active')).toBe('false');

    fireEvent.mouseDown(pane2);
    expect(setActivePaneId).toHaveBeenCalledWith('p2');

    // 焦点变化后重渲染（模拟 activePaneId 真实切换）：只换边框，绝不 unmount。
    rerenderWithActivePane('p2');
    expect(screen.getByTestId('terminal-pane-p2').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('terminal-pane-p1').getAttribute('data-active')).toBe('false');
    expect(viewSpy.mountCount).toBe(2);
    expect(viewSpy.unmountCount).toBe(0);
    expect(screen.getByTestId('terminal-view-t1')).toBeTruthy();
    expect(screen.getByTestId('terminal-view-t2')).toBeTruthy();
  });

  it('键盘聚焦（focus capture）同样切换 activePaneId，且已激活 pane 不重复写', () => {
    const layout = makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
    const { setActivePaneId } = renderSplit({
      layout,
      terminals: [makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })],
      activePaneId: 'p1',
    });

    fireEvent.focus(within(screen.getByTestId('terminal-pane-p1')).getByTestId('terminal-tab-t1'));
    expect(setActivePaneId).not.toHaveBeenCalled();

    fireEvent.focus(within(screen.getByTestId('terminal-pane-p2')).getByTestId('terminal-tab-t2'));
    expect(setActivePaneId).toHaveBeenCalledWith('p2');
  });
});

describe('pane 内动作作用域', () => {
  it('＋ / ⋯ 作用于所属 pane（createTerminal / mergeOthersIntoPane 带 paneId）', () => {
    const layout = makeSplit('split-p2', 'row', [
      makePane('p1', ['t1', 't2']),
      makePane('p2', ['t3']),
    ]);
    const { actions } = renderSplit({
      layout,
      terminals: [
        makeTerminal({ terminalId: 't1' }),
        makeTerminal({ terminalId: 't2' }),
        makeTerminal({ terminalId: 't3' }),
      ],
      activePaneId: 'p1',
    });

    const pane2 = screen.getByTestId('terminal-pane-p2');
    fireEvent.click(within(pane2).getByRole('button', { name: '新建终端' }));
    expect(actions.createTerminal).toHaveBeenCalledWith('p2');

    fireEvent.click(within(pane2).getByRole('button', { name: '更多终端操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /合并到分屏/ }));
    expect(actions.mergeOthersIntoPane).toHaveBeenCalledWith('p2');
  });

  it('tab 单击 / 关闭 / 重命名都带 pane 或 terminal 作用域', () => {
    const layout = makeSplit('split-p2', 'row', [
      makePane('p1', ['t1', 't2']),
      makePane('p2', ['t3']),
    ]);
    const { actions } = renderSplit({
      layout,
      terminals: [
        makeTerminal({ terminalId: 't1' }),
        makeTerminal({ terminalId: 't2' }),
        makeTerminal({ terminalId: 't3' }),
      ],
      activePaneId: 'p1',
    });

    const pane1 = screen.getByTestId('terminal-pane-p1');
    fireEvent.click(within(pane1).getByRole('button', { name: '终端 1' }));
    // 索引是可视位置：纯函数层缺省索引 = 追加到末尾，不传会把点击的 tab 重排。
    expect(actions.selectTerminal).toHaveBeenCalledWith('p1', 't1', 0);

    fireEvent.click(within(pane1).getByRole('button', { name: '关闭终端 终端 1' }));
    expect(actions.closeTerminal).toHaveBeenCalledWith('t1');

    fireEvent.doubleClick(within(pane1).getByRole('button', { name: '终端 1' }));
    const input = within(pane1).getByRole('textbox', { name: '重命名终端' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'dev' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.renameTerminal).toHaveBeenCalledWith('t1', 'dev');
  });

  it('「合并到分屏」在本组已包含所有终端时 disabled', () => {
    // 隐式 pane 托管全部终端 → 没有可合并的对象。
    renderSplit({
      layout: null,
      terminals: [makeTerminal({ terminalId: 't1' }), makeTerminal({ terminalId: 't2' })],
      implicitActiveTerminalId: 't1',
    });

    const pane = screen.getByTestId(`terminal-pane-${IMPLICIT_PANE_ID}`);
    fireEvent.click(within(pane).getByRole('button', { name: '更多终端操作' }));
    const merge = screen.getByRole('menuitem', { name: /合并到分屏/ }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
    expect(merge.getAttribute('title')).toContain('已包含所有终端');
  });

  it('「合并到分屏」在其他 pane 还有终端时可用', () => {
    const layout = makeSplit('split-p2', 'row', [
      makePane('p1', ['t1', 't2']),
      makePane('p2', ['t3']),
    ]);
    const { actions } = renderSplit({
      layout,
      terminals: [
        makeTerminal({ terminalId: 't1' }),
        makeTerminal({ terminalId: 't2' }),
        makeTerminal({ terminalId: 't3' }),
      ],
      activePaneId: 'p1',
    });

    const pane1 = screen.getByTestId('terminal-pane-p1');
    fireEvent.click(within(pane1).getByRole('button', { name: '更多终端操作' }));
    const merge = screen.getByRole('menuitem', { name: /合并到分屏/ }) as HTMLButtonElement;
    expect(merge.disabled).toBe(false);

    fireEvent.click(merge);
    expect(actions.mergeOthersIntoPane).toHaveBeenCalledWith('p1');
  });
});
