import { describe, expect, it } from 'vitest';
import { DAGRunner } from './dag.js';
import type { AgentDAG, DAGNode, DAGEdge } from './types.js';

function createDag(nodes: DAGNode[], edges: DAGEdge[]): AgentDAG {
  return {
    id: 'dag-1',
    sessionId: 'session-1',
    nodes,
    edges,
    status: 'running',
    createdAt: Date.now(),
  };
}

describe('DAGRunner dataFlow semantics', () => {
  it('returns all parallel targets as ready together', () => {
    const runner = new DAGRunner();
    runner.store(
      createDag(
        [
          { id: 'source', type: 'orchestrator', label: 'source', status: 'completed' },
          { id: 'a', type: 'subagent', label: 'A', status: 'pending' },
          { id: 'b', type: 'subagent', label: 'B', status: 'pending' },
        ],
        [
          { id: 'e1', source: 'source', target: 'a', dataFlow: 'parallel' },
          { id: 'e2', source: 'source', target: 'b', dataFlow: 'parallel' },
        ],
      ),
    );

    expect(runner.getReadyNodes('dag-1').map((node) => node.id)).toEqual(['a', 'b']);
  });

  it('releases sequential targets one at a time in edge order', () => {
    const runner = new DAGRunner();
    const dag = createDag(
      [
        { id: 'source', type: 'orchestrator', label: 'source', status: 'completed' },
        { id: 'a', type: 'subagent', label: 'A', status: 'pending' },
        { id: 'b', type: 'subagent', label: 'B', status: 'pending' },
      ],
      [
        { id: 'e1', source: 'source', target: 'a', dataFlow: 'sequential' },
        { id: 'e2', source: 'source', target: 'b', dataFlow: 'sequential' },
      ],
    );
    runner.store(dag);

    expect(runner.getReadyNodes('dag-1').map((node) => node.id)).toEqual(['a']);

    runner.updateNodeStatus('dag-1', 'a', 'completed', { ok: true });
    expect(runner.getReadyNodes('dag-1').map((node) => node.id)).toEqual(['b']);
  });

  it('activates only the matching conditional edge based on source output branch', () => {
    const runner = new DAGRunner();
    const dag = createDag(
      [
        {
          id: 'source',
          type: 'orchestrator',
          label: 'source',
          status: 'completed',
          output: { branch: 'yes' },
        },
        { id: 'yes-node', type: 'subagent', label: 'Yes', status: 'pending' },
        { id: 'no-node', type: 'subagent', label: 'No', status: 'pending' },
      ],
      [
        {
          id: 'yes-edge',
          source: 'source',
          target: 'yes-node',
          dataFlow: 'conditional',
          label: 'yes',
        },
        {
          id: 'no-edge',
          source: 'source',
          target: 'no-node',
          dataFlow: 'conditional',
          label: 'no',
        },
      ],
    );
    runner.store(dag);

    expect(runner.getReadyNodes('dag-1').map((node) => node.id)).toEqual(['yes-node']);
  });

  it('emits edge_activated for inbound edges before running a node', async () => {
    const runner = new DAGRunner();
    const dag = createDag(
      [
        { id: 'source', type: 'orchestrator', label: 'source', status: 'completed' },
        { id: 'a', type: 'subagent', label: 'A', status: 'pending' },
      ],
      [{ id: 'e1', source: 'source', target: 'a', dataFlow: 'parallel' }],
    );
    runner.store(dag);

    const events: string[] = [];
    runner.subscribe('dag-1', (event) => {
      events.push(event.type);
    });

    await runner.executeWithRetry('dag-1', dag.nodes[1]!, 'delegated', async () => ({ ok: true }));

    expect(events.slice(0, 2)).toEqual(['edge_activated', 'node_started']);
  });

  it('emits role metadata for subagent lifecycle events', async () => {
    const runner = new DAGRunner();
    const dag = createDag(
      [
        { id: 'source', type: 'orchestrator', label: 'source', status: 'completed' },
        {
          id: 'a',
          type: 'subagent',
          label: 'A',
          status: 'pending',
          agentRole: {
            id: 'researcher',
            displayName: 'Researcher',
            description: 'Research tasks',
            systemPrompt: 'Research thoroughly',
            allowedTools: ['read'],
            canonicalRole: { coreRole: 'researcher', preset: 'explore', confidence: 'high' },
          },
        },
      ],
      [{ id: 'e1', source: 'source', target: 'a', dataFlow: 'parallel' }],
    );
    runner.store(dag);

    const events: Array<{ type: string; agentRoleId?: string; canonicalRole?: unknown }> = [];
    runner.subscribe('dag-1', (event) => {
      if (event.type === 'node_started' || event.type === 'node_completed') {
        events.push({
          type: event.type,
          agentRoleId: event.agentRoleId,
          canonicalRole: event.canonicalRole,
        });
      }
    });

    await runner.executeWithRetry('dag-1', dag.nodes[1]!, 'delegated', async () => ({ ok: true }));

    expect(events).toEqual([
      {
        type: 'node_started',
        agentRoleId: 'researcher',
        canonicalRole: { coreRole: 'researcher', preset: 'explore', confidence: 'high' },
      },
      {
        type: 'node_completed',
        agentRoleId: 'researcher',
        canonicalRole: { coreRole: 'researcher', preset: 'explore', confidence: 'high' },
      },
    ]);
  });
});
