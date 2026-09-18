import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../../data/build-knowledge-graph.js';
import {
  estimateLabelBox,
  estimateLabelTextWidth,
  selectVisibleLabels,
  type LabelBox,
  type LabelCandidate,
} from './knowledge-graph-labels.js';
import {
  buildAggregateLabelText,
  aggregateLabelFontSizeForRadius,
  aggregateLabelMaxWidthForRadius,
} from './knowledge-graph-label-text.js';
import { aggregateRadiusFor } from './knowledge-graph-layout.js';
import type { GraphNodeModel } from './knowledge-graph-model.js';
import {
  LABEL_OFFSET_Y,
  buildNodeStyle,
  formatAggregateCount,
  labelFontSizeForDepth,
  labelFontSizeForNode,
  labelMaxWidthForDepth,
  labelMaxWidthForNode,
  labelTextForNode,
  nodeDrawnRadius,
  nodeFootprintRadius,
  resolveNodeLabelGeometry,
  type GraphPalette,
} from './knowledge-graph-style.js';

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

function makeCandidate(overrides: Partial<LabelCandidate> & Pick<LabelCandidate, 'id'>) {
  return {
    kind: 'knowledge',
    depth: 1,
    persisted: false,
    highlighted: false,
    x: 100,
    y: 100,
    radius: 14,
    label: '节点标签',
    index: 0,
    ...overrides,
  } satisfies LabelCandidate;
}

function makeGraphNode(
  overrides: Pick<GraphNode, 'id' | 'kind' | 'label' | 'group'> & Partial<GraphNode>,
): GraphNode {
  return {
    content: null,
    detail: null,
    memoryType: null,
    persistedMemoryId: null,
    roleLayers: null,
    searchText: null,
    sourceRef: null,
    state: null,
    ...overrides,
  };
}

function makeAggregateModel(input: {
  id: string;
  label: string;
  depth: number;
  count: number;
}): GraphNodeModel {
  return {
    id: input.id,
    kind: 'category',
    group: 'knowledge',
    label: input.label,
    detail: null,
    phase: null,
    depth: input.depth,
    persisted: false,
    roleLayers: null,
    node: makeGraphNode({
      id: input.id,
      kind: 'category',
      label: input.label,
      group: 'knowledge',
    }),
    collapsed: true,
    descendantCount: input.count,
  };
}

function aggregateCandidate(input: {
  id: string;
  label: string;
  x: number;
  y: number;
  count: number;
  index: number;
  depth?: number;
  radius?: number;
}): LabelCandidate {
  return makeCandidate({
    id: input.id,
    kind: 'category',
    depth: input.depth ?? 1,
    highlighted: false,
    aggregate: true,
    descendantCount: input.count,
    radius: input.radius ?? aggregateRadiusFor(input.count),
    label: input.label,
    x: input.x,
    y: input.y,
    index: input.index,
  });
}

const AGGREGATE_LABEL = 'knowledge:规格、计划、任务、实现与评审产物';

