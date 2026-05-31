import { describe, expect, it } from 'vitest';
import { MultiAgentOrchestratorImpl } from './orchestrator.js';
import type { AgentRole } from './types.js';

function role(name: string): AgentRole {
  return {
    id: name,
    displayName: name,
    systemPrompt: `you are ${name}`,
    capabilities: [],
  } as unknown as AgentRole;
}

describe('orchestrator cancel during interactive approval', () => {
  it('cancelDAG 解除挂起的审批门，executeDAG 不会永久挂起且终态 failed', async () => {
    // Interactive subagents park at `waitForApproval`. With no
    // `approvalTimeoutMs` the gate never auto-resolves, so before the fix
    // `cancelDAG` only flipped a flag the blocked `executeDAG` loop could
    // never observe (it was stuck inside `Promise.allSettled`). The fix
    // makes `cancelDAG` resolve pending approvals with `Cancel` so the
    // in-flight batch settles and the loop transitions to `failed`.
    const orchestrator = new MultiAgentOrchestratorImpl();
    const dag = await orchestrator.createDAG('goal', [role('a')]);

    const approvalRequired = new Promise<void>((resolve) => {
      const unsub = orchestrator.subscribeToEvents(dag.id, (event) => {
        if (event.type === 'human_approval_required') {
          unsub();
          resolve();
        }
      });
    });

    const run = orchestrator.executeDAG(dag.id, 'interactive');

    // Only cancel once a node is actually parked at the approval gate.
    await approvalRequired;
    await orchestrator.cancelDAG(dag.id);

    // Must resolve (not hang) — vitest's default timeout fails on regression.
    await run;

    const result = await orchestrator.getDAGStatus(dag.id);
    expect(result.status).toBe('failed');
  });

  it('resolveApproval(Proceed) 仍按正常路径执行（未被取消逻辑破坏）', async () => {
    const orchestrator = new MultiAgentOrchestratorImpl();
    const dag = await orchestrator.createDAG('goal', [role('a')]);

    const approvalRequired = new Promise<string>((resolve) => {
      const unsub = orchestrator.subscribeToEvents(dag.id, (event) => {
        if (event.type === 'human_approval_required') {
          unsub();
          resolve(event.nodeId);
        }
      });
    });

    const run = orchestrator.executeDAG(dag.id, 'interactive');
    const nodeId = await approvalRequired;
    orchestrator.resolveApproval(nodeId, 'Proceed');

    await run;
    const result = await orchestrator.getDAGStatus(dag.id);
    expect(result.status).toBe('completed');
  });
});
