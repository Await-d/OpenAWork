import { describe, expect, it } from 'vitest';
import type { GraphNode, GraphNodeKind } from '../../../data/build-knowledge-graph.js';
import type { GraphNodeModel } from './knowledge-graph-model.js';
import {
  GRAPH_TOOLTIP_CLASS,
  GRAPH_TOOLTIP_DETAIL_CLASS,
  GRAPH_TOOLTIP_KIND_CLASS,
  GRAPH_TOOLTIP_PERSISTED_CLASS,
  GRAPH_TOOLTIP_TITLE_CLASS,
  buildGraphTooltipElement,
  graphTooltipDetail,
  graphTooltipKindLabel,
} from './knowledge-graph-tooltip.js';

function makeModel(overrides: {
  id: string;
  kind: GraphNodeKind;
  label: string;
  detail?: string | null;
  content?: string | null;
  phase?: string | null;
  persisted?: boolean;
}): GraphNodeModel {
  const node: GraphNode = {
    id: overrides.id,
    kind: overrides.kind,
    label: overrides.label,
    group: 'knowledge',
    content: overrides.content ?? null,
    detail: overrides.detail ?? null,
    memoryType: null,
    persistedMemoryId: overrides.persisted ? 'mem-1' : null,
    roleLayers: null,
    searchText: null,
    sourceRef: overrides.id,
    state: overrides.phase ?? null,
  };
  return {
    id: overrides.id,
    kind: overrides.kind,
    group: 'knowledge',
    label: overrides.label,
    detail: overrides.detail ?? null,
    phase: overrides.phase ?? null,
    depth: 1,
    persisted: overrides.persisted ?? false,
    roleLayers: null,
    node,
  };
}

describe('graphTooltipKindLabel', () => {
  it('artifact 拼接 PHASE_LABELS 阶段文案，其它类型只显示类型', () => {
    expect(
      graphTooltipKindLabel(makeModel({ id: 'a', kind: 'artifact', label: '规格', phase: 'spec' })),
    ).toBe('产物 · 规格');
    expect(
      graphTooltipKindLabel(
        makeModel({ id: 'b', kind: 'artifact', label: '未知阶段', phase: 'unknown' }),
      ),
    ).toBe('产物 · unknown');
    expect(graphTooltipKindLabel(makeModel({ id: 'c', kind: 'memory', label: '记忆' }))).toBe(
      '记忆',
    );
    expect(graphTooltipKindLabel(makeModel({ id: 'd', kind: 'architecture', label: '架构' }))).toBe(
      '架构',
    );
  });
});

describe('graphTooltipDetail', () => {
  it('优先 detail，回退 content，超长截断', () => {
    expect(
      graphTooltipDetail(
        makeModel({ id: 'a', kind: 'knowledge', label: 'x', detail: '详情', content: '正文' }),
      ),
    ).toBe('详情');
    expect(
      graphTooltipDetail(
        makeModel({ id: 'b', kind: 'knowledge', label: 'x', detail: '  ', content: '正文' }),
      ),
    ).toBe('正文');
    const long = '很长的详情'.repeat(40);
    const excerpt = graphTooltipDetail(
      makeModel({ id: 'c', kind: 'knowledge', label: 'x', detail: long }),
    );
    expect(excerpt).not.toBeNull();
    expect(excerpt?.endsWith('…')).toBe(true);
    expect((excerpt ?? '').length).toBeLessThan(long.length);
  });

  it('无详情且无正文时返回 null', () => {
    expect(graphTooltipDetail(makeModel({ id: 'a', kind: 'knowledge', label: 'x' }))).toBeNull();
  });
});

describe('buildGraphTooltipElement', () => {
  it('渲染标签、类型与详情，已入库节点带「已入库」标记', () => {
    const element = buildGraphTooltipElement(
      makeModel({
        id: 'artifact:spec',
        kind: 'artifact',
        label: '知识图谱迁移规格',
        detail: '从 Canvas2D 迁移到 G6 v5',
        phase: 'spec',
        persisted: true,
      }),
    );

    expect(element.className).toBe(GRAPH_TOOLTIP_CLASS);
    expect(element.querySelector(`.${GRAPH_TOOLTIP_TITLE_CLASS}`)?.textContent).toBe(
      '知识图谱迁移规格',
    );
    expect(element.querySelector(`.${GRAPH_TOOLTIP_KIND_CLASS}`)?.textContent).toBe('产物 · 规格');
    expect(element.querySelector(`.${GRAPH_TOOLTIP_DETAIL_CLASS}`)?.textContent).toBe(
      '从 Canvas2D 迁移到 G6 v5',
    );
    expect(element.querySelector(`.${GRAPH_TOOLTIP_PERSISTED_CLASS}`)?.textContent).toBe('已入库');
  });

  it('未入库且无详情时不渲染标记与详情节点', () => {
    const element = buildGraphTooltipElement(
      makeModel({ id: 'artifact:plan', kind: 'artifact', label: '计划', phase: 'plan' }),
    );
    expect(element.querySelector(`.${GRAPH_TOOLTIP_PERSISTED_CLASS}`)).toBeNull();
    expect(element.querySelector(`.${GRAPH_TOOLTIP_DETAIL_CLASS}`)).toBeNull();
  });
});
