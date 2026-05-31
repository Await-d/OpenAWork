import { describe, expect, it } from 'vitest';
import { buildKnowledgeGraph } from './build-knowledge-graph.js';
import type { HandoffEntry, LayerNode } from '../../../../stores/team/team-events.js';

function layer(partial: Partial<LayerNode> & Pick<LayerNode, 'sessionId' | 'roleLayer'>): LayerNode {
  return {
    parentSessionId: null,
    state: 'running',
    ...partial,
  };
}

describe('buildKnowledgeGraph', () => {
  it('为每个 session 生成 session 节点', () => {
    const graph = buildKnowledgeGraph({
      layerNodes: [
        layer({ sessionId: 'a', roleLayer: 'reception' }),
        layer({ sessionId: 'b', roleLayer: 'pm1', parentSessionId: 'a' }),
      ],
      handoffs: [],
    });
    const sessionNodes = graph.nodes.filter((n) => n.kind === 'session');
    expect(sessionNodes).toHaveLength(2);
    expect(sessionNodes.map((n) => n.sessionId).sort()).toEqual(['a', 'b']);
  });

  it('父子 session 之间生成 parent 边', () => {
    const graph = buildKnowledgeGraph({
      layerNodes: [
        layer({ sessionId: 'a', roleLayer: 'reception' }),
        layer({ sessionId: 'b', roleLayer: 'pm1', parentSessionId: 'a' }),
      ],
      handoffs: [],
    });
    const parentEdges = graph.edges.filter((e) => e.kind === 'parent');
    expect(parentEdges).toHaveLength(1);
    expect(parentEdges[0]).toMatchObject({ from: 'session:a', to: 'session:b' });
  });

  it('handoff 边从 to-session 的 parent 指向 to-session，并覆盖状态', () => {
    const handoff: HandoffEntry = {
      id: 'h1',
      state: 'completed',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'b',
      updatedAt: 1,
    };
    const graph = buildKnowledgeGraph({
      layerNodes: [
        layer({ sessionId: 'a', roleLayer: 'reception' }),
        layer({ sessionId: 'b', roleLayer: 'pm1', parentSessionId: 'a', state: 'running' }),
      ],
      handoffs: [handoff],
    });
    const handoffEdges = graph.edges.filter((e) => e.kind === 'handoff');
    expect(handoffEdges).toHaveLength(1);
    expect(handoffEdges[0]).toMatchObject({ from: 'session:a', to: 'session:b', state: 'completed' });
    const bNode = graph.nodes.find((n) => n.id === 'session:b');
    expect(bNode?.state).toBe('completed');
  });

  it('artifact 节点 + produces 边', () => {
    const graph = buildKnowledgeGraph({
      layerNodes: [layer({ sessionId: 'a', roleLayer: 'pm1' })],
      handoffs: [],
      artifacts: [{ id: 'art1', sessionId: 'a', phase: 'spec', title: 'Spec v1' }],
    });
    const artifactNodes = graph.nodes.filter((n) => n.kind === 'artifact');
    expect(artifactNodes).toHaveLength(1);
    expect(artifactNodes[0]).toMatchObject({ label: 'Spec v1', sessionId: 'a' });
    const producesEdges = graph.edges.filter((e) => e.kind === 'produces');
    expect(producesEdges).toHaveLength(1);
    expect(producesEdges[0]).toMatchObject({ from: 'session:a', to: 'artifact:art1' });
  });

  it('去重相同的边', () => {
    const graph = buildKnowledgeGraph({
      layerNodes: [
        layer({ sessionId: 'a', roleLayer: 'reception' }),
        layer({ sessionId: 'b', roleLayer: 'pm1', parentSessionId: 'a' }),
      ],
      handoffs: [],
      artifacts: [
        { id: 'art1', sessionId: 'a', phase: 'spec', title: 'S1' },
        { id: 'art1', sessionId: 'a', phase: 'spec', title: 'S1' },
      ],
    });
    const producesEdges = graph.edges.filter((e) => e.kind === 'produces');
    expect(producesEdges).toHaveLength(1);
  });

  it('空输入返回空图', () => {
    const graph = buildKnowledgeGraph({ layerNodes: [], handoffs: [] });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});
