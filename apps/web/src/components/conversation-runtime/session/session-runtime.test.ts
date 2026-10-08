// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { Session, SessionTask } from '@openAwork/web-client';
import {
  mergeChildSessions,
  mergeSessionTasks,
  mergeSessionTodoLanes,
  preserveEqualList,
  preserveEqualValue,
  resolveSessionStopCapability,
} from './session-runtime.js';

function resolve(
  overrides: Partial<Parameters<typeof resolveSessionStopCapability>[0]> = {},
): ReturnType<typeof resolveSessionStopCapability> {
  return resolveSessionStopCapability({
    canStopCurrentSessionStream: false,
    currentSessionId: 'session-1',
    remoteSessionBusyState: null,
    sessionStateStatus: null,
    streaming: false,
    ...overrides,
  });
}

describe('resolveSessionStopCapability', () => {
  it('本地流式中给出 precise', () => {
    expect(resolve({ streaming: true, sessionStateStatus: 'running' })).toBe('precise');
  });

  it('已接管活跃流时给出 precise', () => {
    expect(resolve({ canStopCurrentSessionStream: true })).toBe('precise');
  });

  it('远端运行中（status running）给出 best_effort', () => {
    expect(resolve({ remoteSessionBusyState: 'running', sessionStateStatus: 'running' })).toBe(
      'best_effort',
    );
  });

  it('等待审批 / 等待回答的暂停必须为 none，不能退化成停止按钮', () => {
    expect(
      resolve({
        remoteSessionBusyState: 'paused',
        sessionStateStatus: 'paused',
      }),
    ).toBe('none');
  });

  it('仍有待审批交互时优先于 running 瞬态（批量审批续跑场景）', () => {
    expect(
      resolve({
        remoteSessionBusyState: 'paused',
        sessionStateStatus: 'running',
      }),
    ).toBe('none');
  });

  it('暂停优先于 observe_only（即使网关状态尚未收敛）', () => {
    expect(
      resolve({
        remoteSessionBusyState: 'paused',
        sessionStateStatus: 'idle',
      }),
    ).toBe('none');
  });

  it('远端运行但未接管原始请求时给出 observe_only', () => {
    expect(
      resolve({
        remoteSessionBusyState: 'running',
        sessionStateStatus: 'idle',
      }),
    ).toBe('observe_only');
  });

  it('空闲会话给出 none', () => {
    expect(resolve({ sessionStateStatus: 'idle' })).toBe('none');
  });
});

/**
 * 3s 轮询的引用稳定性契约。
 *
 * 回归背景：`loadSessionRuntimeSnapshot` 每 3s 跑一次。这些合并函数原先无条件
 * 返回新数组/新对象，导致每拍都击穿 `taskToolRuntimeLookup` 及其下游
 * `ChatGroupBlock` 的 `React.memo`——空闲会话也在每 3s 重渲染整张消息列表。
 */
