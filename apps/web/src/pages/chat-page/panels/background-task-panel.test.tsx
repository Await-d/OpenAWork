// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { BackgroundTaskRow } from './background-task-model.js';
import type { BackgroundTaskPanelModel } from './use-background-task-panel.js';
import { BackgroundTaskPanel } from './background-task-panel.js';

const FIXED_NOW_MS = 1_700_000_000_000;
const CHILD_SESSION_ID = 'sess-1234-5678-90ab';
const TERMINAL_ID = 'term-9f3c';

type PanelProps = Parameters<typeof BackgroundTaskPanel>[0];

function subagentRow(overrides: Partial<BackgroundTaskRow> = {}): BackgroundTaskRow {
  return {
    key: 'T-abc12345',
    kind: 'subagent',
    state: 'running',
    title: '梳理右栏面板结构',
    detail: '@explorer',
    taskId: 'T-abc12345',
    sessionId: CHILD_SESSION_ID,
    agent: 'explorer',
    startedAtMs: FIXED_NOW_MS - 12_000,
    ...overrides,
  };
}

function shellRow(overrides: Partial<BackgroundTaskRow> = {}): BackgroundTaskRow {
  return {
    key: TERMINAL_ID,
    kind: 'shell',
    state: 'running',
    title: 'npm run dev',
    command: 'npm run dev',
    detail: '/home/await/project/OpenAWork',
    cwd: '/home/await/project/OpenAWork',
    terminalId: TERMINAL_ID,
    outputBytesTotal: 1_200,
    startedAtMs: FIXED_NOW_MS - 45_000,
    ...overrides,
  };
}

function makeModel(overrides: Partial<BackgroundTaskPanelModel> = {}): BackgroundTaskPanelModel {
  return {
    rows: [],
    summary: { runningSubagents: 0, runningShells: 0, activeTotal: 0 },
    now: FIXED_NOW_MS,
    ...overrides,
  };
}

function modelWithRows(rows: BackgroundTaskRow[]): BackgroundTaskPanelModel {
  const runningSubagents = rows.filter(
    (row) => row.kind === 'subagent' && row.state === 'running',
  ).length;
  const runningShells = rows.filter(
    (row) => row.kind === 'shell' && row.state === 'running',
  ).length;
  return makeModel({
    rows,
    summary: {
      runningSubagents,
      runningShells,
      activeTotal: runningSubagents + runningShells,
    },
  });
}

function makeProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    model: makeModel(),
    loading: false,
    error: null,
    lastSyncedAtMs: FIXED_NOW_MS,
    stoppingSubAgentIds: new Set<string>(),
    pendingKillIds: new Set<string>(),
    onReloadTerminals: vi.fn(),
    onOpenSession: vi.fn(),
    onStopSubagent: vi.fn(),
    onStopAllSubagents: vi.fn(),
    onPreviewTerminal: vi.fn(),
    onKillTerminal: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BackgroundTaskPanel · 汇总条', () => {
  it('展示两个计数，且仅在存在运行中子代理时显示「全部停止子代理」', () => {
    const { rerender } = render(
      <BackgroundTaskPanel
        {...makeProps({
          model: makeModel({
            summary: { runningSubagents: 0, runningShells: 2, activeTotal: 2 },
          }),
        })}
      />,
    );

    expect(screen.getByTestId('background-task-summary-counts').textContent).toBe(
      '0 个子代理运行中 · 2 个后台命令',
    );
    expect(screen.queryByTestId('background-task-stop-all')).toBeNull();

    rerender(
      <BackgroundTaskPanel
        {...makeProps({
          model: makeModel({
            summary: { runningSubagents: 3, runningShells: 2, activeTotal: 5 },
          }),
        })}
      />,
    );

    expect(screen.getByTestId('background-task-summary-counts').textContent).toBe(
      '3 个子代理运行中 · 2 个后台命令',
    );
    expect(screen.getByTestId('background-task-stop-all')).toBeTruthy();
  });

  it('同步时间缺省显示「尚未同步」，有对账记录时显示相对时间', () => {
    const { rerender } = render(<BackgroundTaskPanel {...makeProps({ lastSyncedAtMs: null })} />);
    expect(screen.getByTestId('background-task-sync-label').textContent).toBe('尚未同步');

    rerender(<BackgroundTaskPanel {...makeProps({ lastSyncedAtMs: FIXED_NOW_MS - 5_000 })} />);
    expect(screen.getByTestId('background-task-sync-label').textContent).toBe('同步于 5s 前');
    expect(screen.getByTestId('background-task-sync-label').getAttribute('data-stale')).toBeNull();
  });

  it('对账超过 30s 未更新时同步时间标记为陈旧', () => {
    render(<BackgroundTaskPanel {...makeProps({ lastSyncedAtMs: FIXED_NOW_MS - 45_000 })} />);

    expect(screen.getByTestId('background-task-sync-label').getAttribute('data-stale')).toBe(
      'true',
    );
  });
});

