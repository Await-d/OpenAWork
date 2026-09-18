// @vitest-environment jsdom
/**
 * tab 右键菜单：右键任一 tab 打开共享 `TerminalContextMenu`，并且所有涉及终端的
 * 动作都绑定**被点击的 tab**（非 active tab 也要命中自己）；重命名走既有
 * `renameRequest` 通道；行内重命名期间把右键让回输入框的原生编辑菜单；
 * Shift+F10 / ContextMenu 键锚定 tab 矩形打开同一菜单。
 *
 * xterm 本体不在场（InteractiveTerminalView 被替换为占位），验证的是
 * tab 条 → pane 菜单状态 → 共享菜单 → pane 动作 / 重命名通道的接线语义。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import {
  TerminalLayoutContext,
  type TerminalLayoutContextValue,
  type TerminalPaneActions,
  type TerminalRenameRequest,
} from './TerminalLayoutContext.js';
import { TerminalPane } from './TerminalPane.js';

vi.mock('./InteractiveTerminalView.js', () => ({
  InteractiveTerminalView: ({ terminal }: { terminal: SessionTerminalView }) => (
    <div data-testid={`terminal-view-${terminal.terminalId}`} />
  ),
}));

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

function renderHarness() {
  const actions = makeActions();
  const requestRename = vi.fn();
  // t1 是 active，t2 是非 active —— 菜单必须命中被点击的 tab 而不是 active。
  const terminals = [
    makeTerminal({ terminalId: 't1' }),
    makeTerminal({ terminalId: 't2', name: '构建' }),
  ];

  function Harness() {
    const [renameRequest, setRenameRequest] = useState<TerminalRenameRequest | null>(null);
    const context: TerminalLayoutContextValue = {
      activePaneId: 'p1',
      setActivePaneId: vi.fn(),
      layout: null,
      paneCount: 1,
      maxPanes: 4,
      preferredSplitDirection: 'row',
      totalTerminalCount: terminals.length,
      shellProfiles: [],
      busyPaneId: null,
      tabDrag: null,
      setTabDrag: vi.fn(),
      renameRequest,
      requestRename: (paneId, terminalId) => {
        requestRename(paneId, terminalId);
        setRenameRequest({ paneId, terminalId });
      },
      clearRenameRequest: () => setRenameRequest(null),
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
          <TerminalPane paneId="p1" terminals={terminals} activeTerminalId="t1" />
        </TerminalLayoutContext>
      </div>
    );
  }

  render(<Harness />);
  return { actions, requestRename };
}

function openTabMenu(terminalId: string): HTMLElement {
  fireEvent.contextMenu(screen.getByTestId(`terminal-tab-${terminalId}`), {
    clientX: 40,
    clientY: 20,
  });
  return screen.getByTestId('terminal-context-menu');
}

function menuItemIds(menu: HTMLElement): (string | undefined)[] {
  return [...menu.querySelectorAll<HTMLElement>('[data-testid^="terminal-context-menu-"]')].map(
    (element) => element.dataset.testid,
  );
}

/** 键盘锚点来自 tab 矩形；jsdom 一律返回 0，这里给出非零值以便断言菜单位置。 */
function stubTabRect(tab: HTMLElement, rect: { left: number; bottom: number }): void {
  const domRect = {
    x: rect.left,
    y: rect.bottom,
    width: 96,
    height: 22,
    top: rect.bottom - 22,
    left: rect.left,
    right: rect.left + 96,
    bottom: rect.bottom,
    toJSON: () => ({}),
  } as DOMRect;
  tab.getBoundingClientRect = () => domRect;
}

afterEach(() => {
  cleanup();
});

