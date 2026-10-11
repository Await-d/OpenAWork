import { describe, expect, it } from 'vitest';
import type { AgentTask } from '@openAwork/agent-core';
import {
  buildBackgroundTaskNotFoundMessage,
  resolveBackgroundTask,
  type BackgroundTaskGraph as ResolvedTaskGraph,
} from '../../tools/sandbox/handlers/background.js';

/**
 * 回归背景：模型只拿到子代理通知里的 `<subagent sessionID …>`，却把它当
 * `task_id` 传给 `background_output`。旧实现只按 task 图主键查，必然 miss，
 * 再加上错误文案不含可用清单，模型只能反复盲试（同一子会话连试 4 次全败）。
 */

function makeTask(overrides: Partial<AgentTask> & Pick<AgentTask, 'id'>): AgentTask {
  return {
    assignedAgent: 'web-researcher',
    createdAt: 1_000,
    description: '调研 Jellyfin 主题生态',
    status: 'completed',
    title: '调研 Jellyfin 主题生态',
    updatedAt: 2_000,
    ...overrides,
  } as AgentTask;
}

function makeGraph(tasks: AgentTask[]): ResolvedTaskGraph {
  const byId: Record<string, AgentTask> = {};
  for (const task of tasks) {
    byId[task.id] = task;
  }
  return {
    sessionId: 'session-parent',
    tasks: byId,
  } as unknown as ResolvedTaskGraph;
}

describe('background_output 任务引用解析', () => {
  it('传 task 主键时精确命中', () => {
    const graph = makeGraph([
      makeTask({ id: 'task-1', sessionId: 'child-session-a' }),
      makeTask({ id: 'task-2', sessionId: 'child-session-b' }),
    ]);

    expect(resolveBackgroundTask(graph, 'task-2')?.id).toBe('task-2');
  });

  it('传子会话 ID 时按 sessionId 反查到对应任务', () => {
    const graph = makeGraph([
      makeTask({ id: 'task-1', sessionId: 'child-session-a' }),
      makeTask({ id: 'task-2', sessionId: 'child-session-b' }),
    ]);

    expect(resolveBackgroundTask(graph, 'child-session-b')?.id).toBe('task-2');
  });

  it('主键优先于 sessionId 反查', () => {
    // 极端边界：某任务主键恰好等于另一任务的子会话 ID，主键必须胜出。
    const graph = makeGraph([
      makeTask({ id: 'child-session-b', sessionId: 'child-session-a' }),
      makeTask({ id: 'task-2', sessionId: 'child-session-b' }),
    ]);

    expect(resolveBackgroundTask(graph, 'child-session-b')?.id).toBe('child-session-b');
  });

  it('两者都匹配不到时返回 null', () => {
    const graph = makeGraph([makeTask({ id: 'task-1', sessionId: 'child-session-a' })]);

    expect(resolveBackgroundTask(graph, 'unknown-ref')).toBeNull();
  });
});

describe('background_output 任务未找到时的诊断文案', () => {
  it('点明 sessionId / taskId 语义差异，并列出可用的 task_id', () => {
    const graph = makeGraph([
      makeTask({ id: 'task-old', sessionId: 'child-a', updatedAt: 1_000 }),
      makeTask({ id: 'task-new', sessionId: 'child-b', updatedAt: 9_000 }),
    ]);

    const message = buildBackgroundTaskNotFoundMessage({
      graph,
      reference: 'child-b',
      sessionId: 'session-parent',
    });

    expect(message).toContain('子会话 ID');
    expect(message).toContain('task_id=task-new');
    expect(message).toContain('task_id=task-old');
    // 按更新时间倒序，最近的任务排在最前面。
    expect(message.indexOf('task-new')).toBeLessThan(message.indexOf('task-old'));
    expect(message).toContain('sessionId=child-a');
  });

  it('当前会话没有任何任务时给出明确指引而不是空清单', () => {
    const message = buildBackgroundTaskNotFoundMessage({
      graph: makeGraph([]),
      reference: 'child-b',
      sessionId: 'session-parent',
    });

    expect(message).toContain('没有任何后台任务记录');
    expect(message).not.toContain('task_id=');
  });

  it('任务数超过上限时说明被截断', () => {
    const graph = makeGraph(
      Array.from({ length: 25 }, (_, index) =>
        makeTask({ id: `task-${index}`, sessionId: `child-${index}`, updatedAt: index }),
      ),
    );

    const message = buildBackgroundTaskNotFoundMessage({
      graph,
      reference: 'missing',
      sessionId: 'session-parent',
    });

    expect(message).toContain('共 25 个');
    expect(message).not.toContain('task_id=task-0\n');
  });
});
