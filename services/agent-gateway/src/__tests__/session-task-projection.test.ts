import { describe, expect, it } from 'vitest';
import type { AgentTaskGraph } from '@openAwork/agent-core';
import { buildSessionTaskProjection } from '../routes/session-task-projection.js';

function createGraph(): AgentTaskGraph {
  return {
    projectRoot: '/tmp/openawork-session-task-projection',
    createdAt: 1,
    updatedAt: 1,
    runs: {},
    interactions: {},
    sessionContexts: {},
    schemaVersion: 2,
    tasks: {
      root: {
        id: 'root',
        title: '根任务',
        status: 'running',
        blockedBy: [],
        sessionId: 'session-1',
        priority: 'high',
        tags: ['root'],
        createdAt: 10,
        updatedAt: 10,
      },
      child: {
        id: 'child',
        title: '子任务',
        status: 'completed',
        blockedBy: [],
        parentTaskId: 'root',
        sessionId: 'session-1',
        priority: 'medium',
        tags: ['child'],
        createdAt: 20,
        updatedAt: 20,
        completedAt: 21,
      },
      child_ready: {
        id: 'child_ready',
        title: '可执行子任务',
        status: 'pending',
        blockedBy: [],
        parentTaskId: 'root',
        sessionId: 'session-1',
        priority: 'medium',
        tags: ['child'],
        createdAt: 25,
        updatedAt: 25,
      },
      sibling: {
        id: 'sibling',
        title: '第二个根任务',
        status: 'pending',
        blockedBy: ['child'],
        sessionId: 'session-1',
        priority: 'low',
        tags: ['sibling'],
        createdAt: 30,
        updatedAt: 30,
      },
      foreign: {
        id: 'foreign',
        title: '其他会话任务',
        status: 'pending',
        blockedBy: [],
        sessionId: 'session-2',
        priority: 'low',
        tags: ['foreign'],
        createdAt: 40,
        updatedAt: 40,
      },
    },
  };
}

describe('buildSessionTaskProjection', () => {
  it('projects a session task tree with depth and subtask counts', () => {
    const projected = buildSessionTaskProjection(createGraph(), 'session-1');

    expect(projected).toHaveLength(4);
    expect(projected[0]).toMatchObject({
      id: 'root',
      kind: 'task',
      subject: '根任务',
      revision: 0,
      completedSubtaskCount: 1,
      depth: 0,
      readySubtaskCount: 1,
      subtaskCount: 2,
      unmetDependencyCount: 0,
    });
    expect(projected[1]).toMatchObject({
      id: 'child',
      completedSubtaskCount: 0,
      parentTaskId: 'root',
      depth: 1,
      subtaskCount: 0,
      unmetDependencyCount: 0,
    });
    expect(projected[2]).toMatchObject({
      id: 'child_ready',
      completedSubtaskCount: 0,
      depth: 1,
      readySubtaskCount: 0,
      subtaskCount: 0,
      unmetDependencyCount: 0,
    });
    expect(projected[3]).toMatchObject({
      id: 'sibling',
      completedSubtaskCount: 0,
      depth: 0,
      blockedBy: ['child'],
      readySubtaskCount: 0,
      unmetDependencyCount: 0,
    });
  });

  it('counts unmet dependencies for pending tasks whose blockers are not completed', () => {
    const graph = createGraph();
    const childTask = graph.tasks['child'];
    expect(childTask).toBeDefined();
    if (!childTask) {
      throw new Error('Expected child task to exist');
    }
    childTask.status = 'pending';
    childTask.completedAt = undefined;

    const projected = buildSessionTaskProjection(graph, 'session-1');

    expect(projected[3]).toMatchObject({
      id: 'sibling',
      unmetDependencyCount: 1,
    });
  });

  it('counts missing dependency ids as unmet dependencies', () => {
    const graph = createGraph();
    const siblingTask = graph.tasks['sibling'];
    expect(siblingTask).toBeDefined();
    if (!siblingTask) {
      throw new Error('Expected sibling task to exist');
    }
    siblingTask.blockedBy = ['missing-task'];

    const projected = buildSessionTaskProjection(graph, 'session-1');

    expect(projected[3]).toMatchObject({
      id: 'sibling',
      unmetDependencyCount: 1,
    });
  });

  it('includes delegated child-session tasks when parent projection opts in to descendant sessions', () => {
    const graph = createGraph();
    graph.tasks['delegated'] = {
      id: 'delegated',
      title: '委派子代理任务',
      status: 'completed',
      blockedBy: [],
      sessionId: 'child-session-1',
      assignedAgent: 'librarian',
      priority: 'medium',
      tags: ['task-tool', 'librarian'],
      createdAt: 26,
      updatedAt: 27,
      completedAt: 27,
      result: '文档抓取完成',
    };

    const projected = buildSessionTaskProjection(
      graph,
      'session-1',
      new Set(['session-1', 'child-session-1']),
    );
    const delegatedTask = projected.find((task) => task.id === 'delegated');

    expect(projected).toHaveLength(5);
    expect(delegatedTask).toMatchObject({
      id: 'delegated',
      kind: 'task',
      subject: '委派子代理任务',
      sessionId: 'child-session-1',
      assignedAgent: 'librarian',
      result: '文档抓取完成',
      depth: 0,
    });
  });
});
