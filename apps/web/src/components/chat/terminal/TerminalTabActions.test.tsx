// @vitest-environment jsdom
/**
 * 终端操作区：＋ 新建、⊟ 拆分（渲染但 disabled）、⋯ 菜单装配
 * （重命名 / 清屏 / 合并到分屏 disabled / 关闭其他 / 关闭全部）与状态门控。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { TerminalTabActions } from './TerminalTabActions.js';

afterEach(() => {
  cleanup();
});

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

function renderActions(overrides: Partial<React.ComponentProps<typeof TerminalTabActions>> = {}) {
  const handlers = {
    onRequestCreate: vi.fn(),
    onRequestRename: vi.fn(),
    onRequestClear: vi.fn(),
    onRequestCloseOthers: vi.fn(),
    onRequestCloseAll: vi.fn(),
  };
  const props: React.ComponentProps<typeof TerminalTabActions> = {
    activeTerminal: makeTerminal(),
    terminalCount: 1,
    canCreate: true,
    creating: false,
    ...handlers,
    ...overrides,
  };
  const view = render(<TerminalTabActions {...props} />);
  return { ...handlers, view };
}

function openMoreMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: '更多终端操作' }));
}

describe('TerminalTabActions', () => {
  it('＋ 新建可用时回调 onRequestCreate，创建中 / 未就绪时禁用', () => {
    const { onRequestCreate, view } = renderActions();

    const createButton = screen.getByRole('button', { name: '新建终端' });
    fireEvent.click(createButton);
    expect(onRequestCreate).toHaveBeenCalledTimes(1);

    view.rerender(
      <TerminalTabActions
        activeTerminal={makeTerminal()}
        terminalCount={1}
        canCreate={false}
        creating={false}
        onRequestCreate={onRequestCreate}
        onRequestRename={vi.fn()}
        onRequestClear={vi.fn()}
        onRequestCloseOthers={vi.fn()}
        onRequestCloseAll={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: '新建终端' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    view.rerender(
      <TerminalTabActions
        activeTerminal={makeTerminal()}
        terminalCount={1}
        canCreate
        creating
        onRequestCreate={onRequestCreate}
        onRequestRename={vi.fn()}
        onRequestClear={vi.fn()}
        onRequestCloseOthers={vi.fn()}
        onRequestCloseAll={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: '新建终端' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('⊟ 拆分：未接入时禁用；接入后可用并回调 onRequestSplit', () => {
    const { view } = renderActions();

    const unbound = screen.getByRole('button', { name: '拆分终端' }) as HTMLButtonElement;
    expect(unbound.disabled).toBe(true);
    expect(unbound.getAttribute('title')).toBe('分屏未接入');

    const onRequestSplit = vi.fn();
    view.rerender(
      <TerminalTabActions
        activeTerminal={makeTerminal()}
        terminalCount={1}
        canCreate
        creating={false}
        onRequestCreate={vi.fn()}
        onRequestRename={vi.fn()}
        onRequestClear={vi.fn()}
        onRequestCloseOthers={vi.fn()}
        onRequestCloseAll={vi.fn()}
        onRequestSplit={onRequestSplit}
        splitHint="上下拆分"
      />,
    );

    const split = screen.getByRole('button', { name: '拆分终端' }) as HTMLButtonElement;
    expect(split.disabled).toBe(false);
    expect(split.getAttribute('title')).toContain('上下拆分');

    fireEvent.click(split);
    expect(onRequestSplit).toHaveBeenCalledTimes(1);
  });

  it('⊟ 拆分：disabledReason 存在时禁用并展示原因（如已达上限）', () => {
    renderActions({ onRequestSplit: vi.fn(), splitDisabledReason: '分屏已达上限（4 个组）' });

    const split = screen.getByRole('button', { name: '拆分终端' }) as HTMLButtonElement;
    expect(split.disabled).toBe(true);
    expect(split.getAttribute('title')).toBe('分屏已达上限（4 个组）');
  });

  it('⋯ 打开菜单并暴露全部菜单项', () => {
    renderActions();

    const more = screen.getByRole('button', { name: '更多终端操作' });
    expect(more.getAttribute('aria-expanded')).toBe('false');

    openMoreMenu();

    expect(screen.getByRole('button', { name: '更多终端操作' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /清屏/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /关闭其他终端/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '关闭全部终端' })).toBeTruthy();
  });

  it('「合并到分屏」：缺省禁用；接入且无原因时可用并回调 onRequestMerge', () => {
    const { view } = renderActions();
    openMoreMenu();

    const unbound = screen.getByRole('menuitem', { name: /合并到分屏/ }) as HTMLButtonElement;
    expect(unbound.disabled).toBe(true);
    expect(unbound.getAttribute('title')).toBe('合并未接入');
    fireEvent.click(unbound);
    // disabled 菜单项点击不触发、也不关闭菜单。
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    const onRequestMerge = vi.fn();
    view.rerender(
      <TerminalTabActions
        activeTerminal={makeTerminal()}
        terminalCount={2}
        totalTerminalCount={3}
        canCreate
        creating={false}
        onRequestCreate={vi.fn()}
        onRequestRename={vi.fn()}
        onRequestClear={vi.fn()}
        onRequestCloseOthers={vi.fn()}
        onRequestCloseAll={vi.fn()}
        onRequestMerge={onRequestMerge}
      />,
    );
    openMoreMenu();

    const merge = screen.getByRole('menuitem', { name: /合并到分屏/ }) as HTMLButtonElement;
    expect(merge.disabled).toBe(false);
    fireEvent.click(merge);
    expect(onRequestMerge).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('「合并到分屏」：mergeDisabledReason 存在时禁用并展示原因', () => {
    renderActions({ onRequestMerge: vi.fn(), mergeDisabledReason: '当前组已包含所有终端' });
    openMoreMenu();

    const merge = screen.getByRole('menuitem', { name: /合并到分屏/ }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
    expect(merge.getAttribute('title')).toBe('当前组已包含所有终端');
  });

  it('「重命名」在无激活终端时 disabled 且不触发回调', () => {
    const { onRequestRename } = renderActions({ activeTerminal: null, terminalCount: 0 });
    openMoreMenu();

    const rename = screen.getByRole('menuitem', { name: '重命名' }) as HTMLButtonElement;
    expect(rename.disabled).toBe(true);
    fireEvent.click(rename);

    expect(onRequestRename).not.toHaveBeenCalled();
  });

  it('「清屏」仅对可交互的持久终端可用，选中后回调', () => {
    const { onRequestClear } = renderActions();
    openMoreMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: /清屏/ }));

    expect(onRequestClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('「清屏」对 agent 后台终端 / 已结束终端禁用', () => {
    const { view } = renderActions({ activeTerminal: makeTerminal({ kind: 'background' }) });
    openMoreMenu();
    expect((screen.getByRole('menuitem', { name: /清屏/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    view.rerender(
      <TerminalTabActions
        activeTerminal={makeTerminal({ status: 'exited' })}
        terminalCount={1}
        canCreate
        creating={false}
        onRequestCreate={vi.fn()}
        onRequestRename={vi.fn()}
        onRequestClear={vi.fn()}
        onRequestCloseOthers={vi.fn()}
        onRequestCloseAll={vi.fn()}
      />,
    );
    openMoreMenu();
    expect((screen.getByRole('menuitem', { name: /清屏/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('「关闭其他」在仅一个终端时禁用，「关闭全部」在无终端时禁用', () => {
    const { view } = renderActions({ terminalCount: 1 });
    openMoreMenu();

    expect(
      (screen.getByRole('menuitem', { name: /关闭其他终端/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('menuitem', { name: '关闭全部终端' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    view.rerender(
      <TerminalTabActions
        activeTerminal={null}
        terminalCount={0}
        canCreate
        creating={false}
        onRequestCreate={vi.fn()}
        onRequestRename={vi.fn()}
        onRequestClear={vi.fn()}
        onRequestCloseOthers={vi.fn()}
        onRequestCloseAll={vi.fn()}
      />,
    );
    openMoreMenu();
    expect(
      (screen.getByRole('menuitem', { name: '关闭全部终端' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('批量关闭项按各自回调触发', () => {
    const { onRequestCloseOthers, onRequestCloseAll } = renderActions({ terminalCount: 3 });
    openMoreMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /关闭其他终端/ }));
    expect(onRequestCloseOthers).toHaveBeenCalledTimes(1);

    openMoreMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭全部终端' }));
    expect(onRequestCloseAll).toHaveBeenCalledTimes(1);
  });
});

describe('TASK-0：⋯ 菜单的方向拆分入口', () => {
  it('桌面宽度：同时提供「向右拆分」(row) 与「向下拆分」(column)，各自带方向回调', () => {
    const onRequestSplitWithDirection = vi.fn();
    renderActions({
      onRequestSplit: vi.fn(),
      splitMenuDirections: ['row', 'column'],
      onRequestSplitWithDirection,
    });
    openMoreMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: '向右拆分' }));
    expect(onRequestSplitWithDirection).toHaveBeenLastCalledWith('row');

    openMoreMenu();
    const columnItem = screen.getByRole('menuitem', { name: '向下拆分' }) as HTMLButtonElement;
    expect(columnItem.disabled).toBe(false);
    expect(columnItem.getAttribute('title')).toContain('上下');
    fireEvent.click(columnItem);
    expect(onRequestSplitWithDirection).toHaveBeenLastCalledWith('column');
    expect(onRequestSplitWithDirection).toHaveBeenCalledTimes(2);
  });

  it('窄屏（<768px）：只保留「向下拆分」', () => {
    renderActions({
      onRequestSplit: vi.fn(),
      splitMenuDirections: ['column'],
      onRequestSplitWithDirection: vi.fn(),
    });
    openMoreMenu();

    expect(screen.getByRole('menuitem', { name: '向下拆分' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '向右拆分' })).toBeNull();
  });

  it('pane 上限 / 未接入：两项都禁用并给出原因', () => {
    const { view } = renderActions({
      onRequestSplit: vi.fn(),
      splitDisabledReason: '分屏已达上限（4 个组）',
      splitMenuDirections: ['row', 'column'],
      onRequestSplitWithDirection: vi.fn(),
    });
    openMoreMenu();

    for (const label of ['向右拆分', '向下拆分']) {
      const item = screen.getByRole('menuitem', { name: label }) as HTMLButtonElement;
      expect(item.disabled).toBe(true);
      expect(item.getAttribute('title')).toBe('分屏已达上限（4 个组）');
    }

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    view.rerender(
      <TerminalTabActions
        activeTerminal={makeTerminal()}
        terminalCount={1}
        canCreate
        creating={false}
        onRequestCreate={vi.fn()}
        onRequestRename={vi.fn()}
        onRequestClear={vi.fn()}
        onRequestCloseOthers={vi.fn()}
        onRequestCloseAll={vi.fn()}
      />,
    );
    openMoreMenu();
    const unbound = screen.getByRole('menuitem', { name: '向下拆分' }) as HTMLButtonElement;
    expect(unbound.disabled).toBe(true);
    expect(unbound.getAttribute('title')).toBe('分屏未接入');
  });
});