describe('BackgroundTaskPanel · 三态', () => {
  it('loading 且无数据时渲染骨架，不渲染空态 / 错误态', () => {
    render(<BackgroundTaskPanel {...makeProps({ loading: true })} />);

    expect(screen.getByTestId('background-task-loading')).toBeTruthy();
    expect(screen.queryByTestId('background-task-empty')).toBeNull();
    expect(screen.queryByTestId('background-task-error')).toBeNull();
  });

  it('error 且无数据时渲染错误文案与重试按钮，点击调用 onReloadTerminals', () => {
    const onReloadTerminals = vi.fn();
    render(<BackgroundTaskPanel {...makeProps({ error: '终端对账失败', onReloadTerminals })} />);

    expect(screen.getByTestId('background-task-error').textContent).toContain(
      '后台任务同步失败：终端对账失败',
    );
    expect(screen.queryByTestId('background-task-empty')).toBeNull();
    expect(screen.queryByTestId('background-task-loading')).toBeNull();

    fireEvent.click(screen.getByTestId('background-task-retry'));
    expect(onReloadTerminals).toHaveBeenCalledTimes(1);
  });

  it('无数据、未加载且无错误时渲染总空态与触发说明', () => {
    render(<BackgroundTaskPanel {...makeProps()} />);

    const empty = screen.getByTestId('background-task-empty');
    expect(empty.textContent).toContain('当前没有后台任务');
    expect(empty.textContent).toContain('模型派发后台子代理或后台命令后，会在这里出现。');
    expect(screen.queryByTestId('background-task-loading')).toBeNull();
  });

  it('已有数据时 error 降级为顶部横幅，行数据仍然可见', () => {
    render(
      <BackgroundTaskPanel
        {...makeProps({ error: '对账超时', model: modelWithRows([subagentRow()]) })}
      />,
    );

    expect(screen.getByTestId('background-task-error')).toBeTruthy();
    expect(screen.getAllByTestId('background-task-row')).toHaveLength(1);
  });

  it('分区空态按分区独立呈现', () => {
    const { rerender } = render(
      <BackgroundTaskPanel {...makeProps({ model: modelWithRows([subagentRow()]) })} />,
    );
    expect(screen.queryByTestId('background-task-subagent-empty')).toBeNull();
    expect(screen.getByTestId('background-task-shell-empty').textContent).toBe('暂无后台命令');

    rerender(<BackgroundTaskPanel {...makeProps({ model: modelWithRows([shellRow()]) })} />);
    expect(screen.getByTestId('background-task-subagent-empty').textContent).toBe(
      '暂无运行中的子代理任务',
    );
    expect(screen.queryByTestId('background-task-shell-empty')).toBeNull();
  });
});