describe('tab 右键菜单', () => {
  it('右键非 active tab：打开共享菜单（七项按既有顺序）且不隐式切换 active', () => {
    const { actions } = renderHarness();

    const menu = openTabMenu('t2');

    expect(menuItemIds(menu)).toEqual([
      'terminal-context-menu-terminal-new',
      'terminal-context-menu-terminal-split-row',
      'terminal-context-menu-terminal-split-column',
      'terminal-context-menu-terminal-kill',
      'terminal-context-menu-terminal-rename',
      'terminal-context-menu-terminal-close-others',
      'terminal-context-menu-terminal-close-all',
    ]);
    // 目标感知的 title：全部指向被点击的 t2，而不是 active 的 t1。
    expect(screen.getByTestId('terminal-context-menu-terminal-kill').title).toBe('终止该终端');
    expect(screen.getByTestId('terminal-context-menu-terminal-rename').title).toBe('重命名该终端');
    expect(screen.getByTestId('terminal-context-menu-terminal-close-others').title).toBe(
      '关闭当前组内除该终端外的终端',
    );
    expect(actions.selectTerminal).not.toHaveBeenCalled();
  });

  it('终止 / 关闭其他 / 关闭全部绑定被点击的 tab 与该组，选中后菜单关闭', () => {
    const { actions } = renderHarness();

    openTabMenu('t2');
    fireEvent.click(screen.getByTestId('terminal-context-menu-terminal-kill'));
    expect(actions.killTerminal).toHaveBeenCalledWith('t2');
    expect(actions.closeTerminal).not.toHaveBeenCalled();
    expect(screen.queryByTestId('terminal-context-menu')).toBeNull();

    // 保留被点击的 t2，关闭本组其他终端（t1）。
    openTabMenu('t2');
    fireEvent.click(screen.getByTestId('terminal-context-menu-terminal-close-others'));
    expect(actions.closeTerminals).toHaveBeenCalledWith(['t1']);

    // 换一个 tab：保留 t1、关闭 t2 —— 证明目标随点击变化。
    openTabMenu('t1');
    fireEvent.click(screen.getByTestId('terminal-context-menu-terminal-close-others'));
    expect(actions.closeTerminals).toHaveBeenLastCalledWith(['t2']);

    openTabMenu('t2');
    fireEvent.click(screen.getByTestId('terminal-context-menu-terminal-close-all'));
    expect(actions.closeAllTerminals).toHaveBeenCalledTimes(1);
  });

  it('重命名走既有 requestRename 通道并落到被点击的 tab（预填其 label）', () => {
    const { requestRename } = renderHarness();

    openTabMenu('t2');
    fireEvent.click(screen.getByTestId('terminal-context-menu-terminal-rename'));

    expect(requestRename).toHaveBeenCalledWith('p1', 't2');
    const pane = screen.getByTestId('terminal-pane-p1');
    const input = within(pane).getByRole('textbox', { name: '重命名终端' });
    expect((input as HTMLInputElement).value).toBe('构建');
  });

  it('新建 / 拆分仍是组级动作，不带终端目标', () => {
    const { actions } = renderHarness();

    openTabMenu('t2');
    fireEvent.click(screen.getByTestId('terminal-context-menu-terminal-new'));
    expect(actions.createTerminal).toHaveBeenCalledWith('p1');

    openTabMenu('t2');
    fireEvent.click(screen.getByTestId('terminal-context-menu-terminal-split-row'));
    expect(actions.splitPane).toHaveBeenCalledWith('p1', 'row');
  });

  it('该 tab 行内重命名时：不弹菜单，右键留给输入框原生编辑菜单', () => {
    renderHarness();
    const tab = screen.getByTestId('terminal-tab-t2');
    fireEvent.doubleClick(tab);
    const input = within(tab).getByRole('textbox', { name: '重命名终端' });

    const notPrevented = fireEvent.contextMenu(input);

    expect(notPrevented).toBe(true);
    expect(screen.queryByTestId('terminal-context-menu')).toBeNull();
  });

  it('Shift+F10 / ContextMenu 键：锚定 tab 矩形打开同一菜单', () => {
    renderHarness();
    const tab = screen.getByTestId('terminal-tab-t2');
    stubTabRect(tab, { left: 120, bottom: 46 });

    fireEvent.keyDown(tab, { key: 'F10', shiftKey: true });
    const menu = screen.getByTestId('terminal-context-menu');
    expect(menu.style.left).toBe('120px');
    expect(menu.style.top).toBe('46px');

    // 换用专用 ContextMenu 键：同一入口。
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('terminal-context-menu')).toBeNull();
    fireEvent.keyDown(tab, { key: 'ContextMenu' });
    expect(screen.getByTestId('terminal-context-menu')).toBeTruthy();
  });
});
