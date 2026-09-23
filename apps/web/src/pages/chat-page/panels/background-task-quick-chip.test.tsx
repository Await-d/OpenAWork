// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundTaskRow, BackgroundTaskSummary } from './background-task-model.js';
import type { BackgroundTaskPanelModel } from './use-background-task-panel.js';
import { BackgroundTaskQuickChip } from './background-task-quick-chip.js';

afterEach(() => {
  cleanup();
});

const NOW = 1_790_000_000_000;

function subagentRow(overrides: Partial<BackgroundTaskRow> = {}): BackgroundTaskRow {
  return {
    key: 'T-chip-running',
    kind: 'subagent',
    state: 'running',
    title: '梳理后台任务入口',
    taskId: 'T-chip-running',
    agent: 'explore',
    sessionId: 'child-chip-running',
    startedAtMs: NOW - 12_000,
    ...overrides,
  };
}

function shellRow(overrides: Partial<BackgroundTaskRow> = {}): BackgroundTaskRow {
  return {
    key: 'term-chip-running',
    kind: 'shell',
    state: 'running',
    title: 'npm run dev -- --host 0.0.0.0',
    command: 'npm run dev -- --host 0.0.0.0',
    terminalId: 'term-chip-running',
    cwd: '/workspace/app',
    startedAtMs: NOW - 30_000,
    ...overrides,
  };
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

function makeModel(
  rows: BackgroundTaskRow[],
  summary: Partial<BackgroundTaskSummary> = {},
): BackgroundTaskPanelModel {
  const runningSubagents = rows.filter(
    (row) => row.kind === 'subagent' && row.state === 'running',
  ).length;
  const runningShells = rows.filter(
    (row) => row.kind === 'shell' && row.state === 'running',
  ).length;
  return {
    rows,
    summary: {
      activeTotal: rows.filter((row) => row.state === 'running' || row.state === 'pending').length,
      runningShells,
      runningSubagents,
      ...summary,
    },
    now: NOW,
  };
}

function createCallbacks() {
  return {
    onKillTerminal: vi.fn(),
    onOpenPanel: vi.fn(),
    onOpenSession: vi.fn(),
    onPreviewTerminal: vi.fn(),
    onStopAllSubagents: vi.fn(),
    onStopSubagent: vi.fn(),
  };
}

function renderChip(
  model: BackgroundTaskPanelModel,
  overrides: Partial<Parameters<typeof BackgroundTaskQuickChip>[0]> = {},
) {
  const callbacks = createCallbacks();
  const view = render(
    <BackgroundTaskQuickChip
      model={model}
      pendingKillIds={EMPTY_SET}
      stoppingSubAgentIds={EMPTY_SET}
      {...callbacks}
      {...overrides}
    />,
  );
  return { ...callbacks, ...view };
}

function openPopover(): void {
  fireEvent.click(screen.getByTestId('background-task-chip'));
}

describe('BackgroundTaskQuickChip 显隐与计数', () => {
  it('没有活跃任务时不渲染胶囊', () => {
    renderChip(makeModel([subagentRow({ state: 'succeeded' }), shellRow({ state: 'failed' })]));

    expect(screen.queryByTestId('background-task-chip')).toBeNull();
  });

  it('只统计运行中/排队中，胶囊文案与 tooltip 给出细目', () => {
    renderChip(
      makeModel([
        subagentRow(),
        subagentRow({ key: 'T-pending', state: 'pending', sessionId: 'child-pending' }),
        shellRow(),
        shellRow({ key: 'term-done', state: 'succeeded', terminalId: 'term-done' }),
      ]),
    );

    const chip = screen.getByTestId('background-task-chip');
    // 2 个子代理（running + pending）+ 1 个命令 = 3
    expect(chip.textContent).toBe('后台 3');
    expect(chip.getAttribute('title')).toBe('2 个子代理进行中 · 1 个后台命令');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('BackgroundTaskQuickChip 展开与关闭', () => {
  it('点击胶囊展开列表，再点收起；弹出的行数与活跃行一致', () => {
    renderChip(makeModel([subagentRow(), shellRow()]));

    openPopover();
    expect(screen.getByTestId('background-task-chip-popover')).toBeTruthy();
    expect(screen.getByTestId('background-task-chip').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByTestId('background-task-chip-row')).toHaveLength(2);

    openPopover();
    expect(screen.queryByTestId('background-task-chip-popover')).toBeNull();
  });

  it('Esc 关闭列表并把焦点还给胶囊', () => {
    renderChip(makeModel([subagentRow()]));

    const chip = screen.getByTestId('background-task-chip');
    openPopover();
    expect(screen.getByTestId('background-task-chip-popover')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('background-task-chip-popover')).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it('超过 6 项时提示打开面板看全部', () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      subagentRow({ key: `T-${index}`, sessionId: `child-${index}` }),
    );
    renderChip(makeModel(rows));

    openPopover();

    expect(screen.getAllByTestId('background-task-chip-row')).toHaveLength(6);
    expect(screen.getByText('另有 2 项，打开面板查看全部')).toBeTruthy();
  });
});

describe('BackgroundTaskQuickChip 操作链路', () => {
  it('子代理行：打开子会话后自动收起列表', () => {
    const { onOpenSession } = renderChip(makeModel([subagentRow()]));

    openPopover();
    fireEvent.click(screen.getByTestId('background-task-chip-row-open-session'));

    expect(onOpenSession).toHaveBeenCalledWith('child-chip-running');
    expect(screen.queryByTestId('background-task-chip-popover')).toBeNull();
  });

  it('子代理行：停止需确认，取消不触发回调', () => {
    const { onStopSubagent } = renderChip(makeModel([subagentRow()]));

    openPopover();
    fireEvent.click(screen.getByTestId('background-task-chip-row-stop'));

    expect(screen.getByTestId('background-task-confirm-stop')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onStopSubagent).not.toHaveBeenCalled();
  });

  it('子代理行：确认后调用 onStopSubagent', () => {
    const { onStopSubagent } = renderChip(makeModel([subagentRow()]));

    openPopover();
    fireEvent.click(screen.getByTestId('background-task-chip-row-stop'));
    fireEvent.click(screen.getByTestId('background-task-confirm-stop'));

    expect(onStopSubagent).toHaveBeenCalledWith('child-chip-running');
  });

  it('命令行：查看终端后自动收起列表', () => {
    const { onPreviewTerminal } = renderChip(makeModel([shellRow()]));

    openPopover();
    fireEvent.click(screen.getByTestId('background-task-chip-row-preview-terminal'));

    expect(onPreviewTerminal).toHaveBeenCalledWith('term-chip-running');
    expect(screen.queryByTestId('background-task-chip-popover')).toBeNull();
  });

  it('命令行：终止需确认，确认后调用 onKillTerminal', () => {
    const { onKillTerminal } = renderChip(makeModel([shellRow()]));

    openPopover();
    fireEvent.click(screen.getByTestId('background-task-chip-row-kill-terminal'));
    fireEvent.click(screen.getByTestId('background-task-confirm-kill'));

    expect(onKillTerminal).toHaveBeenCalledWith('term-chip-running');
  });

  it('头部「全部停止」走 stop-all 确认', () => {
    const { onStopAllSubagents } = renderChip(
      makeModel([subagentRow(), subagentRow({ key: 'T-2', sessionId: 'child-2' })]),
    );

    openPopover();
    fireEvent.click(screen.getByTestId('background-task-chip-stop-all'));
    fireEvent.click(screen.getByTestId('background-task-confirm-stop-all'));

    expect(onStopAllSubagents).toHaveBeenCalledTimes(1);
  });

  it('「打开后台面板」调用 onOpenPanel 并收起列表', () => {
    const { onOpenPanel } = renderChip(makeModel([subagentRow()]));

    openPopover();
    fireEvent.click(screen.getByTestId('background-task-chip-open-panel'));

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('background-task-chip-popover')).toBeNull();
  });

  it('在途态：停止中 / 终止中按钮禁用且文案切换', () => {
    renderChip(makeModel([subagentRow(), shellRow()]), {
      stoppingSubAgentIds: new Set(['child-chip-running']),
      pendingKillIds: new Set(['term-chip-running']),
    });

    openPopover();

    const stop = screen.getByTestId('background-task-chip-row-stop') as HTMLButtonElement;
    const kill = screen.getByTestId('background-task-chip-row-kill-terminal') as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
    expect(stop.textContent).toBe('停止中');
    expect(kill.disabled).toBe(true);
    expect(kill.textContent).toBe('终止中');
  });
});