describe('BackgroundTaskPanel · 行渲染与回调', () => {
  it('同时渲染子代理行与后台命令行，「查看」直接转发 onPreviewTerminal', () => {
    const onPreviewTerminal = vi.fn();
    render(
      <BackgroundTaskPanel
        {...makeProps({
          model: modelWithRows([subagentRow(), shellRow()]),
          onPreviewTerminal,
        })}
      />,
    );

    const rows = screen.getAllByTestId('background-task-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-kind')).toBe('subagent');
    expect(rows[1]?.getAttribute('data-kind')).toBe('shell');

    fireEvent.click(screen.getByTestId('background-task-row-preview-terminal'));
    expect(onPreviewTerminal).toHaveBeenCalledTimes(1);
    expect(onPreviewTerminal).toHaveBeenCalledWith(TERMINAL_ID);
  });

  it('「打开子会话」转发 onOpenSession', () => {
    const onOpenSession = vi.fn();
    render(
      <BackgroundTaskPanel
        {...makeProps({ model: modelWithRows([subagentRow()]), onOpenSession })}
      />,
    );

    fireEvent.click(screen.getByTestId('background-task-row-open-session'));
    expect(onOpenSession).toHaveBeenCalledWith(CHILD_SESSION_ID);
  });

  it('stoppingSubAgentIds / pendingKillIds 驱动行内按钮的进行中态', () => {
    render(
      <BackgroundTaskPanel
        {...makeProps({
          model: modelWithRows([subagentRow(), shellRow()]),
          stoppingSubAgentIds: new Set([CHILD_SESSION_ID]),
          pendingKillIds: new Set([TERMINAL_ID]),
        })}
      />,
    );

    const stopButton = screen.getByTestId('background-task-row-stop') as HTMLButtonElement;
    expect(stopButton.disabled).toBe(true);
    expect(stopButton.textContent).toContain('停止中');

    const killButton = screen.getByTestId('background-task-row-kill-terminal') as HTMLButtonElement;
    expect(killButton.disabled).toBe(true);
    expect(killButton.textContent).toContain('终止中');
  });

  it('行级 errorMessage 以 danger 文案展示', () => {
    render(
      <BackgroundTaskPanel
        {...makeProps({
          model: modelWithRows([subagentRow({ state: 'failed', errorMessage: '子代理执行超时' })]),
        })}
      />,
    );

    const error = screen.getByTestId('background-task-row-error');
    expect(error.textContent).toBe('子代理执行超时');
    expect(error.style.color).toBe('var(--danger)');
  });
});

describe('BackgroundTaskPanel · 破坏性操作二次确认', () => {
  it('行内停止：取消不触发回调，确认后调用 onStopSubagent', () => {
    const onStopSubagent = vi.fn();
    render(
      <BackgroundTaskPanel
        {...makeProps({ model: modelWithRows([subagentRow()]), onStopSubagent })}
      />,
    );

    fireEvent.click(screen.getByTestId('background-task-row-stop'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('停止子代理')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onStopSubagent).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByTestId('background-task-row-stop'));
    fireEvent.click(screen.getByTestId('background-task-confirm-stop'));
    expect(onStopSubagent).toHaveBeenCalledTimes(1);
    expect(onStopSubagent).toHaveBeenCalledWith(CHILD_SESSION_ID);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc 关闭确认弹窗且不触发回调', () => {
    const onStopSubagent = vi.fn();
    render(
      <BackgroundTaskPanel
        {...makeProps({ model: modelWithRows([subagentRow()]), onStopSubagent })}
      />,
    );

    fireEvent.click(screen.getByTestId('background-task-row-stop'));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onStopSubagent).not.toHaveBeenCalled();
  });

  it('确认弹窗的初始焦点给「取消」', () => {
    render(<BackgroundTaskPanel {...makeProps({ model: modelWithRows([subagentRow()]) })} />);

    fireEvent.click(screen.getByTestId('background-task-row-stop'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
  });

  it('终止后台命令：确认后调用 onKillTerminal，弹窗展示目标终端', () => {
    const onKillTerminal = vi.fn();
    render(
      <BackgroundTaskPanel
        {...makeProps({ model: modelWithRows([shellRow()]), onKillTerminal })}
      />,
    );

    fireEvent.click(screen.getByTestId('background-task-row-kill-terminal'));
    expect(screen.getByText('终止后台命令')).toBeTruthy();
    expect(screen.getByTestId('background-task-confirm-scope').textContent).toContain(TERMINAL_ID);

    fireEvent.click(screen.getByTestId('background-task-confirm-kill'));
    expect(onKillTerminal).toHaveBeenCalledTimes(1);
    expect(onKillTerminal).toHaveBeenCalledWith(TERMINAL_ID);
  });

  it('全部停止子代理：取消不触发，确认后调用 onStopAllSubagents', () => {
    const onStopAllSubagents = vi.fn();
    const model = makeModel({
      rows: [subagentRow()],
      summary: { runningSubagents: 1, runningShells: 0, activeTotal: 1 },
    });
    render(<BackgroundTaskPanel {...makeProps({ model, onStopAllSubagents })} />);

    fireEvent.click(screen.getByTestId('background-task-stop-all'));
    expect(screen.getByText('停止全部子代理')).toBeTruthy();
    expect(screen.getByText('将停止 1 个正在运行的子代理，此操作不可撤销。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onStopAllSubagents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('background-task-stop-all'));
    fireEvent.click(screen.getByTestId('background-task-confirm-stop-all'));
    expect(onStopAllSubagents).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
