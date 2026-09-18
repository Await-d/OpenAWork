// @vitest-environment jsdom
/**
 * 端口页自动刷新（T-13，TASK 2；P0 手动刷新 / 暂停）：
 *  - 可见时按 `PORTS_POLL_INTERVAL_MS` 轮询；不可见即停（切页签 = 面板卸载，标签页隐藏 =
 *    `visibilitychange`），恢复可见立刻拉一次；
 *  - 单飞：在途请求未回来不发新请求（可见性恢复的重复触发被吞掉）；
 *  - 失败 → error 态 + **停止**轮询；用户「重试」成功后恢复轮询；
 *  - 轮询静默（不闪回 loading）；「更新于 N 秒前」只更新文案、不重新请求；
 *  - 卸载清定时器与监听。
 *  - P0：「刷新」立刻静默取数并让下一拍从完成后重新计时；「暂停 / 继续」停 / 续自动轮询
 *    （继续从当下重新计时，不立刻拉一次）；暂停不影响在途请求收尾，也不拦手动刷新。
 *
 * 网关客户端整体换成替身（仓库规定：apps 内不得直接 fetch 网关端点，必须走 web-client；
 * 这里 mock 的正是那一层，消费端接线仍被完整覆盖）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ListeningPortsSnapshotView, ListeningPortView } from '@openAwork/web-client';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

const portsClient = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createListeningPortsClient: () => ({ list: portsClient.list }),
  };
});

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

const { TerminalPortsPanel } = await import('./TerminalPortsPanel.js');
const { QuickTerminalPanel } = await import('./QuickTerminalPanel.js');
const { PORTS_POLL_INTERVAL_MS } = await import('./use-terminal-ports-feed.js');

const GATEWAY = 'http://127.0.0.1:3000';
const TOKEN = 'token-1';

function makePort(overrides: Partial<ListeningPortView> = {}): ListeningPortView {
  return {
    port: 3000,
    protocol: 'tcp',
    bindAddress: '127.0.0.1',
    pid: 1234,
    processName: 'node',
    source: 'procfs',
    establishedConnections: 0,
    processAlive: true,
    terminal: null,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ListeningPortsSnapshotView> = {},
): ListeningPortsSnapshotView {
  return {
    ports: [makePort()],
    strategy: 'procfs',
    attributionSupported: true,
    collectedAtMs: Date.now(),
    ...overrides,
  };
}

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

/** 推进假定时器，并让已 resolve 的 Promise 回调跑完（状态更新都发生在微任务里）。 */
async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setDocumentVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function renderPortsPanel() {
  return render(<TerminalPortsPanel gatewayUrl={GATEWAY} token={TOKEN} />);
}

function renderQuickPanel() {
  return render(
    <QuickTerminalPanel
      open
      onRequestClose={vi.fn()}
      workspacePath="/workspace"
      gatewayUrl={GATEWAY}
      token={TOKEN}
      sessionId="session-1"
      terminals={[makeTerminal()]}
      loading={false}
      onReload={vi.fn()}
      onRenameTerminal={vi.fn(async () => undefined)}
      onDismissTerminal={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T10:00:00.000Z'));
  portsClient.list.mockResolvedValue(makeSnapshot());
  useUIStateStore.setState({
    lastChatPath: null,
    terminalLayoutBySession: {},
    quickTerminalActiveIdByWorkspace: {},
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
  useUIStateStore.setState({
    lastChatPath: null,
    terminalLayoutBySession: {},
    quickTerminalActiveIdByWorkspace: {},
  });
});

describe('TerminalPortsPanel：可见时轮询', () => {
  it('挂载取数一次，之后每 5s 拉一次', async () => {
    renderPortsPanel();

    await flush();
    expect(portsClient.list).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('terminal-ports-table')).toBeTruthy();

    await flush(PORTS_POLL_INTERVAL_MS);
    expect(portsClient.list).toHaveBeenCalledTimes(2);

    await flush(PORTS_POLL_INTERVAL_MS);
    expect(portsClient.list).toHaveBeenCalledTimes(3);
  });

  it('轮询刷新是静默的：不闪回 loading，列表一直在', async () => {
    renderPortsPanel();
    await flush();

    await flush(PORTS_POLL_INTERVAL_MS);

    expect(screen.queryByTestId('terminal-ports-loading')).toBeNull();
    expect(screen.getByTestId('terminal-ports-table')).toBeTruthy();
    expect(portsClient.list).toHaveBeenCalledTimes(2);
  });

  it('document 隐藏时暂停轮询，恢复可见时立刻拉一次', async () => {
    renderPortsPanel();
    await flush();
    await flush(PORTS_POLL_INTERVAL_MS);
    expect(portsClient.list).toHaveBeenCalledTimes(2);

    setDocumentVisibility('hidden');
    await flush(PORTS_POLL_INTERVAL_MS * 3);
    expect(portsClient.list).toHaveBeenCalledTimes(2);

    setDocumentVisibility('visible');
    await flush();
    expect(portsClient.list).toHaveBeenCalledTimes(3);
  });

  it('单飞：在途请求未回来时，重复的「恢复可见」不产生并发请求', async () => {
    portsClient.list.mockReturnValue(new Promise<ListeningPortsSnapshotView>(() => undefined));
    renderPortsPanel();
    await flush();
    expect(portsClient.list).toHaveBeenCalledTimes(1);

    setDocumentVisibility('visible');
    setDocumentVisibility('visible');
    await flush(PORTS_POLL_INTERVAL_MS);

    expect(portsClient.list).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('terminal-ports-loading')).toBeTruthy();
  });

  it('失败：进入 error 态并停止轮询；「重试」成功后恢复轮询', async () => {
    portsClient.list
      .mockRejectedValueOnce(new Error('网络异常，读取监听端口失败。'))
      .mockResolvedValue(makeSnapshot());
    renderPortsPanel();

    await flush();
    expect(screen.getByTestId('terminal-ports-error')).toBeTruthy();
    expect(screen.getByText('网络异常，读取监听端口失败。')).toBeTruthy();

    // 失败闩锁：不再 5s 一次地打失败接口。
    await flush(PORTS_POLL_INTERVAL_MS * 3);
    expect(portsClient.list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await flush();
    expect(screen.getByTestId('terminal-ports-table')).toBeTruthy();
    expect(portsClient.list).toHaveBeenCalledTimes(2);

    await flush(PORTS_POLL_INTERVAL_MS);
    expect(portsClient.list).toHaveBeenCalledTimes(3);
  });

  it('卸载：清掉定时器与 visibilitychange 监听，不再发起请求', async () => {
    const view = renderPortsPanel();
    await flush();
    await flush(PORTS_POLL_INTERVAL_MS);
    expect(portsClient.list).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);

    await flush(PORTS_POLL_INTERVAL_MS * 3);
    expect(portsClient.list).toHaveBeenCalledTimes(2);
  });

  it('「更新于 N 秒前」每秒只改文案，不触发新请求', async () => {
    renderPortsPanel();
    await flush();

    expect(screen.getByTestId('terminal-ports-age').textContent).toBe('刚刚更新');

    await flush(3_000);
    expect(screen.getByTestId('terminal-ports-age').textContent).toBe('更新于 3 秒前');
    expect(portsClient.list).toHaveBeenCalledTimes(1);
  });
});

describe('QuickTerminalPanel：「端口」页签可见性', () => {
  it('切到「终端」页签后停止请求，切回「端口」页签立刻恢复', async () => {
    renderQuickPanel();

    fireEvent.click(screen.getByRole('tab', { name: '端口' }));
    await flush();
    expect(portsClient.list).toHaveBeenCalledTimes(1);

    await flush(PORTS_POLL_INTERVAL_MS);
    expect(portsClient.list).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('tab', { name: '终端' }));
    expect(screen.queryByTestId('terminal-ports-panel')).toBeNull();
    await flush(PORTS_POLL_INTERVAL_MS * 3);
    expect(portsClient.list).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('tab', { name: '端口' }));
    await flush();
    expect(portsClient.list).toHaveBeenCalledTimes(3);
  });
});

