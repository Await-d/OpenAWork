// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { GraphNode } from '../../data/build-knowledge-graph.js';
import { KnowledgeNodeInspector } from './workspace-knowledge-graph-inspector.js';

afterEach(() => {
  cleanup();
});

function createKnowledgeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    content: '# Spec\n人工整理后的工作区知识。',
    detail: '人工整理后的工作区知识。',
    group: 'knowledge',
    id: 'artifact:spec',
    kind: 'artifact',
    label: '需求规格',
    memoryType: 'project_context',
    persistedMemoryId: null,
    persistedValue: null,
    roleLayers: null,
    searchText: '人工整理后的工作区知识。',
    sourceRef: 'artifact:spec',
    state: 'spec',
    ...overrides,
  };
}

function renderInspector(node: GraphNode): void {
  render(
    <KnowledgeNodeInspector
      activeRoleLayer={null}
      error={null}
      localGraphAutoApplied={false}
      localGraphDepth={0}
      message={null}
      node={node}
      persistable={node.kind !== 'workspace' && node.kind !== 'category'}
      saving={false}
      selectedRoleLayers={node.roleLayers}
      onLocalGraphDepthChange={vi.fn()}
      onPersist={vi.fn()}
      onToggleRoleLayer={vi.fn()}
      onUseAllRoleLayers={vi.fn()}
      onUseAutoLocalGraph={vi.fn()}
    />,
  );
}

describe('KnowledgeNodeInspector', () => {
  it('已入库节点提示更新会保留已入库正文', () => {
    renderInspector(
      createKnowledgeNode({
        persistedMemoryId: 'memory-1',
        persistedValue: '后端人工整理知识正文。',
        roleLayers: ['pm1'],
      }),
    );

    expect(screen.getByText('已入库')).toBeTruthy();
    expect(screen.getByText('更新会保留当前已入库正文，并同步 AI 层级读取范围。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '更新入库范围' })).toBeTruthy();
  });

  it('未入库节点不显示更新保护提示', () => {
    renderInspector(createKnowledgeNode());

    expect(screen.getByText('未入库')).toBeTruthy();
    expect(screen.queryByText('更新会保留当前已入库正文，并同步 AI 层级读取范围。')).toBeNull();
    expect(screen.getByRole('button', { name: '入库' })).toBeTruthy();
  });
});
