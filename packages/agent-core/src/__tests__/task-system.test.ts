import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentTaskManagerImpl } from '../task-system/index.js';
import { AgentTaskStoreImpl } from '../task-system/index.js';
import type { AgentTaskGraph } from '../task-system/index.js';

function createGraph(): AgentTaskGraph {
  return {
    projectRoot: '/tmp/openawork-task-system',
    tasks: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('AgentTaskManagerImpl', () => {
  it('inherits parent session when creating a subtask', () => {
    const manager = new AgentTaskManagerImpl();
    const graph = createGraph();
    const parentTask = manager.addTask(graph, {
      title: '父任务',
      status: 'pending',
      blockedBy: [],
      sessionId: 'session-1',
      priority: 'high',
      tags: ['root'],
    });

    const childTask = manager.addTask(graph, {
      title: '子任务',
      status: 'pending',
      blockedBy: [],
      parentTaskId: parentTask.id,
      priority: 'medium',
      tags: ['child'],
    });

    expect(childTask.parentTaskId).toBe(parentTask.id);
    expect(childTask.sessionId).toBe('session-1');
  });

  it('rejects reparenting a task under its own descendant', () => {
    const manager = new AgentTaskManagerImpl();
    const graph = createGraph();
    const rootTask = manager.addTask(graph, {
      title: '根任务',
      status: 'pending',
      blockedBy: [],
      sessionId: 'session-1',
      priority: 'high',
      tags: ['root'],
    });
    const childTask = manager.addTask(graph, {
      title: '子任务',
      status: 'pending',
      blockedBy: [],
      parentTaskId: rootTask.id,
      priority: 'medium',
      tags: ['child'],
    });

    expect(() => {
      manager.updateTask(graph, rootTask.id, { parentTaskId: childTask.id });
    }).toThrow(/descendant/);
  });

  it('removes the whole subtask subtree and clears dependency links', () => {
    const manager = new AgentTaskManagerImpl();
    const graph = createGraph();
    const parentTask = manager.addTask(graph, {
      title: '父任务',
      status: 'pending',
      blockedBy: [],
      sessionId: 'session-1',
      priority: 'high',
      tags: ['root'],
    });
    const childTask = manager.addTask(graph, {
      title: '子任务',
      status: 'pending',
      blockedBy: [],
      parentTaskId: parentTask.id,
      priority: 'medium',
      tags: ['child'],
    });
    const siblingTask = manager.addTask(graph, {
      title: '同级任务',
      status: 'pending',
      blockedBy: [childTask.id],
      sessionId: 'session-1',
      priority: 'low',
      tags: ['sibling'],
    });

    manager.removeTask(graph, parentTask.id);

    expect(graph.tasks[parentTask.id]).toBeUndefined();
    expect(graph.tasks[childTask.id]).toBeUndefined();
    expect(graph.tasks[siblingTask.id]?.blockedBy).toEqual([]);
  });

  it('falls back to an empty graph when the persisted task graph JSON is corrupted', async () => {
    const store = new AgentTaskStoreImpl();
    const projectRoot = `/tmp/openawork-task-store-${Date.now()}-corrupt`;
    const tasksDir = path.join(projectRoot, '.agentdocs', 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(path.join(tasksDir, 'session-1.json'), '{not valid json', 'utf8');

    const graph = await store.load(projectRoot, 'session-1');

    expect(graph.projectRoot).toBe(projectRoot);
    expect(graph.tasks).toEqual({});
  });

  it('keeps valid tasks while dropping invalid persisted tasks', async () => {
    const store = new AgentTaskStoreImpl();
    const projectRoot = `/tmp/openawork-task-store-${Date.now()}-mixed`;
    const tasksDir = path.join(projectRoot, '.agentdocs', 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(
      path.join(tasksDir, 'session-2.json'),
      JSON.stringify({
        projectRoot: '/poisoned/root',
        createdAt: 1,
        updatedAt: 2,
        tasks: {
          valid: {
            id: 'valid',
            title: '合法任务',
            status: 'pending',
            blockedBy: [],
            sessionId: 'session-2',
            priority: 'high',
            tags: ['ok'],
            createdAt: 1,
            updatedAt: 2,
          },
          invalid: {
            id: 'invalid',
            title: '',
            status: 'mystery',
            blockedBy: 'bad',
          },
        },
      }),
      'utf8',
    );

    const graph = await store.load(projectRoot, 'session-2');

    expect(graph.projectRoot).toBe(projectRoot);
    expect(Object.keys(graph.tasks)).toEqual(['valid']);
    expect(graph.tasks['valid']?.title).toBe('合法任务');
  });
});
