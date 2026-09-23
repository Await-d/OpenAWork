// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { BackgroundTaskRow } from './background-task-model.js';
import {
  ShellTaskRow,
  SubagentTaskRow,
  formatByteSize,
  formatCompactPath,
  formatSyncAge,
  formatTaskDuration,
  formatTaskStateLabel,
  resolveTaskStateTone,
} from './background-task-rows.js';

const FIXED_NOW_MS = 1_700_000_000_000;
const CHILD_SESSION_ID = 'sess-1234-5678-90ab';

function makeRow(overrides: Partial<BackgroundTaskRow> = {}): BackgroundTaskRow {
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

function makeShellRow(overrides: Partial<BackgroundTaskRow> = {}): BackgroundTaskRow {
  return makeRow({
    key: 'term-9f3c',
    kind: 'shell',
    title: 'npm run dev -- --host 0.0.0.0',
    command: 'npm run dev -- --host 0.0.0.0',
    taskId: undefined,
    sessionId: undefined,
    agent: undefined,
    detail: '/home/await/projects/very-long-workspace-name/app',
    terminalId: 'term-9f3c',
    cwd: '/home/await/projects/very-long-workspace-name/app',
    outputBytesTotal: 1_200,
    startedAtMs: FIXED_NOW_MS - 45_000,
    ...overrides,
  });
}

function stubClipboard(impl: (text: string) => Promise<void>): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

function stubClipboardUnavailable(): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
}

