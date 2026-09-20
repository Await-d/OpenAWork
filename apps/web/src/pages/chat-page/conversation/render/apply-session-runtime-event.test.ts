import { describe, expect, it } from 'vitest';
import type { SessionTask } from '@openAwork/web-client';
import {
  applySessionChildRuntimeEvent,
  applyTaskUpdateRuntimeEvent,
} from './apply-session-runtime-event.js';

function createTask(overrides: Partial<SessionTask> & { id: string }): SessionTask {
  return {
    blockedBy: [],
    completedSubtaskCount: 0,
    createdAt: 1_000,
    depth: 0,
    priority: 'medium',
    readySubtaskCount: 0,
    status: 'pending',
    subtaskCount: 0,
    tags: [],
    title: 'task',
    unmetDependencyCount: 0,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('applySessionChildRuntimeEvent', () => {
  it('会插入新子会话', () => {
    const next = applySessionChildRuntimeEvent([], { sessionId: 's1', title: 'child' });
    expect(next[0]?.id).toBe('s1');
  });

  it('会更新已有子会话标题', () => {
    const next = applySessionChildRuntimeEvent([{ id: 's1', title: 'old' } as never], {
      sessionId: 's1',
      title: 'new',
    });
    expect(next[0]?.title).toBe('new');
  });
});

describe('applyTaskUpdateRuntimeEvent', () => {
  it('会插入新任务', () => {
    const next = applyTaskUpdateRuntimeEvent([], {
      label: 'task',
      status: 'pending',
      taskId: 't1',
    });
    expect(next[0]?.id).toBe('t1');
  });

  it('会把 in_progress 归一化成 running', () => {
    const next = applyTaskUpdateRuntimeEvent([], {
      label: 'task',
      status: 'in_progress',
      taskId: 't1',
    });
    expect(next[0]?.status).toBe('running');
  });

  it('早于已有任务 updatedAt 的事件不会覆盖状态，也不补齐其它字段', () => {
    const previous = [
      createTask({ id: 't1', status: 'completed', updatedAt: 2_000, result: 'done' }),
    ];
    const next = applyTaskUpdateRuntimeEvent(previous, {
      errorMessage: '旧错误',
      label: 'task',
      occurredAt: 1_000,
      status: 'in_progress',
      taskId: 't1',
    });

    expect(next[0]?.status).toBe('completed');
    expect(next[0]?.updatedAt).toBe(2_000);
    expect(next[0]?.result).toBe('done');
    expect(next[0]?.errorMessage).toBeUndefined();
  });

  it('occurredAt 不早于已有任务 updatedAt 时仍正常合并', () => {
    const previous = [createTask({ id: 't1', status: 'pending', updatedAt: 2_000 })];
    const next = applyTaskUpdateRuntimeEvent(previous, {
      label: 'task',
      occurredAt: 2_000,
      status: 'in_progress',
      taskId: 't1',
    });

    expect(next[0]?.status).toBe('running');
    expect(next[0]?.updatedAt).toBe(2_000);
  });

  it('缺失 occurredAt 时保持原有到达顺序合并语义', () => {
    const previous = [createTask({ id: 't1', status: 'completed', updatedAt: 5_000 })];
    const next = applyTaskUpdateRuntimeEvent(previous, {
      label: 'task',
      status: 'in_progress',
      taskId: 't1',
    });

    expect(next[0]?.status).toBe('running');
  });
});
