import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, SessionTask } from '@openAwork/web-client';
import {
  aggregateSubAgentTask,
  resolveSubAgentRunStatus,
  type SubAgentTaskEvidence,
} from './sub-agent-status.js';
import { buildSubAgentRunItems, getStatusLabel } from './sub-agent-run-list.js';

const NOW = 1_700_000_000_000;

function evidence(status: SessionTask['status'], updatedAt: number): SubAgentTaskEvidence {
  return { status, updatedAt };
}

function createTask(overrides: Partial<SessionTask> & { id: string }): SessionTask {
  return {
    blockedBy: [],
    completedSubtaskCount: 0,
    createdAt: NOW - 60_000,
    depth: 0,
    priority: 'medium',
    readySubtaskCount: 0,
    status: 'running',
    subtaskCount: 0,
    tags: [],
    title: '任务',
    unmetDependencyCount: 0,
    updatedAt: NOW,
    ...overrides,
  };
}

function createChildSession(id: string, overrides: Partial<Session> = {}): Session {
  return { id, ...overrides };
}

describe('aggregateSubAgentTask', () => {
  it('按 updatedAt 取最新：重启后的 running 覆盖更旧的 completed', () => {
    const aggregated = aggregateSubAgentTask([
      evidence('completed', NOW - 60_000),
      evidence('running', NOW - 1_000),
    ]);

    expect(aggregated?.status).toBe('running');
  });

  it('按 updatedAt 取最新：更新的 completed 覆盖旧的 running', () => {
    const aggregated = aggregateSubAgentTask([
      evidence('running', NOW - 60_000),
      evidence('completed', NOW - 1_000),
    ]);

    expect(aggregated?.status).toBe('completed');
  });

  it('updatedAt 相同时终态优先于非终态', () => {
    const aggregated = aggregateSubAgentTask([
      evidence('running', NOW),
      evidence('completed', NOW),
    ]);

    expect(aggregated?.status).toBe('completed');
  });

  it('空输入返回 null', () => {
    expect(aggregateSubAgentTask([])).toBeNull();
  });
});

describe('resolveSubAgentRunStatus 优先级', () => {
  it('子会话 paused → paused', () => {
    expect(resolveSubAgentRunStatus({ childStateStatus: 'paused', nowMs: NOW })).toBe('paused');
  });

  it('子会话 running + 父侧任务已终态 → running（新鲜运行事实优先）', () => {
    expect(
      resolveSubAgentRunStatus({
        childStateStatus: 'running',
        task: evidence('completed', NOW - 1_000),
        nowMs: NOW,
      }),
    ).toBe('running');
  });

  it('子会话 idle + 无任务 → ended', () => {
    expect(resolveSubAgentRunStatus({ childStateStatus: 'idle', task: null, nowMs: NOW })).toBe(
      'ended',
    );
  });

  it('子会话 idle + completed 任务 → completed', () => {
    expect(
      resolveSubAgentRunStatus({
        childStateStatus: 'idle',
        task: evidence('completed', NOW - 1_000),
        nowMs: NOW,
      }),
    ).toBe('completed');
  });

  it('子会话 idle + running 任务（超出宽限期）→ ended', () => {
    expect(
      resolveSubAgentRunStatus({
        childStateStatus: 'idle',
        task: evidence('running', NOW - 30_000),
        nowMs: NOW,
      }),
    ).toBe('ended');
  });

  it('子会话 idle + running 任务（宽限期内，派发 spin-up）→ running', () => {
    expect(
      resolveSubAgentRunStatus({
        childStateStatus: 'idle',
        task: evidence('running', NOW - 1_000),
        nowMs: NOW,
      }),
    ).toBe('running');
  });

  it('子会话 idle + failed 任务 → failed', () => {
    expect(
      resolveSubAgentRunStatus({
        childStateStatus: 'idle',
        task: evidence('failed', NOW - 30_000),
        nowMs: NOW,
      }),
    ).toBe('failed');
  });

  it('子会话快照缺失 + pending 任务 → pending', () => {
    expect(resolveSubAgentRunStatus({ task: evidence('pending', NOW - 30_000), nowMs: NOW })).toBe(
      'pending',
    );
  });

  it('子会话快照缺失 + running 任务 → running', () => {
    expect(resolveSubAgentRunStatus({ task: evidence('running', NOW - 30_000), nowMs: NOW })).toBe(
      'running',
    );
  });

  it('完全没有证据（live-only 子会话行）→ pending', () => {
    expect(resolveSubAgentRunStatus({ nowMs: NOW })).toBe('pending');
  });

  it('子会话 idle + 内部任务终态 → 内部任务终态', () => {
    expect(
      resolveSubAgentRunStatus({
        childStateStatus: 'idle',
        internalTasks: [evidence('failed', NOW - 1_000)],
        nowMs: NOW,
      }),
    ).toBe('failed');
  });

  it('子会话快照缺失 + 内部任务 running → running', () => {
    expect(
      resolveSubAgentRunStatus({
        internalTasks: [evidence('running', NOW - 1_000)],
        nowMs: NOW,
      }),
    ).toBe('running');
  });
});

