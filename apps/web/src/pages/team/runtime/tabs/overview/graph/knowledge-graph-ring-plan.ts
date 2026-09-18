/**
 * 知识图谱 · 逐深度环带规划（纯函数，无 DOM / G6 / React）。
 *
 * 从 `knowledge-graph-layout.ts` 拆出：布局层只负责角度扇区与最终坐标，环半径 / 子环拆分
 * 属于「占用预算」职责，单独成模块以便独立推理与测试。
 *
 * 规划方向由**最深（外）层向内**：深层先占用它需要的半径，内层再落在深层内子环让出的边界
 * 之内。某深度节点暴增时会拆成多条同心子环（`planRingBands`），而不是把整圈压成一条相互
 * 重叠的链；更浅的层因此可能被向内收拢——这是换取「环上节点始终可读」的必要代价。
 */

import type { GraphModel, GraphNodeModel } from './knowledge-graph-model.js';
import { planRingBands, radialClearance, type RingNodeInput } from './knowledge-graph-radius.js';

/** 逐深度环带规划结果：每个节点的环带半径、最终盘半径 / 角度，以及各深度的环带半径列表。 */
export interface RingAssignment {
  readonly bandRadiusById: ReadonlyMap<string, number>;
  readonly resolvedRadiusById: ReadonlyMap<string, number>;
  readonly angleById: ReadonlyMap<string, number>;
  readonly bandRadiiByDepth: ReadonlyMap<number, readonly number[]>;
  /** 各深度规划后的实际最大节点半径（供第二轮用真实足迹重算径向净空）。 */
  readonly effectiveMaxByDepth: ReadonlyMap<number, number>;
}

export interface PlanRingsInput {
  readonly model: GraphModel;
  readonly angles: ReadonlyMap<string, number>;
  readonly spans: ReadonlyMap<string, { readonly start: number; readonly end: number }>;
  readonly maxRadius: number;
  /** 圆心节点的半径，用于推导最内层的下界。 */
  readonly rootRadius: number;
  /** 节点的标称（未考虑拥挤）半径。 */
  readonly nominalRadiusOf: (node: GraphNodeModel) => number;
  /** 该深度的设计半径（拥挤时才向外长或拆环）。 */
  readonly designRadiusOf: (depth: number) => number;
  /** 上一轮规划得到的实际最大半径；用于第二轮用真实足迹重算净空。 */
  readonly effectiveMaxByDepth?: ReadonlyMap<number, number>;
}

