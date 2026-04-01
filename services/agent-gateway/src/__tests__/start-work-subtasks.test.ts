import { describe, expect, it } from 'vitest';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { AgentTaskGraph } from '@openAwork/agent-core';
import {
  buildStartWorkTaskTags,
  buildWorkflowPlanSubtaskIdempotencyKey,
  createTaskUpdateEvent,
  createWorkflowPlanSubtasks,
  findReusableStartWorkTask,
  toTaskUpdateStatus,
} from '../routes/start-work-subtasks.js';

function createGraph(): AgentTaskGraph {
  return {
    projectRoot: '/tmp/openawork-start-work-subtasks',
    tasks: {},
    runs: {},
    interactions: {},
    sessionContexts: {},
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('start-work-subtasks helpers', () => {
  it('creates child tasks from pending workflow items and emits parent-linked task updates', () => {
    const taskManager = new AgentTaskManagerImpl();
    const graph = createGraph();
    const rootTask = taskManager.addTask(graph, {
      title: '执行计划：子任务计划',
      description: '继续执行工作计划',
      status: 'pending',
      blockedBy: [],
      sessionId: 'session-1',
      priority: 'high',
      tags: ['start-work', 'workflow', 'plan'],
    });

    const subtasks = createWorkflowPlanSubtasks({
      graph,
      sessionId: 'session-1',
      parentTaskId: rootTask.id,
      taskManager,
      workflowPlan: {
        relativePath: '.agentdocs/workflow/plan.md',
        pendingItems: ['设计任务树模型', '接通任务面板展示'],
      },
    });

    expect(subtasks).toHaveLength(2);
    const firstSubtask = subtasks[0];
    const secondSubtask = subtasks[1];
    expect(firstSubtask).toBeDefined();
    expect(secondSubtask).toBeDefined();
    if (!firstSubtask || !secondSubtask) {
      throw new Error('Expected start-work subtasks to be created');
    }

    expect(firstSubtask).toMatchObject({
      kind: 'workflow_step',
      title: '设计任务树模型',
      subject: '设计任务树模型',
      blockedBy: [],
      parentTaskId: rootTask.id,
      sessionId: 'session-1',
      priority: 'high',
    });
    expect(secondSubtask).toMatchObject({
      kind: 'workflow_step',
      title: '接通任务面板展示',
      subject: '接通任务面板展示',
      blockedBy: [firstSubtask.id],
      parentTaskId: rootTask.id,
      sessionId: 'session-1',
      priority: 'medium',
    });

    const event = createTaskUpdateEvent({
      task: firstSubtask,
      status: 'pending',
      sessionId: 'session-1',
      commandId: 'slash-start-work',
      eventIdSuffix: 'subtask',
    });

    expect(event).toMatchObject({
      type: 'task_update',
      taskId: firstSubtask.id,
      label: '设计任务树模型',
      status: 'pending',
      sessionId: 'session-1',
      parentTaskId: rootTask.id,
      runId: 'command:session-1:slash-start-work',
    });
    expect(firstSubtask.idempotencyKey).toBe(
      buildWorkflowPlanSubtaskIdempotencyKey({
        parentTaskId: rootTask.id,
        relativePath: '.agentdocs/workflow/plan.md',
        title: '设计任务树模型',
      }),
    );
  });

  it('does not create duplicate subtasks for repeated or duplicated checklist items', () => {
    const taskManager = new AgentTaskManagerImpl();
    const graph = createGraph();
    const rootTask = taskManager.addTask(graph, {
      title: '执行计划：重复计划',
      description: '继续执行工作计划',
      status: 'pending',
      blockedBy: [],
      sessionId: 'session-1',
      priority: 'high',
      tags: ['start-work', 'workflow', 'plan'],
    });

    const firstRun = createWorkflowPlanSubtasks({
      graph,
      sessionId: 'session-1',
      parentTaskId: rootTask.id,
      taskManager,
      workflowPlan: {
        relativePath: '.agentdocs/workflow/repeat.md',
        pendingItems: ['同步计划任务', '同步计划任务', '更新任务面板'],
      },
    });
    const secondRun = createWorkflowPlanSubtasks({
      graph,
      sessionId: 'session-1',
      parentTaskId: rootTask.id,
      taskManager,
      workflowPlan: {
        relativePath: '.agentdocs/workflow/repeat.md',
        pendingItems: ['同步计划任务', '更新任务面板'],
      },
    });

    expect(firstRun).toHaveLength(2);
    expect(secondRun).toHaveLength(0);
    const children = Object.values(graph.tasks)
      .filter((task) => task.parentTaskId === rootTask.id)
      .sort((left, right) => left.createdAt - right.createdAt);
    const childTitles = children
      .filter((task) => task.parentTaskId === rootTask.id)
      .map((task) => task.title)
      .sort();
    expect(childTitles).toEqual(['同步计划任务', '更新任务面板']);
    expect(children[0]?.blockedBy).toEqual([]);
    expect(children[1]?.blockedBy).toEqual([children[0]?.id]);
  });

  it('relinks pending subtasks when checklist order changes', () => {
    const taskManager = new AgentTaskManagerImpl();
    const graph = createGraph();
    const rootTask = taskManager.addTask(graph, {
      title: '执行计划：顺序调整',
      description: '继续执行工作计划',
      status: 'pending',
      blockedBy: [],
      sessionId: 'session-1',
      priority: 'high',
      tags: ['start-work', 'workflow', 'plan'],
    });

    const initialRun = createWorkflowPlanSubtasks({
      graph,
      sessionId: 'session-1',
      parentTaskId: rootTask.id,
      taskManager,
      workflowPlan: {
        relativePath: '.agentdocs/workflow/reorder.md',
        pendingItems: ['第一步', '第二步'],
      },
    });
    const firstTask = initialRun[0];
    const secondTask = initialRun[1];
    expect(firstTask).toBeDefined();
    expect(secondTask).toBeDefined();
    if (!firstTask || !secondTask) {
      throw new Error('Expected initial subtasks to exist');
    }

    const reorderedRun = createWorkflowPlanSubtasks({
      graph,
      sessionId: 'session-1',
      parentTaskId: rootTask.id,
      taskManager,
      workflowPlan: {
        relativePath: '.agentdocs/workflow/reorder.md',
        pendingItems: ['第二步', '第一步'],
      },
    });

    expect(reorderedRun).toHaveLength(0);
    expect(graph.tasks[secondTask.id]?.blockedBy).toEqual([]);
    expect(graph.tasks[firstTask.id]?.blockedBy).toEqual([secondTask.id]);
  });

  it('reuses start-work root tasks only when workflow plan path matches', () => {
    const taskManager = new AgentTaskManagerImpl();
    const graph = createGraph();
    const reusableRoot = taskManager.addTask(graph, {
      title: '执行计划：共享标题',
      description: '继续执行工作计划',
      status: 'running',
      blockedBy: [],
      sessionId: 'session-1',
      priority: 'high',
      tags: buildStartWorkTaskTags({
        relativePath: '.agentdocs/workflow/plan-a.md',
        title: '共享标题',
      }),
      startedAt: 10,
    });

    const reused = findReusableStartWorkTask({
      graph,
      sessionId: 'session-1',
      workflowPlan: { relativePath: '.agentdocs/workflow/plan-a.md', title: '共享标题' },
    });
    const notReused = findReusableStartWorkTask({
      graph,
      sessionId: 'session-1',
      workflowPlan: { relativePath: '.agentdocs/workflow/plan-b.md', title: '共享标题' },
    });

    expect(reused?.id).toBe(reusableRoot.id);
    expect(notReused).toBeNull();
  });

  it('maps persisted task statuses to task_update statuses without resetting completed work', () => {
    expect(toTaskUpdateStatus('pending')).toBe('pending');
    expect(toTaskUpdateStatus('running')).toBe('in_progress');
    expect(toTaskUpdateStatus('completed')).toBe('done');
    expect(toTaskUpdateStatus('failed')).toBe('failed');
    expect(toTaskUpdateStatus('cancelled')).toBe('cancelled');
  });
});
