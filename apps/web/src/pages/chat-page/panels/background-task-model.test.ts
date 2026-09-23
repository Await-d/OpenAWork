import { describe, expect, it } from 'vitest';
import type { SessionTask } from '@openAwork/web-client';
import type { SessionTerminalView } from '../../../components/conversation-runtime/terminals/terminals-api.js';
import {
  buildBackgroundTaskRows,
  buildBackgroundTaskSummary,
  type BackgroundTaskRow,
  type BackgroundTaskState,
} from './background-task-model.js';

const BASE_MS = 1_700_000_000_000;
const NOW_MS = BASE_MS + 60_000;

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

function buildRows(input: {
  tasks?: readonly SessionTask[];
  terminals?: readonly SessionTerminalView[];
  now?: number;
}): BackgroundTaskRow[] {
  return buildBackgroundTaskRows({
    tasks: input.tasks ?? [],
    terminals: input.terminals ?? [],
    now: input.now ?? NOW_MS,
  });
}

const TASK_STATE_CASES: ReadonlyArray<readonly [SessionTask['status'], BackgroundTaskState]> = [
  ['pending', 'pending'],
  ['running', 'running'],
  ['completed', 'succeeded'],
  ['failed', 'failed'],
  ['cancelled', 'cancelled'],
];

const TERMINAL_STATE_CASES: ReadonlyArray<
  readonly [SessionTerminalView['status'], number | undefined, BackgroundTaskState]
> = [
  ['running', undefined, 'running'],
  ['idle', undefined, 'running'],
  ['tmux-spawned', undefined, 'running'],
  ['exited', 0, 'succeeded'],
  ['exited', undefined, 'succeeded'],
  ['exited', 1, 'failed'],
  ['aborted', undefined, 'cancelled'],
  ['killed', undefined, 'cancelled'],
  ['tmux-killed', undefined, 'cancelled'],
  ['timeout', undefined, 'failed'],
  ['spawn_error', undefined, 'failed'],
  ['stale', undefined, 'failed'],
];

describe('buildBackgroundTaskRows 状态映射', () => {
  for (const [status, expected] of TASK_STATE_CASES) {
    it(`子代理 ${status} → ${expected}`, () => {
      const rows = buildRows({ tasks: [makeTask({ id: 'T-1', status })] });

      expect(rows.map((row) => row.state)).toEqual([expected]);
    });
  }

  for (const [status, exitCode, expected] of TERMINAL_STATE_CASES) {
    it(`终端 ${status}（exitCode=${String(exitCode)}）→ ${expected}`, () => {
      const rows = buildRows({ terminals: [makeTerminal({ status, exitCode })] });

      expect(rows.map((row) => row.state)).toEqual([expected]);
    });
  }

  it('failed 子代理透传 errorMessage', () => {
    const rows = buildRows({
      tasks: [
        makeTask({ id: 'T-1', status: 'failed', errorMessage: '子代理执行被网关重启中断。' }),
      ],
    });

    expect(rows.map((row) => row.errorMessage)).toEqual(['子代理执行被网关重启中断。']);
  });
});

describe('buildBackgroundTaskRows 排序', () => {
  it('按 running → pending → 终态分组，终态内按 endedAtMs 倒序', () => {
    const rows = buildRows({
      tasks: [
        makeTask({
          id: 'T-done-old',
          status: 'completed',
          startedAt: BASE_MS,
          completedAt: BASE_MS + 1_000,
        }),
        makeTask({ id: 'T-pending', status: 'pending' }),
        makeTask({ id: 'T-running', status: 'running', startedAt: BASE_MS + 500 }),
        makeTask({
          id: 'T-done-new',
          status: 'failed',
          startedAt: BASE_MS + 100,
          completedAt: BASE_MS + 9_000,
        }),
      ],
    });

    expect(rows.map((row) => row.key)).toEqual([
      'T-running',
      'T-pending',
      'T-done-new',
      'T-done-old',
    ]);
  });

  it('同状态按 startedAtMs 升序，同状态同时间按 key 字典序兜底（与输入顺序无关）', () => {
    const makeRunning = (id: string, startedAtMs: number) =>
      makeTask({ id, status: 'running', startedAt: startedAtMs });

    const forward = buildRows({
      tasks: [
        makeRunning('T-b', BASE_MS),
        makeRunning('T-a', BASE_MS),
        makeRunning('T-c', BASE_MS - 1_000),
      ],
    });
    const reversed = buildRows({
      tasks: [
        makeRunning('T-c', BASE_MS - 1_000),
        makeRunning('T-a', BASE_MS),
        makeRunning('T-b', BASE_MS),
      ],
    });

    expect(forward.map((row) => row.key)).toEqual(['T-c', 'T-a', 'T-b']);
    expect(reversed.map((row) => row.key)).toEqual(['T-c', 'T-a', 'T-b']);
  });

  it('终态缺少 endedAtMs 时退回 startedAtMs 参与倒序', () => {
    const rows = buildRows({
      terminals: [
        makeTerminal({
          terminalId: 'term-old',
          status: 'exited',
          exitCode: 0,
          startedAtMs: BASE_MS + 1_000,
          endedAtMs: BASE_MS + 2_000,
        }),
        makeTerminal({
          terminalId: 'term-missing-ended',
          status: 'stale',
          startedAtMs: BASE_MS + 5_000,
        }),
        makeTerminal({
          terminalId: 'term-newest',
          status: 'killed',
          startedAtMs: BASE_MS + 3_000,
          endedAtMs: BASE_MS + 6_000,
        }),
      ],
    });

    expect(rows.map((row) => row.key)).toEqual(['term-newest', 'term-missing-ended', 'term-old']);
  });
});

