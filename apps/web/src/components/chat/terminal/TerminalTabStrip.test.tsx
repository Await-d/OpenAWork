// @vitest-environment jsdom
/**
 * 终端 tab 条：标签优先级、激活态、单击选中、双击重命名、关闭 ×、
 * 重命名输入框的提交 / 取消 / 失焦提交、空态文案、右键 / 键盘菜单上报。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { TerminalTabStrip } from './TerminalTabStrip.js';

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

function renderStrip(overrides: Partial<React.ComponentProps<typeof TerminalTabStrip>> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onStartRename: vi.fn(),
    onRenameValueChange: vi.fn(),
    onCommitRename: vi.fn(),
    onCancelRename: vi.fn(),
    onClose: vi.fn(),
  };
  const props: React.ComponentProps<typeof TerminalTabStrip> = {
    terminals: [makeTerminal()],
    activeId: 'terminal-1',
    renamingId: null,
    renameValue: '',
    ...handlers,
    ...overrides,
  };
  const view = render(<TerminalTabStrip {...props} />);
  return { ...handlers, view };
}

describe('TerminalTabStrip', () => {
  it('空列表展示空态文案', () => {
    renderStrip({ terminals: [], activeId: null });

    expect(screen.getByText('暂无运行中的终端 · 点击 ＋ 新建')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('标签优先级：自定义名 > 描述 > 终端 N > 命令前三个词', () => {
    renderStrip({
      terminals: [
        makeTerminal({ terminalId: 'named', name: '构建产物' }),
        makeTerminal({
          terminalId: 'described',
          toolName: 'bash',
          command: 'npm run build',
          description: '安装依赖',
        }),
        makeTerminal({ terminalId: 'plain', toolName: 'quick_terminal', command: 'bash' }),
        makeTerminal({ terminalId: 'command', toolName: 'bash', command: 'npm run dev -- --host' }),
      ],
      activeId: 'named',
    });

    expect(screen.getByRole('button', { name: '构建产物' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '安装依赖' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '终端 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'npm run dev' })).toBeTruthy();
  });

  it('激活 tab 暴露 data-active 与 aria-current，单击回调选中', () => {
    const { onSelect } = renderStrip();

    const tab = screen.getByTestId('terminal-tab-terminal-1');
    expect(tab.getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: '终端 1' }).getAttribute('aria-current')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: '终端 1' }));
    expect(onSelect).toHaveBeenCalledWith('terminal-1');
  });

  it('双击进入行内重命名，并带上当前标签', () => {
    const { onStartRename } = renderStrip();

    fireEvent.doubleClick(screen.getByRole('button', { name: '终端 1' }));

    expect(onStartRename).toHaveBeenCalledWith('terminal-1', '终端 1');
  });

  it('关闭 × 带可区分的名称并回调关闭', () => {
    const { onClose } = renderStrip();

    fireEvent.click(screen.getByRole('button', { name: '关闭终端 终端 1' }));

    expect(onClose).toHaveBeenCalledWith('terminal-1');
  });

  it('重命名输入框自动聚焦并全选，输入 / Enter / Escape 各自回调', () => {
    const { onRenameValueChange, onCommitRename, onCancelRename } = renderStrip({
      renamingId: 'terminal-1',
      renameValue: '终端 1',
    });

    const input = screen.getByRole('textbox', { name: '重命名终端' }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('终端 1');

    fireEvent.change(input, { target: { value: 'dev server' } });
    expect(onRenameValueChange).toHaveBeenCalledWith('dev server');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommitRename).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancelRename).toHaveBeenCalledTimes(1);
  });

  it('失焦即提交重命名', () => {
    const { onCommitRename } = renderStrip({
      renamingId: 'terminal-1',
      renameValue: '终端 1',
    });

    fireEvent.blur(screen.getByRole('textbox', { name: '重命名终端' }));

    expect(onCommitRename).toHaveBeenCalledTimes(1);
  });
});

describe('tab 右键 / 键盘菜单入口', () => {
  /** 键盘锚点来自 tab 矩形；jsdom 一律返回 0，这里给出非零值以便断言位置。 */
  function stubTabRect(tab: HTMLElement): void {
    const rect = {
      x: 30,
      y: 30,
      width: 96,
      height: 22,
      top: 30,
      left: 30,
      right: 126,
      bottom: 52,
      toJSON: () => ({}),
    } as DOMRect;
    tab.getBoundingClientRect = () => rect;
  }

  it('右键 tab：拦截原生菜单并上报 terminalId 与 client 坐标', () => {
    const onTabContextMenu = vi.fn();
    renderStrip({ onTabContextMenu });

    const notPrevented = fireEvent.contextMenu(screen.getByTestId('terminal-tab-terminal-1'), {
      clientX: 120,
      clientY: 48,
    });

    expect(notPrevented).toBe(false);
    expect(onTabContextMenu).toHaveBeenCalledWith('terminal-1', { x: 120, y: 48 });
  });

  it('未接入 onTabContextMenu：不拦截原生菜单（与今日行为一致）', () => {
    renderStrip();

    const notPrevented = fireEvent.contextMenu(screen.getByTestId('terminal-tab-terminal-1'));

    expect(notPrevented).toBe(true);
  });

  it('行内重命名期间：输入框的原生编辑菜单优先，不上报', () => {
    const onTabContextMenu = vi.fn();
    renderStrip({ renamingId: 'terminal-1', renameValue: '终端 1', onTabContextMenu });

    const notPrevented = fireEvent.contextMenu(screen.getByRole('textbox', { name: '重命名终端' }));

    expect(notPrevented).toBe(true);
    expect(onTabContextMenu).not.toHaveBeenCalled();
  });

  it('Shift+F10 / ContextMenu 键：以 tab 矩形为锚点上报同一入口', () => {
    const onTabContextMenu = vi.fn();
    renderStrip({ onTabContextMenu });
    const tab = screen.getByTestId('terminal-tab-terminal-1');
    stubTabRect(tab);

    fireEvent.keyDown(tab, { key: 'F10', shiftKey: true });
    expect(onTabContextMenu).toHaveBeenCalledWith('terminal-1', { x: 30, y: 52 });

    onTabContextMenu.mockClear();
    fireEvent.keyDown(tab, { key: 'ContextMenu' });
    expect(onTabContextMenu).toHaveBeenCalledWith('terminal-1', { x: 30, y: 52 });
  });

  it('单独按 F10（无 Shift）不触发菜单', () => {
    const onTabContextMenu = vi.fn();
    renderStrip({ onTabContextMenu });

    fireEvent.keyDown(screen.getByTestId('terminal-tab-terminal-1'), { key: 'F10' });

    expect(onTabContextMenu).not.toHaveBeenCalled();
  });
});