describe('轮询快照的引用稳定性', () => {
  function session(id: string, updatedAt: number): Session {
    return { id, updatedAt, title: id } as unknown as Session;
  }

  function buildTask(overrides: Partial<SessionTask> & Pick<SessionTask, 'id'>): SessionTask {
    return {
      title: '子代理任务',
      status: 'pending',
      updatedAt: 0,
      completedSubtaskCount: 0,
      readySubtaskCount: 0,
      unmetDependencyCount: 0,
      subtaskCount: 0,
      ...overrides,
    } as unknown as SessionTask;
  }

  it('子会话无变化时 mergeChildSessions 返回同一个数组引用', () => {
    const previous = [session('a', 1), session('b', 1)];
    // 模拟重新反序列化：id/updatedAt 相同但对象引用全新
    const next = [session('a', 1), session('b', 1)];

    expect(mergeChildSessions(previous, next)).toBe(previous);
  });

  it('单个子会话更新时其余子会话仍复用旧引用', () => {
    const kept = session('a', 1);
    const previous = [kept, session('b', 1)];
    const next = [session('a', 1), session('b', 2)];

    const merged = mergeChildSessions(previous, next);

    expect(merged).not.toBe(previous);
    expect(merged[0]).toBe(kept);
    expect(merged[1]).toBe(next[1]);
  });

  it('子会话顺序变化视为真实变化（不复用旧引用）', () => {
    const previous = [session('a', 1), session('b', 1)];
    const next = [session('b', 1), session('a', 1)];

    expect(mergeChildSessions(previous, next)).not.toBe(previous);
  });

  it('子会话集合变化时不返回旧引用', () => {
    const previous = [session('a', 1)];
    const next = [session('a', 1), session('b', 1)];

    expect(mergeChildSessions(previous, next)).not.toBe(previous);
  });

  it('任务无变化时 mergeSessionTasks 返回同一个数组引用', () => {
    const previous = [buildTask({ id: 't1', status: 'completed', updatedAt: 1 })];
    const next = [buildTask({ id: 't1', status: 'completed', updatedAt: 1 })];

    expect(mergeSessionTasks(previous, next)).toBe(previous);
  });

  it('任务状态推进时换新引用', () => {
    const previous = [buildTask({ id: 't1', status: 'running', updatedAt: 1 })];
    const next = [buildTask({ id: 't1', status: 'completed', updatedAt: 2 })];

    expect(mergeSessionTasks(previous, next)).not.toBe(previous);
  });

  it('待办无变化时 mergeSessionTodoLanes 返回同一个数组引用', () => {
    const lanes = {
      main: [{ id: 'todo-1', content: '写文档', status: 'pending' }],
      temp: [],
    } as unknown as Parameters<typeof mergeSessionTodoLanes>[1];
    const previous = mergeSessionTodoLanes([], lanes);

    expect(mergeSessionTodoLanes(previous, lanes)).toBe(previous);
  });

  it('待办内容变化时换新引用', () => {
    const previous = mergeSessionTodoLanes([], {
      main: [{ id: 'todo-1', content: '写文档', status: 'pending' }],
      temp: [],
    } as unknown as Parameters<typeof mergeSessionTodoLanes>[1]);

    const next = mergeSessionTodoLanes(previous, {
      main: [{ id: 'todo-1', content: '写文档', status: 'in_progress' }],
      temp: [],
    } as unknown as Parameters<typeof mergeSessionTodoLanes>[1]);

    expect(next).not.toBe(previous);
  });

  it('preserveEqualValue 对深度等价对象沿用旧引用', () => {
    const previous = { runId: 'r1', startedAtMs: 100 };
    expect(preserveEqualValue(previous, { runId: 'r1', startedAtMs: 100 })).toBe(previous);
    expect(preserveEqualValue(previous, { runId: 'r1', startedAtMs: 200 })).not.toBe(previous);
    expect(preserveEqualValue<null>(null, null)).toBeNull();
  });

  it('preserveEqualValue 对嵌套字段变化不沿用旧引用（浅比较会误判）', () => {
    // WorkflowRuntimeState 的 activePlan / evidence 都是嵌套对象
    const previous = {
      mode: 'execution',
      activePlan: { path: 'a.md', progress: '1/8' },
      evidence: { artifactRefs: ['r1'], status: 'available' },
    };
    const sameContent = {
      mode: 'execution',
      activePlan: { path: 'a.md', progress: '1/8' },
      evidence: { artifactRefs: ['r1'], status: 'available' },
    };
    const progressChanged = {
      mode: 'execution',
      activePlan: { path: 'a.md', progress: '2/8' },
      evidence: { artifactRefs: ['r1'], status: 'available' },
    };
    const evidenceChanged = {
      mode: 'execution',
      activePlan: { path: 'a.md', progress: '1/8' },
      evidence: { artifactRefs: ['r1', 'r2'], status: 'available' },
    };

    expect(preserveEqualValue(previous, sameContent)).toBe(previous);
    expect(preserveEqualValue(previous, progressChanged)).not.toBe(previous);
    expect(preserveEqualValue(previous, evidenceChanged)).not.toBe(previous);
  });

  it('preserveEqualValue 对数组顺序敏感（顺序参与渲染）', () => {
    const previous = { refs: ['a', 'b'] };
    expect(preserveEqualValue(previous, { refs: ['b', 'a'] })).not.toBe(previous);
  });

  it('preserveEqualList 逐项复用未变元素的引用', () => {
    const kept = { id: 'p1' };
    const previous = [kept, { id: 'p2', nested: { deep: 1 } }];
    const next = [{ id: 'p1' }, { id: 'p2', nested: { deep: 1 } }];

    const preserved = preserveEqualList(previous, next);

    // 深度等价 → 逐项复用
    expect(preserved[0]).toBe(kept);
    expect(preserved[1]).toBe(previous[1]);
    expect(preserved).toBe(previous);
  });

  it('列表项嵌套字段变化时该项换新引用', () => {
    const previous = [{ id: 'p1', nested: { deep: 1 } }];
    const next = [{ id: 'p1', nested: { deep: 2 } }];

    expect(preserveEqualList(previous, next)).not.toBe(previous);
  });

  // ─── 陈旧渲染回归（必须保守判定，宁可多渲染也不可漏更新）──────────────────

  it('子会话 state_status 变化时换新引用，即使 updatedAt 相同（秒级精度盲区）', () => {
    const previous = [
      { id: 'c1', updatedAt: 1_000, state_status: 'running' } as unknown as Session,
    ];
    const next = [{ id: 'c1', updatedAt: 1_000, state_status: 'paused' } as unknown as Session];

    expect(mergeChildSessions(previous, next)).not.toBe(previous);
  });

  it('子会话 title 变化时换新引用', () => {
    const previous = [{ id: 'c1', updatedAt: 1, title: '旧标题' } as unknown as Session];
    const next = [{ id: 'c1', updatedAt: 1, title: '新标题' } as unknown as Session];

    expect(mergeChildSessions(previous, next)).not.toBe(previous);
  });

  it('子会话子状态 substate 变化时换新引用', () => {
    const previous = [{ id: 'c1', updatedAt: 1, substate: 'a' } as unknown as Session];
    const next = [{ id: 'c1', updatedAt: 1, substate: 'b' } as unknown as Session];

    expect(mergeChildSessions(previous, next)).not.toBe(previous);
  });

  it('任务派生计数变化时换新引用，即使父任务 updatedAt 不变（读时计算）', () => {
    // completedSubtaskCount / readySubtaskCount / unmetDependencyCount 由子任务
    // 状态实时计算，只 bump 子任务自己的 updatedAt，父任务时间戳不动。
    const previous = [
      buildTask({ id: 't1', status: 'running', completedSubtaskCount: 1, readySubtaskCount: 2 }),
    ];
    const next = [
      buildTask({ id: 't1', status: 'running', completedSubtaskCount: 2, readySubtaskCount: 1 }),
    ];

    expect(mergeSessionTasks(previous, next)).not.toBe(previous);
  });

  it('任务 unmetDependencyCount 变化时换新引用', () => {
    const previous = [buildTask({ id: 't1', unmetDependencyCount: 0 })];
    const next = [buildTask({ id: 't1', unmetDependencyCount: 1 })];

    expect(mergeSessionTasks(previous, next)).not.toBe(previous);
  });

  it('任务 result 回填但 status 未变时换新引用', () => {
    const previous = [buildTask({ id: 't1', status: 'running', result: undefined })];
    const next = [buildTask({ id: 't1', status: 'running', result: '完成' })];

    expect(mergeSessionTasks(previous, next)).not.toBe(previous);
  });

  it('任务 title 重命名时换新引用', () => {
    const previous = [buildTask({ id: 't1', title: '旧' })];
    const next = [buildTask({ id: 't1', title: '新' })];

    expect(mergeSessionTasks(previous, next)).not.toBe(previous);
  });

  it('待办内容变化时换新引用（逐字段浅比较，字段全为原始值）', () => {
    const previous = mergeSessionTodoLanes([], {
      main: [{ id: 'todo-1', content: '写文档', status: 'pending' }],
      temp: [],
    } as unknown as Parameters<typeof mergeSessionTodoLanes>[1]);

    const next = mergeSessionTodoLanes(previous, {
      main: [{ id: 'todo-1', content: '写文档', status: 'in_progress' }],
      temp: [],
    } as unknown as Parameters<typeof mergeSessionTodoLanes>[1]);

    expect(next).not.toBe(previous);
  });
});
