import type { GraphNode, GraphNodeKind } from '../../../data/build-knowledge-graph.js';
import { LABEL_LINE_HEIGHT_RATIO, estimateLabelTextWidth } from './knowledge-graph-label-text.js';
import { LABEL_OFFSET_Y, resolveNodeLabelGeometry } from './knowledge-graph-style.js';

export { estimateLabelTextWidth } from './knowledge-graph-label-text.js';

type KnowledgeGraphLabelDensity = 'auto' | 'all' | 'focus';

export interface NodeLabelVisibility {
  meta: boolean;
  title: boolean;
}

const LABEL_BUDGET = 80;
/** `auto` 默认展开到该深度：根 + 分组 + 其直接子节点，保证可辨读而不是只显示 5 个骨架标签。 */
const AUTO_LABEL_MAX_DEPTH = 2;

/** 参与碰撞消歧的标签候选；坐标为该节点在布局后的最终位置。 */
export interface LabelCandidate {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly depth: number;
  readonly persisted: boolean;
  /** 选中或聚焦：优先级高于普通内容节点，不应因标签密度被丢弃。 */
  readonly highlighted: boolean;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly label: string;
  /** 折叠聚合标签：字号 / 宽度上限按 `radius` 放宽，文本按「名称 · 数量」预截断。 */
  readonly aggregate?: boolean;
  /** 折叠聚合的后代数量；与 `aggregate` 同时存在时决定标签尾部计数。 */
  readonly descendantCount?: number;
  /** 输入序号：作为最终稳定排序键，保证结果与输入顺序无关。 */
  readonly index: number;
}