describe('已报告症状回归', () => {
  it('症状 1：子代理已结束，父侧任务记录仍停在 running → 不再显示「运行中」', () => {
    const status = resolveSubAgentRunStatus({
      childStateStatus: 'idle',
      task: evidence('running', NOW - 30_000),
      nowMs: NOW,
    });

    expect(status).toBe('ended');
    expect(getStatusLabel(status)).toBe('已结束');
  });

  it('症状 2：子代理已结束且无任务记录 → 不再显示「待执行」', () => {
    const status = resolveSubAgentRunStatus({
      childStateStatus: 'idle',
      task: null,
      nowMs: NOW,
    });

    expect(status).not.toBe('pending');
    expect(status).toBe('ended');
    expect(getStatusLabel(status)).toBe('已结束');
  });

  it('症状 3：子代理仍在运行，父侧任务已是 completed / cancelled / failed → 仍显示「运行中」', () => {
    for (const terminalStatus of ['completed', 'cancelled', 'failed'] as const) {
      const status = resolveSubAgentRunStatus({
        childStateStatus: 'running',
        task: evidence(terminalStatus, NOW - 1_000),
        nowMs: NOW,
      });

      expect(status).toBe('running');
      expect(getStatusLabel(status)).toBe('运行中');
    }
  });
});

describe('buildSubAgentRunItems（chip 列表接入 resolver）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('已结束子代理的停滞 running 任务不会再把 chip 显示成「运行中」', () => {
    const items = buildSubAgentRunItems(
      [createChildSession('child-1', { state_status: 'idle' })],
      [createTask({ id: 'task-1', sessionId: 'child-1', updatedAt: NOW - 30_000 })],
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('ended');
  });

  it('同一子代理多条任务按 updatedAt 聚合，不受数组顺序影响', () => {
    const childSessions = [createChildSession('child-1', { state_status: 'running' })];
    const tasks = [
      createTask({
        id: 'task-old',
        sessionId: 'child-1',
        status: 'completed',
        updatedAt: NOW - 60_000,
      }),
      createTask({
        id: 'task-new',
        sessionId: 'child-1',
        status: 'running',
        updatedAt: NOW - 1_000,
      }),
    ];

    const forward = buildSubAgentRunItems(childSessions, tasks);
    const reversed = buildSubAgentRunItems(childSessions, [...tasks].reverse());

    expect(forward[0]?.status).toBe('running');
    expect(reversed[0]?.status).toBe('running');
  });

  it('无任务的 idle 子会话显示「已结束」，live-only 子会话保持「待执行」', () => {
    const items = buildSubAgentRunItems(
      [
        createChildSession('child-idle', { state_status: 'idle' }),
        createChildSession('child-live'),
      ],
      [],
    );

    const byId = new Map(items.map((item) => [item.sessionId, item.status]));
    expect(byId.get('child-idle')).toBe('ended');
    expect(byId.get('child-live')).toBe('pending');
  });
});
