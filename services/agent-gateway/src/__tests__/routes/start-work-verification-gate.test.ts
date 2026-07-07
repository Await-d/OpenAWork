import { AgentTaskManagerImpl, type AgentTaskGraph } from '@openAwork/agent-core';
import { describe, expect, it } from 'vitest';
import {
  applyStartWorkVerifierVerdict,
  createWorkflowPlanSubtasks,
  recordStartWorkDoneClaim,
} from '../../routes/start-work-subtasks.js';

function createGraph(): AgentTaskGraph {
  const now = Date.now();
  return {
    projectRoot: '/workspace',
    tasks: {},
    runs: {},
    interactions: {},
    sessionContexts: {},
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe('start-work verification gate', () => {
  it('新建计划子任务时写入等待 executor claim 和 verifier verdict 的 gate metadata', () => {
    const graph = createGraph();
    const taskManager = new AgentTaskManagerImpl();
    const parent = taskManager.addTask(graph, {
      title: '执行计划',
      status: 'running',
      blockedBy: [],
      sessionId: 'session-1',
      priority: 'high',
      tags: ['start-work'],
    });

    const [subtask] = createWorkflowPlanSubtasks({
      graph,
      parentTaskId: parent.id,
      sessionId: 'session-1',
      taskManager,
      workflowPlan: {
        pendingItems: ['T1 实现能力'],
        relativePath: '.agentdocs/workflow/demo.md',
      },
    });

    expect(subtask?.metadata?.['startWorkGate']).toEqual({
      completionBlocked: true,
      executorClaimStatus: 'missing',
      verifierVerdict: 'pending',
    });
  });

  it('executor DoneClaim 不会直接完成任务，confirmed verdict 才会完成', () => {
    const graph = createGraph();
    const taskManager = new AgentTaskManagerImpl();
    const task = taskManager.addTask(graph, {
      title: 'T1 实现能力',
      status: 'pending',
      blockedBy: [],
      sessionId: 'session-1',
      priority: 'high',
      tags: ['start-work', 'workflow', 'subtask'],
      metadata: {
        startWorkGate: {
          completionBlocked: true,
          executorClaimStatus: 'missing',
          verifierVerdict: 'pending',
        },
      },
    });
    taskManager.startTask(graph, task.id);

    recordStartWorkDoneClaim({
      graph,
      taskId: task.id,
      taskManager,
      summary: '实现完成，测试通过。',
    });
    expect(graph.tasks[task.id]?.status).toBe('running');
    expect(graph.tasks[task.id]?.metadata?.['startWorkGate']).toMatchObject({
      completionBlocked: true,
      executorClaimStatus: 'submitted',
    });

    applyStartWorkVerifierVerdict({
      graph,
      taskId: task.id,
      taskManager,
      verdict: 'confirmed',
      note: '证据充分。',
    });
    expect(graph.tasks[task.id]?.status).toBe('completed');
    expect(graph.tasks[task.id]?.metadata?.['startWorkGate']).toMatchObject({
      completionBlocked: false,
      doneClaim: {
        summary: '实现完成，测试通过。',
      },
      verifierVerdict: 'confirmed',
    });
  });

  it('needs-fix verdict 阻止任务完成', () => {
    const graph = createGraph();
    const taskManager = new AgentTaskManagerImpl();
    const task = taskManager.addTask(graph, {
      title: 'T1 实现能力',
      status: 'pending',
      blockedBy: [],
      sessionId: 'session-1',
      priority: 'high',
      tags: ['start-work', 'workflow', 'subtask'],
      metadata: {
        startWorkGate: {
          completionBlocked: true,
          executorClaimStatus: 'submitted',
          verifierVerdict: 'pending',
        },
      },
    });
    taskManager.startTask(graph, task.id);

    applyStartWorkVerifierVerdict({
      graph,
      taskId: task.id,
      taskManager,
      verdict: 'needs-fix',
      note: '缺少失败路径验证。',
    });

    expect(graph.tasks[task.id]?.status).toBe('running');
    expect(graph.tasks[task.id]?.metadata?.['startWorkGate']).toMatchObject({
      completionBlocked: true,
      verifierVerdict: 'needs-fix',
    });
  });
});