/** 节点渲染足迹：关键圆 + 主层柔光盘；主层绘制在标签层之上，标签落进足迹即被遮断。 */
export interface LabelObstacle {
  /** 节点 id；用于把标签**自身**的足迹排除在遮挡判定之外（标签盒已按足迹下移，此处仅作兜底）。 */
  readonly id?: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface SelectVisibleLabelsOptions {
  /** 最多绘制的标签数；缺省沿用 `LABEL_BUDGET`。 */
  readonly budget?: number;
  /** 额外避让的节点圆；绘制在标签层之上的节点会遮挡文字，需一并排除。 */
  readonly obstacles?: readonly LabelObstacle[];
}

/** 标签包围盒（图像坐标系，左上为原点）。 */
export interface LabelBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * 标签盒：水平居中于节点、紧贴节点**渲染足迹**的下沿。
 *
 * 几何全部来自 `resolveNodeLabelGeometry` —— 与绘制层 `buildNodeStyle` 同一份事实来源：
 *   - 字号 / 宽度上限 / 预截断文本（只裁名称、保住计数）；
 *   - 垂直锚点取**足迹半径**（关键圆 + 主层柔光盘，柔光盘绘制在标签层之上），并叠加
 *     `LABEL_OFFSET_Y` 的净空。只避让关键圆会让标签顶部落进自身柔光盘里被压淡——
 *     半径越大越明显（枢纽盘尤为显著）。
 */
export function estimateLabelBox(candidate: LabelCandidate): LabelBox {
  const geometry = resolveNodeLabelGeometry({
    collapsed: candidate.aggregate === true,
    count: candidate.descendantCount ?? 0,
    depth: candidate.depth,
    label: candidate.label,
    radius: candidate.radius,
  });
  const width = Math.min(
    estimateLabelTextWidth(geometry.text, geometry.fontSize),
    geometry.maxWidth,
  );
  const top = candidate.y + geometry.footprintRadius + LABEL_OFFSET_Y;
  return {
    left: candidate.x - width / 2,
    right: candidate.x + width / 2,
    top,
    bottom: top + geometry.fontSize * LABEL_LINE_HEIGHT_RATIO,
  };
}

function boxesIntersect(left: LabelBox, right: LabelBox): boolean {
  return (
    left.left < right.right &&
    right.left < left.right &&
    left.top < right.bottom &&
    right.top < left.bottom
  );
}

/** 盒与圆是否重叠：取盒内离圆心最近的点，比较其到圆心的距离与半径。 */
function boxIntersectsCircle(box: LabelBox, circle: LabelObstacle): boolean {
  const closestX = Math.min(Math.max(circle.x, box.left), box.right);
  const closestY = Math.min(Math.max(circle.y, box.top), box.bottom);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy < circle.radius * circle.radius;
}

/** 层级优先级：workspace → category → 普通内容节点。 */
function kindPriority(kind: GraphNodeKind): number {
  if (kind === 'workspace') {
    return 0;
  }
  if (kind === 'category') {
    return 1;
  }
  return 2;
}

/**
 * 候选优先级（高在前）：workspace / category 骨架 → 选中或聚焦 → 折叠聚合 → 已入库 →
 * 深度更浅 → 原始序号。纯比较函数且不含随机性，因此同一输入集合永远得到同一顺序。
 */
function compareCandidates(left: LabelCandidate, right: LabelCandidate): number {
  const kindDiff = kindPriority(left.kind) - kindPriority(right.kind);
  if (kindDiff !== 0) {
    return kindDiff;
  }
  if (left.highlighted !== right.highlighted) {
    return left.highlighted ? -1 : 1;
  }
  const leftAggregate = carriesCount(left);
  const rightAggregate = carriesCount(right);
  if (leftAggregate !== rightAggregate) {
    return leftAggregate ? -1 : 1;
  }
  if (left.persisted !== right.persisted) {
    return left.persisted ? -1 : 1;
  }
  if (left.depth !== right.depth) {
    return left.depth - right.depth;
  }
  return left.index - right.index;
}

/**
 * 绝不被丢弃的候选（用于**预算与标签间竞争**）：骨架（workspace / category）与选中 / 聚焦。
 * 折叠聚合虽然优先级很高，但仍需避让节点圆——否则长聚合标签会横跨同环邻居的圆盘。
 * 即骨架 / 聚合只在「与更低优先级标签竞争」时受保护，不允许为它破坏「零可见重叠」的硬目标。
 */
function isNeverDropped(candidate: LabelCandidate): boolean {
  return (
    candidate.highlighted ||
    kindPriority(candidate.kind) <= 1 ||
    (candidate.descendantCount ?? 0) > 0
  );
}

/** 标签是否承载计数（折叠聚合，或自身已展开但仍有隐藏后代）：这类标签绝不能被静默省略。 */
function carriesCount(candidate: LabelCandidate): boolean {
  return candidate.aggregate === true || (candidate.descendantCount ?? 0) > 0;
}

/**
 * 唯一对**节点圆盘**也免疫的候选：选中 / 聚焦。它是用户当前视线的锚点，即使局部被压住也必须
 * 显示（其余候选——含骨架 / 折叠聚合——都要清空占用集合，才能达成「零可见重叠」的硬目标）。
 */
function isDiscExempt(candidate: LabelCandidate): boolean {
  return candidate.highlighted;
}

/** 标签盒是否落在某个**其它**节点的渲染足迹上；自身足迹排除（自己的足迹位于标签上方，不构成遮挡）。 */
function isBlockedByDisc(
  candidate: LabelCandidate,
  box: LabelBox,
  obstacles: readonly LabelObstacle[],
): boolean {
  return obstacles.some((circle) => {
    if (circle.id !== undefined && circle.id === candidate.id) {
      return false;
    }
    return boxIntersectsCircle(box, circle);
  });
}

/**
 * 贪心标签消歧：按优先级依次尝试放入候选标签盒。
 *
 * 占用集合 = 已接受标签盒 ∪ **全部节点渲染足迹**（`obstacles`）。标签层绘制在节点主层之下，
 * 因此任何与节点足迹（关键圆 + 柔光盘）相交的标签都会被遮断——无论它是骨架、聚合还是叶子，
 * 都必须清空足迹（唯一例外是选中 / 聚焦标签）。此前只登记关键圆半径，柔光盘会漏过，于是
 * 密集区里贴着邻居圆盘的标签被主层切断，读成 `架构上下文条…` 这类残句。
 *
 * 优先级通过**处理顺序**保证：workspace / category / 选中 / 聚焦 / 折叠聚合先于普通内容标签，
 * 与它们相撞的低优先级标签被丢弃；预算同样只对非保护候选生效。结果只由候选集合决定
 * （内部稳定排序，无随机 / 无 `Date.now()`），可跨渲染稳定复现。
 * `all` 密度模式属于用户显式全量请求，调用方绕过本函数直接全显（见 runtime）。
 */
export function selectVisibleLabels(
  candidates: readonly LabelCandidate[],
  options: SelectVisibleLabelsOptions = {},
): Set<string> {
  const budget = options.budget ?? LABEL_BUDGET;
  const obstacles = options.obstacles ?? [];
  const ordered = [...candidates].sort(compareCandidates);
  const accepted: LabelBox[] = [];
  const visible = new Set<string>();
  for (const candidate of ordered) {
    const protectedCandidate = isNeverDropped(candidate);
    if (visible.size >= budget && !protectedCandidate) {
      continue;
    }
    const box = estimateLabelBox(candidate);
    if (accepted.some((existing) => boxesIntersect(box, existing))) {
      continue;
    }
    if (!isDiscExempt(candidate) && isBlockedByDisc(candidate, box, obstacles)) {
      continue;
    }
    accepted.push(box);
    visible.add(candidate.id);
  }
  return visible;
}

export function shouldShowNodeLabel({
  collapsed,
  depth,
  focusActive,
  focused,
  hasHiddenCount,
  labelDensity,
  node,
  selected,
  visibleIndex,
  zoom,
}: {
  collapsed?: boolean;
  depth: number;
  focusActive: boolean;
  focused: boolean;
  /** 该节点仍有隐藏后代：计数必须始终可见，因此标签也必须始终可见。 */
  hasHiddenCount?: boolean;
  labelDensity: KnowledgeGraphLabelDensity;
  node: GraphNode;
  selected: boolean;
  visibleIndex: number;
  zoom: number;
}): boolean {
  // 折叠聚合是当前层级的「导航标签」：没有它用户看不到自己展开的是哪一组，始终显示。
  // 有隐藏后代的节点同理：计数（` · N`）就写在标签尾部，标签丢了计数也就丢了。
  if (collapsed || hasHiddenCount) {
    return true;
  }
  if (labelDensity === 'all') {
    return true;
  }
  const isSkeleton = node.kind === 'workspace' || node.kind === 'category';
  if (labelDensity === 'focus') {
    if (!focusActive) {
      return isSkeleton;
    }
    return selected || focused || isSkeleton;
  }
  if (selected || isSkeleton) {
    return true;
  }
  if (depth <= AUTO_LABEL_MAX_DEPTH) {
    return visibleIndex < LABEL_BUDGET;
  }
  if (!focused) {
    return false;
  }
  return visibleIndex < LABEL_BUDGET && zoom >= 0.85;
}

export function nodeLabelVisibility({
  collapsed,
  depth,
  focusActive,
  focused,
  hasHiddenCount,
  labelDensity,
  node,
  selected,
  visibleIndex,
  zoom,
}: {
  collapsed?: boolean;
  depth: number;
  focusActive: boolean;
  focused: boolean;
  /** 该节点仍有隐藏后代：计数必须始终可见，因此标签也必须始终可见。 */
  hasHiddenCount?: boolean;
  labelDensity: KnowledgeGraphLabelDensity;
  node: GraphNode;
  selected: boolean;
  visibleIndex: number;
  zoom: number;
}): NodeLabelVisibility {
  const title = shouldShowNodeLabel({
    collapsed,
    depth,
    focusActive,
    focused,
    hasHiddenCount,
    labelDensity,
    node,
    selected,
    visibleIndex,
    zoom,
  });
  if (!title) {
    return { meta: false, title: false };
  }
  if (
    collapsed ||
    hasHiddenCount ||
    node.kind === 'workspace' ||
    node.kind === 'category' ||
    selected
  ) {
    return { meta: true, title: true };
  }
  if (labelDensity === 'all') {
    return { meta: zoom >= 0.72, title: true };
  }
  if (labelDensity === 'focus') {
    return { meta: focusActive ? zoom >= 0.92 : false, title: true };
  }
  return { meta: zoom >= 1.05 && visibleIndex < Math.floor(LABEL_BUDGET * 0.72), title: true };
}