describe('selectVisibleLabels', () => {
  it('同一位置的两节点只保留优先级更高者（workspace 胜过普通节点），且与输入顺序无关', () => {
    const workspace = makeCandidate({ id: 'ws', kind: 'workspace', index: 0 });
    const content = makeCandidate({ id: 'content', index: 1 });

    const visible = selectVisibleLabels([content, workspace]);

    expect(visible.has('ws')).toBe(true);
    expect(visible.has('content')).toBe(false);
    expect(visible.size).toBe(1);
  });

  it('相距很远的两节点都保留标签', () => {
    const left = makeCandidate({ id: 'left', x: 100, y: 100, index: 0 });
    const right = makeCandidate({ id: 'right', x: 600, y: 400, index: 1 });

    const visible = selectVisibleLabels([left, right]);

    expect([...visible].sort()).toEqual(['left', 'right']);
  });

  it('选中节点即使深度更深、与更浅的普通节点碰撞也绝不被丢弃', () => {
    const selected = makeCandidate({ id: 'selected', depth: 3, highlighted: true, index: 1 });
    const shallower = makeCandidate({ id: 'shallower', depth: 0, index: 0 });

    const visible = selectVisibleLabels([shallower, selected]);

    expect(visible.has('selected')).toBe(true);
    expect(visible.has('shallower')).toBe(false);
  });

  it('选中节点与更深节点碰撞时保留选中节点', () => {
    const selected = makeCandidate({ id: 'selected', depth: 0, highlighted: true, index: 0 });
    const deeper = makeCandidate({ id: 'deeper', depth: 4, index: 1 });

    const visible = selectVisibleLabels([selected, deeper]);

    expect(visible.has('selected')).toBe(true);
    expect(visible.has('deeper')).toBe(false);
  });

  it('结果确定：同一集合无论顺序如何都得到同一可见集合', () => {
    const candidates = [
      makeCandidate({ id: 'a', kind: 'category', x: 120, y: 120, index: 0 }),
      makeCandidate({ id: 'b', x: 120, y: 120, index: 1 }),
      makeCandidate({ id: 'c', x: 125, y: 122, index: 2 }),
      makeCandidate({ id: 'd', x: 500, y: 300, index: 3 }),
    ];

    const first = selectVisibleLabels(candidates);
    const repeated = selectVisibleLabels(candidates);
    const reversed = selectVisibleLabels([...candidates].reverse());

    expect(repeated).toEqual(first);
    expect([...reversed].sort()).toEqual([...first].sort());
    expect(first.has('d')).toBe(true);
  });

  it('预算之外的普通候选不再绘制，但高亮候选不受预算限制', () => {
    const candidates = [
      makeCandidate({ id: 'normal', x: 900, y: 900, index: 0 }),
      makeCandidate({ id: 'pinned', x: 100, y: 100, highlighted: true, index: 1 }),
    ];

    const visible = selectVisibleLabels(candidates, { budget: 0 });

    expect(visible.has('normal')).toBe(false);
    expect(visible.has('pinned')).toBe(true);
  });

  it('落在其他节点圆上的标签被丢弃；仅选中 / 聚焦豁免，自身圆盘不算遮挡', () => {
    const candidate = makeCandidate({ id: 'node', x: 100, y: 100, radius: 14, index: 0 });
    const blocking = { id: 'other', x: 100, y: 130, radius: 14 };

    expect(selectVisibleLabels([candidate]).has('node')).toBe(true);
    expect(selectVisibleLabels([candidate], { obstacles: [blocking] }).has('node')).toBe(false);
    // 骨架（category）不再是圆盘豁免项：必须清空邻居圆盘，否则长分类标签会被节点压碎。
    expect(
      selectVisibleLabels([makeCandidate({ id: 'cat', kind: 'category' })], {
        obstacles: [blocking],
      }).has('cat'),
    ).toBe(false);
    // 选中 / 聚焦是唯一的圆盘豁免：用户视线锚点必须显示。
    expect(
      selectVisibleLabels([makeCandidate({ id: 'sel', highlighted: true })], {
        obstacles: [blocking],
      }).has('sel'),
    ).toBe(true);
    // 自身圆盘排除（`id` 匹配）：标签落在自己节点下方，不构成遮挡。
    expect(
      selectVisibleLabels([candidate], {
        obstacles: [{ id: 'node', x: candidate.x, y: candidate.y, radius: candidate.radius }],
      }).has('node'),
    ).toBe(true);
  });
});

