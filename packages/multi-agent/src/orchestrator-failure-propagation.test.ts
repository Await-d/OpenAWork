import { describe, expect, it } from 'vitest';
import { MultiAgentOrchestratorImpl } from './orchestrator.js';
import type { AgentRole, DAGNode, WorkflowMode } from './types.js';

function role(name: string): AgentRole {
  return {
    id: name,
    displayName: name,
    systemPrompt: `you are ${name}`,
    capabilities: [],
  } as unknown as AgentRole;
}

describe('orchestrator failure propagation', () => {
  it('上游节点失败时下游不会死循环，DAG 终态为 failed 且下游标记 failed', async () => {
    // Executor fails the orchestrator (root) node; subagents depend on it.
    const executor = (node: DAGNode, _mode: WorkflowMode, _signal: AbortSignal) => {
      if (node.type === 'orchestrator') {
        return Promise.reject(new Error('root planning failed'));
      }
      return Promise.resolve({ nodeId: node.id, ok: true });
    };
    const orchestrator = new MultiAgentOrchestratorImpl(executor);
    const dag = await orchestrator.createDAG('goal', [role('a'), role('b')]);

    // Must resolve (not hang). Vitest's default timeout fails the test if the
    // old infinite-spin regressed.
    await orchestrator.executeDAG(dag.id, 'delegated');

    const result = await orchestrator.getDAGStatus(dag.id);
    expect(result.status).toBe('failed');

    const orchestratorNode = result.nodes.find((n) => n.type === 'orchestrator');
    expect(orchestratorNode?.status).toBe('failed');

    // Downstream subagents could never run → resolved to failed, not stuck pending.
    const subagents = result.nodes.filter((n) => n.type === 'subagent');
    expect(subagents.length).toBeGreaterThan(0);
    for (const sub of subagents) {
      expect(sub.status).toBe('failed');
    }
  });

  it('全部成功时 DAG 终态为 completed', async () => {
    const orchestrator = new MultiAgentOrchestratorImpl();
    const dag = await orchestrator.createDAG('goal', [role('a')]);
    await orchestrator.executeDAG(dag.id, 'delegated');
    const result = await orchestrator.getDAGStatus(dag.id);
    expect(result.status).toBe('completed');
  });
});