describe('buildBackgroundTaskRows 去重合并', () => {
  it('同一 terminalId 只保留一行，后到行的有值字段覆盖先到行', () => {
    const rows = buildRows({
      terminals: [
        makeTerminal({
          terminalId: 'term-1',
          status: 'exited',
          exitCode: 0,
          cwd: '/tmp',
          outputBytesTotal: 0,
        }),
        makeTerminal({
          terminalId: 'term-1',
          status: 'exited',
          exitCode: 0,
          cwd: '/repo',
          endedAtMs: BASE_MS + 2_000,
          outputBytesTotal: 2_048,
        }),
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'term-1',
      cwd: '/repo',
      detail: '/repo',
      endedAtMs: BASE_MS + 2_000,
      outputBytesTotal: 2_048,
    });
  });

  it('后到行缺失字段不会抹掉先到行的有效字段', () => {
    const rows = buildRows({
      tasks: [
        makeTask({
          id: 'T-1',
          status: 'running',
          assignedAgent: 'scout',
          sessionId: 'child-1',
          startedAt: BASE_MS,
        }),
        makeTask({ id: 'T-1', status: 'running', assignedAgent: undefined, sessionId: undefined }),
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agent: 'scout', detail: '@scout', sessionId: 'child-1' });
  });

  it('终态不会被迟到但更旧的活跃快照回退', () => {
    const rows = buildRows({
      tasks: [
        makeTask({
          id: 'T-1',
          status: 'completed',
          startedAt: BASE_MS,
          completedAt: BASE_MS + 1_000,
        }),
        makeTask({ id: 'T-1', status: 'running', startedAt: BASE_MS }),
      ],
    });

    expect(rows.map((row) => row.state)).toEqual(['succeeded']);
  });

  it('不同 kind 的同名 key 互不影响', () => {
    const rows = buildRows({
      tasks: [makeTask({ id: 'shared-id', status: 'running', startedAt: BASE_MS })],
      terminals: [makeTerminal({ terminalId: 'shared-id', status: 'running' })],
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.kind)).toEqual(['subagent', 'shell']);
  });
});

describe('buildBackgroundTaskRows 缺失字段兜底', () => {
  it('shell 用命令首行作标题，command 为空时给「未命名命令」', () => {
    const rows = buildRows({
      terminals: [
        makeTerminal({ terminalId: 'term-multi', command: '\n  npm run dev\n--host 0.0.0.0' }),
        makeTerminal({ terminalId: 'term-empty', command: '   ' }),
      ],
    });

    expect(rows.find((row) => row.key === 'term-multi')?.title).toBe('npm run dev');
    expect(rows.find((row) => row.key === 'term-empty')?.title).toBe('未命名命令');
  });

  it('subagent 标题为空时给「未命名任务」，detail 为 @agent', () => {
    const rows = buildRows({
      tasks: [makeTask({ id: 'T-1', title: '  ', assignedAgent: 'web-researcher' })],
    });

    expect(rows[0]).toMatchObject({
      title: '未命名任务',
      detail: '@web-researcher',
      agent: 'web-researcher',
    });
  });

  it('startedAt 缺失时退回 createdAt，createdAt 也不可信时为 0', () => {
    const rows = buildRows({
      tasks: [
        makeTask({ id: 'T-created', status: 'running', createdAt: BASE_MS - 5_000 }),
        makeTask({ id: 'T-zero', status: 'running', createdAt: 0, startedAt: 0 }),
      ],
    });

    expect(rows.find((row) => row.key === 'T-created')?.startedAtMs).toBe(BASE_MS - 5_000);
    expect(rows.find((row) => row.key === 'T-zero')?.startedAtMs).toBe(0);
  });

  it('活跃行不暴露 endedAtMs，终态行才带结束时间', () => {
    const rows = buildRows({
      tasks: [
        makeTask({
          id: 'T-running',
          status: 'running',
          startedAt: BASE_MS,
          completedAt: BASE_MS + 9_000,
        }),
        makeTask({
          id: 'T-done',
          status: 'completed',
          startedAt: BASE_MS,
          completedAt: BASE_MS + 9_000,
        }),
      ],
    });

    expect(rows.find((row) => row.key === 'T-running')?.endedAtMs).toBeUndefined();
    expect(rows.find((row) => row.key === 'T-done')?.endedAtMs).toBe(BASE_MS + 9_000);
  });

  it('foreground 终端（阻塞 bash / 用户交互终端）不入行，background 与 tmux 保留', () => {
    const rows = buildRows({
      terminals: [
        makeTerminal({ terminalId: 'term-fg-bash', kind: 'foreground', toolName: 'bash' }),
        makeTerminal({
          terminalId: 'term-fg-quick',
          kind: 'foreground',
          toolName: 'quick_terminal',
          command: '(交互终端)',
        }),
        makeTerminal({
          terminalId: 'term-bg',
          kind: 'background',
          toolName: 'run_bash_in_background',
        }),
        makeTerminal({ terminalId: 'term-tmux', kind: 'tmux', toolName: 'interactive_bash' }),
      ],
    });

    expect(rows.map((row) => row.terminalId)).toEqual(['term-bg', 'term-tmux']);
  });

  it('shell 行携带 terminalId / command / cwd / 输出字节与 terminalKind', () => {
    const rows = buildRows({
      terminals: [
        makeTerminal({
          terminalId: 'term-1',
          kind: 'tmux',
          command: 'top',
          cwd: '/repo/app',
          outputBytesTotal: 4_096,
          sessionId: 'session-9',
        }),
      ],
    });

    expect(rows[0]).toMatchObject({
      key: 'term-1',
      kind: 'shell',
      terminalId: 'term-1',
      sessionId: 'session-9',
      command: 'top',
      cwd: '/repo/app',
      detail: '/repo/app',
      outputBytesTotal: 4_096,
      terminalKind: 'tmux',
    });
  });

  it('subagent 行携带 taskId / sessionId 与模型侧主键', () => {
    const rows = buildRows({
      tasks: [
        makeTask({
          id: 'T-42',
          status: 'running',
          sessionId: 'child-session-42',
          startedAt: BASE_MS + 1_000,
        }),
      ],
    });

    expect(rows[0]).toMatchObject({
      key: 'T-42',
      kind: 'subagent',
      taskId: 'T-42',
      sessionId: 'child-session-42',
      startedAtMs: BASE_MS + 1_000,
    });
  });
});

describe('buildBackgroundTaskRows 排队时长', () => {
  it('pending 且已有 startedAt 用 startedAt - createdAt', () => {
    const rows = buildRows({
      tasks: [
        makeTask({ id: 'T-1', status: 'pending', createdAt: BASE_MS, startedAt: BASE_MS + 3_000 }),
      ],
    });

    expect(rows.map((row) => row.queuedMs)).toEqual([3_000]);
  });

  it('pending 且未 startedAt 用 now - createdAt', () => {
    const rows = buildRows({
      now: NOW_MS,
      tasks: [makeTask({ id: 'T-1', status: 'pending', createdAt: BASE_MS })],
    });

    expect(rows.map((row) => row.queuedMs)).toEqual([NOW_MS - BASE_MS]);
  });

  it('时钟回拨导致负值时夹到 0', () => {
    const rows = buildRows({
      tasks: [
        makeTask({ id: 'T-1', status: 'pending', createdAt: BASE_MS, startedAt: BASE_MS - 1_000 }),
      ],
    });

    expect(rows.map((row) => row.queuedMs)).toEqual([0]);
  });

  it('非 pending 行不带排队时长', () => {
    const rows = buildRows({
      tasks: [
        makeTask({
          id: 'T-run',
          status: 'running',
          createdAt: BASE_MS,
          startedAt: BASE_MS + 1_000,
        }),
        makeTask({
          id: 'T-done',
          status: 'completed',
          createdAt: BASE_MS,
          startedAt: BASE_MS + 1_000,
          completedAt: BASE_MS + 2_000,
        }),
      ],
    });

    expect(rows.every((row) => row.queuedMs === undefined)).toBe(true);
  });
});

describe('buildBackgroundTaskSummary', () => {
  it('空输入返回空行与全 0 汇总', () => {
    const rows = buildRows({});

    expect(rows).toEqual([]);
    expect(buildBackgroundTaskSummary(rows)).toEqual({
      runningSubagents: 0,
      runningShells: 0,
      activeTotal: 0,
    });
  });

  it('区分运行中的两个分项，并把 pending 计入 activeTotal', () => {
    const rows = buildRows({
      tasks: [
        makeTask({ id: 'T-run-1', status: 'running', startedAt: BASE_MS }),
        makeTask({ id: 'T-run-2', status: 'running', startedAt: BASE_MS + 1 }),
        makeTask({ id: 'T-pending', status: 'pending' }),
        makeTask({
          id: 'T-done',
          status: 'completed',
          startedAt: BASE_MS,
          completedAt: BASE_MS + 1,
        }),
      ],
      terminals: [
        makeTerminal({ terminalId: 'term-run', status: 'running' }),
        makeTerminal({
          terminalId: 'term-exited',
          status: 'exited',
          exitCode: 0,
          endedAtMs: BASE_MS + 1,
        }),
      ],
    });

    expect(buildBackgroundTaskSummary(rows)).toEqual({
      runningSubagents: 2,
      runningShells: 1,
      activeTotal: 4,
    });
  });
});
