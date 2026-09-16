// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalPanel } from './TerminalPanel.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import type { SessionTerminalView } from '../../../components/conversation-runtime/terminals/terminals-api.js';

vi.mock('../../../components/chat/terminal/QuickTerminalPanel.js', () => ({
  QuickTerminalPanel: (props: {
    readonly height?: number;
    readonly onRequestClose: () => void;
    readonly open: boolean;
    readonly presentation?: 'overlay' | 'inline';
    readonly sessionId: string | null;
    readonly terminals: readonly SessionTerminalView[];
  }) => (
    <section
      aria-label="快捷终端面板 mock"
      data-height={props.height}
      data-open={String(props.open)}
      data-presentation={props.presentation}
      data-session-id={props.sessionId ?? ''}
      data-terminal-count={props.terminals.length}
    >
      <button type="button" onClick={props.onRequestClose}>
        mock close
      </button>
    </section>
  ),
}));

function makeTerminal(overrides: Partial<SessionTerminalView>): SessionTerminalView {
  return {
    terminalId: 'terminal-default',
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

const DEFAULT_PROPS = {
  workspacePath: '/home/await/project/OpenAWork',
  gatewayUrl: 'https://gateway.test',
  token: 'test-token',
  sessionId: 'session-1',
  terminals: [] as SessionTerminalView[],
  loading: false,
  onReload: () => undefined,
} as const;

function resetUiState(): void {
  useUIStateStore.setState({
    terminalPanelHeight: 260,
    terminalPanelOpened: false,
  });
}

beforeEach(() => {
  cleanup();
  resetUiState();
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe('TerminalPanel', () => {
  it('折叠态展示终端入口和活跃终端数量', () => {
    render(
      <TerminalPanel
        {...DEFAULT_PROPS}
        terminals={[
          makeTerminal({ terminalId: 'terminal-running', status: 'running' }),
          makeTerminal({ terminalId: 'terminal-idle', status: 'idle' }),
          makeTerminal({ terminalId: 'terminal-tmux', status: 'tmux-spawned' }),
          makeTerminal({ terminalId: 'terminal-exited', status: 'exited' }),
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: '展开终端面板' })).toBeTruthy();
    expect(screen.getByText('终端')).toBeTruthy();
    expect(screen.getByText('3 个运行中 · Gateway ready · gateway.test')).toBeTruthy();
  });

  it('点击折叠态入口后展开全局终端面板', () => {
    render(<TerminalPanel {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByRole('button', { name: '展开终端面板' }));

    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
  });

  it('展开态复用 inline QuickTerminalPanel 并传入 fusion 高度', () => {
    useUIStateStore.setState({
      terminalPanelHeight: 312,
      terminalPanelOpened: true,
    });

    render(
      <TerminalPanel
        {...DEFAULT_PROPS}
        terminals={[makeTerminal({ terminalId: 'terminal-active', status: 'running' })]}
      />,
    );

    const panel = screen.getByLabelText('快捷终端面板 mock');
    expect(panel.getAttribute('data-open')).toBe('true');
    expect(panel.getAttribute('data-presentation')).toBe('inline');
    expect(panel.getAttribute('data-height')).toBe('312');
    expect(panel.getAttribute('data-session-id')).toBe('session-1');
    expect(panel.getAttribute('data-terminal-count')).toBe('1');
  });

  it('QuickTerminalPanel 请求关闭时收起 fusion 终端面板', () => {
    useUIStateStore.setState({
      terminalPanelOpened: true,
    });
    render(<TerminalPanel {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByRole('button', { name: 'mock close' }));

    expect(useUIStateStore.getState().terminalPanelOpened).toBe(false);
  });

  it('最后一个活跃终端结束后自动收起 fusion 终端面板', async () => {
    useUIStateStore.setState({
      terminalPanelOpened: true,
    });

    const exitedTerminals = (): SessionTerminalView[] => [
      makeTerminal({ terminalId: 'terminal-active', status: 'exited' }),
    ];

    const { rerender } = render(
      <TerminalPanel
        {...DEFAULT_PROPS}
        terminals={[makeTerminal({ terminalId: 'terminal-active', status: 'running' })]}
      />,
    );

    // 第一次归零只写入待确认标记（防上游虚假瞬时 0），抽屉此时保持展开。
    rerender(<TerminalPanel {...DEFAULT_PROPS} terminals={exitedTerminals()} />);
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);

    // 下一次完整 sync 仍为 0 → 确认归零 → 正常收起。
    rerender(<TerminalPanel {...DEFAULT_PROPS} terminals={exitedTerminals()} />);

    await waitFor(() => {
      expect(useUIStateStore.getState().terminalPanelOpened).toBe(false);
    });
  });

  it('瞬时 0 不触发自动收起（D-1 防抖回归：2 → 0 → 2）', () => {
    useUIStateStore.setState({
      terminalPanelOpened: true,
    });

    const runningTerminals = (): SessionTerminalView[] => [
      makeTerminal({ terminalId: 'terminal-a', status: 'running' }),
      makeTerminal({ terminalId: 'terminal-b', status: 'running' }),
    ];

    const { rerender } = render(
      <TerminalPanel {...DEFAULT_PROPS} terminals={runningTerminals()} />,
    );

    // 上游 reload 清空本地快照造成虚假瞬时 0：第一次归零只记录待确认、不收起。
    rerender(<TerminalPanel {...DEFAULT_PROPS} terminals={[]} />);
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
    expect(screen.getByLabelText('快捷终端面板 mock')).toBeTruthy();

    // 下一次 sync 恢复真实快照：待确认被撤销，抽屉保持展开。
    rerender(<TerminalPanel {...DEFAULT_PROPS} terminals={runningTerminals()} />);
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
    expect(screen.getByLabelText('快捷终端面板 mock')).toBeTruthy();
  });

  it('归零需连续两次采样确认（持续 0）才自动收起', async () => {
    useUIStateStore.setState({
      terminalPanelOpened: true,
    });

    const exitedTerminals = (): SessionTerminalView[] => [
      makeTerminal({ terminalId: 'terminal-active', status: 'exited' }),
    ];

    const { rerender } = render(
      <TerminalPanel
        {...DEFAULT_PROPS}
        terminals={[makeTerminal({ terminalId: 'terminal-active', status: 'running' })]}
      />,
    );

    // 第一次采样归零：只记录待确认，抽屉保持展开。
    rerender(<TerminalPanel {...DEFAULT_PROPS} terminals={exitedTerminals()} />);
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);

    // 第二次采样仍为 0：归零被确认，正常收起。
    rerender(<TerminalPanel {...DEFAULT_PROPS} terminals={exitedTerminals()} />);

    await waitFor(() => {
      expect(useUIStateStore.getState().terminalPanelOpened).toBe(false);
    });
  });
});
