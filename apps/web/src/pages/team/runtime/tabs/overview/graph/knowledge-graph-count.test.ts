import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import {
  collapsedTopLevelExpansion,
  computeDescendantCounts,
  projectVisibleGraph,
} from './knowledge-graph-aggregation.js';
import { shouldShowNodeLabel } from './knowledge-graph-labels.js';
import {
  AGGREGATE_BADGE_INNER_RATIO,
  aggregateBadgeLayout,
  estimateLabelTextWidth,
  formatAggregateCount,
  resolveNodeLabelGeometry,
} from './knowledge-graph-label-text.js';
import { aggregateRadiusFor, nodeRadiusForModel } from './knowledge-graph-layout.js';
import { buildGraphModel } from './knowledge-graph-model.js';
import { buildNodeStyle, type GraphPalette } from './knowledge-graph-style.js';

const PALETTE: GraphPalette = {
  accent: '#6461f0',
  contrast: '#a06bff',
  complement: '#e0497a',
  aux: '#3aa0ff',
  success: '#38e2c1',
  warning: '#a06bff',
  chart1: '#6461f0',
  chart2: '#a06bff',
  chart3: '#3aa0ff',
  chart4: '#e0497a',
  chart5: '#c084fc',
  chart6: '#38e2c1',
  chart7: '#67e8f9',
  chart8: '#f0abfc',
  fgStrong: '#f3f4ff',
  fgDefault: '#c8ccca',
  fgMuted: '#8e94b8',
  fgSubtle: '#5a6088',
  bgBase: '#060818',
  bgOverlay: '#11142a',
  bgRaised: '#0a0c1f',
  borderSubtle: '#11111111',
  borderDefault: '#22222222',
  borderEmphasis: '#33333333',
};

function node(
  id: string,
  kind: GraphNode['kind'],
  label: string,
  group: GraphNode['group'],
): GraphNode {
  return {
    id,
    kind,
    label,
    group,
    content: null,
    detail: null,
    memoryType: null,
    persistedMemoryId: null,
    roleLayers: null,
    searchText: null,
    sourceRef: null,
    state: null,
  };
}

function edge(from: string, to: string): GraphEdge {
  return { id: `contains:${from}->${to}`, from, to, kind: 'contains', state: null };
}

/** workspace → category:knowledge（1055 后代）→ 两个中间节点 → 深层叶子。 */
function countFixture(): KnowledgeGraph {
  const nodes: GraphNode[] = [
    node('workspace:ws', 'workspace', '示例工作区', 'workspace'),
    node('category:knowledge', 'category', '知识产物', 'knowledge'),
    node('phase:spec', 'knowledge', '规格阶段', 'knowledge'),
    node('phase:plan', 'knowledge', '计划阶段', 'knowledge'),
  ];
  const edges: GraphEdge[] = [
    edge('workspace:ws', 'category:knowledge'),
    edge('category:knowledge', 'phase:spec'),
    edge('phase:spec', 'phase:plan'),
  ];
  for (let index = 0; index < 1053; index += 1) {
    const id = `leaf:${index}`;
    nodes.push(node(id, 'knowledge', `内容节点 ${index}`, 'knowledge'));
    edges.push(edge('phase:plan', id));
  }
  return { nodes, edges };
}

function styleFor(
  graph: KnowledgeGraph,
  collapsedIds: ReadonlySet<string>,
  counts: ReadonlyMap<string, number>,
) {
  const model = buildGraphModel(graph, { collapsedIds, counts });
  return (id: string) => {
    const entry = model.byId.get(id);
    if (!entry) {
      throw new Error(`missing model ${id}`);
    }
    return {
      entry,
      style: buildNodeStyle(entry, {
        colorMode: 'group',
        palette: PALETTE,
        focused: false,
        selected: false,
        dimmed: false,
        showLabel: true,
        radius: nodeRadiusForModel(entry),
      }),
      geometry: resolveNodeLabelGeometry({
        collapsed: entry.collapsed === true,
        count: entry.descendantCount ?? 0,
        depth: entry.depth,
        label: entry.label,
        radius: nodeRadiusForModel(entry),
      }),
    };
  };
}

describe('计数格式化唯一入口（D4）', () => {
  it('盘内徽标与标签尾部计数逐字相同（含紧凑值）', () => {
    const graph = countFixture();
    const counts = computeDescendantCounts(graph);
    const projection = projectVisibleGraph(graph, collapsedTopLevelExpansion(graph), { counts });
    const render = styleFor(projection.graph, projection.collapsedIds, projection.hiddenCounts);

    const category = render('category:knowledge');
    expect(category.style.iconText).toBe(formatAggregateCount(1055));
    expect(category.style.iconText).toBe('1.1k');
    expect(String(category.style.labelText).endsWith(` · ${category.style.iconText}`)).toBe(true);
    expect(category.geometry.badgeText).toBe(formatAggregateCount(1055));

    const workspace = render('workspace:ws');
    expect(String(workspace.style.labelText)).toContain(formatAggregateCount(1055));
  });

  it('小于 1000 的计数保持精确值，徽标与尾部仍然是同一个字符串', () => {
    expect(formatAggregateCount(0)).toBe('0');
    expect(formatAggregateCount(37)).toBe('37');
    expect(formatAggregateCount(942)).toBe('942');
    expect(formatAggregateCount(1000)).toBe('1.0k');
    expect(formatAggregateCount(1055)).toBe('1.1k');
  });
});

