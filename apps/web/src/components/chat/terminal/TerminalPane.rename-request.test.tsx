// @vitest-environment jsdom
/**
 * 内容区右键「重命名」的**请求通道**（TerminalLayoutContext.renameRequest）：
 *  - 请求由目标 pane 消费，并接入 pane 既有的行内重命名（预填与 ⋯ / 双击同一套 label 推导）；
 *  - 消费后清空，避免同一请求重复生效；
 *  - 其他 pane 不消费不属于自己的请求（不抢请求），终端不存在时保持待处理。
 *
 * xterm 本体不在场：InteractiveTerminalView 被替换为「渲染 menuItems 按钮」的替身，
 * 这里验证的是 pane → 请求 → effect → startRename 的接线语义。
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
import type { TerminalContextMenuItem } from './TerminalContextMenu.js';

interface MockInteractiveTerminalViewProps {
  terminal: SessionTerminalView;
  menuItems?: TerminalContextMenuItem[];
}

vi.mock('./InteractiveTerminalView.js', () => ({
  InteractiveTerminalView: ({ terminal, menuItems }: MockInteractiveTerminalViewProps) => (
    <div data-testid={`terminal-view-${terminal.terminalId}`}>
      {(menuItems ?? []).map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid={`terminal-menu-${item.id}`}
          disabled={item.disabled}
          title={item.title}
          onClick={item.onSelect}
        >
          {item.label}
        </button>
      ))}
    </div>
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

function renderHarness(options: { activeTerminalId?: string } = {}) {
  const actions = makeActions();
  const activeTerminalId = options.activeTerminalId ?? 't1';
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
      requestRename: (paneId, terminalId) => setRenameRequest({ paneId, terminalId }),
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
          <TerminalPane paneId="p1" terminals={terminals} activeTerminalId={activeTerminalId} />
          <TerminalPane
            paneId="p2"
            terminals={[makeTerminal({ terminalId: 't3' })]}
            activeTerminalId="t3"
          />
          {/* 探针：请求是否仍待处理（消费后应变为 none）。 */}
          <span data-testid="pending-request">
            {renameRequest === null
              ? 'none'
              : `${renameRequest.paneId}:${renameRequest.terminalId}`}
          </span>
          <button
            type="button"
            data-testid="request-p2-t3"
            onClick={() => context.requestRename('p2', 't3')}
          >
            请求 p2 重命名
          </button>
          <button
            type="button"
            data-testid="request-p1-missing"
            onClick={() => context.requestRename('p1', 't-missing')}
          >
            请求不存在的终端
          </button>
        </TerminalLayoutContext>
      </div>
    );
  }

  render(<Harness />);
  return { actions };
}

afterEach(() => {
  cleanup();
});

describe('内容区右键「重命名」请求通道', () => {
  it('本 pane 的请求进入既有行内重命名并预填 tab label，随后请求被清空', () => {
    renderHarness();
    const pane1 = screen.getByTestId('terminal-pane-p1');

    fireEvent.click(within(pane1).getByTestId('terminal-menu-terminal-rename'));

    const input = within(pane1).getByRole('textbox', { name: '重命名终端' });
    expect((input as HTMLInputElement).value).toBe('终端 1');
    expect(screen.getByTestId('pending-request').textContent).toBe('none');
  });

  it('请求属于其他 pane：本 pane 不进入重命名，由目标 pane 消费', () => {
    renderHarness();

    fireEvent.click(screen.getByTestId('request-p2-t3'));

    const pane1 = screen.getByTestId('terminal-pane-p1');
    const pane2 = screen.getByTestId('terminal-pane-p2');
    expect(within(pane1).queryByRole('textbox', { name: '重命名终端' })).toBeNull();
    const input = within(pane2).getByRole('textbox', { name: '重命名终端' });
    expect((input as HTMLInputElement).value).toBe('终端 1');
    expect(screen.getByTestId('pending-request').textContent).toBe('none');
  });

  it('请求的终端不在本 pane：不消费、不进入重命名，请求保持待处理', () => {
    renderHarness();
    const pane1 = screen.getByTestId('terminal-pane-p1');

    fireEvent.click(screen.getByTestId('request-p1-missing'));

    expect(within(pane1).queryByRole('textbox', { name: '重命名终端' })).toBeNull();
    expect(screen.getByTestId('pending-request').textContent).toBe('p1:t-missing');
  });

  it('自定义名终端按 name 预填（与 tab 显示一致）', () => {
    renderHarness({ activeTerminalId: 't2' });
    const pane1 = screen.getByTestId('terminal-pane-p1');

    fireEvent.click(within(pane1).getByTestId('terminal-menu-terminal-rename'));

    const input = within(pane1).getByRole('textbox', { name: '重命名终端' });
    expect((input as HTMLInputElement).value).toBe('构建');
  });

  it('命令段每一项都接到 pane 的真实动作上', () => {
    const { actions } = renderHarness();
    const pane1 = screen.getByTestId('terminal-pane-p1');
    const click = (id: string) => {
      fireEvent.click(within(pane1).getByTestId(`terminal-menu-${id}`));
    };

    click('terminal-new');
    expect(actions.createTerminal).toHaveBeenCalledWith('p1');

    click('terminal-split-column');
    expect(actions.splitPane).toHaveBeenCalledWith('p1', 'column');

    click('terminal-kill');
    expect(actions.killTerminal).toHaveBeenCalledWith('t1');
    expect(actions.closeTerminal).not.toHaveBeenCalled();

    click('terminal-close-others');
    expect(actions.closeTerminals).toHaveBeenCalledWith(['t2']);

    click('terminal-close-all');
    expect(actions.closeAllTerminals).toHaveBeenCalledTimes(1);
  });
});