export function planRings(input: PlanRingsInput): RingAssignment {
  const { model, angles, spans, maxRadius, rootRadius, nominalRadiusOf, designRadiusOf } = input;
  const effectiveMaxByDepth = input.effectiveMaxByDepth ?? new Map<number, number>();

  const nominalRadiusById = new Map<string, number>();
  const aggregateById = new Map<string, { aggregate: boolean; count: number }>();
  for (const node of model.nodes) {
    nominalRadiusById.set(node.id, nominalRadiusOf(node));
    const collapsedCount = node.collapsed === true ? (node.descendantCount ?? 0) : 0;
    aggregateById.set(node.id, { aggregate: collapsedCount > 0, count: collapsedCount });
  }

  const parentByChild = new Map<string, string>();
  for (const [parentId, childIds] of model.childrenOf) {
    for (const childId of childIds) {
      parentByChild.set(childId, parentId);
    }
  }

  const nodesByDepth = new Map<number, GraphNodeModel[]>();
  for (const node of model.nodes) {
    if (node.depth < 1 || node.depth > model.maxDepth) {
      continue;
    }
    const siblings = nodesByDepth.get(node.depth);
    if (siblings) {
      siblings.push(node);
    } else {
      nodesByDepth.set(node.depth, [node]);
    }
  }

  const nominalMaxByDepth = new Map<number, number>();
  for (const [depth, depthNodes] of nodesByDepth) {
    let max = 0;
    for (const node of depthNodes) {
      max = Math.max(max, nominalRadiusOf(node));
    }
    nominalMaxByDepth.set(depth, max);
  }
  const maxRadiusByDepth = (depth: number): number =>
    effectiveMaxByDepth.get(depth) ?? nominalMaxByDepth.get(depth) ?? 0;
  /**
   * 逐深度**链式**下界：第 d 层的环内沿必须同时让出「根 + 更浅各层」的空间。
   *
   * 旧实现每一层的下界都只按根半径推导，于是深层（子环多）可以一路铺到很靠内的半径；
   * 更浅层被挤到 `outerLimit < innerBound` 时，`clampBetween` 会退化成把该层放在
   * `innerBound` —— 也就是**压在更深层的内子环上**（D2 里分类盘与内容盘相交、根盘与内容盘
   * 相交都是这一处造成的）。链式下界让 `outerLimit(d) ≥ innerBound(d)` 恒成立，
   * 于是「更浅层向内收拢」永远不会收进更深层的盘里。
   */
  const innerBoundByDepth = new Map<number, number>();
  let reservedInner = 0;
  for (let depth = 1; depth <= model.maxDepth; depth += 1) {
    const currentMax = maxRadiusByDepth(depth);
    if (depth === 1) {
      reservedInner = radialClearance(rootRadius, currentMax);
    } else {
      reservedInner += radialClearance(maxRadiusByDepth(depth - 1), currentMax);
    }
    innerBoundByDepth.set(depth, reservedInner);
  }

  const bandRadiusById = new Map<string, number>();
  const resolvedRadiusById = new Map<string, number>();
  const angleById = new Map<string, number>();
  const bandRadiiByDepth = new Map<number, readonly number[]>();
  const effectiveMaxResult = new Map<number, number>();
  let deeperInnerRadius: number | null = null;
  let deeperMaxRadius = 0;

  for (let depth = model.maxDepth; depth >= 1; depth -= 1) {
    const nodes = nodesByDepth.get(depth);
    if (!nodes || nodes.length === 0) {
      continue;
    }
    const ordered = [...nodes].sort((left, right) => {
      const angleDiff = (angles.get(left.id) ?? 0) - (angles.get(right.id) ?? 0);
      return angleDiff !== 0 ? angleDiff : left.id.localeCompare(right.id, 'zh-CN');
    });
    const ringNodes: RingNodeInput[] = ordered.map((node) => {
      const meta = aggregateById.get(node.id);
      const parentId = parentByChild.get(node.id) ?? null;
      const angle = angles.get(node.id) ?? 0;
      const parentSpan = parentId === null ? undefined : spans.get(parentId);
      return {
        id: node.id,
        parentId,
        radius: nominalRadiusById.get(node.id) ?? 0,
        aggregate: meta?.aggregate ?? false,
        count: meta?.count ?? 0,
        angle,
        parentSpanStart: parentSpan?.start ?? angle,
        parentSpanEnd: parentSpan?.end ?? angle,
      };
    });
    const nominalMax = ringNodes.reduce((max, node) => Math.max(max, node.radius), 0);
    const estimatedMax = effectiveMaxByDepth.get(depth) ?? nominalMax;
    const innerBound = Math.min(
      maxRadius,
      Math.max(radialClearance(rootRadius, estimatedMax), innerBoundByDepth.get(depth) ?? 0),
    );
    const outerLimit =
      deeperInnerRadius === null
        ? maxRadius
        : Math.min(maxRadius, deeperInnerRadius - radialClearance(estimatedMax, deeperMaxRadius));
    const plan = planRingBands({
      nodes: ringNodes,
      innerBound,
      outerLimit,
      designRadius: designRadiusOf(depth),
    });
    for (const band of plan.bands) {
      for (const entry of band.entries) {
        bandRadiusById.set(entry.id, band.radius);
        resolvedRadiusById.set(
          entry.id,
          plan.nodeRadiusById.get(entry.id) ?? nominalRadiusById.get(entry.id) ?? 0,
        );
      }
    }
    for (const [id, angle] of plan.angleById) {
      angleById.set(id, angle);
    }
    bandRadiiByDepth.set(
      depth,
      plan.bands.map((band) => band.radius).sort((left, right) => left - right),
    );
    const innermost = plan.bands.reduce(
      (min, band) => Math.min(min, band.radius),
      Number.POSITIVE_INFINITY,
    );
    if (Number.isFinite(innermost)) {
      deeperInnerRadius = innermost;
    }
    deeperMaxRadius = plan.maxRadius;
    effectiveMaxResult.set(depth, plan.maxRadius);
  }

  return {
    bandRadiusById,
    resolvedRadiusById,
    angleById,
    bandRadiiByDepth,
    effectiveMaxByDepth: effectiveMaxResult,
  };
}

/**
 * 节点到相邻环带的最小径向间距；用于约束有机半径偏移。返回 null 表示不做半径偏移
 * （深层最外环、游离节点，或相邻深度缺失）。
 */
export function radialGapForNode(
  node: GraphNodeModel,
  rings: RingAssignment,
  maxDepth: number,
  maxRadius: number,
): number | null {
  if (node.depth < 1 || node.depth > maxDepth) {
    return null;
  }
  const bandRadius = rings.bandRadiusById.get(node.id);
  if (bandRadius === undefined) {
    return null;
  }
  const sameDepth = rings.bandRadiiByDepth.get(node.depth) ?? [];
  let outerNeighbor: number | null = null;
  for (const candidate of sameDepth) {
    if (candidate > bandRadius + 1e-9) {
      outerNeighbor = candidate;
      break;
    }
  }
  if (outerNeighbor === null) {
    if (node.depth >= maxDepth) {
      outerNeighbor = maxRadius;
    } else {
      outerNeighbor = rings.bandRadiiByDepth.get(node.depth + 1)?.[0] ?? null;
    }
  }
  let innerNeighbor: number | null = null;
  for (let index = sameDepth.length - 1; index >= 0; index -= 1) {
    const candidate = sameDepth[index];
    if (candidate !== undefined && candidate < bandRadius - 1e-9) {
      innerNeighbor = candidate;
      break;
    }
  }
  if (innerNeighbor === null) {
    if (node.depth > 1) {
      const shallower = rings.bandRadiiByDepth.get(node.depth - 1);
      innerNeighbor = shallower?.[shallower.length - 1] ?? null;
    } else {
      innerNeighbor = 0;
    }
  }
  if (outerNeighbor === null || innerNeighbor === null) {
    return null;
  }
  return Math.min(outerNeighbor - bandRadius, bandRadius - innerNeighbor);
}