describe('密集场景零重叠（占用集合含节点圆盘）', () => {
  function boxesOverlap(left: LabelBox, right: LabelBox): boolean {
    return (
      left.left < right.right &&
      right.left < left.right &&
      left.top < right.bottom &&
      right.top < left.bottom
    );
  }

  function boxHitsDisc(
    box: LabelBox,
    disc: { readonly x: number; readonly y: number; readonly radius: number },
  ): boolean {
    const closestX = Math.min(Math.max(disc.x, box.left), box.right);
    const closestY = Math.min(Math.max(disc.y, box.top), box.bottom);
    const dx = disc.x - closestX;
    const dy = disc.y - closestY;
    return dx * dx + dy * dy < disc.radius * disc.radius;
  }

  function buildDenseScene(): {
    candidates: LabelCandidate[];
    obstacles: Array<{ id: string; x: number; y: number; radius: number }>;
  } {
    const columns = 10;
    const rows = 8;
    const candidates: LabelCandidate[] = [];
    const obstacles: Array<{ id: string; x: number; y: number; radius: number }> = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const id = `dense-${row}-${column}`;
        const x = 200 + column * 44;
        const y = 200 + row * 42;
        const radius = 14;
        candidates.push(
          makeCandidate({
            id,
            depth: 3,
            x,
            y,
            radius,
            label: `密集标签 ${row}-${column}：验证圆盘与标签盒同时避让`,
            index: row * columns + column,
          }),
        );
        obstacles.push({ id, x, y, radius });
      }
    }
    return { candidates, obstacles };
  }

  it('每个被接受的标签盒都清空其它标签盒与全部节点圆盘', () => {
    const { candidates, obstacles } = buildDenseScene();

    const visible = selectVisibleLabels(candidates, { obstacles });
    expect(visible.size).toBeGreaterThan(0);
    expect(visible.size).toBeLessThan(candidates.length);

    const boxes = candidates
      .filter((candidate) => visible.has(candidate.id))
      .map((candidate) => estimateLabelBox(candidate));

    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        expect(boxesOverlap(boxes[left] ?? boxes[0]!, boxes[right] ?? boxes[0]!)).toBe(false);
      }
      for (const disc of obstacles) {
        expect(boxHitsDisc(boxes[left] ?? boxes[0]!, disc)).toBe(false);
      }
    }
  });

  it('优先级保持：选中 / 聚焦标签在同等碰撞下胜出，低优先级标签被丢弃', () => {
    const selected = makeCandidate({ id: 'selected', highlighted: true, x: 300, y: 300, index: 1 });
    const low = makeCandidate({ id: 'low', x: 306, y: 302, index: 0 });

    const visible = selectVisibleLabels([low, selected], {
      obstacles: [{ id: 'selected', x: 300, y: 300, radius: 14 }],
    });

    expect(visible.has('selected')).toBe(true);
    expect(visible.has('low')).toBe(false);
  });

  it('结果确定：同一密集场景无论候选顺序如何都得到同一可见集合', () => {
    const { candidates, obstacles } = buildDenseScene();

    const first = selectVisibleLabels(candidates, { obstacles });
    const repeated = selectVisibleLabels(candidates, { obstacles });
    const reversed = selectVisibleLabels([...candidates].reverse(), { obstacles });

    expect(repeated).toEqual(first);
    expect([...reversed].sort()).toEqual([...first].sort());
  });
});

describe('estimateLabelBox', () => {
  it('标签盒清空节点自身的渲染足迹（枢纽大盘 / 折叠聚合 / 叶子）', () => {
    const candidates = [
      makeCandidate({ id: 'hub', radius: 40, x: 400, y: 400, descendantCount: 1200 }),
      aggregateCandidate({
        id: 'agg',
        label: '知识产物',
        x: 200,
        y: 200,
        count: 1055,
        index: 1,
        radius: 16,
      }),
      makeCandidate({ id: 'leaf', radius: 14, x: 100, y: 100 }),
    ];
    for (const candidate of candidates) {
      const geometry = resolveNodeLabelGeometry({
        collapsed: candidate.aggregate === true,
        count: candidate.descendantCount ?? 0,
        depth: candidate.depth,
        label: candidate.label,
        radius: candidate.radius,
      });
      const box = estimateLabelBox(candidate);
      expect(box.top - candidate.y).toBeGreaterThanOrEqual(geometry.footprintRadius);
      expect(
        boxHitsDisc(box, { x: candidate.x, y: candidate.y, radius: geometry.footprintRadius }),
      ).toBe(false);
    }
  });

  it('盒宽被 labelMaxWidthForDepth 截断，且水平居中于节点', () => {
    const candidate = makeCandidate({
      id: 'long',
      depth: 0,
      label: '这是一个非常非常非常长的中文知识节点标签用于验证截断上限',
    });

    const box = estimateLabelBox(candidate);

    expect(box.right - box.left).toBeLessThanOrEqual(labelMaxWidthForDepth(0));
    expect((box.left + box.right) / 2).toBeCloseTo(candidate.x, 5);
    expect(box.top).toBeCloseTo(candidate.y + footprintRadiusFor(candidate) + LABEL_OFFSET_Y, 5);
    expect(box.bottom).toBeGreaterThan(box.top);
  });

  it('全角字形按约 1em、拉丁字形按约 0.66em 估算，并带统一安全余量（估算只允许偏大）', () => {
    const wide = estimateLabelTextWidth('中文', 14);
    const narrow = estimateLabelTextWidth('ab', 14);
    expect(wide).toBeGreaterThan(narrow);
    const emPerWide = wide / (2 * 14);
    const emPerNarrow = narrow / (2 * 14);
    expect(emPerWide).toBeGreaterThanOrEqual(1);
    expect(emPerWide).toBeLessThanOrEqual(1.06);
    expect(emPerNarrow / emPerWide).toBeCloseTo(0.66, 1);
  });

  it('省略号按全角估算：不会被当作窄字形而低估截断后的宽度', () => {
    expect(estimateLabelTextWidth('…', 12)).toBeGreaterThan(estimateLabelTextWidth('a', 12));
  });
});

