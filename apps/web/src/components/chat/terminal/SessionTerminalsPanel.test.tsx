// @vitest-environment jsdom
/**
 * Smoke coverage for the chat-page session terminals panel.
 *
 * We verify three contract points:
 *
 *   1. Active rows (status='running') render a 终止 button; closed rows do not.
 *   2. Clicking 终止 invokes the kill handler with the right terminalId.
 *   3. Clicking 详情 expands the inline output preview so the user can
 *      eyeball stdout/stderr without leaving the chat.
 *
 * The panel itself is presentational (state is owned by useSessionTerminals
 * via ChatPage), so we render with hand-crafted props to keep the test
 * focused on UI behaviour.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { SessionTerminalsPanel } from './SessionTerminalsPanel.js';

// xterm.js relies on browser-only APIs (matchMedia, canvas) that jsdom
// doesn't fully provide. Stub the interactive view with a placeholder so
// the smoke test stays focused on the panel chrome.
vi.mock('./InteractiveTerminalView.js', () => ({
  InteractiveTerminalView: (props: { terminal: { outputTail: string } }) => (
    <div data-testid="terminal-view-mock">{props.terminal.outputTail}</div>
  ),
}));

function makeTerminal(overrides: Partial<SessionTerminalView>): SessionTerminalView {
  return {
    terminalId: 'term_default',
    sessionId: 'session-1',
    toolName: 'bash',
    kind: 'foreground',
    command: 'echo hi',
    cwd: '/tmp',
    status: 'running',
    startedAtMs: 1_700_000_000_000,
    lastActivityMs: 1_700_000_000_500,
    outputBytesTotal: 0,
    outputTail: '',
    ...overrides,
  };
}

const baseProps = {
  open: true,
  onClose: () => {},
  loading: false,
  error: null,
  pendingKillIds: new Set<string>(),
  onReload: () => {},
  gatewayUrl: 'https://gateway.test',
  token: 'test-token',
  sessionId: 'session-1',
};

describe('SessionTerminalsPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders 终止 button for running terminals only', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={[
          makeTerminal({ terminalId: 'term_running', status: 'running' }),
          makeTerminal({
            terminalId: 'term_done',
            status: 'exited',
            exitCode: 0,
            command: 'echo done',
          }),
        ]}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    const killButtons = screen.queryAllByRole('button', { name: '终止' });
    expect(killButtons.length).toBe(1);

    // Closed rows expose 清理 (delete) instead of 终止.
    const cleanupButtons = screen.queryAllByRole('button', { name: '清理' });
    expect(cleanupButtons.length).toBe(1);
  });

  it('clicking 终止 calls onKillTerminal with the right terminalId', () => {
    const onKill = vi.fn(async () => {});
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={[makeTerminal({ terminalId: 'term_kill_me', status: 'running' })]}
        onKillTerminal={onKill}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '终止' }));
    expect(onKill).toHaveBeenCalledWith('term_kill_me');
  });

  it('terminating button is disabled while a kill is in flight', () => {
    const pending = new Set<string>(['term_kill_me']);
    render(
      <SessionTerminalsPanel
        {...baseProps}
        pendingKillIds={pending}
        terminals={[makeTerminal({ terminalId: 'term_kill_me', status: 'running' })]}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );
    const button = screen.getByRole('button', { name: '终止中…' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('clicking 详情 expands the output preview', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={[
          makeTerminal({
            terminalId: 'term_with_output',
            status: 'exited',
            exitCode: 0,
            outputTail: 'first stdout line\nsecond line',
            outputBytesTotal: 32,
          }),
        ]}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryByText(/first stdout line/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(screen.getByText(/first stdout line/)).toBeTruthy();
  });

  it('renders empty-state copy when there are no terminals', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={[]}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );
    expect(screen.getByText(/还没有跑过终端命令/)).toBeTruthy();
  });
});

/**
 * 筛选 / 批量处置覆盖。
 *
 * 会话终端多起来之后（一个长会话几十条记录），逐行点终止或清理是不现实
 * 的。这里锁定两件事：筛选能收敛列表，批量按钮能一次命中所有目标。
 */
const twoRunningAndOneClosed = [
  makeTerminal({ terminalId: 'term_dev', status: 'running', command: 'npm run dev' }),
  makeTerminal({ terminalId: 'term_test', status: 'running', command: 'vitest run' }),
  makeTerminal({
    terminalId: 'term_done',
    status: 'exited',
    command: 'pnpm build',
    exitCode: 0,
  }),
];

describe('SessionTerminalsPanel 筛选与批量', () => {
  afterEach(() => {
    cleanup();
  });

  it('按状态筛选后只保留对应行', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryAllByRole('button', { name: '终止' }).length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: '运行中 2' }));

    expect(screen.queryAllByRole('button', { name: '终止' }).length).toBe(2);
    expect(screen.queryByRole('button', { name: '清理' })).toBeNull();
  });

  it('按命令关键字过滤', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    fireEvent.change(screen.getByLabelText('按命令或目录过滤终端'), {
      target: { value: 'vitest' },
    });

    expect(screen.getByText('vitest run')).toBeTruthy();
    expect(screen.queryByText('npm run dev')).toBeNull();
    expect(screen.queryAllByRole('button', { name: '终止' }).length).toBe(1);
  });

  it('无匹配时给出清除筛选入口', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    fireEvent.change(screen.getByLabelText('按命令或目录过滤终端'), {
      target: { value: 'no-such-command' },
    });
    expect(screen.getByText('没有符合当前筛选条件的终端。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByText('npm run dev')).toBeTruthy();
  });

  it('批量终止会对每个运行中终端各调用一次', async () => {
    const onKill = vi.fn(async () => {});
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        onKillTerminal={onKill}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /终止全部运行中/ }));

    await waitFor(() => expect(onKill).toHaveBeenCalledTimes(2));
    expect(onKill).toHaveBeenCalledWith('term_dev');
    expect(onKill).toHaveBeenCalledWith('term_test');
  });

  it('筛选后批量按钮只作用于可见行', async () => {
    const onKill = vi.fn(async () => {});
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        onKillTerminal={onKill}
      />,
    );

    fireEvent.change(screen.getByLabelText('按命令或目录过滤终端'), {
      target: { value: 'npm run dev' },
    });
    fireEvent.click(screen.getByRole('button', { name: /终止全部运行中/ }));

    await waitFor(() => expect(onKill).toHaveBeenCalledTimes(1));
    expect(onKill).toHaveBeenCalledWith('term_dev');
  });

  it('展示同步状态文案', () => {
    render(
      <SessionTerminalsPanel
        {...baseProps}
        terminals={twoRunningAndOneClosed}
        lastSyncedAtMs={Date.now()}
        onKillTerminal={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText('刚刚同步')).toBeTruthy();
  });
});