describe('TerminalPortsPanel：P0 手动刷新 / 暂停', () => {
  it('「刷新」立刻静默取数：不闪回 loading，下一拍从本次完成后重新计时', async () => {
    renderPortsPanel();
    await flush();
    expect(portsClient.list).toHaveBeenCalledTimes(1);

    // 走到距下一拍还剩 2s 的位置再刷新：倒计时若没被重置，2s 后就会开火。
    await flush(PORTS_POLL_INTERVAL_MS - 2_000);
    fireEvent.click(screen.getByTestId('terminal-ports-refresh'));
    await flush();
    expect(portsClient.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('terminal-ports-loading')).toBeNull();

    await flush(2_000);
    expect(portsClient.list).toHaveBeenCalledTimes(2);

    await flush(PORTS_POLL_INTERVAL_MS - 2_000);
    expect(portsClient.list).toHaveBeenCalledTimes(3);
  });

  it('「暂停」停止轮询；「继续」从当下重新计时，不立刻拉一次', async () => {
    renderPortsPanel();
    await flush();
    expect(portsClient.list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('terminal-ports-pause'));
    await flush(PORTS_POLL_INTERVAL_MS * 3);
    expect(portsClient.list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('terminal-ports-pause'));
    await flush(0);
    expect(portsClient.list).toHaveBeenCalledTimes(1);

    await flush(PORTS_POLL_INTERVAL_MS);
    expect(portsClient.list).toHaveBeenCalledTimes(2);
  });

  it('暂停不影响在途请求：响应照常收尾更新列表，之后不再排下一拍', async () => {
    renderPortsPanel();
    await flush();
    expect(portsClient.list).toHaveBeenCalledTimes(1);

    // 第二拍（自动轮询）挂起，模拟慢响应。
    let resolveSecond!: (snapshot: ListeningPortsSnapshotView) => void;
    portsClient.list.mockReturnValueOnce(
      new Promise<ListeningPortsSnapshotView>((resolve) => {
        resolveSecond = resolve;
      }),
    );
    await flush(PORTS_POLL_INTERVAL_MS);
    expect(portsClient.list).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('terminal-ports-pause'));
    resolveSecond(makeSnapshot({ ports: [makePort({ port: 4000, processName: 'gunicorn' })] }));
    await flush();

    // 在途响应照常落地（暂停只停「下一拍」，不丢在途结果）。
    expect(screen.getByTestId('terminal-ports-row-4000')).toBeTruthy();

    await flush(PORTS_POLL_INTERVAL_MS * 3);
    expect(portsClient.list).toHaveBeenCalledTimes(2);
  });

  it('暂停期间「刷新」仍可用：立刻静默取数，且不会顺带复活自动轮询', async () => {
    renderPortsPanel();
    await flush();
    fireEvent.click(screen.getByTestId('terminal-ports-pause'));
    await flush(PORTS_POLL_INTERVAL_MS * 2);
    expect(portsClient.list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('terminal-ports-refresh'));
    await flush();
    expect(portsClient.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('terminal-ports-loading')).toBeNull();

    await flush(PORTS_POLL_INTERVAL_MS * 3);
    expect(portsClient.list).toHaveBeenCalledTimes(2);
  });
});