describe('聚合标签估算与绘制的宽度一致性', () => {
  it('估算盒使用与绘制完全相同的字号、宽度上限与「名称 · 数量」文本', () => {
    const count = 942;
    const model = makeAggregateModel({
      id: 'category:knowledge',
      label: AGGREGATE_LABEL,
      depth: 1,
      count,
    });
    const radius = aggregateRadiusFor(count);
    const fontSize = labelFontSizeForNode(model.depth, true, radius);
    const maxWidth = labelMaxWidthForNode(model.depth, true, radius);
    const rendered = labelTextForNode(model, fontSize, maxWidth);

    const box = estimateLabelBox(
      aggregateCandidate({ id: model.id, label: model.label, x: 200, y: 200, count, index: 0 }),
    );

    expect(fontSize).toBe(aggregateLabelFontSizeForRadius(radius));
    expect(maxWidth).toBe(aggregateLabelMaxWidthForRadius(radius));
    expect(fontSize).toBeGreaterThan(labelFontSizeForDepth(model.depth));
    expect(maxWidth).toBeGreaterThan(labelMaxWidthForDepth(model.depth));
    expect(rendered.endsWith(` · ${formatAggregateCount(count)}`)).toBe(true);
    expect(box.right - box.left).toBeCloseTo(
      Math.min(estimateLabelTextWidth(rendered, fontSize), maxWidth),
      5,
    );
  });

  it('真实盒相撞的两个聚合不会同时绘制，相距很远的两个都会绘制', () => {
    const near = aggregateCandidate({
      id: 'agg-near',
      label: AGGREGATE_LABEL,
      x: 300,
      y: 300,
      count: 942,
      index: 0,
    });
    const nearSibling = aggregateCandidate({
      id: 'agg-near-sibling',
      label: 'memory:项目记忆、个人记忆与经验沉淀',
      x: 340,
      y: 300,
      count: 320,
      index: 1,
    });
    const far = aggregateCandidate({
      id: 'agg-far',
      label: 'governance:团队宪法与执行约束规则集合',
      x: 1200,
      y: 760,
      count: 40,
      index: 2,
    });

    const nearBox = estimateLabelBox(near);
    const siblingBox = estimateLabelBox(nearSibling);
    const boxesActuallyCollide = nearBox.left < siblingBox.right && siblingBox.left < nearBox.right;
    expect(boxesActuallyCollide).toBe(true);

    const closeVisible = selectVisibleLabels([near, nearSibling]);
    expect(closeVisible.has('agg-near')).toBe(true);
    expect(closeVisible.has('agg-near-sibling')).toBe(false);

    const spreadVisible = selectVisibleLabels([near, far]);
    expect([...spreadVisible].sort()).toEqual(['agg-far', 'agg-near']);
  });

  it('宽度不足时只截断名称，计数始终完整且最多一个省略号', () => {
    const count = 1234;
    const fontSize = aggregateLabelFontSizeForRadius(aggregateRadiusFor(count));
    const maxWidth = aggregateLabelMaxWidthForRadius(aggregateRadiusFor(count));
    const narrow = buildAggregateLabelText(
      '这是一个非常非常非常长的中文分类名称用于验证截断只裁名称',
      count,
      { fontSize, maxWidth: 150 },
    );

    expect(narrow.endsWith(` · ${formatAggregateCount(count)}`)).toBe(true);
    expect((narrow.match(/…/gu) ?? []).length).toBeLessThanOrEqual(1);
    expect(estimateLabelTextWidth(narrow, fontSize)).toBeLessThanOrEqual(150);
    expect(narrow).not.toMatch(/[，、：:]\s*…/u);

    const wide = buildAggregateLabelText('记忆与经验', 220, { fontSize, maxWidth });
    expect(wide).toBe('记忆与经验 · 220');
  });

  it('宽度极紧时仍保留名称片段与完整计数，绝不退化为「… · 6」', () => {
    const narrow = buildAggregateLabelText('一个非常非常长的中文聚合名称', 6, {
      fontSize: 15,
      maxWidth: 55,
    });

    expect(narrow.endsWith('6')).toBe(true);
    expect(narrow).not.toBe('…·6');
    expect(narrow).not.toBe('… · 6');
    expect(narrow.startsWith('…')).toBe(false);
    expect((narrow.match(/…/gu) ?? []).length).toBeLessThanOrEqual(1);
    expect(estimateLabelTextWidth(narrow, 15)).toBeLessThanOrEqual(55);
  });

  it('空间连名称都放不下时只保留完整计数（计数永远可读）', () => {
    const countOnly = buildAggregateLabelText('超长名称', 6, { fontSize: 15, maxWidth: 20 });
    expect(countOnly).toBe('6');
  });

  it('拥挤收缩后的聚合半径在绘制与盒估算间保持一致', () => {
    const count = 1080;
    const model = makeAggregateModel({
      id: 'category:knowledge',
      label: AGGREGATE_LABEL,
      depth: 2,
      count,
    });
    const resolvedRadius = 18.5;
    const style = buildNodeStyle(model, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
      radius: resolvedRadius,
    });
    const fontSize = Number(style.labelFontSize);
    const maxWidth = Number(style.labelMaxWidth);
    const text = String(style.labelText);

    expect(fontSize).toBe(labelFontSizeForNode(model.depth, true, resolvedRadius));
    expect(maxWidth).toBe(labelMaxWidthForNode(model.depth, true, resolvedRadius));
    expect(text).toBe(labelTextForNode(model, fontSize, maxWidth));
    expect(text.endsWith(` · ${formatAggregateCount(count)}`)).toBe(true);

    const box = estimateLabelBox(
      aggregateCandidate({
        id: model.id,
        label: model.label,
        x: 200,
        y: 200,
        count,
        index: 0,
        depth: model.depth,
        radius: resolvedRadius,
      }),
    );
    expect(box.right - box.left).toBeCloseTo(
      Math.min(estimateLabelTextWidth(text, fontSize), maxWidth),
      5,
    );
  });
});

