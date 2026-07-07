import { AgentTaskManagerImpl, type AgentTaskGraph } from '@openAwork/agent-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __testing } from '../../routes/commands.js';

let workspaceRoot: string;

function createGraph(projectRoot: string): AgentTaskGraph {
  const now = Date.now();
  return {
    projectRoot,
    tasks: {},
    runs: {},
    interactions: {},
    sessionContexts: {},
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe('start-work gate commands', () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'openawork-start-work-gate-'));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { force: true, recursive: true });
  });

  it('完成声明不会完成任务，confirmed review 才会完成任务', async () => {
    const graph = createGraph(workspaceRoot);
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

    const doneResult = await __testing.executeStartWorkDoneClaimCommand({
      args: ['--task', task.id, '实现完成，测试通过。'],
      commandId: 'slash-start-work-done',
      graph,
      messages: [],
      metadataJson: '{}',
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(doneResult.card?.type).toBe('status');
    expect(graph.tasks[task.id]?.status).toBe('running');
    expect(graph.tasks[task.id]?.metadata?.['startWorkGate']).toMatchObject({
      completionBlocked: true,
      doneClaim: {
        summary: '实现完成，测试通过。',
      },
      executorClaimStatus: 'submitted',
    });

    const reviewResult = await __testing.executeStartWorkReviewCommand({
      args: ['--task', task.id, '--verdict', 'confirmed', '证据充分。'],
      commandId: 'slash-start-work-review',
      graph,
      messages: [],
      metadataJson: '{}',
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(reviewResult.events[0]?.type).toBe('task_update');
    expect(graph.tasks[task.id]?.status).toBe('completed');
    expect(graph.tasks[task.id]?.metadata?.['startWorkGate']).toMatchObject({
      completionBlocked: false,
      doneClaim: {
        summary: '实现完成，测试通过。',
      },
      review: {
        note: '证据充分。',
        verdict: 'confirmed',
      },
      verifierVerdict: 'confirmed',
    });
  });
});
