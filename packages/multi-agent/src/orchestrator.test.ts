import { describe, expect, it, vi } from 'vitest';

vi.mock('@openAwork/agent-core', () => ({
  buildSubAgentPrompt: vi.fn((displayName: string, task: string) => `[${displayName}] ${task}`),
  isSubAgentPrompt: vi.fn(() => true),
}));

import { MultiAgentOrchestratorImpl } from './orchestrator.js';
import type { AgentRole, DAGNode } from './types.js';

const TEST_ROLE: AgentRole = {
  id: 'researcher',
  displayName: 'Researcher',
  description: 'Research tasks',
  systemPrompt: 'Research thoroughly',
  allowedTools: ['web_search'],
};

describe('MultiAgentOrchestratorImpl', () => {
  it('waits for approval before executing interactive subagent nodes', async () => {
    const executor = vi.fn(async () => ({ ok: true }));
    const orchestrator = new MultiAgentOrchestratorImpl(executor);
    const dag = await orchestrator.createDAG('Investigate issue', [TEST_ROLE]);
    const events: string[] = [];

    orchestrator.subscribeToEvents(dag.id, (event) => {
      events.push(event.type);
    });

    const execution = orchestrator.executeDAG(dag.id, 'interactive');
    await waitFor(() => events.includes('human_approval_required'));

    expect(events).toContain('human_approval_required');
    expect(executor).toHaveBeenCalledTimes(1);

    orchestrator.resolveApproval(dag.nodes[1]!.id, 'Proceed');
    await execution;

    const status = await orchestrator.getDAGStatus(dag.id);
    console.log(
      `ORCH_RESULT=${JSON.stringify({
        dagStatus: status.status,
        nodeStatuses: status.nodes.map((node) => ({ id: node.id, status: node.status })),
      })}`,
    );

    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('marks a node skipped when approval resolves to Skip', async () => {
    const executor = vi.fn(async () => ({ ok: true }));
    const orchestrator = new MultiAgentOrchestratorImpl(executor);
    const dag = await orchestrator.createDAG('Investigate issue', [TEST_ROLE]);

    const execution = orchestrator.executeDAG(dag.id, 'interactive');
    await waitFor(() => typeof orchestrator.getDAGStatus === 'function');
    await waitForApprovalWindow(orchestrator, dag.nodes[1]!.id);
    orchestrator.resolveApproval(dag.nodes[1]!.id, 'Skip');
    await execution;

    const result = await orchestrator.getDAGStatus(dag.id);
    expect(result.nodes[1]?.status).toBe('skipped');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('injects built prompt into delegated subagent execution input', async () => {
    let receivedInput: Record<string, unknown> | null = null;
    const executor = vi.fn(async (node: DAGNode) => {
      receivedInput = (node.input ?? null) as Record<string, unknown> | null;
      return { ok: true };
    });
    const orchestrator = new MultiAgentOrchestratorImpl(executor);

    await orchestrator.delegateToSubagent({
      parentSessionId: 'session-1',
      role: TEST_ROLE,
      task: 'Search for current facts',
      context: { topic: 'weather' },
    });

    expect(receivedInput).toMatchObject({
      context: { topic: 'weather' },
      prompt: expect.any(String),
    });
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForApprovalWindow(
  orchestrator: MultiAgentOrchestratorImpl,
  nodeId: string,
): Promise<void> {
  await waitFor(() => {
    const pendingApprovals = orchestrator as unknown as {
      pendingApprovals?: Map<string, unknown>;
    };
    return pendingApprovals.pendingApprovals?.has(nodeId) ?? false;
  });
}