function boxesOverlap(left: LabelBox, right: LabelBox): boolean {
  return (
    left.left < right.right &&
    right.left < left.right &&
    left.top < right.bottom &&
    right.top < left.bottom
  );
}

function boxHitsDisc(
  box: LabelBox,
  disc: { readonly x: number; readonly y: number; readonly radius: number },
): boolean {
  const closestX = Math.min(Math.max(disc.x, box.left), box.right);
  const closestY = Math.min(Math.max(disc.y, box.top), box.bottom);
  const dx = disc.x - closestX;
  const dy = disc.y - closestY;
  return dx * dx + dy * dy < disc.radius * disc.radius;
}

function rendererStyleFor(candidate: LabelCandidate) {
  const model: GraphNodeModel = {
    id: candidate.id,
    kind: candidate.aggregate ? 'category' : 'knowledge',
    group: 'knowledge',
    label: candidate.label,
    detail: null,
    phase: null,
    depth: candidate.depth,
    persisted: candidate.persisted,
    roleLayers: null,
    node: makeGraphNode({
      id: candidate.id,
      kind: candidate.aggregate ? 'category' : 'knowledge',
      label: candidate.label,
      group: 'knowledge',
    }),
    collapsed: candidate.aggregate === true,
    descendantCount: candidate.descendantCount ?? 0,
  };
  return buildNodeStyle(model, {
    colorMode: 'group',
    palette: PALETTE,
    focused: false,
    selected: false,
    dimmed: false,
    showLabel: true,
    radius: candidate.radius,
  });
}

