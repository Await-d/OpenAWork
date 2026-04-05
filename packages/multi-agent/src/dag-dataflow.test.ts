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

  it('fails a node when executionTimeoutMs is exceeded', async () => {
    const runner = new DAGRunner();
    const dag = createDag(
      [
        { id: 'source', type: 'orchestrator', label: 'source', status: 'completed' },
        {
          id: 'timeout-node',
          type: 'subagent',
          label: 'Timeout node',
          status: 'pending',
          executionTimeoutMs: 10,
          retryPolicy: { maxRetries: 0, backoffMs: 1, escalateOnExhaustion: false },
        },
      ],
      [{ id: 'e1', source: 'source', target: 'timeout-node', dataFlow: 'parallel' }],
    );
    runner.store(dag);

    const failures: string[] = [];
    runner.subscribe('dag-1', (event) => {
      if (event.type === 'node_failed') {
        failures.push(event.error);
      }
    });

    await runner.executeWithRetry('dag-1', dag.nodes[1]!, 'delegated', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { ok: true };
    });

    expect(dag.nodes[1]?.status).toBe('failed');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('timed out after 10ms');
  });

  it('aborts the executor signal when executionTimeoutMs is exceeded', async () => {
    const runner = new DAGRunner();
    const dag = createDag(
      [
        { id: 'source', type: 'orchestrator', label: 'source', status: 'completed' },
        {
          id: 'abort-node',
          type: 'subagent',
          label: 'Abort node',
          status: 'pending',
          executionTimeoutMs: 10,
          retryPolicy: { maxRetries: 0, backoffMs: 1, escalateOnExhaustion: false },
        },
      ],
      [{ id: 'e1', source: 'source', target: 'abort-node', dataFlow: 'parallel' }],
    );
    runner.store(dag);

    let aborted = false;
    await runner.executeWithRetry(
      'dag-1',
      dag.nodes[1]!,
      'delegated',
      async (_node, _mode, signal) => {
        await new Promise<unknown>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
            },
            { once: true },
          );
        });
        return { ok: true };
      },
    );

    expect(aborted).toBe(true);
    expect(dag.nodes[1]?.status).toBe('failed');
  });

  it('retries a timed out node and completes on a later successful attempt', async () => {
    const runner = new DAGRunner();
    const dag = createDag(
      [
        { id: 'source', type: 'orchestrator', label: 'source', status: 'completed' },
        {
          id: 'retry-timeout-node',
          type: 'subagent',
          label: 'Retry timeout node',
          status: 'pending',
          executionTimeoutMs: 10,
          retryPolicy: { maxRetries: 1, backoffMs: 1, escalateOnExhaustion: false },
        },
      ],
      [{ id: 'e1', source: 'source', target: 'retry-timeout-node', dataFlow: 'parallel' }],
    );
    runner.store(dag);

    let attempt = 0;
    await runner.executeWithRetry('dag-1', dag.nodes[1]!, 'delegated', async () => {
      attempt += 1;
      if (attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return { ok: true, attempt };
    });

    expect(attempt).toBe(2);
    expect(dag.nodes[1]?.status).toBe('completed');
    expect(dag.nodes[1]?.output).toEqual({ ok: true, attempt: 2 });
  });
});
