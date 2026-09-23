// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTask } from '@openAwork/web-client';
import type { SessionTerminalView } from '../../../components/conversation-runtime/terminals/terminals-api.js';
import { useBackgroundTaskPanel } from './use-background-task-panel.js';

const BASE_MS = 1_700_000_000_000;

interface PanelProps {
  readonly tasks: readonly SessionTask[];
  readonly terminals: readonly SessionTerminalView[];
}

function makeTask(overrides: Partial<SessionTask> & { readonly id: string }): SessionTask {
  return {
    blockedBy: [],
    completedSubtaskCount: 0,
    createdAt: BASE_MS,
    depth: 0,
    priority: 'medium',
    readySubtaskCount: 0,
    status: 'pending',
    subtaskCount: 0,
    tags: [],
    title: `任务 ${overrides.id}`,
    unmetDependencyCount: 0,
    updatedAt: BASE_MS,
    ...overrides,
  };
}

function makeTerminal(overrides: Partial<SessionTerminalView>): SessionTerminalView {
  return {
    terminalId: 'term-default',
    sessionId: 'session-1',
    toolName: 'bash',
    kind: 'background',
    command: 'echo hi',
    cwd: '/tmp',
    status: 'running',
    startedAtMs: BASE_MS,
    lastActivityMs: BASE_MS + 500,
    outputBytesTotal: 0,
    outputTail: '',
    ...overrides,
  };
}

function renderPanel(initialProps: PanelProps) {
  return renderHook((props: PanelProps) => useBackgroundTaskPanel(props), { initialProps });
}

describe('useBackgroundTaskPanel 心跳', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('存在 pending 行时每秒推进 now，并刷新排队时长', () => {
    const { result } = renderPanel({
      tasks: [makeTask({ id: 'T-1', status: 'pending', createdAt: BASE_MS })],
      terminals: [],
    });

    expect(result.current.now).toBe(BASE_MS);
    expect(result.current.rows.map((row) => row.queuedMs)).toEqual([0]);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(result.current.now).toBe(BASE_MS + 3_000);
    expect(result.current.rows.map((row) => row.queuedMs)).toEqual([3_000]);
  });

  it('存在 running 行时同样推进 now', () => {
    const { result } = renderPanel({
      tasks: [makeTask({ id: 'T-1', status: 'running', startedAt: BASE_MS + 1_000 })],
      terminals: [],
    });

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(result.current.now).toBe(BASE_MS + 2_000);
  });

  it('只有终态行时不启动心跳', () => {
    const { result } = renderPanel({
      tasks: [
        makeTask({
          id: 'T-1',
          status: 'completed',
          startedAt: BASE_MS,
          completedAt: BASE_MS + 1_000,
        }),
      ],
      terminals: [
        makeTerminal({
          terminalId: 'term-1',
          status: 'exited',
          exitCode: 0,
          endedAtMs: BASE_MS + 2_000,
        }),
      ],
    });

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(result.current.now).toBe(BASE_MS);
  });

  it('最后一条活跃行结算后自动停表', () => {
    const { result, rerender } = renderPanel({
      tasks: [makeTask({ id: 'T-1', status: 'running', startedAt: BASE_MS })],
      terminals: [],
    });

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.now).toBe(BASE_MS + 2_000);

    rerender({
      tasks: [
        makeTask({
          id: 'T-1',
          status: 'completed',
          startedAt: BASE_MS,
          completedAt: BASE_MS + 2_000,
        }),
      ],
      terminals: [],
    });

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(result.current.now).toBe(BASE_MS + 2_000);
  });

  it('活跃行稍后出现时才启动心跳，并立即对齐当前时间', () => {
    const { result, rerender } = renderPanel({ tasks: [], terminals: [] });

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.now).toBe(BASE_MS);

    rerender({
      tasks: [makeTask({ id: 'T-1', status: 'running', startedAt: BASE_MS + 1_000 })],
      terminals: [],
    });
    expect(result.current.now).toBe(BASE_MS + 3_000);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.now).toBe(BASE_MS + 4_000);
  });

  it('派生 rows 与 summary 与输入同步', () => {
    const { result } = renderPanel({
      tasks: [makeTask({ id: 'T-1', status: 'running', startedAt: BASE_MS })],
      terminals: [makeTerminal({ terminalId: 'term-1', status: 'running' })],
    });

    expect(result.current.rows.map((row) => row.key)).toEqual(['T-1', 'term-1']);
    expect(result.current.summary).toEqual({
      runningSubagents: 1,
      runningShells: 1,
      activeTotal: 2,
    });
  });

  it('空输入返回空行与全 0 汇总，且不启动心跳', () => {
    const { result } = renderPanel({ tasks: [], terminals: [] });

    expect(result.current.rows).toEqual([]);
    expect(result.current.summary).toEqual({
      runningSubagents: 0,
      runningShells: 0,
      activeTotal: 0,
    });

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.now).toBe(BASE_MS);
  });
});