function footprintRadiusFor(candidate: LabelCandidate): number {
  return nodeFootprintRadius(
    candidate.aggregate === true,
    candidate.descendantCount ?? 0,
    candidate.radius,
  );
}

function buildDenseRendererScene(): {
  candidates: LabelCandidate[];
  obstacles: Array<{
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly radius: number;
  }>;
} {
  const candidates: LabelCandidate[] = [];
  const obstacles: Array<{
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly radius: number;
  }> = [];

  const aggregateInputs = [
    { id: 'agg-a', x: 232, y: 206, count: 1055, radius: 16 },
    { id: 'agg-b', x: 452, y: 276, count: 9999, radius: 18 },
    { id: 'agg-c', x: 300, y: 468, count: 320, radius: 20 },
  ];
  for (const input of aggregateInputs) {
    const candidate = makeCandidate({
      id: input.id,
      kind: 'category',
      depth: 1,
      aggregate: true,
      descendantCount: input.count,
      radius: input.radius,
      x: input.x,
      y: input.y,
      label: `知识产物聚合：规格、计划、任务与实现评审（第${input.count}条）`,
      index: candidates.length,
    });
    candidates.push(candidate);
    obstacles.push({
      id: candidate.id,
      x: candidate.x,
      y: candidate.y,
      radius: footprintRadiusFor(candidate),
    });
  }

  const columns = 9;
  const rows = 7;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const id = `leaf-${row}-${column}`;
      const candidate = makeCandidate({
        id,
        depth: 2,
        x: 180 + column * 40,
        y: 160 + row * 38,
        radius: 14,
        label: `架构上下文条目：模块边界与长期设计约束（第${row * columns + column}段）`,
        index: candidates.length,
      });
      candidates.push(candidate);
      obstacles.push({ id, x: candidate.x, y: candidate.y, radius: footprintRadiusFor(candidate) });
    }
  }

  return { candidates, obstacles };
}

describe('密集场景零重叠（renderer-effective 几何 · D3 回归锁）', () => {
  it('每个被接受的标签盒同时清空其它标签盒与每一颗节点渲染足迹盘', () => {
    const { candidates, obstacles } = buildDenseRendererScene();

    const visible = selectVisibleLabels(candidates, { obstacles });
    expect(visible.size).toBeGreaterThan(0);
    expect(visible.size).toBeLessThan(candidates.length);

    const accepted = candidates.filter((candidate) => visible.has(candidate.id));
    const boxes = accepted.map((candidate) => ({
      id: candidate.id,
      box: estimateLabelBox(candidate),
    }));

    for (let left = 0; left < boxes.length; left += 1) {
      const leftEntry = boxes[left]!;
      for (let right = left + 1; right < boxes.length; right += 1) {
        expect(boxesOverlap(leftEntry.box, boxes[right]!.box)).toBe(false);
      }
      for (const disc of obstacles) {
        if (disc.id === leftEntry.id) {
          continue;
        }
        expect(boxHitsDisc(leftEntry.box, disc)).toBe(false);
      }
    }
  });

  it('标签盒使用与绘制层完全相同的字号 / 文本 / 顶部锚点（含徽标撑大后的盘半径）', () => {
    const aggregate = aggregateCandidate({
      id: 'agg-shrunk',
      label: '记忆与经验：项目记忆、个人偏好与经验沉淀集合',
      x: 240,
      y: 240,
      count: 1055,
      radius: 16,
      index: 0,
    });
    const leaf = makeCandidate({
      id: 'leaf',
      depth: 2,
      x: 300,
      y: 300,
      radius: 14,
      label: '架构上下文条目：模块边界与长期设计约束（第十二段）',
      index: 1,
    });

    for (const candidate of [aggregate, leaf]) {
      const style = rendererStyleFor(candidate);
      const geometry = resolveNodeLabelGeometry({
        collapsed: candidate.aggregate === true,
        count: candidate.descendantCount ?? 0,
        depth: candidate.depth,
        label: candidate.label,
        radius: candidate.radius,
      });
      const box = estimateLabelBox(candidate);

      expect(geometry.text).toBe(style.labelText);
      expect(geometry.fontSize).toBe(style.labelFontSize);
      expect(geometry.maxWidth).toBe(style.labelMaxWidth);
      expect(geometry.discRadius).toBe(Number(style.size) / 2);
      expect(box.top).toBeCloseTo(
        candidate.y + Number(style.size) / 2 + Number(style.labelOffsetY),
        5,
      );
      expect(box.right - box.left).toBeCloseTo(
        Math.min(
          estimateLabelTextWidth(String(style.labelText), Number(style.labelFontSize)),
          Number(style.labelMaxWidth),
        ),
        5,
      );
    }

    expect(nodeDrawnRadius(true, 1055, 16)).toBeGreaterThan(16);
  });

  it('结果确定：同一密集 renderer 场景无论顺序如何都得到同一可见集合', () => {
    const { candidates, obstacles } = buildDenseRendererScene();

    const first = selectVisibleLabels(candidates, { obstacles });
    const repeated = selectVisibleLabels(candidates, { obstacles });
    const reversed = selectVisibleLabels([...candidates].reverse(), { obstacles });

    expect(repeated).toEqual(first);
    expect([...reversed].sort()).toEqual([...first].sort());
  });
});

