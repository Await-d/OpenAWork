import { describe, expect, it } from 'vitest';
import { buildKnowledgeGraph } from './build-knowledge-graph.js';
import type { HandoffEntry, LayerNode } from '../../../../stores/team/team-events.js';

function layer(
  partial: Partial<LayerNode> & Pick<LayerNode, 'sessionId' | 'roleLayer'>,
): LayerNode {
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

  it('handoff 边直接使用真实 fromSessionId / toSessionId，并覆盖目标状态', () => {
    const handoff: HandoffEntry = {
      fromSessionId: 'actual-from',
      id: 'h1',
      state: 'completed',
      fromRoleLayer: 'reception',
      toSessionId: 'b',
      toRoleLayer: 'pm1',
      sessionId: 'b',
      updatedAt: 1,
    };
    const graph = buildKnowledgeGraph({
      layerNodes: [
        layer({ sessionId: 'actual-from', roleLayer: 'reception' }),
        layer({ sessionId: 'a', roleLayer: 'reception' }),
        layer({ sessionId: 'b', roleLayer: 'pm1', parentSessionId: 'a', state: 'running' }),
      ],
      handoffs: [handoff],
    });
    const handoffEdges = graph.edges.filter((e) => e.kind === 'handoff');
    expect(handoffEdges).toHaveLength(1);
    expect(handoffEdges[0]).toMatchObject({
      from: 'session:actual-from',
      to: 'session:b',
      state: 'completed',
    });
    const bNode = graph.nodes.find((n) => n.id === 'session:b');
    expect(bNode?.state).toBe('completed');
  });

  it('handoff 缺少 layerNodes 时，也会补占位 session 节点保持真实关系', () => {
    const graph = buildKnowledgeGraph({
      layerNodes: [],
      handoffs: [
        {
          fromSessionId: 'pm1-session',
          id: 'handoff-placeholder',
          state: 'running',
          fromRoleLayer: 'pm1',
          toSessionId: 'pm2-session',
          toRoleLayer: 'pm2',
          updatedAt: 1,
        },
      ],
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'session:pm1-session',
          layer: 'pm1',
          sessionId: 'pm1-session',
        }),
        expect.objectContaining({
          id: 'session:pm2-session',
          layer: 'pm2',
          sessionId: 'pm2-session',
          state: 'running',
        }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'handoff:handoff-placeholder',
          from: 'session:pm1-session',
          to: 'session:pm2-session',
          kind: 'handoff',
          state: 'running',
        }),
      ]),
    );
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