/** 复制走的是 Promise 链，用 async act 冲掉微任务队列后再断言反馈文案。 */
async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderSubagentRow(
  row: BackgroundTaskRow,
  props: { stopping?: boolean; onOpenSession?: () => void; onStop?: () => void } = {},
): void {
  render(
    <SubagentTaskRow
      row={row}
      stopping={props.stopping ?? false}
      onOpenSession={props.onOpenSession ?? vi.fn()}
      onStop={props.onStop ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW_MS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('后台任务行 · 纯格式化函数', () => {
  it('状态文案与 tone 覆盖五种状态', () => {
    expect(formatTaskStateLabel('running')).toBe('运行中');
    expect(formatTaskStateLabel('pending')).toBe('排队中');
    expect(formatTaskStateLabel('succeeded')).toBe('已完成');
    expect(formatTaskStateLabel('failed')).toBe('失败');
    expect(formatTaskStateLabel('cancelled')).toBe('已取消');

    expect(resolveTaskStateTone('running')).toBe('accent');
    expect(resolveTaskStateTone('pending')).toBe('warning');
    expect(resolveTaskStateTone('failed')).toBe('danger');
    expect(resolveTaskStateTone('succeeded')).toBe('muted');
    expect(resolveTaskStateTone('cancelled')).toBe('muted');
  });

  it('字节数按人读格式输出', () => {
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(1_200)).toBe('1.2 KB');
    expect(formatByteSize(1_250_000)).toBe('1.3 MB');
    expect(formatByteSize(2_000_000_000)).toBe('2.0 GB');
  });

  it('耗时在秒 / 分 / 时之间切换', () => {
    expect(formatTaskDuration(500)).toBe('0s');
    expect(formatTaskDuration(12_000)).toBe('12s');
    expect(formatTaskDuration(60_000)).toBe('1m');
    expect(formatTaskDuration(65_000)).toBe('1m 5s');
    expect(formatTaskDuration(3_600_000)).toBe('1h 0m');
  });

  it('cwd 过长时折叠为「…/父目录/末级」', () => {
    expect(formatCompactPath('packages/web/src')).toBe('packages/web/src');
    expect(formatCompactPath('/home/await/projects/very-long-workspace-name/app')).toBe(
      '…/very-long-workspace-name/app',
    );
    expect(formatCompactPath('  ')).toBe('');
  });

  it('同步时间口径区分未同步 / 刚刚同步 / Ns 前', () => {
    expect(formatSyncAge(FIXED_NOW_MS, null)).toBe('尚未同步');
    expect(formatSyncAge(FIXED_NOW_MS, FIXED_NOW_MS)).toBe('刚刚同步');
    expect(formatSyncAge(FIXED_NOW_MS, FIXED_NOW_MS - 5_000)).toBe('同步于 5s 前');
    expect(formatSyncAge(FIXED_NOW_MS, FIXED_NOW_MS - 120_000)).toBe('同步于 2m 前');
  });
});

describe('SubagentTaskRow', () => {
  it('渲染标题、@agent、task_id、会话短 id 与耗时，并转发操作回调', () => {
    const onOpenSession = vi.fn();
    const onStop = vi.fn();
    renderSubagentRow(makeRow(), { onOpenSession, onStop });

    const row = screen.getByTestId('background-task-row');
    expect(row.getAttribute('data-kind')).toBe('subagent');
    expect(row.getAttribute('data-state')).toBe('running');
    expect(row.getAttribute('data-task-key')).toBe('T-abc12345');

    expect(screen.getByText('梳理右栏面板结构')).toBeTruthy();
    expect(screen.getByText('@explorer')).toBeTruthy();
    expect(screen.getByText('会话 sess-123')).toBeTruthy();
    expect(screen.getByText('运行中')).toBeTruthy();
    expect(screen.getByText('12s')).toBeTruthy();
    expect(screen.getByTestId('background-task-row-copy-id').textContent).toContain('T-abc12345');

    fireEvent.click(screen.getByTestId('background-task-row-open-session'));
    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(onOpenSession).toHaveBeenCalledWith(CHILD_SESSION_ID);

    fireEvent.click(screen.getByTestId('background-task-row-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledWith(CHILD_SESSION_ID);
  });

  it('agent 与 detail 两种来源都渲染为单个 @agent，不出现 @@', () => {
    const { rerender } = render(
      <SubagentTaskRow
        row={makeRow({ agent: 'explorer', detail: '@explorer' })}
        stopping={false}
        onOpenSession={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText('@explorer')).toBeTruthy();

    // 只有 W1 的 `detail`（已带 @）时不得二次加前缀。
    rerender(
      <SubagentTaskRow
        row={makeRow({ agent: undefined, detail: '@explorer' })}
        stopping={false}
        onOpenSession={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText('@explorer')).toBeTruthy();
  });

  it('pending 行显示排队时长，终态行按 endedAtMs 计算耗时', () => {
    const { rerender } = render(
      <SubagentTaskRow
        row={makeRow({ state: 'pending', queuedMs: 5_000 })}
        stopping={false}
        onOpenSession={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText('排队 5s')).toBeTruthy();
    expect(screen.getByText('排队中')).toBeTruthy();

    rerender(
      <SubagentTaskRow
        row={makeRow({
          state: 'succeeded',
          startedAtMs: FIXED_NOW_MS - 90_000,
          endedAtMs: FIXED_NOW_MS - 30_000,
        })}
        stopping={false}
        onOpenSession={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText('1m')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
  });

  it('stopping 为 true 时停止按钮显示「停止中」且不可点击', () => {
    const onStop = vi.fn();
    renderSubagentRow(makeRow(), { stopping: true, onStop });

    const stopButton = screen.getByTestId('background-task-row-stop') as HTMLButtonElement;
    expect(stopButton.disabled).toBe(true);
    expect(stopButton.textContent).toContain('停止中');
    expect(stopButton.getAttribute('aria-label')).toBe('停止子代理 梳理右栏面板结构');

    fireEvent.click(stopButton);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('缺少 sessionId 时打开子会话与停止都禁用且不显示会话号', () => {
    const onOpenSession = vi.fn();
    const onStop = vi.fn();
    renderSubagentRow(makeRow({ sessionId: undefined }), { onOpenSession, onStop });

    const openButton = screen.getByTestId('background-task-row-open-session') as HTMLButtonElement;
    const stopButton = screen.getByTestId('background-task-row-stop') as HTMLButtonElement;
    expect(openButton.disabled).toBe(true);
    expect(stopButton.disabled).toBe(true);
    expect(screen.queryByText(/^会话 /)).toBeNull();

    fireEvent.click(openButton);
    fireEvent.click(stopButton);
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('行级 errorMessage 以 danger 文本展示', () => {
    renderSubagentRow(makeRow({ state: 'failed', errorMessage: '子代理执行超时' }));

    const error = screen.getByTestId('background-task-row-error');
    expect(error.textContent).toBe('子代理执行超时');
    expect(error.style.color).toBe('var(--danger)');
  });

  it('状态点按状态给出 tone 与无障碍文案', () => {
    const { rerender } = render(
      <SubagentTaskRow
        row={makeRow({ state: 'running' })}
        stopping={false}
        onOpenSession={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    const dot = screen.getByTestId('background-task-row-status');
    expect(dot.getAttribute('data-tone')).toBe('accent');
    expect(dot.getAttribute('aria-label')).toBe('运行中');

    rerender(
      <SubagentTaskRow
        row={makeRow({ state: 'pending' })}
        stopping={false}
        onOpenSession={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByTestId('background-task-row-status').getAttribute('data-tone')).toBe(
      'warning',
    );

    rerender(
      <SubagentTaskRow
        row={makeRow({ state: 'failed' })}
        stopping={false}
        onOpenSession={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByTestId('background-task-row-status').getAttribute('data-tone')).toBe(
      'danger',
    );
  });

  it('操作按钮聚焦时给出 accent 2px focus ring', () => {
    renderSubagentRow(makeRow());
    const stopButton = screen.getByTestId('background-task-row-stop');

    fireEvent.focus(stopButton);
    expect(stopButton.style.outlineStyle).toBe('solid');
    expect(stopButton.style.outlineWidth).toBe('2px');
    expect(stopButton.style.outlineColor).toBe('var(--accent)');

    fireEvent.blur(stopButton);
    expect(stopButton.style.outlineStyle).toBe('none');
  });

  it('点击 task_id 复制成功时给出「已复制」反馈', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    renderSubagentRow(makeRow());

    fireEvent.click(screen.getByTestId('background-task-row-copy-id'));
    await flushAsyncWork();

    expect(writeText).toHaveBeenCalledWith('T-abc12345');
    expect(screen.getByTestId('background-task-row-copy-id-feedback').textContent).toBe('已复制');
  });

  it('复制被拒绝时给出「复制失败」反馈', async () => {
    stubClipboard(() => Promise.reject(new Error('clipboard denied')));
    renderSubagentRow(makeRow());

    fireEvent.click(screen.getByTestId('background-task-row-copy-id'));
    await flushAsyncWork();

    expect(screen.getByTestId('background-task-row-copy-id-feedback').textContent).toBe('复制失败');
  });

  it('剪贴板不可用时同样降级为「复制失败」', async () => {
    stubClipboardUnavailable();
    renderSubagentRow(makeRow());

    fireEvent.click(screen.getByTestId('background-task-row-copy-id'));
    await flushAsyncWork();

    expect(screen.getByTestId('background-task-row-copy-id-feedback').textContent).toBe('复制失败');
  });
});

describe('ShellTaskRow', () => {
  it('渲染命令、折叠 cwd、terminalId、耗时与输出字节，并转发操作回调', () => {
    const onPreview = vi.fn();
    const onKill = vi.fn();
    render(
      <ShellTaskRow
        row={makeShellRow()}
        pendingKill={false}
        onPreview={onPreview}
        onKill={onKill}
      />,
    );

    const row = screen.getByTestId('background-task-row');
    expect(row.getAttribute('data-kind')).toBe('shell');
    expect(row.getAttribute('data-task-key')).toBe('term-9f3c');

    expect(screen.getByText('npm run dev -- --host 0.0.0.0')).toBeTruthy();
    expect(screen.getByText('…/very-long-workspace-name/app')).toBeTruthy();
    expect(screen.getByText('45s')).toBeTruthy();
    expect(screen.getByTestId('background-task-row-output-bytes').textContent).toBe('1.2 KB');
    expect(screen.getByTestId('background-task-row-copy-id').textContent).toContain('term-9f3c');

    fireEvent.click(screen.getByTestId('background-task-row-preview-terminal'));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith('term-9f3c');

    fireEvent.click(screen.getByTestId('background-task-row-kill-terminal'));
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(onKill).toHaveBeenCalledWith('term-9f3c');
  });

  it('pendingKill 为 true 时终止按钮禁用并显示「终止中」', () => {
    const onKill = vi.fn();
    render(<ShellTaskRow row={makeShellRow()} pendingKill onPreview={vi.fn()} onKill={onKill} />);

    const killButton = screen.getByTestId('background-task-row-kill-terminal') as HTMLButtonElement;
    expect(killButton.disabled).toBe(true);
    expect(killButton.textContent).toContain('终止中');
    expect(killButton.getAttribute('aria-label')).toBe('终止后台命令 term-9f3c');

    fireEvent.click(killButton);
    expect(onKill).not.toHaveBeenCalled();
  });

  it('命令全文挂在 title 上，供省略号截断后查看', () => {
    render(
      <ShellTaskRow
        row={makeShellRow({ title: 'npm run dev -- --host 0.0.0.0' })}
        pendingKill={false}
        onPreview={vi.fn()}
        onKill={vi.fn()}
      />,
    );

    expect(screen.getByText('npm run dev -- --host 0.0.0.0').getAttribute('title')).toBe(
      'npm run dev -- --host 0.0.0.0',
    );
  });

  it('多行命令压成单行展示，title 保留全文（含换行）', () => {
    const command = 'npm run dev\n  -- --host 0.0.0.0';
    render(
      <ShellTaskRow
        row={makeShellRow({ title: 'npm run dev', command })}
        pendingKill={false}
        onPreview={vi.fn()}
        onKill={vi.fn()}
      />,
    );

    const commandNode = screen.getByText(/^npm run dev\s+-- --host 0\.0\.0\.0$/);
    expect(commandNode.getAttribute('title')).toBe(command);
  });
});

describe('终态行不提供破坏性操作', () => {
  it('子代理终态（succeeded/failed/cancelled）不渲染「停止」按钮', () => {
    for (const state of ['succeeded', 'failed', 'cancelled'] as const) {
      const { unmount } = render(
        <SubagentTaskRow
          row={makeRow({ state })}
          stopping={false}
          onOpenSession={vi.fn()}
          onStop={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('background-task-row-stop')).toBeNull();
      // 非破坏性操作仍可用：打开子会话按钮保留。
      expect(screen.getByTestId('background-task-row-open-session')).toBeTruthy();
      unmount();
    }
  });

  it('后台命令终态（succeeded/failed）不渲染「终止」按钮', () => {
    for (const state of ['succeeded', 'failed'] as const) {
      const { unmount } = render(
        <ShellTaskRow
          row={makeShellRow({ state })}
          pendingKill={false}
          onPreview={vi.fn()}
          onKill={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('background-task-row-kill-terminal')).toBeNull();
      // 非破坏性操作仍可用：查看按钮保留。
      expect(screen.getByTestId('background-task-row-preview-terminal')).toBeTruthy();
      unmount();
    }
  });
});