describe('优先级保持（workspace / category / selected / focused / aggregate 不被丢弃）', () => {
  it('同位置竞争时五类受保护标签全部保留，普通标签被丢弃', () => {
    const x = 400;
    const y = 400;
    const protectedCandidates: readonly LabelCandidate[] = [
      makeCandidate({ id: 'workspace', kind: 'workspace', x, y, index: 0 }),
      makeCandidate({ id: 'category', kind: 'category', x, y, index: 1 }),
      makeCandidate({ id: 'selected', x, y, highlighted: true, index: 2 }),
      makeCandidate({ id: 'focused', x, y, highlighted: true, index: 3 }),
      makeCandidate({
        id: 'aggregate',
        kind: 'category',
        x,
        y,
        aggregate: true,
        descendantCount: 320,
        radius: 16,
        index: 4,
      }),
    ];

    for (const protectedCandidate of protectedCandidates) {
      const low = makeCandidate({ id: 'low', x, y, index: 99 });
      const visible = selectVisibleLabels([low, protectedCandidate]);
      expect(visible.has(protectedCandidate.id)).toBe(true);
      expect(visible.has('low')).toBe(false);
    }
  });
});

describe('聚合计数不可截断（D4 回归锁）', () => {
  const LONG_AGGREGATE_NAME = '记忆与经验：项目记忆、个人偏好与长期经验沉淀集合';

  it('折叠聚合的绘制文本始终以「 · N」结尾，长名称也只裁名称', () => {
    const count = 1055;
    const model = makeAggregateModel({
      id: 'category:memory',
      label: LONG_AGGREGATE_NAME,
      depth: 1,
      count,
    });
    const style = buildNodeStyle(model, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
      radius: 18.5,
    });

    const text = String(style.labelText);
    expect(text.endsWith(` · ${formatAggregateCount(count)}`)).toBe(true);
    expect((text.match(/…/gu) ?? []).length).toBeLessThanOrEqual(1);
    expect(String(style.iconText)).toBe(formatAggregateCount(count));
  });

  it('折叠但后代计数为 0 时仍保留完整计数「 · 0」，绝不退化为无计数名称', () => {
    const model = makeAggregateModel({
      id: 'category:empty',
      label: LONG_AGGREGATE_NAME,
      depth: 1,
      count: 0,
    });
    const style = buildNodeStyle(model, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
      radius: 20,
    });

    expect(String(style.labelText).endsWith(' · 0')).toBe(true);
    expect(String(style.iconText)).toBe('0');
    expect(labelTextForNode(model, Number(style.labelFontSize), Number(style.labelMaxWidth))).toBe(
      String(style.labelText),
    );
  });
});