describe('有隐藏后代的节点始终暴露计数（D4）', () => {
  it('折叠概览下工作区根节点（已展开）也显示盘内计数，且与标签尾部计数一致', () => {
    const graph = countFixture();
    const counts = computeDescendantCounts(graph);
    const projection = projectVisibleGraph(graph, collapsedTopLevelExpansion(graph), { counts });
    const render = styleFor(projection.graph, projection.collapsedIds, projection.hiddenCounts);

    const workspace = render('workspace:ws');
    expect(workspace.style.iconText).toBe(formatAggregateCount(1055));
    expect(workspace.style.iconText).toBe('1.1k');
    expect(String(workspace.style.labelText)).toBe(`示例工作区 · ${workspace.style.iconText}`);
    expect(projection.hiddenCounts.get('workspace:ws')).toBe(1055);
  });

  it('工作区枢纽的盘半径按徽标可读下界托底，计数数字放得进盘内', () => {
    const graph = countFixture();
    const counts = computeDescendantCounts(graph);
    const projection = projectVisibleGraph(graph, collapsedTopLevelExpansion(graph), { counts });
    const render = styleFor(projection.graph, projection.collapsedIds, projection.hiddenCounts);

    const workspace = render('workspace:ws');
    const badge = aggregateBadgeLayout(formatAggregateCount(1055), 30);
    expect(nodeRadiusForModel(workspace.entry)).toBeGreaterThanOrEqual(badge.radius);
    expect(Number(workspace.style.size) / 2).toBeGreaterThanOrEqual(badge.radius);
    expect(workspace.geometry.discRadius).toBeGreaterThanOrEqual(badge.radius);
  });

  it('枢纽与折叠聚合共用同一条计数腿脚：盘内计数落在盘内并留出一致净空', () => {
    const graph = countFixture();
    const counts = computeDescendantCounts(graph);
    const projection = projectVisibleGraph(graph, collapsedTopLevelExpansion(graph), { counts });
    const render = styleFor(projection.graph, projection.collapsedIds, projection.hiddenCounts);

    const hub = render('workspace:ws');
    expect(nodeRadiusForModel(hub.entry)).toBeGreaterThanOrEqual(aggregateRadiusFor(1055));

    for (const entry of [hub, render('category:knowledge')]) {
      const discRadius = Number(entry.style.size) / 2;
      const fontSize = Number(entry.style.iconFontSize);
      const countText = String(entry.style.iconText);
      const halfWidth = estimateLabelTextWidth(countText, fontSize) / 2;
      const halfDiagonal = Math.hypot(halfWidth, fontSize / 2);
      expect(halfDiagonal).toBeLessThanOrEqual(discRadius * AGGREGATE_BADGE_INNER_RATIO + 1e-6);
      expect(discRadius - halfWidth).toBeGreaterThanOrEqual(0.2 * discRadius);
    }
  });

  it('中间层节点只要有隐藏后代就带计数（非顶层聚合同样如此）', () => {
    const graph = countFixture();
    const counts = computeDescendantCounts(graph);
    const expanded = new Set([...collapsedTopLevelExpansion(graph), 'category:knowledge']);
    const projection = projectVisibleGraph(graph, expanded, { counts });
    const render = styleFor(projection.graph, projection.collapsedIds, projection.hiddenCounts);

    const phase = render('phase:spec');
    expect(projection.hiddenCounts.get('phase:spec')).toBe(1054);
    expect(String(phase.style.labelText).endsWith(' · 1.1k')).toBe(true);
    expect(phase.style.labelMaxWidth).toBeGreaterThanOrEqual(200);
  });

  it('计数为 0 的可见叶子不带后缀，也不显示徽标', () => {
    const graph = countFixture();
    const counts = computeDescendantCounts(graph);
    const expanded = new Set([
      ...collapsedTopLevelExpansion(graph),
      'category:knowledge',
      'phase:spec',
      'phase:plan',
    ]);
    const projection = projectVisibleGraph(graph, expanded, { counts });
    const render = styleFor(projection.graph, projection.collapsedIds, projection.hiddenCounts);
    const leaf = render('leaf:0');

    expect(projection.hiddenCounts.get('leaf:0')).toBe(0);
    expect(String(leaf.style.labelText)).toBe('内容节点 0');
    expect(leaf.style.iconText).toBeUndefined();
  });

  it('计数节点的标签在任何标签密度与缩放下都必须可见', () => {
    for (const labelDensity of ['auto', 'focus'] as const) {
      expect(
        shouldShowNodeLabel({
          collapsed: false,
          depth: 3,
          focusActive: true,
          focused: false,
          hasHiddenCount: true,
          labelDensity,
          node: node('leaf:0', 'knowledge', '内容节点 0', 'knowledge'),
          selected: false,
          visibleIndex: 999,
          zoom: 0.5,
        }),
      ).toBe(true);
    }
  });

  it('折叠但计数为 0 的聚合仍保留「 · 0」（既有契约不回退）', () => {
    const graph = countFixture();
    const counts = new Map<string, number>([['category:knowledge', 0]]);
    const render = styleFor(graph, new Set(['category:knowledge']), counts);
    const category = render('category:knowledge');

    expect(String(category.style.labelText)).toBe('知识产物 · 0');
    expect(category.style.iconText).toBe('0');
  });
});
